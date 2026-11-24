/**
 * Solvability check. We know the true grammar, so instead of searching all grammars we search its
 * neighbourhood: "competitor" grammars a human might plausibly arrive at instead (Bozhanov & Derzhanski's
 * parasitic solutions). A competitor that reproduces every corpus sentence but answers a test item
 * differently makes the puzzle ambiguous.
 *
 * Competitor families (single edits; pairs of near-miss edits are also tried):
 *   wordOrder      any other S/O/V order, or the lone subject on the other side of the verb
 *   particleSide   negation particle on the other side of the verb
 *   condition      a morpheme's condition replaced, narrowed (C & Q, C & not Q) or widened (C or Q), with Q
 *                  ranging over role sets, number, definiteness, animacy, humanness, first-noun position,
 *                  stem vowels, transitivity, tense and polarity. This covers "the suffix marks animates",
 *                  "marks the first noun", plural/definiteness conflation, subject vs absolutive agreement,
 *                  split ergativity by tense, and so on.
 *   slotOrder      two affixes on the same side in the other order
 *   reduplication  another copy size, "first consonant + fixed vowel", or a fixed prefix
 *   harmony        no harmony (always back / always front) or allomorphs chosen by another feature
 *   boundary       a morpheme boundary shifted by one letter (stem "taku" + "-n" vs "tak" + "-un")
 *   circumfixSplit the two halves of a circumfix read as independent morphemes
 *   adjective      adjective on the other side of the noun; noun-phrase morphology on the head only,
 *                  copied onto the adjective (number, or number and case), or on the phrase's last word
 *   possessor      possessor on the other side of the possessed noun (possessor- vs possessed-marking is
 *                  covered by the condition family: GEN "appears when: possessed noun")
 *   adverbPosition the manner/time word in any other position
 *
 * Known gaps: competitors never invent new morpheme strings beyond one-letter boundary shifts, never
 * posit free word order, and never reanalyse a stem as two morphemes. The explicit evidence check
 * (every test morpheme seen twice, every test word seen) backs these up.
 */

import {
  cloneGrammar, describeCondition, featureCondition, NOUN_FEATURES, VERB_FEATURES, WORD_ORDERS,
  type AdjectiveRules, type AdverbPosition, type Condition, type Feature, type Grammar, type Morpheme, type Role,
} from "./grammar";
import { englishSentence, type EnglishLexicon, type EnglishOptions } from "./english";
import { relatedMeanings, type Meaning } from "./meaning";
import { resolveHarmony, VOWEL_LETTERS } from "./phonology";
import { realise, sentenceText } from "./realise";

export interface Competitor { family: string; description: string; grammar: Grammar }

export interface TestItem { meaning: Meaning; direction: "toEnglish" | "toLang" }

export interface CheckContext {
  grammar: Grammar;
  corpus: Meaning[];
  tests: TestItem[];
  english: EnglishLexicon;
  englishOptions: EnglishOptions;
}

export interface CompetitorVerdict {
  competitor: Competitor;
  /** Index of the first corpus sentence the competitor gets wrong, or -1 if it reproduces them all. */
  killedBy: number;
  /** Test items it answers differently (only meaningful when killedBy is -1). */
  disagreesOn: number[];
}

const ALL_ROLE_SETS: Role[][] = [["A"], ["S"], ["P"], ["A", "S"], ["S", "P"], ["A", "P"], ["A", "S", "P"]];

function containsRole(condition: Condition): boolean {
  switch (condition.type) {
    case "role": return true;
    case "not": return containsRole(condition.inner);
    case "and": case "or": return containsRole(condition.left) || containsRole(condition.right);
    default: return false;
  }
}

function replaceRoles(condition: Condition, roles: Role[]): Condition {
  switch (condition.type) {
    case "role": return { type: "role", roles };
    case "not": return { type: "not", inner: replaceRoles(condition.inner, roles) };
    case "and": case "or":
      return { type: condition.type, left: replaceRoles(condition.left, roles), right: replaceRoles(condition.right, roles) };
    default: return condition;
  }
}

function mentionsFeature(condition: Condition, feature: Feature): boolean {
  switch (condition.type) {
    case "feature": return condition.feature === feature;
    case "not": return mentionsFeature(condition.inner, feature);
    case "and": case "or": return mentionsFeature(condition.left, feature) || mentionsFeature(condition.right, feature);
    default: return false;
  }
}

/** Features the player can actually observe in this language (no tense contrast -> "past" is meaningless). */
function observableFeatures(grammar: Grammar, host: Morpheme["host"]): Feature[] {
  const dimensions = grammar.info.dimensions;
  return (host === "noun" ? NOUN_FEATURES : VERB_FEATURES).filter(feature =>
    !(feature === "past" && !dimensions.tense) &&
    !((feature === "possessor" || feature === "possessed") && !dimensions.possession) &&
    !(feature === "pastTimeWord" && !grammar.lexicon.adverbs.some(adverb => adverb.requiresPast)) &&
    !(feature === "definite" && !grammar.info.dimensions.definiteness) &&
    !(feature === "frontStem" && !grammar.phonology.harmony));
}

/** Alternative conditions for a morpheme: role reassignments, narrowings, widenings, replacements. */
function alternativeConditions(grammar: Grammar, morpheme: Morpheme): { condition: Condition; description: string }[] {
  const original = morpheme.condition;
  const alternatives: { condition: Condition; description: string }[] = [];
  if (containsRole(original))
    for (const roles of ALL_ROLE_SETS) {
      const condition = replaceRoles(original, roles);
      alternatives.push({ condition, description: describeCondition(condition) });
    }
  for (const feature of observableFeatures(grammar, morpheme.host)) {
    if (mentionsFeature(original, feature)) continue;
    const featureOnly = featureCondition(feature);
    const notFeature: Condition = { type: "not", inner: featureOnly };
    for (const condition of [
      featureOnly,
      { type: "and", left: original, right: featureOnly },
      { type: "and", left: original, right: notFeature },
      { type: "or", left: original, right: featureOnly },
    ] as Condition[])
      alternatives.push({ condition, description: describeCondition(condition) });
  }
  return alternatives.filter(alternative => JSON.stringify(alternative.condition) !== JSON.stringify(original));
}

/** "-ka/-ke" style name, with harmony placeholders spelled out. */
const morphemeName = (grammar: Grammar, morpheme: Morpheme) => {
  const exponent = morpheme.exponent;
  const spelled = (affix: string) => [...new Set([resolveHarmony(grammar.phonology, affix, false), resolveHarmony(grammar.phonology, affix, true)])];
  switch (exponent.kind) {
    case "suffix": return spelled(exponent.form).map(form => `-${form}`).join("/");
    case "prefix": return `${exponent.form}-`;
    case "circumfix": return `${exponent.prefix}-…-${spelled(exponent.suffix).join("/")}`;
    case "particle": return exponent.form;
    case "reduplication": return `${exponent.copy} reduplication`;
    case "consonantCopyPrefix": return `C${exponent.vowel}- copy`;
  }
};

const isPrefixLike = (morpheme: Morpheme) =>
  ["prefix", "reduplication", "consonantCopyPrefix", "circumfix"].includes(morpheme.exponent.kind);
const isSuffixLike = (morpheme: Morpheme) => ["suffix", "circumfix"].includes(morpheme.exponent.kind);

/** Every single-edit competitor of the true grammar. */
export function singleEditCompetitors(grammar: Grammar): Competitor[] {
  const competitors: Competitor[] = [];
  const add = (family: string, description: string, edit: (candidate: Grammar) => void) => {
    const candidateGrammar = cloneGrammar(grammar);
    edit(candidateGrammar);
    competitors.push({ family, description, grammar: candidateGrammar });
  };

  for (const order of WORD_ORDERS)
    if (order !== grammar.wordOrder) add("wordOrder", `word order ${order}`, candidate => { candidate.wordOrder = order; });
  add("wordOrder", `lone subject ${grammar.intransitiveSubjectFirst ? "after" : "before"} the verb`,
    candidate => { candidate.intransitiveSubjectFirst = !grammar.intransitiveSubjectFirst; });

  grammar.morphemes.forEach((morpheme, index) => {
    const exponent = morpheme.exponent;
    if (exponent.kind === "particle")
      add("particleSide", `${exponent.form} goes on the other side of the verb`, candidate => {
        const candidateExponent = candidate.morphemes[index].exponent;
        if (candidateExponent.kind === "particle") candidateExponent.side = exponent.side === "before" ? "after" : "before";
      });

    for (const alternative of alternativeConditions(grammar, morpheme))
      add("condition", `${morphemeName(grammar, morpheme)} appears when: ${alternative.description}`, candidate => {
        candidate.morphemes[index].condition = alternative.condition;
      });

    if (exponent.kind === "reduplication") {
      for (const copy of ["full", "CV", "CVC"] as const)
        if (copy !== exponent.copy)
          add("reduplication", `plural copies ${copy}`, candidate => { candidate.morphemes[index].exponent = { kind: "reduplication", copy }; });
      for (const vowel of grammar.phonology.vowels)
        add("reduplication", `plural is first consonant + ${vowel}`, candidate => {
          candidate.morphemes[index].exponent = { kind: "consonantCopyPrefix", vowel };
        });
      for (const noun of grammar.lexicon.nouns) {
        const fixed = new RegExp(`^[^${VOWEL_LETTERS}]*[${VOWEL_LETTERS}]`).exec(noun.form)?.[0] ?? "";
        add("reduplication", `plural is a fixed prefix ${fixed}-`, candidate => {
          candidate.morphemes[index].exponent = { kind: "prefix", form: fixed };
        });
      }
    }

    if (exponent.kind === "circumfix")
      for (const feature of VERB_FEATURES.filter(feature => feature !== "negative"))
        for (const suffixCondition of [featureCondition(feature), {
          type: "and", left: featureCondition("negative"), right: featureCondition(feature),
        } as Condition])
          add("circumfixSplit", `${exponent.prefix}- is negation, -${exponent.suffix.toLowerCase()} marks ${describeCondition(suffixCondition)}`, candidate => {
            candidate.morphemes[index].exponent = { kind: "prefix", form: exponent.prefix };
            candidate.morphemes.push({
              id: "SPLIT", gloss: "X", host: "verb", slot: morpheme.slot,
              exponent: { kind: "suffix", form: exponent.suffix }, condition: suffixCondition,
            });
          });

    // Boundary shifts: the affix absorbs a stem letter, or gives its first letter to every stem.
    if (exponent.kind === "suffix" || exponent.kind === "prefix") {
      const stems = morpheme.host === "noun" ? grammar.lexicon.nouns : grammar.lexicon.verbs;
      const edgeLetters = new Set(stems.map(entry => exponent.kind === "suffix" ? entry.form.slice(-1) : entry.form[0]));
      for (const letter of edgeLetters)
        add("boundary", `${morphemeName(grammar, morpheme)} is really ${exponent.kind === "suffix" ? `-${letter}${exponent.form}` : `${exponent.form}${letter}-`}`, candidate => {
          const candidateStems = morpheme.host === "noun" ? candidate.lexicon.nouns : candidate.lexicon.verbs;
          for (const entry of candidateStems) {
            if (exponent.kind === "suffix" && entry.form.endsWith(letter)) entry.form = entry.form.slice(0, -1);
            if (exponent.kind === "prefix" && entry.form.startsWith(letter)) entry.form = entry.form.slice(1);
          }
          candidate.morphemes[index].exponent = exponent.kind === "suffix"
            ? { kind: "suffix", form: letter + exponent.form } : { kind: "prefix", form: exponent.form + letter };
        });
      if (exponent.form.length >= 2)
        add("boundary", `${morphemeName(grammar, morpheme)} is shorter; its edge letter belongs to the stems`, candidate => {
          const candidateStems = morpheme.host === "noun" ? candidate.lexicon.nouns : candidate.lexicon.verbs;
          for (const entry of candidateStems)
            entry.form = exponent.kind === "suffix" ? entry.form + exponent.form[0] : exponent.form.slice(-1) + entry.form;
          candidate.morphemes[index].exponent = exponent.kind === "suffix"
            ? { kind: "suffix", form: exponent.form.slice(1) } : { kind: "prefix", form: exponent.form.slice(0, -1) };
        });
    }
  });

  // Affix order.
  for (let i = 0; i < grammar.morphemes.length; i++)
    for (let j = i + 1; j < grammar.morphemes.length; j++) {
      const first = grammar.morphemes[i], second = grammar.morphemes[j];
      if (first.host !== second.host) continue;
      if (!(isSuffixLike(first) && isSuffixLike(second)) && !(isPrefixLike(first) && isPrefixLike(second))) continue;
      add("slotOrder", `${morphemeName(grammar, first)} and ${morphemeName(grammar, second)} in the other order`, candidate => {
        [candidate.morphemes[i].slot, candidate.morphemes[j].slot] = [second.slot, first.slot];
      });
    }

  if (grammar.adjectives) {
    const rules = grammar.adjectives;
    add("adjective", `adjective goes ${rules.position === "before" ? "after" : "before"} the noun`, candidate => {
      candidate.adjectives = { ...rules, position: rules.position === "before" ? "after" : "before" };
    });
    const caseIds = grammar.morphemes.filter(morpheme => ["ACC", "ERG"].includes(morpheme.id)).map(morpheme => morpheme.id);
    const allIds = grammar.morphemes.filter(morpheme => morpheme.host === "noun").map(morpheme => morpheme.id);
    const markings: AdjectiveRules[] = [
      { position: rules.position, marking: "head", concord: [] },
      { position: rules.position, marking: "concord", concord: ["PL"] },
      { position: rules.position, marking: "concord", concord: ["PL", ...caseIds] },
      { position: rules.position, marking: "concord", concord: allIds },
      { position: "after", marking: "edge", concord: [] },
      { position: "before", marking: "edge", concord: [] },
    ];
    for (const marking of markings)
      if (JSON.stringify(marking) !== JSON.stringify(rules))
        add("adjective", `noun-phrase endings: ${marking.marking}${marking.concord.length ? ` (${marking.concord.join("+")} copied)` : ""}, adjective ${marking.position}`,
          candidate => { candidate.adjectives = marking; });
  }
  if (grammar.possessorPosition)
    add("possessor", `possessor goes ${grammar.possessorPosition === "before" ? "after" : "before"} the possessed noun`, candidate => {
      candidate.possessorPosition = grammar.possessorPosition === "before" ? "after" : "before";
    });
  if (grammar.adverbPosition)
    for (const position of ["initial", "final", "beforeVerb", "afterVerb"] as AdverbPosition[])
      if (position !== grammar.adverbPosition)
        add("adverbPosition", `adverb position: ${position}`, candidate => { candidate.adverbPosition = position; });

  if (grammar.harmonyCondition) {
    add("harmony", "no vowel harmony: suffixes always have back vowels", candidate => { candidate.harmonyCondition = { type: "never" }; });
    add("harmony", "no vowel harmony: suffixes always have front vowels", candidate => { candidate.harmonyCondition = { type: "always" }; });
    for (const feature of observableFeatures(grammar, "noun").filter(feature => feature !== "frontStem"))
      for (const condition of [featureCondition(feature), { type: "not", inner: featureCondition(feature) } as Condition])
        add("harmony", `suffix vowels depend on: ${describeCondition(condition)}`, candidate => { candidate.harmonyCondition = condition; });
  }
  return competitors;
}

const TOP_LEVEL_FIELDS = ["wordOrder", "intransitiveSubjectFirst", "harmonyCondition", "adjectives", "possessorPosition", "adverbPosition"] as const;

/** Combine two single edits (applied in sequence) into one competitor. */
function combine(grammar: Grammar, first: Competitor, second: Competitor): Competitor | null {
  if (first.family === second.family && first.family !== "condition") return null;
  // Re-derive the second edit on top of the first by diffing it against the true grammar.
  const combined = cloneGrammar(first.grammar);
  let changed = false;
  for (const field of TOP_LEVEL_FIELDS)
    if (JSON.stringify(second.grammar[field]) !== JSON.stringify(grammar[field])) {
      if (JSON.stringify(first.grammar[field]) !== JSON.stringify(grammar[field])) return null; // both edit it
      Object.assign(combined, { [field]: second.grammar[field] });
    }
  second.grammar.morphemes.forEach((morpheme, index) => {
    const original = grammar.morphemes[index];
    if (!original) { combined.morphemes.push({ ...morpheme }); return; }
    if (JSON.stringify(morpheme) !== JSON.stringify(original)) {
      if (JSON.stringify(combined.morphemes[index]) !== JSON.stringify(original)) changed = true; // both edit it
      combined.morphemes[index] = { ...morpheme, exponent: { ...morpheme.exponent } };
    }
  });
  if (changed) return null;
  if (second.family === "boundary" || second.family === "lexicalSwap") combined.lexicon = second.grammar.lexicon;
  return { family: `${first.family}+${second.family}`, description: `${first.description}; and ${second.description}`, grammar: combined };
}

/** Readings of a sentence under a grammar: meanings with the same lexemes that realise to the same text. */
function readings(grammar: Grammar, text: string, candidates: Meaning[]): Meaning[] {
  return candidates.filter(meaning => {
    try { return sentenceText(realise(grammar, meaning)) === text; } catch { return false; }
  });
}

export interface Checker {
  evaluate(competitor: Competitor): CompetitorVerdict;
  corpusMismatches(competitor: Competitor): number;
}

export function makeChecker(context: CheckContext): Checker {
  const { grammar, corpus, tests, english, englishOptions } = context;
  const corpusTexts = corpus.map(meaning => sentenceText(realise(grammar, meaning)));
  const testTexts = tests.map(test => sentenceText(realise(grammar, test.meaning)));
  // Computed lazily: only competitors that survive the corpus need to read the test sentences.
  const readingCandidates = new Map<number, Meaning[]>();
  const candidatesFor = (index: number) => {
    if (!readingCandidates.has(index))
      readingCandidates.set(index, relatedMeanings(grammar.lexicon, grammar.info.dimensions, tests[index].meaning));
    return readingCandidates.get(index)!;
  };
  const trueEnglish = tests.map(test => englishSentence(test.meaning, english, englishOptions));

  const realiseText = (candidateGrammar: Grammar, meaning: Meaning) => {
    try { return sentenceText(realise(candidateGrammar, meaning)); } catch { return "\u0000"; }
  };

  return {
    corpusMismatches(competitor) {
      return corpus.filter((meaning, index) => realiseText(competitor.grammar, meaning) !== corpusTexts[index]).length;
    },
    evaluate(competitor) {
      const killedBy = corpus.findIndex((meaning, index) => realiseText(competitor.grammar, meaning) !== corpusTexts[index]);
      const disagreesOn: number[] = [];
      if (killedBy === -1)
        tests.forEach((test, index) => {
          if (test.direction === "toLang") {
            if (realiseText(competitor.grammar, test.meaning) !== testTexts[index]) disagreesOn.push(index);
          } else {
            // A competitor that cannot read the sentence at all gives no rival answer.
            const rivalReadings = readings(competitor.grammar, testTexts[index], candidatesFor(index));
            if (rivalReadings.some(meaning => englishSentence(meaning, english, englishOptions) !== trueEnglish[index]))
              disagreesOn.push(index);
          }
        });
      return { competitor, killedBy, disagreesOn };
    },
  };
}

export interface CheckResult {
  verdicts: CompetitorVerdict[];
  /** Competitors that fit the corpus but change a test answer. Empty = unique answers (within this space). */
  harmful: CompetitorVerdict[];
}

/** Run all single-edit competitors, plus pairs of single edits that each miss at most two corpus sentences. */
export function checkSolvability(context: CheckContext, maxPairs = 3000): CheckResult {
  const checker = makeChecker(context);
  const singles = singleEditCompetitors(context.grammar);
  const verdicts = singles.map(competitor => checker.evaluate(competitor));
  const nearMisses = singles.filter((competitor, index) =>
    verdicts[index].killedBy !== -1 && checker.corpusMismatches(competitor) <= 2);
  let pairCount = 0;
  outer: for (let i = 0; i < nearMisses.length; i++)
    for (let j = i + 1; j < nearMisses.length; j++) {
      const pair = combine(context.grammar, nearMisses[i], nearMisses[j]);
      if (!pair) continue;
      verdicts.push(checker.evaluate(pair));
      if (++pairCount >= maxPairs) break outer;
    }
  return { verdicts, harmful: verdicts.filter(verdict => verdict.killedBy === -1 && verdict.disagreesOn.length > 0) };
}

/** Competitors that swap two stems of the same kind, or the spellings of two affixes on the same host. */
export function swapCompetitors(grammar: Grammar): Competitor[] {
  const competitors: Competitor[] = [];
  const lexiconLists = ["nouns", "verbs", "adjectives", "adverbs"] as const;
  for (const listName of lexiconLists) {
    const entries = grammar.lexicon[listName];
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++) {
        const candidate = cloneGrammar(grammar);
        const list = candidate.lexicon[listName];
        [list[i].form, list[j].form] = [list[j].form, list[i].form];
        competitors.push({ family: "lexicalSwap", description: `"${entries[i].form}" means ${entries[j].id} and "${entries[j].form}" means ${entries[i].id}`, grammar: candidate });
      }
  }
  for (let i = 0; i < grammar.morphemes.length; i++)
    for (let j = i + 1; j < grammar.morphemes.length; j++) {
      if (grammar.morphemes[i].host !== grammar.morphemes[j].host) continue;
      const candidate = cloneGrammar(grammar);
      const [first, second] = [candidate.morphemes[i], candidate.morphemes[j]];
      [first.exponent, second.exponent] = [second.exponent, first.exponent];
      competitors.push({ family: "exponentSwap", description: `${morphemeName(grammar, grammar.morphemes[i])} and ${morphemeName(grammar, grammar.morphemes[j])} swap meanings`, grammar: candidate });
    }
  return competitors;
}

export interface ShuffleCheck {
  /** Rows whose English line stays in place. Empty when no anchor set makes the pairing unique. */
  anchors: number[];
  unique: boolean;
  /** Rival pairings found (each is row -> English line), and the grammar that produced the first one. */
  rivalCount: number;
  rival?: string;
}

/**
 * Shuffled days: the player must also work out which English line belongs to which sentence.
 *
 * Method: take a hypothesis space H = the true grammar, every single-edit competitor, every swap of two
 * stems or two affix spellings, every pair of stem swaps, and every stem swap combined with a single
 * edit. For each G in H, realise every English line's meaning under G. Corpus sentences are distinct
 * strings, so if the realisations are exactly the corpus sentences in some order, G explains the data
 * under one and only one pairing (string equality fixes it), and we record that pairing. No search over
 * the n! pairings is needed. The puzzle is uniquely pairable (within H) if every recorded pairing other
 * than the true one moves at least one anchor row; we choose 1-2 anchors to make that so.
 *
 * Limits: like the main check, this only covers grammars near the true one. A player could in principle
 * hold a wilder analysis; H was chosen to include the confusions shuffling invites (which word is which).
 */
export function checkShufflePairing(grammar: Grammar, corpus: Meaning[], rng: { shuffle<T>(items: readonly T[]): T[] }): ShuffleCheck {
  const corpusTexts = corpus.map(meaning => sentenceText(realise(grammar, meaning)));
  const rowOf = new Map(corpusTexts.map((text, row) => [text, row]));
  const singles = singleEditCompetitors(grammar);
  const swaps = swapCompetitors(grammar);
  const lexicalSwaps = swaps.filter(competitor => competitor.family === "lexicalSwap");
  const hypotheses: Competitor[] = [{ family: "true", description: "the true grammar", grammar }, ...singles, ...swaps];
  for (let i = 0; i < lexicalSwaps.length; i++) {
    for (let j = i + 1; j < lexicalSwaps.length; j++) {
      const pairGrammar = cloneGrammar(grammar);
      pairGrammar.lexicon = combineLexicons(grammar, lexicalSwaps[i].grammar, lexicalSwaps[j].grammar);
      hypotheses.push({ family: "lexicalSwap+lexicalSwap", description: `${lexicalSwaps[i].description}; and ${lexicalSwaps[j].description}`, grammar: pairGrammar });
    }
    for (const single of singles) {
      const pair = combine(grammar, single, lexicalSwaps[i]);
      if (pair) hypotheses.push(pair);
    }
  }

  const rivalPairings: { pairing: number[]; description: string }[] = [];
  const seen = new Set<string>();
  for (const hypothesis of hypotheses) {
    const pairing: number[] = new Array(corpus.length);
    let explains = true;
    for (let line = 0; line < corpus.length && explains; line++) {
      let text: string;
      try { text = sentenceText(realise(hypothesis.grammar, corpus[line])); } catch { explains = false; break; }
      const row = rowOf.get(text);
      if (row === undefined || pairing[row] !== undefined) explains = false;
      else pairing[row] = line;
    }
    if (!explains) continue;
    const key = pairing.join(",");
    if (pairing.every((line, row) => line === row) || seen.has(key)) continue;
    seen.add(key);
    rivalPairings.push({ pairing, description: hypothesis.description });
  }
  if (!rivalPairings.length) return { anchors: [rng.shuffle(corpus.map((_, row) => row))[0]], unique: true, rivalCount: 0 };
  // Find 1-2 anchor rows that every rival pairing moves.
  const rows = rng.shuffle(corpus.map((_, row) => row));
  const movesAll = (anchors: number[]) => rivalPairings.every(rival => anchors.some(anchor => rival.pairing[anchor] !== anchor));
  for (const anchor of rows) if (movesAll([anchor])) return { anchors: [anchor], unique: true, rivalCount: rivalPairings.length };
  for (const first of rows) for (const second of rows)
    if (first < second && movesAll([first, second])) return { anchors: [first, second], unique: true, rivalCount: rivalPairings.length };
  return { anchors: [], unique: false, rivalCount: rivalPairings.length, rival: rivalPairings[0].description };
}

/** Apply two independent stem swaps to one lexicon. */
function combineLexicons(grammar: Grammar, first: Grammar, second: Grammar): Grammar["lexicon"] {
  const lexicon = cloneGrammar(first).lexicon;
  for (const listName of ["nouns", "verbs", "adjectives", "adverbs"] as const)
    lexicon[listName].forEach((entry, index) => {
      if (second.lexicon[listName][index].form !== grammar.lexicon[listName][index].form) entry.form = second.lexicon[listName][index].form;
    });
  return lexicon;
}

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
 *
 * Known gaps: competitors never invent new morpheme strings beyond one-letter boundary shifts, never
 * posit free word order, and never reanalyse a stem as two morphemes. The explicit evidence check
 * (every test morpheme seen twice, every test word seen) backs these up.
 */

import {
  cloneGrammar, describeCondition, featureCondition, NOUN_FEATURES, VERB_FEATURES, WORD_ORDERS,
  type Condition, type Feature, type Grammar, type Morpheme, type Role,
} from "./grammar";
import { englishSentence, type EnglishLexicon, type EnglishOptions } from "./english";
import { lexemesOf, type Meaning } from "./meaning";
import { resolveHarmony } from "./phonology";
import { realise, sentenceText } from "./realise";

export interface Competitor { family: string; description: string; grammar: Grammar }

export interface TestItem { meaning: Meaning; direction: "toEnglish" | "toLang" }

export interface CheckContext {
  grammar: Grammar;
  corpus: Meaning[];
  tests: TestItem[];
  /** All meanings the lexicon allows, used to read test sentences under a competitor grammar. */
  meaningPool: Meaning[];
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
  return (host === "noun" ? NOUN_FEATURES : VERB_FEATURES).filter(feature =>
    !(feature === "past" && !grammar.info.dimensions.tense) &&
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
        const fixed = /^[^aeiouäöü]*[aeiouäöü]/.exec(noun.form)?.[0] ?? "";
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

  if (grammar.harmonyCondition) {
    add("harmony", "no vowel harmony: suffixes always have back vowels", candidate => { candidate.harmonyCondition = { type: "never" }; });
    add("harmony", "no vowel harmony: suffixes always have front vowels", candidate => { candidate.harmonyCondition = { type: "always" }; });
    for (const feature of observableFeatures(grammar, "noun").filter(feature => feature !== "frontStem"))
      for (const condition of [featureCondition(feature), { type: "not", inner: featureCondition(feature) } as Condition])
        add("harmony", `suffix vowels depend on: ${describeCondition(condition)}`, candidate => { candidate.harmonyCondition = condition; });
  }
  return competitors;
}

/** Combine two single edits (applied in sequence) into one competitor. */
function combine(grammar: Grammar, first: Competitor, second: Competitor): Competitor | null {
  if (first.family === second.family && first.family !== "condition") return null;
  // Re-derive the second edit on top of the first by diffing it against the true grammar.
  const combined = cloneGrammar(first.grammar);
  if (second.grammar.wordOrder !== grammar.wordOrder) combined.wordOrder = second.grammar.wordOrder;
  if (second.grammar.intransitiveSubjectFirst !== grammar.intransitiveSubjectFirst)
    combined.intransitiveSubjectFirst = second.grammar.intransitiveSubjectFirst;
  if (JSON.stringify(second.grammar.harmonyCondition) !== JSON.stringify(grammar.harmonyCondition))
    combined.harmonyCondition = second.grammar.harmonyCondition;
  let changed = false;
  second.grammar.morphemes.forEach((morpheme, index) => {
    const original = grammar.morphemes[index];
    if (!original) { combined.morphemes.push({ ...morpheme }); return; }
    if (JSON.stringify(morpheme) !== JSON.stringify(original)) {
      if (JSON.stringify(combined.morphemes[index]) !== JSON.stringify(original)) changed = true; // both edit it
      combined.morphemes[index] = { ...morpheme, exponent: { ...morpheme.exponent } };
    }
  });
  if (changed) return null;
  if (second.family === "boundary") combined.lexicon = second.grammar.lexicon;
  return { family: `${first.family}+${second.family}`, description: `${first.description}; and ${second.description}`, grammar: combined };
}

/** Readings of a sentence under a grammar: meanings with the same lexemes that realise to the same text. */
function readings(grammar: Grammar, text: string, candidates: Meaning[]): Meaning[] {
  return candidates.filter(meaning => {
    try { return sentenceText(realise(grammar, meaning)) === text; } catch { return false; }
  });
}

function sameLexemes(first: Meaning, second: Meaning): boolean {
  return [...lexemesOf(first)].sort().join() === [...lexemesOf(second)].sort().join();
}

export interface Checker {
  evaluate(competitor: Competitor): CompetitorVerdict;
  corpusMismatches(competitor: Competitor): number;
}

export function makeChecker(context: CheckContext): Checker {
  const { grammar, corpus, tests, meaningPool, english, englishOptions } = context;
  const corpusTexts = corpus.map(meaning => sentenceText(realise(grammar, meaning)));
  const testTexts = tests.map(test => sentenceText(realise(grammar, test.meaning)));
  const testReadingCandidates = tests.map(test => meaningPool.filter(meaning => sameLexemes(meaning, test.meaning)));
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
            const rivalReadings = readings(competitor.grammar, testTexts[index], testReadingCandidates[index]);
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

/**
 * Data selection. Tests are chosen first; the corpus is then built greedily so that every word and
 * morpheme a test needs is evidenced (morphemes at least twice), and grown in a counterexample-guided
 * loop: while some competitor grammar fits the corpus but answers a test differently, add a sentence on
 * which that competitor and the true grammar disagree.
 */

import type { Rng } from "./rng";
import { checkSolvability, type CheckContext, type CheckResult, type TestItem } from "./checker";
import type { Grammar, Morpheme } from "./grammar";
import type { EnglishLexicon, EnglishOptions } from "./english";
import { isAnimate } from "./lexicon";
import { lexemesOf, meaningDistance, meaningKey, meaningPool, type Meaning, type NounPhrase } from "./meaning";
import { realise, sentenceText, type RealisedWord } from "./realise";

export const MIN_CORPUS = 6;
export const MAX_CORPUS = 10;
/** Each test must differ from every corpus sentence in at least this many lexemes/features. */
const MIN_TEST_DISTANCE = 2;

export interface Selection {
  corpus: Meaning[];
  tests: TestItem[];
  check: CheckResult;
  /** Competitors that forced an extra corpus sentence during the loop (the interesting ones). */
  blocked: string[];
}

/** Morpheme evidence key: which morpheme, in which spelling (harmony allomorphs count separately). */
const morphemeKeys = (words: RealisedWord[]) =>
  words.flatMap(word => word.applied.map(applied =>
    applied.morpheme.exponent.kind === "reduplication" ? applied.morpheme.id : `${applied.morpheme.id}:${applied.form}`));

function exercisesHeadline(grammar: Grammar, meaning: Meaning, words: RealisedWord[]): boolean {
  const animate = (noun: string) => isAnimate(grammar.lexicon.nouns.find(entry => entry.id === noun)!);
  switch (grammar.info.headline) {
    case "ergative": return meaning.object ? true : animate(meaning.subject.noun);
    case "differentialObject":
    case "wordOrder": return !!meaning.object;
    case "reduplication": return meaning.subject.plural || !!meaning.object?.plural;
    case "circumfix": return meaning.negative;
    case "harmony": return words.some(word => word.applied.some(applied => isHarmonising(applied.morpheme)));
    case "definiteness": return !meaning.subject.definite || !!(meaning.object && !meaning.object.definite);
    case "possessive": return phrases(meaning).some(phrase => !!phrase.possessor);
    case "adjectivePhrase": return phrases(meaning).some(phrase => !!phrase.adjective && phrase.plural);
  }
}

const phrases = (meaning: Meaning): NounPhrase[] => [meaning.subject, ...(meaning.object ? [meaning.object] : [])];
const hasStructure = (meaning: Meaning) => !!meaning.adverb || phrases(meaning).some(phrase => !!phrase.adjective || !!phrase.possessor);

/** Does this morpheme have a vowel-harmony placeholder (uppercase vowel)? */
export function isHarmonising(morpheme: Morpheme): boolean {
  const exponent = morpheme.exponent;
  return (exponent.kind === "suffix" && /[A-Z]/.test(exponent.form)) || (exponent.kind === "circumfix" && /[A-Z]/.test(exponent.suffix));
}

const morphemeCount = (words: RealisedWord[]) => words.reduce((sum, word) => sum + word.applied.length, 0);

function chooseTests(rng: Rng, grammar: Grammar, pool: Meaning[]): TestItem[] | null {
  const transitive = pool.filter(meaning => meaning.object);
  const intransitive = pool.filter(meaning => !meaning.object);
  const dimensions = grammar.info.dimensions;
  const structuresInUse = dimensions.adjectives || dimensions.possession || dimensions.adverbs;
  for (let attempt = 0; attempt < 400; attempt++) {
    // One item each way. The into-language item is transitive and must exercise the headline (it carries the aha).
    const toLanguage = rng.pick(transitive);
    const toEnglish = rng.pick(rng.chance(0.7) ? transitive : intransitive);
    const meanings = [toLanguage, toEnglish];
    const words = meanings.map(meaning => realise(grammar, meaning));
    const different = meaningDistance(toLanguage, toEnglish) >= 3;
    const headlineInToLanguage = exercisesHeadline(grammar, toLanguage, words[0]);
    // prefer both items exercising the headline; accept one after many tries
    const headlineInBoth = headlineInToLanguage && exercisesHeadline(grammar, toEnglish, words[1]);
    const rich = words.every(sentence => morphemeCount(sentence) >= 2);
    // On days with adjectives/possessives/adverbs, the into-language item uses one of them.
    const structured = !structuresInUse || hasStructure(toLanguage) || attempt > 300;
    if (different && rich && structured && (headlineInBoth || (attempt > 200 && headlineInToLanguage)))
      return [{ meaning: toLanguage, direction: "toLang" }, { meaning: toEnglish, direction: "toEnglish" }];
  }
  return null;
}

interface Requirement { key: string; need: number; covers: (meaning: Meaning, words: RealisedWord[]) => number }

function requirementsFor(grammar: Grammar, tests: TestItem[]): Requirement[] {
  const requirements = new Map<string, Requirement>();
  const add = (requirement: Requirement) => { if (!requirements.has(requirement.key)) requirements.set(requirement.key, requirement); };
  for (const test of tests) {
    const words = realise(grammar, test.meaning);
    for (const lexeme of lexemesOf(test.meaning))
      add({ key: `lexeme:${lexeme}`, need: 1, covers: meaning => Number(lexemesOf(meaning).includes(lexeme)) });
    for (const key of morphemeKeys(words))
      add({ key: `morpheme:${key}`, need: 2, covers: (_, sentence) => morphemeKeys(sentence).filter(other => other === key).length });
    const clauseType = test.meaning.object ? "transitive" : "intransitive";
    add({ key: `clause:${clauseType}`, need: 2, covers: meaning => Number(!!meaning.object === (clauseType === "transitive")) });
  }
  // Structures in a test need two corpus sentences showing them.
  const structureRequirement = (name: string, present: (meaning: Meaning) => boolean) =>
    add({ key: `structure:${name}`, need: 2, covers: meaning => Number(present(meaning)) });
  for (const test of tests) {
    if (phrases(test.meaning).some(phrase => phrase.adjective)) structureRequirement("adjective", meaning => phrases(meaning).some(phrase => !!phrase.adjective));
    if (phrases(test.meaning).some(phrase => phrase.possessor)) structureRequirement("possessor", meaning => phrases(meaning).some(phrase => !!phrase.possessor));
    if (test.meaning.adverb) structureRequirement("adverb", meaning => !!meaning.adverb);
  }
  // Every structure and morpheme the grammar has must actually show up (twice), or the explanation would
  // describe things the player never saw.
  const dimensions = grammar.info.dimensions;
  if (dimensions.adjectives) structureRequirement("adjective", meaning => phrases(meaning).some(phrase => !!phrase.adjective));
  if (dimensions.possession) structureRequirement("possessor", meaning => phrases(meaning).some(phrase => !!phrase.possessor));
  if (dimensions.adverbs) structureRequirement("adverb", meaning => !!meaning.adverb);
  for (const morpheme of grammar.morphemes)
    add({ key: `morphemeSeen:${morpheme.id}`, need: 2, covers: (_, words) => words.filter(word => word.applied.some(applied => applied.morpheme === morpheme)).length });
  if (grammar.info.headline === "adjectivePhrase") {
    structureRequirement("pluralAdjective", meaning => phrases(meaning).some(phrase => !!phrase.adjective && phrase.plural));
    add({ key: "structure:singularAdjective", need: 1, covers: meaning => Number(phrases(meaning).some(phrase => !!phrase.adjective && !phrase.plural)) });
  }
  if (grammar.info.headline === "possessive") structureRequirement("possessor", meaning => phrases(meaning).some(phrase => !!phrase.possessor));
  const animate = (noun: string) => isAnimate(grammar.lexicon.nouns.find(entry => entry.id === noun)!);
  if (grammar.info.headline === "ergative")
    add({ key: "contrast:animateLoneSubject", need: 2, covers: meaning => Number(!meaning.object && animate(meaning.subject.noun)) });
  if (grammar.info.headline === "differentialObject") {
    const accusative = grammar.morphemes.find(morpheme => morpheme.id === "ACC")!;
    add({ key: "contrast:markedObject", need: 2, covers: (meaning, words) => Number(!!meaning.object && words.some(word => word.applied.some(applied => applied.morpheme === accusative))) });
    add({ key: "contrast:bareObject", need: 2, covers: (meaning, words) => Number(!!meaning.object && !words.some(word => word.applied.some(applied => applied.morpheme === accusative))) });
  }
  return [...requirements.values()];
}

export interface SelectionInput {
  rng: Rng;
  grammar: Grammar;
  english: EnglishLexicon;
  englishOptions: EnglishOptions;
}

export function selectData({ rng, grammar, english, englishOptions }: SelectionInput): Selection | null {
  const pool = meaningPool(grammar.lexicon, grammar.info.dimensions, rng);
  const tests = chooseTests(rng, grammar, pool);
  if (!tests) return null;
  const testLexemes = new Set(tests.flatMap(test => lexemesOf(test.meaning)));
  const candidates = rng.shuffle(pool.filter(meaning =>
    tests.every(test => meaningDistance(meaning, test.meaning) >= MIN_TEST_DISTANCE)));
  const realised = new Map(candidates.map(meaning => [meaningKey(meaning), realise(grammar, meaning)]));
  const wordsOf = (meaning: Meaning) => realised.get(meaningKey(meaning))!;
  const requirements = requirementsFor(grammar, tests);

  const corpus: Meaning[] = [];
  const inCorpus = new Set<string>();
  const remainingNeed = (requirement: Requirement) =>
    requirement.need - corpus.reduce((sum, meaning) => sum + requirement.covers(meaning, wordsOf(meaning)), 0);
  const score = (meaning: Meaning) => {
    let gain = 0;
    for (const requirement of requirements) {
      const missing = remainingNeed(requirement);
      if (missing > 0) gain += Math.min(missing, requirement.covers(meaning, wordsOf(meaning)));
    }
    // Story focus: prefer the cast of the test items. Variety: new verbs and new noun roles.
    const strangers = lexemesOf(meaning).filter(lexeme => !testLexemes.has(lexeme)).length;
    const usedVerbs = new Set(corpus.map(other => other.verb));
    const newVerb = !usedVerbs.has(meaning.verb) && usedVerbs.size < 3 ? 0.6 : 0;
    const newRoles = nounRoles(meaning).filter(role => !corpus.some(other => nounRoles(other).includes(role))).length;
    return gain - 0.4 * strangers + newVerb + 0.2 * newRoles;
  };
  // No verb in more than half the sentences (checked at every prefix, so it holds at the end too).
  const halfCap = (count: number, floor: number) => count + 1 <= Math.max(floor, Math.ceil((corpus.length + 1) / 2));
  const countWhere = (predicate: (meaning: Meaning) => boolean) => corpus.filter(predicate).length;
  const hasAdjective = (meaning: Meaning) => phrases(meaning).some(phrase => !!phrase.adjective);
  const hasPossessor = (meaning: Meaning) => phrases(meaning).some(phrase => !!phrase.possessor);
  // Likewise adverbs, adjectives and possessors: each in at most about half the sentences.
  const verbAllowed = (meaning: Meaning) =>
    halfCap(countWhere(other => other.verb === meaning.verb), 1) &&
    (!meaning.adverb || halfCap(countWhere(other => !!other.adverb), 2)) &&
    (!hasAdjective(meaning) || halfCap(countWhere(hasAdjective), 2)) &&
    (!hasPossessor(meaning) || halfCap(countWhere(hasPossessor), 2));
  const bestCandidate = (filter: (meaning: Meaning) => boolean) => {
    let best: Meaning | null = null, bestScore = -Infinity;
    for (const meaning of candidates) {
      if (inCorpus.has(meaningKey(meaning)) || !verbAllowed(meaning) || !filter(meaning)) continue;
      const candidateScore = score(meaning);
      if (candidateScore > bestScore) { best = meaning; bestScore = candidateScore; }
    }
    return best;
  };
  const addToCorpus = (meaning: Meaning) => { corpus.push(meaning); inCorpus.add(meaningKey(meaning)); };

  // 1. Greedy coverage of explicit evidence requirements.
  while (requirements.some(requirement => remainingNeed(requirement) > 0)) {
    if (corpus.length >= MAX_CORPUS) return null;
    const next = bestCandidate(() => true);
    if (!next || score(next) <= 0) return null;
    addToCorpus(next);
  }
  // Heavier days get a little more data to chew on.
  const minimumCorpus = grammar.info.difficulty >= 4 ? MIN_CORPUS + 1 : MIN_CORPUS;
  while (corpus.length < minimumCorpus) {
    const next = bestCandidate(() => true);
    if (!next) return null;
    addToCorpus(next);
  }

  // At least three different verbs where the vocabulary has them.
  const wantedVerbs = Math.min(3, grammar.lexicon.verbs.length);
  while (new Set(corpus.map(meaning => meaning.verb)).size < wantedVerbs) {
    const used = new Set(corpus.map(meaning => meaning.verb));
    const next = bestCandidate(meaning => !used.has(meaning.verb));
    if (!next || corpus.length >= MAX_CORPUS) return null;
    addToCorpus(next);
  }

  // 2. Counterexample-guided loop against competitor grammars.
  const blocked: string[] = [];
  const context = (): CheckContext => ({ grammar, corpus, tests, english, englishOptions });
  for (;;) {
    const check = checkSolvability(context());
    if (!check.harmful.length) return { corpus, tests, check, blocked };
    if (corpus.length >= MAX_CORPUS) return null;
    const rival = check.harmful[0].competitor;
    const distinguishing = bestCandidate(meaning => {
      try { return sentenceText(realise(rival.grammar, meaning)) !== sentenceText(wordsOf(meaning)); } catch { return true; }
    });
    if (!distinguishing) return null;
    blocked.push(rival.description);
    addToCorpus(distinguishing);
  }
}

/** "guard@A", "tower@P", "king@POSS": which nouns appear in which roles. */
function nounRoles(meaning: Meaning): string[] {
  const roles = [`${meaning.subject.noun}@${meaning.object ? "A" : "S"}`];
  if (meaning.object) roles.push(`${meaning.object.noun}@P`);
  for (const phrase of phrases(meaning)) if (phrase.possessor) roles.push(`${phrase.possessor.noun}@POSS`);
  return roles;
}

/** Corpus display order: one-participant sentences first, then by number of morphemes. */
export function orderCorpus(rng: Rng, grammar: Grammar, corpus: Meaning[]): Meaning[] {
  const complexity = (meaning: Meaning) => (meaning.object ? 10 : 0) + morphemeCount(realise(grammar, meaning)) + rng.next();
  return corpus.map(meaning => ({ meaning, key: complexity(meaning) }))
    .sort((first, second) => first.key - second.key)
    .map(entry => entry.meaning);
}

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
import { enumerateMeanings, lexemesOf, meaningDistance, meaningKey, type Meaning } from "./meaning";
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
  }
}

/** Does this morpheme have a vowel-harmony placeholder (uppercase vowel)? */
export function isHarmonising(morpheme: Morpheme): boolean {
  const exponent = morpheme.exponent;
  return (exponent.kind === "suffix" && /[A-Z]/.test(exponent.form)) || (exponent.kind === "circumfix" && /[A-Z]/.test(exponent.suffix));
}

const morphemeCount = (words: RealisedWord[]) => words.reduce((sum, word) => sum + word.applied.length, 0);

function chooseTests(rng: Rng, grammar: Grammar, pool: Meaning[]): TestItem[] | null {
  const transitive = pool.filter(meaning => meaning.object);
  const intransitive = pool.filter(meaning => !meaning.object);
  for (let attempt = 0; attempt < 200; attempt++) {
    // Three into-language items (the harder direction carries the aha), two into English.
    const shapes = rng.shuffle([true, true, false]).concat([true, rng.chance(0.5)]);
    const meanings = shapes.map(isTransitive => rng.pick(isTransitive ? transitive : intransitive));
    const words = meanings.map(meaning => realise(grammar, meaning));
    const spread = meanings.every((meaning, i) => meanings.every((other, j) => i === j || meaningDistance(meaning, other) >= 3));
    const headlineCount = meanings.filter((meaning, index) => exercisesHeadline(grammar, meaning, words[index])).length;
    const rich = words.slice(0, 3).every(sentence => morphemeCount(sentence) >= 2);
    const lexemes = new Set(meanings.flatMap(lexemesOf));
    if (spread && rich && headlineCount >= 3 && lexemes.size <= 8)
      return meanings.map((meaning, index) => ({ meaning, direction: index < 3 ? "toLang" : "toEnglish" }));
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
  const pool = enumerateMeanings(grammar.lexicon, grammar.info.dimensions);
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
    const strangers = lexemesOf(meaning).filter(lexeme => !testLexemes.has(lexeme)).length;
    return gain - 0.4 * strangers;
  };
  const bestCandidate = (filter: (meaning: Meaning) => boolean) => {
    let best: Meaning | null = null, bestScore = -Infinity;
    for (const meaning of candidates) {
      if (inCorpus.has(meaningKey(meaning)) || !filter(meaning)) continue;
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
  while (corpus.length < MIN_CORPUS) {
    const next = bestCandidate(() => true);
    if (!next) return null;
    addToCorpus(next);
  }

  // 2. Counterexample-guided loop against competitor grammars.
  const blocked: string[] = [];
  const context = (): CheckContext => ({ grammar, corpus, tests, meaningPool: pool, english, englishOptions });
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

/** Corpus display order: one-participant sentences first, then by number of morphemes. */
export function orderCorpus(rng: Rng, grammar: Grammar, corpus: Meaning[]): Meaning[] {
  const complexity = (meaning: Meaning) => (meaning.object ? 10 : 0) + morphemeCount(realise(grammar, meaning)) + rng.next();
  return corpus.map(meaning => ({ meaning, key: complexity(meaning) }))
    .sort((first, second) => first.key - second.key)
    .map(entry => entry.meaning);
}

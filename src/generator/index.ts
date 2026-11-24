/** Entry point: date -> Puzzle. Deterministic: the same date (and generator version) gives the same puzzle. */

import type { Puzzle } from "../puzzle";
import { buildPuzzle, englishLexiconOf, englishOptionsOf } from "./build";
import { checkShufflePairing, checkSolvability, type CheckResult } from "./checker";
import type { Grammar } from "./grammar";
import { looksEnglish, makeLanguageName } from "./lexicon";
import type { Meaning } from "./meaning";
import { planForDate, planWithOverrides, type PlanOverrides, type DayPlan } from "./plan";
import { realise } from "./realise";
import { Rng } from "./rng";
import { sampleGrammar } from "./sample";
import { orderCorpus, selectData } from "./select";
import { THEMES, type Theme } from "./themes";

export const GENERATOR_VERSION = "2";

export interface GenerationReport {
  date: string;
  attempts: number;
  theme: string;
  plan: DayPlan;
  headline: string;
  supporting: string[];
  wordOrder: string;
  alignment: string;
  competitorsTried: number;
  competitorsKilled: number;
  /** Fit the corpus but give the same answers (harmless re-analyses). */
  harmlessSurvivors: string[];
  /** Competitors that forced an extra corpus sentence. */
  blocked: string[];
  /** Competitor -> 1-based corpus sentence that rules it out (first 40). */
  eliminated: { competitor: string; bySentence: number }[];
  /** How many corpus sentences use each verb. */
  verbUsage: Record<string, number>;
  /** Shuffle pairing check: rival pairings found before anchoring, and the anchors chosen. */
  shuffle: { unique: boolean; rivalPairings: number; anchors: number[] } | null;
}

export function themeForDate(date: string): Theme {
  const themeId = planForDate(date).theme;
  return THEMES.find(theme => theme.id === themeId)!;
}

/** Two different words with the same spelling, or a word that reads as English, is a reason to retry. */
function surfaceProblems(grammar: Grammar, meanings: Meaning[]): string | null {
  const glossesByForm = new Map<string, string>();
  for (const meaning of meanings)
    for (const word of realise(grammar, meaning)) {
      if (looksEnglish(word.form)) return `"${word.form}" is an English word`;
      const previous = glossesByForm.get(word.form);
      if (previous && previous !== word.gloss) return `"${word.form}" means both ${previous} and ${word.gloss}`;
      glossesByForm.set(word.form, word.gloss);
    }
  return null;
}

/** A random derangement of the non-anchor rows (anchors map to themselves). */
function shuffledOrder(rng: Rng, rowCount: number, anchors: number[]): number[] {
  const movable = Array.from({ length: rowCount }, (_, row) => row).filter(row => !anchors.includes(row));
  for (;;) {
    const targets = rng.shuffle(movable);
    if (movable.length < 2 || targets.every((target, index) => target !== movable[index])) {
      const order = Array.from({ length: rowCount }, (_, row) => row);
      movable.forEach((row, index) => { order[row] = targets[index]; });
      return order;
    }
  }
}

export interface GenerateOptions extends PlanOverrides { maxAttempts?: number }

/**
 * Build the puzzle for `date`. With no options this is the scheduled puzzle for that date (deterministic).
 * `difficulty` / `shuffle` override the day plan; `seed` re-rolls everything for the same date.
 */
export function generatePuzzle(date: string, options: GenerateOptions = {}): { puzzle: Puzzle; report: GenerationReport } {
  const { maxAttempts = 1500, ...overrides } = options;
  const plan = planWithOverrides(date, overrides);
  const theme = THEMES.find(candidate => candidate.id === plan.theme)!;
  const seedKey = overrides.seed ?? date;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = new Rng(`naclodle-v${GENERATOR_VERSION}:${seedKey}:${attempt}`);
    const grammar = sampleGrammar(rng, theme, plan);
    if (!grammar) continue;
    const english = englishLexiconOf(grammar);
    const englishOptions = englishOptionsOf(grammar);
    const selection = selectData({ rng, grammar, english, englishOptions });
    if (!selection) continue;
    if (surfaceProblems(grammar, [...selection.corpus, ...selection.tests.map(test => test.meaning)])) continue;

    // Re-check in display order so "eliminated by sentence n" refers to what the player sees.
    const corpus = orderCorpus(rng, grammar, selection.corpus);
    const check: CheckResult = checkSolvability({ grammar, corpus, tests: selection.tests, english, englishOptions });
    if (check.harmful.length) continue;

    // Every puzzle gets a pairing check; shuffled days must pass it, other days only carry the block if they do.
    const shuffleCheck = checkShufflePairing(grammar, corpus, rng);
    if (plan.shuffle && !shuffleCheck.unique) continue;
    const shuffle = shuffleCheck.unique
      ? { anchors: shuffleCheck.anchors, order: shuffledOrder(rng, corpus.length, shuffleCheck.anchors) }
      : undefined;

    const languageName = makeLanguageName(rng, grammar.phonology);
    const puzzle = buildPuzzle({
      date, languageName, grammar, corpus, tests: selection.tests, check, blocked: selection.blocked, themeTitle: theme.title, shuffle,
    });
    const report: GenerationReport = {
      date, attempts: attempt + 1, theme: theme.id, plan,
      headline: grammar.info.headline, supporting: grammar.info.supporting,
      wordOrder: grammar.wordOrder, alignment: grammar.info.alignment,
      competitorsTried: check.verdicts.length,
      competitorsKilled: check.verdicts.filter(verdict => verdict.killedBy >= 0).length,
      harmlessSurvivors: check.verdicts.filter(verdict => verdict.killedBy < 0).map(verdict => verdict.competitor.description),
      blocked: selection.blocked,
      eliminated: check.verdicts.filter(verdict => verdict.killedBy >= 0).slice(0, 40)
        .map(verdict => ({ competitor: verdict.competitor.description, bySentence: verdict.killedBy + 1 })),
      verbUsage: corpus.reduce<Record<string, number>>((counts, meaning) => ({ ...counts, [meaning.verb]: (counts[meaning.verb] ?? 0) + 1 }), {}),
      shuffle: { unique: shuffleCheck.unique, rivalPairings: shuffleCheck.rivalCount, anchors: shuffleCheck.anchors },
    };
    return { puzzle, report };
  }
  throw new Error(`no acceptable puzzle for ${date} after ${maxAttempts} attempts`);
}

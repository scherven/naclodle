/** Entry point: date -> Puzzle. Deterministic: the same date (and generator version) gives the same puzzle. */

import type { Puzzle } from "../puzzle";
import { buildPuzzle, englishLexiconOf, englishOptionsOf } from "./build";
import type { CheckResult } from "./checker";
import type { Grammar } from "./grammar";
import { looksEnglish, makeLanguageName } from "./lexicon";
import { realise } from "./realise";
import { Rng } from "./rng";
import { sampleGrammar } from "./sample";
import { orderCorpus, selectData } from "./select";
import { THEMES, type Theme } from "./themes";
import { checkSolvability } from "./checker";
import { enumerateMeanings, type Meaning } from "./meaning";

export const GENERATOR_VERSION = "1";

export interface GenerationReport {
  date: string;
  attempts: number;
  theme: string;
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
}

export function themeForDate(date: string): Theme {
  return new Rng(`naclodle-theme:${date}`).pick(THEMES);
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

export function generatePuzzle(date: string, maxAttempts = 400): { puzzle: Puzzle; report: GenerationReport } {
  const theme = themeForDate(date);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = new Rng(`naclodle-v${GENERATOR_VERSION}:${date}:${attempt}`);
    const grammar = sampleGrammar(rng, theme);
    if (!grammar) continue;
    const english = englishLexiconOf(grammar);
    const englishOptions = englishOptionsOf(grammar);
    const selection = selectData({ rng, grammar, english, englishOptions });
    if (!selection) continue;
    if (surfaceProblems(grammar, [...selection.corpus, ...selection.tests.map(test => test.meaning)])) continue;

    // Re-check in display order so "eliminated by sentence n" refers to what the player sees.
    const corpus = orderCorpus(rng, grammar, selection.corpus);
    const pool = enumerateMeanings(grammar.lexicon, grammar.info.dimensions);
    const check: CheckResult = checkSolvability({ grammar, corpus, tests: selection.tests, meaningPool: pool, english, englishOptions });
    if (check.harmful.length) continue;

    const languageName = makeLanguageName(rng, grammar.phonology);
    const puzzle = buildPuzzle({ date, languageName, grammar, corpus, tests: selection.tests, check, blocked: selection.blocked });
    const report: GenerationReport = {
      date, attempts: attempt + 1, theme: theme.id,
      headline: grammar.info.headline, supporting: grammar.info.supporting,
      wordOrder: grammar.wordOrder, alignment: grammar.info.alignment,
      competitorsTried: check.verdicts.length,
      competitorsKilled: check.verdicts.filter(verdict => verdict.killedBy >= 0).length,
      harmlessSurvivors: check.verdicts.filter(verdict => verdict.killedBy < 0).map(verdict => verdict.competitor.description),
      blocked: selection.blocked,
      eliminated: check.verdicts.filter(verdict => verdict.killedBy >= 0).slice(0, 40)
        .map(verdict => ({ competitor: verdict.competitor.description, bySentence: verdict.killedBy + 1 })),
    };
    return { puzzle, report };
  }
  throw new Error(`no acceptable puzzle for ${date} after ${maxAttempts} attempts`);
}

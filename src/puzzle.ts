/**
 * The puzzle format. One JSON file per puzzle in public/puzzles/, listed in public/puzzles/index.json.
 * Hand-written puzzles (real languages) and generated ones (src/generator) both produce this shape.
 */

export interface Puzzle {
  /** Short stable id, e.g. "001" or "gen-2026-11-24". */
  id: string;
  /** Display number shown in the header and the share text. */
  number: number;
  /** ISO date this puzzle is scheduled for (YYYY-MM-DD). */
  date: string;
  /** 1 (easy) to 5 (hard). */
  difficulty: 1 | 2 | 3 | 4 | 5;
  language: {
    name: string;
    /** false for generated languages. */
    real: boolean;
    /** BCP 47 tag used for case-folding (e.g. "tr" so I/ı/İ/i fold correctly). Defaults to "und". */
    locale?: string;
  };
  /** How many answer checks the player gets. */
  checks: number;
  /** Special characters offered as on-screen keys. */
  keys: string[];
  /** The one hint (costs a point). */
  hint: string;
  /** Example sentences, in the order of the language column. */
  corpus: CorpusLine[];
  /** The item translated from the language into English (exactly one). */
  toEnglish: Item[];
  /** The item translated from English into the language (exactly one). */
  toLang: Item[];
  /** Shown after the game ends. */
  explain: Explanation;
  /** One-line theme of the vocabulary, e.g. "sea voyage". Not shown to players. */
  theme?: string;
  /**
   * Makes the puzzle eligible for a shuffled day: anchors plus a starting order whose correct pairing
   * has been checked to be unique. Only used on days the schedule marks `shuffle: true`.
   */
  shuffle?: Shuffle;
}

export interface CorpusLine {
  lang: string;
  en: string;
  /** One gloss per whitespace-separated word of `lang` (Leipzig style, e.g. "apple-ACC"). */
  gloss: string[];
}

export interface Item {
  /** The sentence to translate. */
  prompt: string;
  /** Every accepted answer. Compared after normalisation (case, punctuation, contractions, hyphens). */
  accepted: string[];
  /** One line explaining the answer, shown after the game. */
  explanation: string;
}

export interface Explanation {
  /** [form, meaning] */
  words: [string, string][];
  /** [form, what it does] */
  grammar: [string, string][];
  /** Optional extra paragraph (e.g. vowel harmony). */
  notes?: string;
  /** A fun fact about the language. Real languages only. */
  fact?: string;
}

export interface Shuffle {
  /** Corpus rows whose translation stays in place. */
  anchors: number[];
  /** order[row] = index of the English line shown in that row at the start. Anchors map to themselves. */
  order: number[];
}

/** The schedule: which puzzle file runs on which date, and whether that day is shuffled. */
export interface PuzzleIndex {
  puzzles: ScheduleEntry[];
}
export interface ScheduleEntry {
  date: string;
  file: string;
  /** Start the English column out of order. The puzzle must carry a `shuffle` block. */
  shuffle?: boolean;
}

/** Light structural check used by tests and the loader. Returns a list of problems (empty = ok). */
export function validatePuzzle(puzzle: Puzzle): string[] {
  const problems: string[] = [];
  if (!puzzle.id) problems.push("missing id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzle.date)) problems.push("date must be YYYY-MM-DD");
  if (puzzle.checks < 1) problems.push("checks must be >= 1");
  if (puzzle.corpus.length < 2) problems.push("corpus needs at least 2 lines");
  puzzle.corpus.forEach((line, index) => {
    const wordCount = line.lang.trim().split(/\s+/).length;
    if (line.gloss.length !== wordCount) problems.push(`corpus[${index}]: ${wordCount} words but ${line.gloss.length} glosses`);
  });
  [...puzzle.toEnglish, ...puzzle.toLang].forEach((item, index) => {
    if (!item.accepted?.length) problems.push(`item ${index}: no accepted answers`);
    if (!item.prompt) problems.push(`item ${index}: no prompt`);
  });
  if (puzzle.toEnglish.length !== 1) problems.push("needs exactly one item to translate into English");
  if (puzzle.toLang.length !== 1) problems.push("needs exactly one item to translate into the language");
  if (puzzle.shuffle) {
    const rowCount = puzzle.corpus.length;
    const order = puzzle.shuffle.order;
    const isPermutation = order.length === rowCount && new Set(order).size === rowCount && order.every(row => row >= 0 && row < rowCount);
    if (!isPermutation) problems.push("shuffle.order must be a permutation of the corpus rows");
    puzzle.shuffle.anchors.forEach(anchor => { if (order[anchor] !== anchor) problems.push(`anchor ${anchor} must map to itself`); });
  }
  return problems;
}

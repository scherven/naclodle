/** Game state and rules: checking, pairing, scoring, share text. Pure functions over (puzzle, state). */

import type { Item, Puzzle } from "../puzzle";
import { DEFAULT_COLOURS, type Colour } from "./colours";
import { grade, type Verdict } from "./text";

export type Side = "lang" | "en";

/**
 * A highlight. Either every match of `query` on one side ("all" mode), or one specific word / letter range
 * ("one" mode). `location` names a word on the page, e.g. "L3:1" = sentence 3, second word.
 */
export type Paint =
  | { colour: number; side: Side; query: string; wholeWord: boolean }
  | { colour: number; location: string; wholeWord: true }
  | { colour: number; location: string; start: number; end: number };

/** A divider drawn inside a word, before the letter at `position`. */
export type Split =
  | { side: Side; word: string; position: number }
  | { location: string; position: number };

export interface GameState {
  answers: Record<string, string>;
  /** Answers as they were at the last check (Check stays disabled until something changes). */
  answersAtLastCheck: Record<string, string>;
  /** Latest verdict per item. */
  verdicts: Record<string, Verdict>;
  /** One row per check, one verdict per item. */
  checkHistory: Verdict[][];
  hintUsed: boolean;
  notes: string;
  paints: Paint[];
  splits: Split[];
  colours: Colour[];
  /** true: a click highlights every match. false: only what was clicked. */
  matchAll: boolean;
  /** Shuffled days: translationOrder[row] = index of the English line shown in that row. */
  translationOrder: number[];
  lockedRows: number[];
  /** One row per pair check; "ok" or "bad" per non-anchor row. */
  pairCheckHistory: Verdict[][];
  /** Rows placed automatically at the end of the game. */
  revealedRows: number[];
  orderAtLastPairCheck: string | null;
  /** Time spent with the puzzle on screen before the game ended. 0 for games finished before this was tracked. */
  activeMs: number;
}

export interface TestItem extends Item { id: string; isEnglish: boolean }

export const POINTS = { ok: 3, near: 2, bad: 0 } as const;
export const COST = { hint: 1, pairCheck: 1, revealedPair: 1 } as const;

export function testItems(puzzle: Puzzle): TestItem[] {
  return [
    ...puzzle.toEnglish.map((item, index) => ({ ...item, id: "A" + (index + 1), isEnglish: true })),
    ...puzzle.toLang.map((item, index) => ({ ...item, id: "B" + (index + 1), isEnglish: false })),
  ];
}

export function freshState(puzzle: Puzzle): GameState {
  const identity = puzzle.corpus.map((_, row) => row);
  return {
    answers: {}, answersAtLastCheck: {}, verdicts: {}, checkHistory: [], hintUsed: false, notes: "",
    paints: [], splits: [], colours: DEFAULT_COLOURS.map(colour => ({ ...colour })), matchAll: true,
    translationOrder: puzzle.shuffle ? puzzle.shuffle.order.slice() : identity,
    lockedRows: puzzle.shuffle ? puzzle.shuffle.anchors.slice() : identity,
    pairCheckHistory: [], revealedRows: [], orderAtLastPairCheck: null, activeMs: 0,
  };
}

export const verdictFor = (state: GameState, itemId: string): Verdict | null => state.verdicts[itemId] ?? null;
const isSolved = (state: GameState, itemId: string) => verdictFor(state, itemId) === "ok";
export const allSolved = (puzzle: Puzzle, state: GameState) => testItems(puzzle).every(item => isSolved(state, item.id));
export const isOver = (puzzle: Puzzle, state: GameState) => allSolved(puzzle, state) || state.checkHistory.length >= puzzle.checks;
export const unpairedRows = (state: GameState) =>
  state.translationOrder.map((_, row) => row).filter(row => !state.lockedRows.includes(row));

/** Has any unsolved, non-empty answer changed since the last check? */
export function canCheck(puzzle: Puzzle, state: GameState): boolean {
  if (isOver(puzzle, state)) return false;
  return testItems(puzzle).some(item => {
    const answer = state.answers[item.id] || "";
    return !isSolved(state, item.id) && answer.trim() !== "" && answer !== state.answersAtLastCheck[item.id];
  });
}

/** Grade every unsolved item and record a row. Returns a new state. */
export function checkAnswers(puzzle: Puzzle, previous: GameState): GameState {
  if (!canCheck(puzzle, previous)) return previous;
  const state = structuredClone(previous);
  const row = testItems(puzzle).map(item => {
    if (isSolved(state, item.id)) return "ok" as Verdict;
    const verdict = grade(item, state.answers[item.id] || "", puzzle.language.locale, item.isEnglish);
    state.verdicts[item.id] = verdict;
    return verdict;
  });
  for (const item of testItems(puzzle)) state.answersAtLastCheck[item.id] = state.answers[item.id] ?? "";
  state.checkHistory.push(row);
  return isOver(puzzle, state) ? placeRemainingPairs(puzzle, state) : state;
}

/** Put the right translation in `row` and lock it. Mutates. */
function lockRow(state: GameState, row: number) {
  const currentRow = state.translationOrder.indexOf(row);
  [state.translationOrder[row], state.translationOrder[currentRow]] = [state.translationOrder[currentRow], state.translationOrder[row]];
  if (!state.lockedRows.includes(row)) state.lockedRows.push(row);
}

export function swapTranslations(previous: GameState, firstRow: number, secondRow: number): GameState {
  const state = structuredClone(previous);
  const order = state.translationOrder;
  [order[firstRow], order[secondRow]] = [order[secondRow], order[firstRow]];
  return state;
}

export function canCheckPairs(puzzle: Puzzle, state: GameState): boolean {
  return !!puzzle.shuffle && unpairedRows(state).length > 0 && !isOver(puzzle, state)
    && state.orderAtLastPairCheck !== state.translationOrder.join(",");
}

/** A hint: locks every correctly placed translation, says nothing about the wrong ones. */
export function checkPairs(puzzle: Puzzle, previous: GameState): GameState {
  if (!canCheckPairs(puzzle, previous)) return previous;
  const state = structuredClone(previous);
  const anchors = puzzle.shuffle!.anchors;
  const row = state.translationOrder.map((_, rowIndex) => rowIndex).filter(rowIndex => !anchors.includes(rowIndex)).map(rowIndex => {
    if (state.lockedRows.includes(rowIndex)) return "ok" as Verdict;
    if (state.translationOrder[rowIndex] === rowIndex) { state.lockedRows.push(rowIndex); return "ok" as Verdict; }
    return "bad" as Verdict;
  });
  state.pairCheckHistory.push(row);
  state.orderAtLastPairCheck = state.translationOrder.join(",");
  return state;
}

/** At the end of the game any unpaired translations move into place, at a cost each. */
export function placeRemainingPairs(puzzle: Puzzle, previous: GameState): GameState {
  if (!puzzle.shuffle || !unpairedRows(previous).length) return previous;
  const state = structuredClone(previous);
  for (const row of unpairedRows(state)) { lockRow(state, row); state.revealedRows.push(row); }
  return state;
}

export function score(puzzle: Puzzle, state: GameState): number {
  let total = 0;
  for (const item of testItems(puzzle)) total += POINTS[verdictFor(state, item.id) ?? "bad"];
  if (state.hintUsed) total -= COST.hint;
  total -= state.pairCheckHistory.length * COST.pairCheck + state.revealedRows.length * COST.revealedPair;
  return Math.max(0, total);
}
export const maxScore = (puzzle: Puzzle) => testItems(puzzle).length * POINTS.ok;
export const hintsUsed = (state: GameState) => (state.hintUsed ? 1 : 0) + state.pairCheckHistory.length;

const SQUARES: Record<Verdict, string> = { ok: "🟩", near: "🟨", bad: "⬜" };
/** 75000 → "1:15", 3725000 → "1:02:05". */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600), minutes = Math.floor(totalSeconds / 60) % 60, seconds = totalSeconds % 60;
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}` : `${minutes}:${twoDigits(seconds)}`;
}

export function shareText(puzzle: Puzzle, state: GameState): string {
  const hints = hintsUsed(state);
  const perfect = allSolved(puzzle, state) && hints === 0 && !state.revealedRows.length;
  const difficulty = "●".repeat(puzzle.difficulty) + "○".repeat(5 - puzzle.difficulty);
  const header = `naclodle ${puzzle.number}${puzzle.shuffle ? " ⇅" : ""}  ${difficulty}  ${score(puzzle, state)}/${maxScore(puzzle)}` +
    (state.activeMs ? `  ⏱ ${formatDuration(state.activeMs)}` : "") +
    (hints ? "  " + "💡".repeat(hints) : "") + (perfect ? "  ★" : "");
  const grid = (rows: Verdict[][]) => rows.map(row => row.map(verdict => SQUARES[verdict]).join("")).join("\n");
  const pairGrid = puzzle.shuffle && state.pairCheckHistory.length ? grid(state.pairCheckHistory) + "\n\n" : "";
  return header + "\n" + pairGrid + grid(state.checkHistory);
}

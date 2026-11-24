import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePuzzle, type Puzzle, type PuzzleIndex } from "../puzzle";
import { DEFAULT_COLOURS, newColour } from "./colours";
import { canCheck, checkAnswers, checkPairs, freshState, isOver, placeRemainingPairs, score, shareText, swapTranslations, testItems } from "./state";
import { closestAccepted, grade, normalise } from "./text";

const DIR = join(__dirname, "../../public/puzzles");
const load = (file: string) => JSON.parse(readFileSync(join(DIR, file), "utf8")) as Puzzle;
// the Turkish file carries a shuffle block; the schedule decides whether a day uses it
const shuffled = load("2026-11-23-turkish.json");
const turkish: Puzzle = { ...shuffled, shuffle: undefined };

describe("normalisation and grading", () => {
  it("folds Turkish case with the Turkish locale", () => {
    expect(normalise("KADIN", "tr", false)).toBe("kadın");
    expect(normalise("İki", "tr", false)).toBe("iki");
  });
  it("expands English contractions and drops punctuation", () => {
    expect(normalise("The men didn't eat bread.", undefined, true)).toBe("the men did not eat bread");
  });
  const item = turkish.toLang[0]; // çocuk balık yedi
  it("accepts exact answers regardless of case and punctuation", () => {
    expect(grade(item, "Çocuk balık yedi.", "tr", false)).toBe("ok");
  });
  it("treats accent slips and one wrong word as near", () => {
    expect(grade(item, "cocuk balik yedi", "tr", false)).toBe("near");
    expect(grade(item, "çocuk balığı yedi", "tr", false)).toBe("near");
  });
  it("rejects wrong answers", () => {
    expect(grade(item, "balık çocuğu gördü", "tr", false)).toBe("bad");
    expect(grade(item, "", "tr", false)).toBe("bad");
  });
  it("picks the closest accepted answer for the key", () => {
    expect(closestAccepted(turkish.toEnglish[0], "the men did not eat any bread", "tr", true)).toBe("the men did not eat any bread");
  });
});

describe("game rules", () => {
  const answerEverything = (state = freshState(turkish)) => {
    for (const item of testItems(turkish)) state.answers[item.id] = item.accepted[0];
    return state;
  };
  it("solves with full marks and a star", () => {
    const state = checkAnswers(turkish, answerEverything());
    expect(isOver(turkish, state)).toBe(true);
    expect(score(turkish, state)).toBe(6);
    expect(shareText(turkish, state)).toContain("★");
  });
  it("only allows a check when an answer changed", () => {
    let state = freshState(turkish);
    expect(canCheck(turkish, state)).toBe(false);
    state.answers.A1 = "wrong";
    state = checkAnswers(turkish, state);
    expect(canCheck(turkish, state)).toBe(false);
    state.answers.A1 = "still wrong";
    expect(canCheck(turkish, state)).toBe(true);
  });
  it("ends after the allowed number of checks", () => {
    let state = freshState(turkish);
    for (let attempt = 0; attempt < turkish.checks; attempt++) { state.answers.A1 = "wrong " + attempt; state = checkAnswers(turkish, state); }
    expect(isOver(turkish, state)).toBe(true);
    expect(score(turkish, state)).toBe(0);
  });
  it("charges for the hint", () => {
    const state = answerEverything(); state.hintUsed = true;
    expect(score(turkish, checkAnswers(turkish, state))).toBe(5);
  });
});

describe("shuffled pairing", () => {
  it("locks correct pairs on a pair check and charges for it", () => {
    let state = freshState(shuffled);
    const row = state.translationOrder.indexOf(1); // where the English for sentence 1 currently sits
    state = swapTranslations(state, 1, row);
    state = checkPairs(shuffled, state);
    expect(state.lockedRows).toContain(1);
    expect(state.pairCheckHistory.length).toBe(1);
  });
  it("snaps unpaired translations into place at the end, at a cost", () => {
    const state = placeRemainingPairs(shuffled, freshState(shuffled));
    expect(state.translationOrder).toEqual(shuffled.corpus.map((_, row) => row));
    expect(state.revealedRows.length).toBe(shuffled.corpus.length - shuffled.shuffle!.anchors.length);
  });
});

describe("colours", () => {
  it("adds a colour unlike the existing ones", () => {
    const added = newColour(DEFAULT_COLOURS);
    expect(added.id).toBe(5);
    for (const existing of DEFAULT_COLOURS) {
      const hueGap = Math.min(Math.abs(added.hue - existing.hue), 360 - Math.abs(added.hue - existing.hue));
      expect(hueGap > 20 || added.tier !== existing.tier).toBe(true);
    }
  });
});

describe("puzzle files", () => {
  const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as PuzzleIndex;
  it("index lists only files that exist", () => {
    const files = new Set(readdirSync(DIR));
    for (const entry of index.puzzles) expect(files.has(entry.file), entry.file).toBe(true);
  });
  for (const entry of index.puzzles) {
    it(`${entry.file} is valid and its own answers grade ok`, () => {
      const puzzle = load(entry.file);
      expect(validatePuzzle(puzzle)).toEqual([]);
      expect(puzzle.date).toBe(entry.date);
      if (entry.shuffle) expect(puzzle.shuffle, "shuffled day needs a shuffle block").toBeDefined();
      for (const item of testItems(puzzle))
        for (const answer of item.accepted) expect(grade(item, answer, puzzle.language.locale, item.isEnglish)).toBe("ok");
    });
  }
});

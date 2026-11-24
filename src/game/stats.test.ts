import { describe, expect, it } from "vitest";
import { emptyStats, recordResult, summarise } from "./stats";

const result = (score: number, playedOn: string, solved = true) => ({ score, max: 6, solved, perfect: score === 6, playedOn });

describe("stats", () => {
  it("keeps the first result for a puzzle", () => {
    let stats = recordResult(emptyStats(), "2026-11-24", result(6, "2026-11-24"));
    stats = recordResult(stats, "2026-11-24", result(0, "2026-11-25", false));
    expect(stats.results["2026-11-24"].score).toBe(6);
  });

  it("counts streaks of puzzles solved on their own day", () => {
    let stats = emptyStats();
    for (const day of ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-24", "2026-11-25"])
      stats = recordResult(stats, day, result(5, day));
    stats = recordResult(stats, "2026-11-23", result(5, "2026-11-30")); // caught up later: no streak
    const summary = summarise(stats, "2026-11-26");
    expect(summary.streak).toBe(2);
    expect(summary.bestStreak).toBe(3);
    expect(summarise(stats, "2026-11-27").streak).toBe(0);
    expect(summary.played).toBe(6);
    expect(summary.scores[5]).toBe(6);
  });

  it("breaks the streak on a failed day", () => {
    let stats = recordResult(emptyStats(), "2026-11-24", result(5, "2026-11-24"));
    stats = recordResult(stats, "2026-11-25", result(1, "2026-11-25", false));
    expect(summarise(stats, "2026-11-25").streak).toBe(0);
    expect(summarise(stats, "2026-11-25").solved).toBe(1);
  });
});

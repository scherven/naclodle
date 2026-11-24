/**
 * Lifetime stats, kept in localStorage under one key. One result per scheduled puzzle (drafts don't count),
 * recorded when the game ends. Streaks count puzzles solved on their own day, so catching up on old puzzles
 * through #YYYY-MM-DD adds to the totals but not the streak.
 */

export interface PuzzleResult {
  score: number;
  max: number;
  solved: boolean;
  perfect: boolean;
  /** Local date the game was finished on. */
  playedOn: string;
}

export interface Stats {
  /** Keyed by puzzle date. */
  results: Record<string, PuzzleResult>;
}

export const emptyStats = (): Stats => ({ results: {} });

/** The first finish counts; replaying a finished puzzle never changes its result. */
export function recordResult(stats: Stats, puzzleDate: string, result: PuzzleResult): Stats {
  if (stats.results[puzzleDate]) return stats;
  return { results: { ...stats.results, [puzzleDate]: result } };
}

const previousDay = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
};

export interface Summary {
  played: number;
  solved: number;
  perfect: number;
  /** Solved on the day, consecutive, ending today (or yesterday, while today is unplayed). */
  streak: number;
  bestStreak: number;
  /** How many games ended on each score, 0 … the highest max seen. */
  scores: number[];
}

export function summarise(stats: Stats, today: string): Summary {
  const entries = Object.entries(stats.results);
  const onTheDay = new Set(entries.filter(([date, result]) => result.solved && result.playedOn === date).map(([date]) => date));
  let bestStreak = 0;
  for (const date of onTheDay) {
    if (onTheDay.has(previousDay(date))) continue; // not the start of a run
    let length = 0;
    for (let day = date; onTheDay.has(day); day = nextDay(day)) length++;
    bestStreak = Math.max(bestStreak, length);
  }
  let streak = 0;
  // today not played yet keeps yesterday's streak alive; today played and failed ends it
  let day = onTheDay.has(today) || stats.results[today]?.playedOn === today ? today : previousDay(today);
  while (onTheDay.has(day)) { streak++; day = previousDay(day); }
  const highest = Math.max(0, ...entries.map(([, result]) => result.max));
  const scores = Array.from({ length: highest + 1 }, () => 0);
  for (const [, result] of entries) scores[Math.min(result.score, highest)]++;
  return {
    played: entries.length,
    solved: entries.filter(([, result]) => result.solved).length,
    perfect: entries.filter(([, result]) => result.perfect).length,
    streak, bestStreak, scores,
  };
}

function nextDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

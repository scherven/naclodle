/**
 * The day plan: difficulty target, headline phenomenon, word order and shuffle flag for each date.
 *
 * Variety rules: the headline differs from the previous two days' headlines, the same word order
 * never runs three days in a row, and the theme differs from the previous six days'. Difficulty follows the weekday, NYT-crossword style
 * (Mon 1, Tue 2, Wed 3, Thu 3, Fri 4, Sat 5, Sun 4). Saturdays are shuffled days.
 *
 * The plan is a pure function of the date: plans are computed day by day from PLAN_EPOCH, each day's
 * choice seeded by its own date and constrained by the two days before. This is cheap (no puzzles are
 * generated), so any date's plan can be recomputed without reading earlier files.
 */

import { Rng } from "./rng";
import type { Headline, WordOrder } from "./grammar";
import { THEMES } from "./themes";
import { SOUND_STYLE_NAMES } from "./phonology";

/** Share of days with a non-plain sound style. */
const STYLE_CHANCE = 0.65;

export interface DayPlan {
  date: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  headline: Headline;
  wordOrder: WordOrder;
  /** Theme id; never the same as in the previous six days. */
  theme: string;
  /** Sound style ("plain" or a SOUND_STYLES key); a non-plain style never repeats within six days. */
  style: string;
  shuffle: boolean;
}

/** First planned date. The two puzzles before it (Turkish, Mata) were made by hand. */
export const PLAN_EPOCH = "2026-11-24";
const HISTORY_BEFORE_EPOCH: PlanHistory[] = [
  { headline: "definiteness", wordOrder: "SOV", theme: "dragon-hoard" }, // 2026-11-23, Mata
];

/** Indexed by getUTCDay(): Sunday = 0. */
const WEEKDAY_DIFFICULTY: DayPlan["difficulty"][] = [4, 1, 2, 3, 3, 4, 5];
const SHUFFLE_WEEKDAYS = new Set([6]);

/** Which headlines suit which difficulty, with weights. Structural headlines start at 3. */
const HEADLINE_WEIGHTS: Record<Headline, { minimum: number; weight: number }> = {
  reduplication: { minimum: 1, weight: 2 },
  circumfix: { minimum: 1, weight: 1.5 },
  definiteness: { minimum: 1, weight: 1.5 },
  wordOrder: { minimum: 1, weight: 1 },
  harmony: { minimum: 2, weight: 2 },
  differentialObject: { minimum: 2, weight: 1.5 },
  possessive: { minimum: 3, weight: 2.5 },
  adjectivePhrase: { minimum: 3, weight: 2.5 },
  ergative: { minimum: 3, weight: 3 },
  oblique: { minimum: 2, weight: 2.5 },
};

/** WALS 81A counts x interest boost; easy days stay with common orders. */
const WORD_ORDER_WEIGHTS: [WordOrder, number][] = [
  ["SOV", 564], ["SVO", 244], ["VSO", 285], ["VOS", 150], ["OVS", 110], ["OSV", 80],
];
const EASY_WORD_ORDER_WEIGHTS: [WordOrder, number][] = [["SOV", 5], ["SVO", 4], ["VSO", 2]];
const HEADLINE_WORD_ORDER_WEIGHTS: [WordOrder, number][] = [["VOS", 3], ["OVS", 3], ["OSV", 3], ["VSO", 1]];

export function addDays(date: string, offset: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

/** Ways to steer one day's plan away from the weekday defaults. */
export interface PlanOverrides {
  difficulty?: DayPlan["difficulty"];
  shuffle?: boolean;
  /** Re-roll: a different seed gives a different headline, order and theme for the same date. */
  seed?: string;
  /** Force a sound style ("plain" or a SOUND_STYLES key). */
  style?: string;
}

type PlanHistory = Pick<DayPlan, "headline" | "wordOrder" | "theme"> & { style?: string };

function planOneDay(date: string, history: PlanHistory[], overrides: PlanOverrides = {}): DayPlan {
  const rng = new Rng(`naclodle-plan:${overrides.seed ?? date}`);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const difficulty = overrides.difficulty ?? WEEKDAY_DIFFICULTY[weekday];
  const recentHeadlines = history.slice(-2).map(day => day.headline);
  const headlineChoices = (Object.entries(HEADLINE_WEIGHTS) as [Headline, { minimum: number; weight: number }][])
    .filter(([headline, rule]) => rule.minimum <= difficulty && !recentHeadlines.includes(headline))
    .map(([headline, rule]) => [headline, rule.weight] as const);
  const headline = rng.weighted(headlineChoices);
  const lastTwo = history.slice(-2);
  const repeatedOrder = lastTwo.length === 2 && lastTwo[0].wordOrder === lastTwo[1].wordOrder ? lastTwo[0].wordOrder : null;
  // A heavy headline on an easy day leaves no room for a verb-initial order.
  const heavyOnEasyDay = difficulty === 1 || (difficulty === 2 && (headline === "harmony" || headline === "differentialObject"));
  const orderWeights = headline === "wordOrder" ? HEADLINE_WORD_ORDER_WEIGHTS
    : heavyOnEasyDay ? EASY_WORD_ORDER_WEIGHTS.filter(([order]) => order !== "VSO")
    : difficulty <= 2 ? EASY_WORD_ORDER_WEIGHTS : WORD_ORDER_WEIGHTS;
  const wordOrder = rng.weighted(orderWeights.filter(([order]) => order !== repeatedOrder));
  const recentThemes = history.slice(-6).map(day => day.theme);
  const theme = rng.pick(THEMES.filter(candidate => !recentThemes.includes(candidate.id))).id;
  // drawn last so adding styles didn't change any earlier day's headline, order or theme
  const recentStyles = history.slice(-6).map(day => day.style);
  const style = overrides.style ?? (rng.chance(STYLE_CHANCE)
    ? rng.pick(SOUND_STYLE_NAMES.filter(name => !recentStyles.includes(name)))
    : "plain");
  return { date, difficulty, headline, wordOrder, theme, style, shuffle: overrides.shuffle ?? SHUFFLE_WEEKDAYS.has(weekday) };
}

const planCache = new Map<string, DayPlan>();

export function planForDate(date: string): DayPlan {
  const cached = planCache.get(date);
  if (cached) return cached;
  if (date < PLAN_EPOCH) return planOneDay(date, []);
  let history = [...HISTORY_BEFORE_EPOCH];
  let plan: DayPlan | undefined;
  for (let day = PLAN_EPOCH; day <= date; day = addDays(day, 1)) {
    plan = planCache.get(day) ?? planOneDay(day, history);
    planCache.set(day, plan);
    history = [...history.slice(-5), plan];
  }
  return plan!;
}

/** The plan for a date with some choices overridden, keeping the variety rules against the days before it. */
export function planWithOverrides(date: string, overrides: PlanOverrides): DayPlan {
  if (overrides.difficulty === undefined && overrides.shuffle === undefined && overrides.seed === undefined && overrides.style === undefined)
    return planForDate(date);
  const history = [6, 5, 4, 3, 2, 1].map(daysBefore => planForDate(addDays(date, -daysBefore)));
  return planOneDay(date, history, overrides);
}

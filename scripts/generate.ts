/**
 * Generate artificial-language puzzles.
 *
 *   npm run generate -- next [--days 7]                 the next N days after the last scheduled puzzle
 *   npm run generate -- date 2026-12-11 [--days 3]      specific dates (scheduled)
 *   npm run generate -- draft [--seed fox]              a one-off, not scheduled; play it at #draft-<seed>
 *   npm run generate -- list                            what's scheduled (no spoilers)
 *
 * Options for next / date / draft:
 *   --difficulty 1-5     override the weekday difficulty
 *   --shuffle            make it a shuffled puzzle (--no-shuffle to turn a Saturday off)
 *   --force              replace puzzles that already exist (otherwise they're skipped)
 *   --report-dir DIR     write a solvability report per puzzle (spoilers)
 *
 * Each puzzle and its schedule entry are written as soon as that puzzle is done, atomically, so Ctrl-C never
 * loses finished work (the current puzzle is finished first) and re-running resumes where it stopped.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePuzzle, type GenerateOptions } from "../src/generator/index";
import { addDays, planWithOverrides } from "../src/generator/plan";
import { validatePuzzle, type Puzzle, type PuzzleIndex, type ScheduleEntry } from "../src/puzzle";

const PUZZLE_DIRECTORY = join(import.meta.dirname, "..", "public", "puzzles");
const DRAFT_DIRECTORY = join(PUZZLE_DIRECTORY, "drafts");
const INDEX_PATH = join(PUZZLE_DIRECTORY, "index.json");

type Command = "next" | "date" | "draft" | "list";
interface Options {
  command: Command;
  date: string | null;
  days: number;
  overrides: GenerateOptions;
  force: boolean;
  reportDirectory: string | null;
}

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function parseArguments(argumentList: string[]): Options {
  const valueOf = (flag: string) => {
    const position = argumentList.indexOf(flag);
    return position >= 0 ? argumentList[position + 1] : undefined;
  };
  // the older form `--date D [--days N] --schedule` still works and means `date D`
  let command = argumentList[0] as Command;
  let date: string | null = null;
  if (!["next", "date", "draft", "list"].includes(command)) {
    if (!valueOf("--date")) throw new Error("Usage: npm run generate -- next | date YYYY-MM-DD | draft | list   (see scripts/generate.ts)");
    command = "date";
    date = valueOf("--date")!;
  } else if (command === "date") {
    date = argumentList[1];
  }
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD, got ${date}`);

  const days = Number(valueOf("--days") ?? (command === "next" ? 7 : 1));
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive integer");
  const overrides: GenerateOptions = {};
  const difficulty = valueOf("--difficulty");
  if (difficulty !== undefined) {
    const level = Number(difficulty);
    if (![1, 2, 3, 4, 5].includes(level)) throw new Error("--difficulty must be 1 to 5");
    overrides.difficulty = level as 1 | 2 | 3 | 4 | 5;
  }
  if (argumentList.includes("--shuffle")) overrides.shuffle = true;
  if (argumentList.includes("--no-shuffle")) overrides.shuffle = false;
  if (command === "draft") overrides.seed = valueOf("--seed") ?? Math.random().toString(36).slice(2, 8);
  return {
    command, date, days, overrides,
    force: argumentList.includes("--force"),
    reportDirectory: valueOf("--report-dir") ?? null,
  };
}

/** Write via a temporary file and rename, so an interrupted write never leaves a half-written file. */
function writeJsonAtomically(path: string, value: unknown) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporaryPath, path);
}

const readIndex = (): PuzzleIndex => (existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, "utf8")) : { puzzles: [] });

/** Shuffled days are scheduled with shuffle: true, but only if the puzzle carries a shuffle block. */
function scheduleInIndex(date: string, file: string, wantShuffle: boolean, force: boolean) {
  const puzzle: Puzzle = JSON.parse(readFileSync(join(PUZZLE_DIRECTORY, file), "utf8"));
  const index = readIndex();
  const existing = index.puzzles.find(entry => entry.date === date);
  if (existing && existing.file !== file && !force) {
    console.warn(`  the schedule already has ${existing.file} on ${date}; leaving it (use --force to replace)`);
    return;
  }
  index.puzzles = index.puzzles.filter(entry => entry.date !== date);
  const entry: ScheduleEntry = wantShuffle && puzzle.shuffle ? { date, file, shuffle: true } : { date, file };
  index.puzzles.push(entry);
  index.puzzles.sort((first, second) => first.date.localeCompare(second.date));
  writeJsonAtomically(INDEX_PATH, index);
}

/** One line per puzzle, without giving anything away. */
function summary(puzzle: Puzzle, shuffled: boolean) {
  return `${puzzle.language.name}${puzzle.theme ? ` (${puzzle.theme})` : ""}, difficulty ${puzzle.difficulty}, ` +
    `${puzzle.corpus.length} sentences${shuffled ? ", shuffled" : ""}`;
}

function listSchedule() {
  const today = todayIso();
  for (const entry of readIndex().puzzles) {
    const puzzle: Puzzle = JSON.parse(readFileSync(join(PUZZLE_DIRECTORY, entry.file), "utf8"));
    const marker = entry.date === today ? "→" : entry.date < today ? " " : "·";
    console.log(`${marker} ${entry.date}  ${entry.file.padEnd(32)} ${summary(puzzle, !!entry.shuffle)}`);
  }
}

function build(date: string, overrides: GenerateOptions, reportDirectory: string | null, reportName: string): Puzzle {
  const startedAt = Date.now();
  const { puzzle, report } = generatePuzzle(date, overrides);
  const problems = validatePuzzle(puzzle);
  if (problems.length) throw new Error(`${date}: generated puzzle is invalid: ${problems.join("; ")}`);
  if (reportDirectory) writeJsonAtomically(join(reportDirectory, `${reportName}.report.json`), report);
  console.log(`${date}: ${summary(puzzle, !!(overrides.shuffle ?? report.plan.shuffle) && !!puzzle.shuffle)} ` +
    `(${report.attempts} attempt(s), ${Date.now() - startedAt} ms)`);
  return puzzle;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "list") { listSchedule(); return; }

  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log("\nInterrupted: finishing the current puzzle, then stopping. Press Ctrl-C again to quit now.");
  });
  mkdirSync(PUZZLE_DIRECTORY, { recursive: true });
  if (options.reportDirectory) mkdirSync(options.reportDirectory, { recursive: true });

  if (options.command === "draft") {
    mkdirSync(DRAFT_DIRECTORY, { recursive: true });
    const name = `draft-${options.overrides.seed}`;
    const puzzle = build(options.date ?? todayIso(), options.overrides, options.reportDirectory, name);
    writeJsonAtomically(join(DRAFT_DIRECTORY, `${name}.json`), { ...puzzle, id: name });
    console.log(`Play it at http://localhost:5173/#${name}  (re-create it with --seed ${options.overrides.seed})`);
    return;
  }

  let startDate = options.date!;
  if (options.command === "next") {
    const scheduled = readIndex().puzzles.map(entry => entry.date).sort();
    const last = scheduled[scheduled.length - 1];
    const tomorrow = addDays(todayIso(), 1);
    startDate = last && last >= tomorrow ? addDays(last, 1) : tomorrow;
  }

  for (let offset = 0; offset < options.days && !interrupted; offset++) {
    const date = addDays(startDate, offset);
    const file = `gen-${date}.json`;
    const path = join(PUZZLE_DIRECTORY, file);
    const wantShuffle = planWithOverrides(date, options.overrides).shuffle;
    if (existsSync(path) && !options.force) {
      console.log(`${date}: ${file} exists, skipping (--force to replace)`);
    } else {
      writeJsonAtomically(path, build(date, options.overrides, options.reportDirectory, `gen-${date}`));
    }
    scheduleInIndex(date, file, wantShuffle, options.force);
    await new Promise(resolve => setImmediate(resolve)); // let a pending Ctrl-C be handled between puzzles
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

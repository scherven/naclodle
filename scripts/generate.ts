/**
 * Generate daily puzzles.
 *
 *   npm run generate -- --date 2026-11-24 [--days 7] [--schedule] [--force] [--report-dir DIR]
 *
 * Writes public/puzzles/gen-<date>.json for each date. Resumable: dates whose file already exists are
 * skipped unless --force. Each puzzle (and its index entry, with --schedule) is written as soon as it is
 * done, atomically, so Ctrl-C never loses finished work; the current date is finished before exiting.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePuzzle } from "../src/generator/index";
import { validatePuzzle, type PuzzleIndex } from "../src/puzzle";

const PUZZLE_DIRECTORY = join(import.meta.dirname, "..", "public", "puzzles");
const INDEX_PATH = join(PUZZLE_DIRECTORY, "index.json");

interface Options { startDate: string; days: number; schedule: boolean; force: boolean; reportDirectory: string | null }

function parseArguments(argumentList: string[]): Options {
  const valueOf = (flag: string) => {
    const position = argumentList.indexOf(flag);
    return position >= 0 ? argumentList[position + 1] : undefined;
  };
  const startDate = valueOf("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error(`--date must be YYYY-MM-DD, got ${startDate}`);
  const days = Number(valueOf("--days") ?? 1);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive integer");
  return {
    startDate, days,
    schedule: argumentList.includes("--schedule"),
    force: argumentList.includes("--force"),
    reportDirectory: valueOf("--report-dir") ?? null,
  };
}

function addDays(date: string, offset: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

/** Write via a temporary file and rename, so an interrupted write never leaves a half-written file. */
function writeJsonAtomically(path: string, value: unknown) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporaryPath, path);
}

function scheduleInIndex(date: string, file: string, force: boolean) {
  const index: PuzzleIndex = existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, "utf8")) : { puzzles: [] };
  const existing = index.puzzles.find(entry => entry.date === date);
  if (existing && existing.file !== file && !force) {
    console.warn(`  index already has ${existing.file} for ${date}; leaving it (use --force to replace)`);
    return;
  }
  index.puzzles = index.puzzles.filter(entry => entry.date !== date);
  index.puzzles.push({ date, file });
  index.puzzles.sort((first, second) => first.date.localeCompare(second.date));
  writeJsonAtomically(INDEX_PATH, index);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log("\nInterrupted: finishing the current date, then stopping. Press Ctrl-C again to quit now.");
  });
  mkdirSync(PUZZLE_DIRECTORY, { recursive: true });
  if (options.reportDirectory) mkdirSync(options.reportDirectory, { recursive: true });

  for (let offset = 0; offset < options.days && !interrupted; offset++) {
    const date = addDays(options.startDate, offset);
    const file = `gen-${date}.json`;
    const path = join(PUZZLE_DIRECTORY, file);
    if (existsSync(path) && !options.force) {
      console.log(`${date}: ${file} exists, skipping`);
    } else {
      const startedAt = Date.now();
      const { puzzle, report } = generatePuzzle(date);
      const problems = validatePuzzle(puzzle);
      if (problems.length) throw new Error(`${date}: generated puzzle is invalid: ${problems.join("; ")}`);
      writeJsonAtomically(path, puzzle);
      if (options.reportDirectory) writeJsonAtomically(join(options.reportDirectory, `gen-${date}.report.json`), report);
      console.log(
        `${date}: ${puzzle.language.name} (${report.theme}), headline ${report.headline}, ${report.wordOrder}, ` +
        `supporting [${report.supporting.join(", ")}], difficulty ${puzzle.difficulty}, ${puzzle.corpus.length} sentences, ` +
        `${report.competitorsKilled}/${report.competitorsTried} competitors eliminated, ` +
        `${report.attempts} attempt(s), ${Date.now() - startedAt} ms`);
      for (const description of report.blocked) console.log(`    blocked by an added sentence: ${description}`);
    }
    if (options.schedule) scheduleInIndex(date, file, options.force);
    await new Promise(resolve => setImmediate(resolve)); // let a pending Ctrl-C be handled between dates
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

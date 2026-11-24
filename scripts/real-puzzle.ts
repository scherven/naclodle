/**
 * Have Claude Code write a real-language puzzle, then check it and schedule it.
 *
 *   npm run real -- French [--date 2026-12-12] [--difficulty 3] [--theme "Arthurian court"] [--no-schedule]
 *
 * Runs `claude -p` (headless Claude Code, using your own Claude account) with scripts/prompts/real-language-puzzle.md.
 * Claude only prints a spoiler-free summary. Without --date the puzzle goes on the day after the last scheduled one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays } from "../src/generator/plan";
import { validatePuzzle, type Puzzle, type PuzzleIndex } from "../src/puzzle";
import { grade } from "../src/game/text";

const ROOT = join(import.meta.dirname, "..");
const PUZZLE_DIRECTORY = join(ROOT, "public", "puzzles");
const INDEX_PATH = join(PUZZLE_DIRECTORY, "index.json");

const argumentList = process.argv.slice(2);
const valueOf = (flag: string) => {
  const position = argumentList.indexOf(flag);
  return position >= 0 ? argumentList[position + 1] : undefined;
};
const language = argumentList[0];
if (!language || language.startsWith("--")) {
  console.error('Usage: npm run real -- <Language> [--date YYYY-MM-DD] [--difficulty 1-5] [--theme "..."] [--no-schedule]');
  process.exit(1);
}

const index: PuzzleIndex = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
const lastScheduled = index.puzzles.map(entry => entry.date).sort().at(-1);
const date = valueOf("--date") ?? (lastScheduled ? addDays(lastScheduled, 1) : new Date().toISOString().slice(0, 10));
const slug = language.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
const file = `${date}-${slug}.json`;
if (existsSync(join(PUZZLE_DIRECTORY, file)) && !argumentList.includes("--force")) {
  console.error(`${file} already exists (use --force to replace it).`);
  process.exit(1);
}

const prompt = readFileSync(join(ROOT, "scripts", "prompts", "real-language-puzzle.md"), "utf8")
  .replaceAll("{{LANGUAGE}}", language)
  .replaceAll("{{DATE}}", date)
  .replaceAll("{{DIFFICULTY}}", valueOf("--difficulty") ?? "3")
  .replaceAll("{{THEME}}", valueOf("--theme") ?? "your choice")
  .replaceAll("{{FILE}}", file);

console.log(`Asking Claude for a ${language} puzzle for ${date} (this takes a few minutes)…`);
const run = spawnSync("claude", [
  "-p", prompt,
  "--permission-mode", "acceptEdits",
  "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Bash(npx tsx:*)",
], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
if (run.error) { console.error(`Couldn't run claude: ${run.error.message}. Is Claude Code installed and on your PATH?`); process.exit(1); }
if (run.status !== 0) process.exit(run.status ?? 1);

// Check what Claude wrote before scheduling it.
const path = join(PUZZLE_DIRECTORY, file);
if (!existsSync(path)) { console.error(`Claude finished but ${file} wasn't written.`); process.exit(1); }
const puzzle: Puzzle = JSON.parse(readFileSync(path, "utf8"));
const problems = validatePuzzle(puzzle);
const items = [
  ...puzzle.toEnglish.map(item => ({ item, isEnglish: true })),
  ...puzzle.toLang.map(item => ({ item, isEnglish: false })),
];
for (const { item, isEnglish } of items)
  for (const answer of item.accepted)
    if (grade(item, answer, puzzle.language.locale, isEnglish) !== "ok") problems.push(`an accepted answer doesn't grade as correct`);
if (puzzle.date !== date) problems.push(`date is ${puzzle.date}, expected ${date}`);
if (problems.length) { console.error(`${file} has problems:\n  ${problems.join("\n  ")}`); process.exit(1); }

if (!argumentList.includes("--no-schedule")) {
  index.puzzles = index.puzzles.filter(entry => entry.date !== date);
  index.puzzles.push({ date, file });
  index.puzzles.sort((first, second) => first.date.localeCompare(second.date));
  writeFileSync(`${INDEX_PATH}.tmp`, JSON.stringify(index, null, 2) + "\n");
  renameSync(`${INDEX_PATH}.tmp`, INDEX_PATH);
  console.log(`Scheduled ${file} on ${date}. Play it at http://localhost:5173/#${date}`);
} else {
  console.log(`Wrote ${file} (not scheduled).`);
}

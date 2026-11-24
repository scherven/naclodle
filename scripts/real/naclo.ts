/**
 * A local archive of abstract cards describing past olympiad problems (NACLO, IOL, …): what each one teaches and
 * what its "aha" is, never its text. Puzzle designers read a few cards for style, and the pipeline checks a new
 * puzzle isn't a rerun of one.
 *
 *   npx tsx scripts/real/naclo.ts cards      turn every PDF in research/naclo/pdfs/ into cards (resumable, Ctrl-C safe)
 *   npx tsx scripts/real/naclo.ts status     how many PDFs and cards there are
 *
 * naclo.org doesn't serve its PDFs to scripts, so download them in a browser (the "All Round 1/2 Problems" and
 * "Solutions" links on https://www.naclo.org/practice.php cover every year) into research/naclo/pdfs/. Everything
 * here is gitignored: the cards are notes for local use, not something to publish.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fill, runAgent } from "./claude";

const ROOT = join(import.meta.dirname, "..", "..");
const ARCHIVE_DIRECTORY = join(ROOT, "research", "naclo");
const PDF_DIRECTORY = join(ARCHIVE_DIRECTORY, "pdfs");
const TEXT_DIRECTORY = join(ARCHIVE_DIRECTORY, "text");
const CARDS_PATH = join(ARCHIVE_DIRECTORY, "cards.json");

export interface ProblemCard {
  title: string;
  year: number | null;
  language: string;
  family: string | null;
  kind: "rosetta" | "numbers" | "morphology" | "phonology" | "script" | "semantics" | "computational" | "other";
  phenomena: string[];
  aha: string;
  layout: string;
  difficulty: number;
  /** The PDF the card came from. */
  source: string;
}

interface Archive { processed: string[]; cards: ProblemCard[] }

const CARD_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: ["integer", "null"] },
          language: { type: "string" },
          family: { type: ["string", "null"] },
          kind: { enum: ["rosetta", "numbers", "morphology", "phonology", "script", "semantics", "computational", "other"] },
          phenomena: { type: "array", items: { type: "string" } },
          aha: { type: "string" },
          layout: { type: "string" },
          difficulty: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["title", "year", "language", "family", "kind", "phenomena", "aha", "layout", "difficulty"],
      },
    },
  },
  required: ["cards"],
};

export function loadArchive(): Archive {
  return existsSync(CARDS_PATH) ? JSON.parse(readFileSync(CARDS_PATH, "utf8")) : { processed: [], cards: [] };
}

function saveArchive(archive: Archive) {
  writeFileSync(`${CARDS_PATH}.tmp`, JSON.stringify(archive, null, 2) + "\n");
  renameSync(`${CARDS_PATH}.tmp`, CARDS_PATH);
}

/** Cards about the same language, so a new puzzle can steer clear of what they taught. */
export function cardsForLanguage(language: string): ProblemCard[] {
  const wanted = language.toLowerCase();
  return loadArchive().cards.filter(card => card.language.toLowerCase().includes(wanted) || wanted.includes(card.language.toLowerCase()));
}

/** A few cards of a kind, as style examples for a designer. */
export function exampleCards(kind: ProblemCard["kind"], count: number, pick: <T>(items: T[]) => T[]): ProblemCard[] {
  return pick(loadArchive().cards.filter(card => card.kind === kind)).slice(0, count);
}

export const cardText = (card: ProblemCard) =>
  `- ${card.language} (${card.phenomena.join(", ")}): ${card.aha} Layout: ${card.layout}`;

async function buildCards() {
  mkdirSync(PDF_DIRECTORY, { recursive: true });
  mkdirSync(TEXT_DIRECTORY, { recursive: true });
  const pdfs = readdirSync(PDF_DIRECTORY).filter(name => name.toLowerCase().endsWith(".pdf")).sort();
  const archive = loadArchive();
  const pending = pdfs.filter(name => !archive.processed.includes(name));
  if (!pdfs.length) { console.log(`No PDFs yet. Download olympiad PDFs into ${PDF_DIRECTORY} and run this again.`); return; }
  console.log(`${pending.length} of ${pdfs.length} PDF(s) to read.`);

  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log("\nInterrupted: finishing the current PDF, then stopping. Press Ctrl-C again to quit now.");
  });
  const prompt = readFileSync(join(ROOT, "scripts", "prompts", "naclo-card.md"), "utf8");
  for (const name of pending) {
    if (interrupted) break;
    const textFile = join(TEXT_DIRECTORY, `${basename(name, ".pdf")}.txt`);
    if (!existsSync(textFile)) execFileSync("pdftotext", ["-layout", join(PDF_DIRECTORY, name), textFile]);
    try {
      const { answer } = await runAgent<{ cards: Omit<ProblemCard, "source">[] }>(fill(prompt, { TEXT_FILE: textFile }), {
        tools: ["Read"], model: "sonnet", schema: CARD_SCHEMA, cwd: ROOT,
      });
      archive.cards.push(...answer.cards.map(card => ({ ...card, source: name })));
      archive.processed.push(name);
      saveArchive(archive); // after every PDF, so an interruption never loses finished work
      console.log(`${name}: ${answer.cards.length} card(s)`);
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : error} (will retry next run)`);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log(`${archive.cards.length} card(s) in ${CARDS_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === "cards") await buildCards();
  else if (command === "status") {
    const archive = loadArchive();
    const pdfCount = existsSync(PDF_DIRECTORY) ? readdirSync(PDF_DIRECTORY).filter(name => name.toLowerCase().endsWith(".pdf")).length : 0;
    const kinds = archive.cards.reduce<Record<string, number>>((counts, card) => ({ ...counts, [card.kind]: (counts[card.kind] ?? 0) + 1 }), {});
    console.log(`${pdfCount} PDF(s), ${archive.processed.length} read, ${archive.cards.length} card(s): ${JSON.stringify(kinds)}`);
  } else {
    console.error("Usage: npx tsx scripts/real/naclo.ts cards | status");
    process.exit(1);
  }
}

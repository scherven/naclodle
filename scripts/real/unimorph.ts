/**
 * UniMorph (unimorph.github.io): attested inflection tables for hundreds of languages, used to check that every
 * word form in a real-language puzzle exists and means what its gloss says.
 *
 *   npx tsx scripts/real/unimorph.ts deu form Hunden        every analysis of a form
 *   npx tsx scripts/real/unimorph.ts deu paradigm Hund      a lemma's whole table
 *   npx tsx scripts/real/unimorph.ts deu check FILE.json    the report the pipeline gives its fact-checker (spoilers)
 *
 * Tables are downloaded once from github.com/unimorph/<code> into research/unimorph/ (gitignored).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Puzzle } from "../../src/puzzle";

const CACHE_DIRECTORY = join(import.meta.dirname, "..", "..", "research", "unimorph");

/** Language name → UniMorph code, for languages with good tables. Pass a code directly for others. */
export const UNIMORPH_CODES: Record<string, string> = {
  german: "deu", french: "fra", spanish: "spa", italian: "ita", portuguese: "por", catalan: "cat", romanian: "ron",
  latin: "lat", dutch: "nld", swedish: "swe", danish: "dan", norwegian: "nob", icelandic: "isl", faroese: "fao",
  finnish: "fin", estonian: "est", hungarian: "hun", turkish: "tur", azerbaijani: "aze", kazakh: "kaz",
  russian: "rus", ukrainian: "ukr", polish: "pol", czech: "ces", slovak: "slk", slovene: "slv", serbo: "hbs",
  bulgarian: "bul", lithuanian: "lit", latvian: "lav", irish: "gle", welsh: "cym", "scottish gaelic": "gla",
  breton: "bre", basque: "eus", georgian: "kat", armenian: "hye", greek: "ell", albanian: "sqi",
  arabic: "ara", hebrew: "heb", maltese: "mlt", persian: "fas", hindi: "hin", urdu: "urd", bengali: "ben",
  swahili: "swc", zulu: "zul", navajo: "nav", quechua: "que", "classical nahuatl": "nci", khalkha: "khk",
};

export function unimorphCode(language: string): string | null {
  const key = language.trim().toLowerCase();
  if (UNIMORPH_CODES[key]) return UNIMORPH_CODES[key];
  return /^[a-z]{3}$/.test(key) ? key : null;
}

export interface Analysis { lemma: string; form: string; features: string[] }

function tablePath(code: string): string {
  const path = join(CACHE_DIRECTORY, code);
  if (!existsSync(path)) {
    mkdirSync(CACHE_DIRECTORY, { recursive: true });
    const temporary = `${path}.download`;
    execFileSync("curl", ["-sfL", `https://raw.githubusercontent.com/unimorph/${code}/master/${code}`, "-o", temporary]);
    renameSync(temporary, path);
  }
  return path;
}

export class UniMorph {
  private byForm = new Map<string, Analysis[]>();
  private byLemma = new Map<string, Analysis[]>();

  constructor(readonly code: string) {
    for (const line of readFileSync(tablePath(code), "utf8").split("\n")) {
      const [lemma, form, features] = line.split("\t");
      if (!form || !features) continue;
      const analysis = { lemma, form, features: features.split(";") };
      const formKey = form.toLocaleLowerCase();
      (this.byForm.get(formKey) ?? this.byForm.set(formKey, []).get(formKey)!).push(analysis);
      (this.byLemma.get(lemma) ?? this.byLemma.set(lemma, []).get(lemma)!).push(analysis);
    }
  }

  /** Case-insensitive, so sentence-initial capitals and German noun capitals both match. */
  analyses(form: string): Analysis[] {
    return this.byForm.get(form.toLocaleLowerCase()) ?? [];
  }

  paradigm(lemma: string): Analysis[] {
    return this.byLemma.get(lemma) ?? this.byLemma.get(lemma.toLocaleLowerCase()) ?? [];
  }
}

/** Leipzig gloss tags → UniMorph features. Tags without a counterpart are not checked. */
const TAG_FEATURES: Record<string, string[]> = {
  NOM: ["NOM"], ACC: ["ACC"], DAT: ["DAT"], GEN: ["GEN"], INS: ["INS"], LOC: ["LOC"], ABL: ["ABL"], ESS: ["ESS"],
  SG: ["SG"], PL: ["PL"], DU: ["DU"],
  PRS: ["PRS"], PRES: ["PRS"], PST: ["PST"], PAST: ["PST"], FUT: ["FUT"],
  SBJV: ["SBJV"], IMP: ["IMP"], INF: ["NFIN"], PTCP: ["V.PTCP"],
  M: ["MASC"], MASC: ["MASC"], F: ["FEM"], FEM: ["FEM"], N: ["NEUT"], NEUT: ["NEUT"],
  CMPR: ["CMPR"], SPRL: ["SPRL"],
};

export function glossFeatures(gloss: string): string[] {
  const features: string[] = [];
  for (const tag of gloss.split(/[-.=:]/)) {
    const personNumber = tag.match(/^([123])(SG|PL|DU)$/);
    if (personNumber) { features.push(personNumber[1], personNumber[2]); continue; }
    if (/^[123]$/.test(tag)) { features.push(tag); continue; }
    features.push(...(TAG_FEATURES[tag] ?? []));
  }
  return features;
}

const words = (text: string) => text.split(/\s+/).map(word => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter(Boolean);

export interface FormFinding {
  form: string;
  where: string;
  problem: "not in UniMorph" | "gloss doesn't match";
  gloss?: string;
  attested?: string[];
}

/** Every form not in the tables, and every glossed form whose features no table entry has. */
export function checkPuzzle(puzzle: Puzzle, table: UniMorph): { checked: number; findings: FormFinding[] } {
  const findings: FormFinding[] = [];
  let checked = 0;
  const seen = new Set<string>();
  const look = (form: string, where: string, gloss?: string) => {
    const key = `${form}|${gloss ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    checked++;
    const analyses = table.analyses(form);
    if (!analyses.length) { findings.push({ form, where, problem: "not in UniMorph", gloss }); return; }
    const wanted = gloss ? glossFeatures(gloss) : [];
    if (wanted.length && !analyses.some(analysis => wanted.every(feature => analysis.features.includes(feature))))
      findings.push({ form, where, problem: "gloss doesn't match", gloss, attested: analyses.map(analysis => `${analysis.lemma} ${analysis.features.join(";")}`) });
  };
  puzzle.corpus.forEach((line, row) => words(line.lang).forEach((form, position) => look(form, `corpus ${row + 1}`, line.gloss[position])));
  for (const item of puzzle.toLang) for (const answer of item.accepted) words(answer).forEach(form => look(form, "into-language answer"));
  for (const item of puzzle.toEnglish) words(item.prompt).forEach(form => look(form, "into-English prompt"));
  return { checked, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [code, command, argument] = process.argv.slice(2);
  if (!code || !command || !argument) {
    console.error("Usage: npx tsx scripts/real/unimorph.ts <code> form|paradigm|check <word|lemma|file>");
    process.exit(1);
  }
  const table = new UniMorph(unimorphCode(code) ?? code);
  if (command === "form") {
    const analyses = table.analyses(argument);
    console.log(analyses.length ? analyses.map(analysis => `${analysis.lemma}\t${analysis.form}\t${analysis.features.join(";")}`).join("\n") : "not attested");
  } else if (command === "paradigm") {
    const analyses = table.paradigm(argument);
    console.log(analyses.length ? analyses.map(analysis => `${analysis.form}\t${analysis.features.join(";")}`).join("\n") : "no such lemma");
  } else if (command === "check") {
    console.log(JSON.stringify(checkPuzzle(JSON.parse(readFileSync(argument, "utf8")), table), null, 2));
  }
}

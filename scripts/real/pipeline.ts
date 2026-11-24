/**
 * Make a real-language puzzle with a designer agent and independent reviewers, then schedule it.
 *
 *   npm run real -- German [--difficulty 4] [--theme "..."] [--shuffle] [--kind numbers]
 *                          [--date 2026-12-12 | --draft | --shelve] [--rounds 3] [--fresh]
 *   npm run real -- validate FILE.json        the mechanical checks alone
 *
 * Each round the designer writes (or revises) the puzzle, then, each in a fresh `claude -p` that sees only its own
 * inputs:
 *   - UniMorph check   mechanical: every word form attested, glosses match (scripts/real/unimorph.ts)
 *   - back-translator  sees only the language text; its English is compared with the puzzle's and it flags anything
 *                      ungrammatical or unnatural
 *   - fact-checker     cites a source for every line, answer and the fact, and lists missing accepted answers
 *   - two blind solvers  see what the player sees, with the language disguised by a letter cipher so knowing it
 *                      doesn't help; both must get both answers (and the pairing on shuffled days)
 *   - attacker         looks for a second answer the data allows
 *   - novelty check    against the local archive of past olympiad problems (scripts/real/naclo.ts), if any
 * Everything they find goes back to the designer, up to --rounds times. The puzzle is placed only when a round is
 * clean. Without --date it goes on the day after the last scheduled puzzle; --draft makes it playable at
 * #draft-<language> without scheduling it, --shelve puts it in public/puzzles/shelved/.
 *
 * Nothing printed here gives the puzzle away. The run's working files (spoilers) are in research/real-runs/<run>/;
 * every finished step is saved there, so Ctrl-C or a failure loses nothing and the same command resumes.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays } from "../../src/generator/plan";
import { puzzleNumber } from "../../src/generator/build";
import { Rng } from "../../src/generator/rng";
import { validatePuzzle, type Puzzle, type PuzzleIndex } from "../../src/puzzle";
import { grade } from "../../src/game/text";
import { fill, runAgent, type AgentOptions } from "./claude";
import { makeCipher, type Cipher } from "./cipher";
import { checkPuzzle, UniMorph, unimorphCode, type FormFinding } from "./unimorph";
import { cardsForLanguage, cardText, exampleCards, type ProblemCard } from "./naclo";

const ROOT = join(import.meta.dirname, "..", "..");
const PUZZLE_DIRECTORY = join(ROOT, "public", "puzzles");
const INDEX_PATH = join(PUZZLE_DIRECTORY, "index.json");
const RUNS_DIRECTORY = join(ROOT, "research", "real-runs");
const prompt = (name: string) => readFileSync(join(ROOT, "scripts", "prompts", `${name}.md`), "utf8");

/* ---------- mechanical checks ---------- */

const words = (text: string) => text.toLocaleLowerCase().split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);

/** Format, grading and coverage problems. Placeholder id/date/number are fine: the pipeline fills them in. */
export function mechanicalProblems(puzzle: Puzzle, wantShuffle: boolean): string[] {
  const problems = validatePuzzle(puzzle);
  const locale = puzzle.language?.locale;
  for (const item of puzzle.toEnglish ?? []) for (const answer of item.accepted ?? [])
    if (grade(item, answer, locale, true) !== "ok") problems.push(`accepted English answer "${answer}" doesn't grade as correct`);
  for (const item of puzzle.toLang ?? []) for (const answer of item.accepted ?? [])
    if (grade(item, answer, locale, false) !== "ok") problems.push(`accepted answer "${answer}" doesn't grade as correct`);
  if (!puzzle.language?.real) problems.push("language.real must be true");
  if (!puzzle.explain?.fact) problems.push("explain.fact is missing");
  if (wantShuffle) {
    const anchors = puzzle.shuffle?.anchors ?? [];
    if (anchors.length < 1 || anchors.length > 2) problems.push("a shuffled puzzle needs shuffle.anchors with 1 or 2 rows");
  }
  const corpusWords = new Set((puzzle.corpus ?? []).flatMap(line => words(line.lang)));
  const unseen = [...(puzzle.toEnglish ?? []).flatMap(item => words(item.prompt)), ...(puzzle.toLang ?? []).flatMap(item => words(item.accepted[0] ?? ""))]
    .filter(word => !corpusWords.has(word));
  if (unseen.length) problems.push(`note (fine only if a rule in the data derives them): test words not in the corpus: ${[...new Set(unseen)].join(", ")}`);
  return problems;
}
const blocking = (problems: string[]) => problems.filter(problem => !problem.startsWith("note"));

/* ---------- what the solvers see ---------- */

const letter = (position: number) => String.fromCharCode(65 + position);

/** The puzzle as a player sees it (no glosses), with the language disguised. */
export function playerView(puzzle: Puzzle, cipher: Cipher): string {
  const lines: string[] = [];
  if (puzzle.shuffle) {
    const { anchors, order } = puzzle.shuffle;
    lines.push(`Sentences in the language (numbered) and their English translations (lettered), which have been shuffled. ` +
      `Row ${anchors.map(anchor => anchor + 1).join(" and ")} ${anchors.length > 1 ? "are" : "is"} already paired with ${anchors.length > 1 ? "their" : "its"} own letter.`);
    puzzle.corpus.forEach((line, row) => lines.push(`${row + 1}. ${cipher.encode(line.lang)}`));
    lines.push("");
    order.forEach((englishRow, row) => lines.push(`${letter(row)}. ${puzzle.corpus[englishRow].en}`));
  } else {
    lines.push("Sentences in the language with their English translations:");
    puzzle.corpus.forEach((line, row) => lines.push(`${row + 1}. ${cipher.encode(line.lang)} = ${line.en}`));
  }
  lines.push("", `Hint (players may use it): ${puzzle.hint}`);
  lines.push("", `Translate into English: ${cipher.encode(puzzle.toEnglish[0].prompt)}`);
  lines.push(`Translate into the language: ${puzzle.toLang[0].prompt}`);
  return lines.join("\n");
}

/** The letter each row should get on a shuffled day. */
const correctPairing = (puzzle: Puzzle) =>
  puzzle.corpus.map((_, row) => letter(puzzle.shuffle!.order.indexOf(row)));

/* ---------- reviewer answers ---------- */

interface BackTranslation { texts: { number: number; english: string; grammatical: boolean; natural: boolean; problem: string }[] }
interface Comparison { pairs: { number: number; same: boolean; difference: string }[] }
interface FactCheck {
  checks: { where: string; ok: boolean; source: string; problem: string }[];
  missingAnswers: { item: "toEnglish" | "toLang"; answer: string; why: string }[];
}
interface Solution { toEnglish: string; toLang: string; pairing?: string[]; rules: string; difficulty: number; uncertain: string }
interface Attack { alternatives: { item: "toEnglish" | "toLang" | "pairing"; answer: string; rule: string }[] }
interface Novelty { rerun: boolean; closest: string; why: string }

const string = { type: "string" };
const BACK_SCHEMA = { type: "object", required: ["texts"], properties: { texts: { type: "array", items: { type: "object",
  required: ["number", "english", "grammatical", "natural", "problem"],
  properties: { number: { type: "integer" }, english: string, grammatical: { type: "boolean" }, natural: { type: "boolean" }, problem: string } } } } };
const COMPARE_SCHEMA = { type: "object", required: ["pairs"], properties: { pairs: { type: "array", items: { type: "object",
  required: ["number", "same", "difference"], properties: { number: { type: "integer" }, same: { type: "boolean" }, difference: string } } } } };
const FACT_SCHEMA = { type: "object", required: ["checks", "missingAnswers"], properties: {
  checks: { type: "array", items: { type: "object", required: ["where", "ok", "source", "problem"],
    properties: { where: string, ok: { type: "boolean" }, source: string, problem: string } } },
  missingAnswers: { type: "array", items: { type: "object", required: ["item", "answer", "why"],
    properties: { item: { enum: ["toEnglish", "toLang"] }, answer: string, why: string } } } } };
const solveSchema = (shuffled: boolean) => ({ type: "object",
  required: ["toEnglish", "toLang", "rules", "difficulty", "uncertain", ...(shuffled ? ["pairing"] : [])],
  properties: { toEnglish: string, toLang: string, rules: string, difficulty: { type: "integer", minimum: 1, maximum: 5 }, uncertain: string,
    ...(shuffled ? { pairing: { type: "array", items: string, description: "the letter for each numbered row, in row order" } } : {}) } });
const ATTACK_SCHEMA = { type: "object", required: ["alternatives"], properties: { alternatives: { type: "array", items: { type: "object",
  required: ["item", "answer", "rule"], properties: { item: { enum: ["toEnglish", "toLang", "pairing"] }, answer: string, rule: string } } } } };
const NOVELTY_SCHEMA = { type: "object", required: ["rerun", "closest", "why"], properties: { rerun: { type: "boolean" }, closest: string, why: string } };

/* ---------- run state ---------- */

interface Settings {
  language: string;
  kind: "sentences" | "numbers";
  difficulty: string;
  theme: string;
  shuffle: boolean;
  placement: { to: "schedule"; date: string } | { to: "draft" } | { to: "shelve" };
  rounds: number;
}
interface RunState {
  settings: Settings;
  /** Finished steps by "round:step". */
  steps: Record<string, unknown>;
  costUsd: number;
  placed?: string;
}

function parseArguments(argumentList: string[]): { settings: Settings; fresh: boolean } {
  const valueOf = (flag: string) => {
    const position = argumentList.indexOf(flag);
    return position >= 0 ? argumentList[position + 1] : undefined;
  };
  const language = argumentList[0];
  if (!language || language.startsWith("--")) {
    console.error('Usage: npm run real -- <Language> [--difficulty 1-5] [--theme "..."] [--shuffle] [--kind numbers] [--date YYYY-MM-DD | --draft | --shelve] [--rounds 3] [--fresh]');
    process.exit(1);
  }
  const kind = valueOf("--kind") ?? "sentences";
  if (kind !== "sentences" && kind !== "numbers") throw new Error("--kind must be sentences or numbers");
  let placement: Settings["placement"];
  if (argumentList.includes("--draft")) placement = { to: "draft" };
  else if (argumentList.includes("--shelve")) placement = { to: "shelve" };
  else {
    const index: PuzzleIndex = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    const last = index.puzzles.map(entry => entry.date).sort().at(-1);
    placement = { to: "schedule", date: valueOf("--date") ?? (last ? addDays(last, 1) : new Date().toISOString().slice(0, 10)) };
  }
  return {
    settings: {
      language, kind, placement,
      difficulty: valueOf("--difficulty") ?? "3",
      theme: valueOf("--theme") ?? "your choice",
      shuffle: argumentList.includes("--shuffle"),
      rounds: Number(valueOf("--rounds") ?? 3),
    },
    fresh: argumentList.includes("--fresh"),
  };
}

const slugOf = (language: string) => language.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

function runName(settings: Settings): string {
  const where = settings.placement.to === "schedule" ? settings.placement.date : settings.placement.to;
  return `${slugOf(settings.language)}-${settings.kind}-${where}`;
}

/* ---------- the run ---------- */

async function run(settings: Settings, fresh: boolean) {
  const name = runName(settings);
  const runDirectory = join(RUNS_DIRECTORY, name);
  if (fresh) rmSync(runDirectory, { recursive: true, force: true });
  mkdirSync(runDirectory, { recursive: true });
  const statePath = join(runDirectory, "state.json");
  const puzzlePath = join(runDirectory, "puzzle.json");
  const state: RunState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { settings, steps: {}, costUsd: 0 };
  if (state.placed) { console.log(`Already placed as ${state.placed}. Use --fresh to start over.`); return; }
  const save = () => {
    writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2) + "\n");
    renameSync(`${statePath}.tmp`, statePath);
  };
  /** Run a step once; a re-run reuses its saved result. */
  const step = async <T>(key: string, work: (stepKey: string) => Promise<T> | T): Promise<T> => {
    if (key in state.steps) return state.steps[key] as T;
    const result = await work(key);
    state.steps[key] = result;
    save();
    return result;
  };
  /** The agent runner for one step: its calls carry the step's key. */
  const agentFor = (stepKey: string): Agent => async <T>(text: string, options: Omit<AgentOptions, "cwd">): Promise<T> => {
    const { answer, costUsd } = await runAgent<T>(text, { ...options, cwd: ROOT, key: stepKey });
    state.costUsd += costUsd;
    return answer;
  };

  const code = settings.kind === "sentences" ? unimorphCode(settings.language) : null;
  const table = code ? new UniMorph(code) : null;
  const pastProblems = cardsForLanguage(settings.language);
  const rng = new Rng(`examples:${name}`);
  const examples = exampleCards(settings.kind === "numbers" ? "numbers" : "rosetta", 4, items => rng.shuffle(items));
  console.log(`${settings.language} ${settings.kind} puzzle, difficulty ${settings.difficulty}${settings.shuffle ? ", shuffled" : ""}. ` +
    `UniMorph: ${code ?? "none"}. Past problems on file for this language: ${pastProblems.length}. Working files: ${runDirectory}`);

  let issues: string[] = (state.steps["issues"] as string[] | undefined) ?? [];
  for (let round = 1; round <= settings.rounds; round++) {
    const key = (stepName: string) => `${round}:${stepName}`;
    if (state.steps[key("clean")]) break;

    await step(key("design"), async stepKey => {
      const agent = agentFor(stepKey);
      process.stdout.write(`Round ${round}: ${round === 1 ? "designing" : "revising"}… `);
      await agent(designerPrompt(settings, puzzlePath, code, examples, pastProblems, round === 1 ? [] : issues), {
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Bash"],
        allow: ["Bash(npx tsx scripts/real/pipeline.ts validate:*)", "Bash(npx tsx scripts/real/unimorph.ts:*)"],
        model: "opus",
      });
      console.log("done");
      return true;
    });
    if (!existsSync(puzzlePath)) throw new Error("the designer didn't write the puzzle");
    const puzzle = finalise(JSON.parse(readFileSync(puzzlePath, "utf8")), settings, name);
    writeFileSync(puzzlePath, JSON.stringify(puzzle, null, 2) + "\n");

    const mechanical = blocking(mechanicalProblems(puzzle, settings.shuffle));
    if (mechanical.length) {
      issues = mechanical.map(problem => `Format: ${problem}`);
      state.steps["issues"] = issues;
      save();
      console.log(`Round ${round}: ${mechanical.length} format problem(s); back to the designer.`);
      continue;
    }

    const cipher = makeCipher([...puzzle.corpus.map(line => line.lang), puzzle.toEnglish[0].prompt, ...puzzle.toLang[0].accepted], name);
    writeFileSync(join(runDirectory, `round-${round}-disguised.txt`), playerView(puzzle, cipher) + "\n");
    console.log(`Round ${round}: reviewing (in parallel; takes several minutes)…`);
    const reviews = await Promise.allSettled([
      step(key("unimorph"), () => (table ? checkPuzzle(puzzle, table) : { checked: 0, findings: [] as FormFinding[] })),
      step(key("back"), stepKey => backTranslate(puzzle, settings, agentFor(stepKey))),
      step(key("fact"), async stepKey => {
        const agent = agentFor(stepKey);
        const formReport = table ? checkPuzzle(puzzle, table) : null;
        return agent<FactCheck>(fill(prompt("fact-check"), {
          LANGUAGE: settings.language, PUZZLE_PATH: puzzlePath, UNIMORPH_CODE: code ?? "(none)",
          UNIMORPH: formReport ? (formReport.findings.length ? formReport.findings.map(finding => `- ${JSON.stringify(finding)}`).join("\n") : "(all forms attested, glosses match)") : "(no table for this language: source every form yourself)",
        }), { tools: ["Read", "WebSearch", "WebFetch", "Bash"], allow: ["Bash(npx tsx scripts/real/unimorph.ts:*)"], model: "opus", schema: FACT_SCHEMA });
      }),
      step(key("solve-1"), stepKey => solve(puzzle, cipher, "opus", agentFor(stepKey))),
      step(key("solve-2"), stepKey => solve(puzzle, cipher, "sonnet", agentFor(stepKey))),
      step(key("attack"), stepKey => agentFor(stepKey)<Attack>(fill(prompt("attack"), {
        PUZZLE: playerView(puzzle, cipher),
        ACCEPTED: [`Into English: ${puzzle.toEnglish[0].accepted.map(answer => `"${answer}"`).join(", ")}`,
          `Into the language: ${puzzle.toLang[0].accepted.map(answer => `"${cipher.encode(answer)}"`).join(", ")}`,
          ...(puzzle.shuffle ? [`Pairing (letter for each row): ${correctPairing(puzzle).join(" ")}`] : [])].join("\n"),
        PAIRING: puzzle.shuffle ? "Also check whether the rows can be paired with the English lines in more than one way; if so, report the other pairing as item \"pairing\".\n" : "",
      }), { tools: [], model: "opus", schema: ATTACK_SCHEMA })),
      step(key("novelty"), stepKey => pastProblems.length
        ? agentFor(stepKey)<Novelty>(fill(prompt("novelty"), {
          LANGUAGE: settings.language,
          GRAMMAR: puzzle.explain.grammar.map(([, role]) => `- ${role}`).join("\n") + (puzzle.explain.notes ? `\n${puzzle.explain.notes}` : ""),
          CARDS: pastProblems.map(cardText).join("\n"),
        }), { tools: [], model: "sonnet", schema: NOVELTY_SCHEMA })
        : { rerun: false, closest: "", why: "no past problems on file" }),
    ]);
    const failed = reviews.filter(review => review.status === "rejected") as PromiseRejectedResult[];
    if (failed.length) throw new Error(`${failed.length} reviewer(s) failed (finished ones are saved; re-run to resume): ${failed.map(review => review.reason?.message ?? review.reason).join(" | ")}`);
    const [forms, back, fact, solveOne, solveTwo, attack, novelty] = reviews.map(review => (review as PromiseFulfilledResult<unknown>).value) as
      [{ findings: FormFinding[] }, { back: BackTranslation; comparison: Comparison; texts: string[] }, FactCheck, Solution, Solution, Attack, Novelty];

    const found: Record<string, string[]> = {
      "back-translation": backIssues(back),
      "fact-check": [
        ...fact.checks.filter(check => !check.ok).map(check => `Fact-checker, ${check.where}: ${check.problem} (source: ${check.source})`),
        ...fact.missingAnswers.map(missing => `Fact-checker: ${missing.item} should also accept "${missing.answer}" (${missing.why})`),
      ],
      solvers: [
        ...[solveOne, solveTwo].flatMap((solution, position) => solverIssues(puzzle, cipher, solution, position + 1)),
        ...difficultyIssue((solveOne.difficulty + solveTwo.difficulty) / 2, Number(settings.difficulty)),
      ],
      attack: attack.alternatives.flatMap(alternative => attackIssue(puzzle, cipher, alternative)),
      novelty: novelty.rerun ? [`Novelty: this is essentially a rerun of a past olympiad problem (${novelty.closest}: ${novelty.why}). Teach something else.`] : [],
    };
    issues = Object.values(found).flat();
    state.steps["issues"] = issues;
    state.steps[key("found")] = found;
    save();
    const attested = forms.findings.length;
    console.log(`Round ${round}: ` + Object.entries(found).map(([reviewer, list]) => `${reviewer} ${list.length ? `✗ ${list.length}` : "✓"}`).join(" · ") +
      (table ? ` · UniMorph: ${attested} form(s) for the fact-checker to source` : "") +
      ` · solvers rated it ${solveOne.difficulty} and ${solveTwo.difficulty}`);
    if (!issues.length) { state.steps[key("clean")] = true; save(); break; }
  }

  console.log(`Spent about $${state.costUsd.toFixed(2)} so far.`);
  if (issues.length) {
    console.error(`Not clean after ${settings.rounds} round(s): ${issues.length} open issue(s). Re-run with a higher --rounds to keep going, ` +
      `or read research/real-runs/${name}/state.json (spoilers).`);
    process.exit(1);
  }
  place(JSON.parse(readFileSync(puzzlePath, "utf8")), settings, state, save);
}

function designerPrompt(settings: Settings, puzzlePath: string, code: string | null, examples: ProblemCard[], pastProblems: ProblemCard[], issues: string[]): string {
  const shuffleText = settings.shuffle
    ? "This puzzle will be SHUFFLED: the English column starts out of order and the player drags translations into place before translating. Add \"shuffle\": { \"anchors\": [one or two row indexes], \"order\": [0, 1, …, n-1] } (the script scrambles the order). The pairing must be uniquely recoverable from the data, and working it out should itself be part of the fun; the anchor rows give a foothold."
    : "";
  const unimorphText = code
    ? `Morphology tables: UniMorph has attested forms for this language. Use only forms it attests, or that you source elsewhere:\n  npx tsx scripts/real/unimorph.ts ${code} paradigm <lemma>\n  npx tsx scripts/real/unimorph.ts ${code} form <word>`
    : "";
  const naclo = [
    examples.length ? `How some past olympiad problems work (for style; do not copy them):\n${examples.map(cardText).join("\n")}` : "",
    pastProblems.length ? `Past olympiad problems on this language already taught the following. Teach something different:\n${pastProblems.map(cardText).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const revision = issues.length
    ? `REVISION. The puzzle is already at ${puzzlePath}. Independent reviewers found these problems. Fix every one (add or change data, fix forms, widen \`accepted\`). If you are sure a reviewer is wrong, change the puzzle so the point can't be misread rather than ignoring it.\n${issues.map(issue => `- ${issue}`).join("\n")}`
    : "";
  return fill(prompt("designer"), {
    LANGUAGE: settings.language, DIFFICULTY: settings.difficulty, THEME: settings.theme, PUZZLE_PATH: puzzlePath,
    KIND: settings.kind === "numbers" ? fill(prompt("numbers"), { LANGUAGE: settings.language }) : "",
    SHUFFLE: shuffleText, UNIMORPH: unimorphText, NACLO: naclo, REVISION: revision,
  }).replace(/\n{3,}/g, "\n\n");
}

/** Fill in what the script owns: id, date, number, and the scrambled order of a shuffled puzzle. */
export function finalise(puzzle: Puzzle, settings: Settings, name: string): Puzzle {
  const slug = slugOf(settings.language);
  const date = settings.placement.to === "schedule" ? settings.placement.date : new Date().toISOString().slice(0, 10);
  puzzle.id = settings.placement.to === "draft" ? `draft-${slug}` : `${slug}-${date}`;
  puzzle.date = date;
  puzzle.number = puzzleNumber(date);
  puzzle.checks = 3;
  if (settings.shuffle && puzzle.shuffle?.anchors?.length && puzzle.corpus?.length) {
    const anchors = puzzle.shuffle.anchors;
    const loose = puzzle.corpus.map((_, row) => row).filter(row => !anchors.includes(row));
    // a scramble that leaves no loose row in its own place
    const rng = new Rng(`shuffle:${name}`);
    let scrambled = rng.shuffle(loose);
    for (let attempt = 0; attempt < 100 && scrambled.some((row, position) => row === loose[position]); attempt++) scrambled = rng.shuffle(loose);
    const order = puzzle.corpus.map((_, row) => row);
    loose.forEach((row, position) => { order[row] = scrambled[position]; });
    puzzle.shuffle = { anchors, order };
  } else if (!settings.shuffle) {
    delete puzzle.shuffle;
  }
  return puzzle;
}

type Agent = <T>(text: string, options: Omit<AgentOptions, "cwd">) => Promise<T>;

async function backTranslate(puzzle: Puzzle, settings: Settings, agent: Agent) {
  const texts = [
    ...puzzle.corpus.map(line => line.lang),
    puzzle.toEnglish[0].prompt,
    ...puzzle.toLang[0].accepted,
  ];
  const references = [...puzzle.corpus.map(line => line.en), puzzle.toEnglish[0].accepted[0], ...puzzle.toLang[0].accepted.map(() => puzzle.toLang[0].prompt)];
  const back = await agent<BackTranslation>(fill(prompt("back-translate"), {
    LANGUAGE: settings.language, TEXTS: texts.map((text, position) => `${position + 1}. ${text}`).join("\n"),
  }), { tools: ["WebSearch", "WebFetch"], model: "opus", schema: BACK_SCHEMA });
  const comparison = await agent<Comparison>(fill(prompt("compare"), {
    LANGUAGE: settings.language,
    PAIRS: texts.map((text, position) => `${position + 1}. ${text}\n   author: ${references[position]}\n   independent: ${back.texts.find(entry => entry.number === position + 1)?.english ?? "(none)"}`).join("\n"),
  }), { tools: [], model: "sonnet", schema: COMPARE_SCHEMA });
  return { back, comparison, texts };
}

function backIssues({ back, comparison, texts }: { back: BackTranslation; comparison: Comparison; texts: string[] }): string[] {
  const issues: string[] = [];
  for (const entry of back.texts) {
    const text = texts[entry.number - 1];
    if (!entry.grammatical || !entry.natural) issues.push(`Back-translator on "${text}": ${entry.grammatical ? "unnatural" : "ungrammatical"}: ${entry.problem}`);
  }
  for (const pair of comparison.pairs) if (!pair.same)
    issues.push(`Back-translation of "${texts[pair.number - 1]}" means something different from your English: ${pair.difference}`);
  return issues;
}

async function solve(puzzle: Puzzle, cipher: Cipher, model: "opus" | "sonnet", agent: Agent): Promise<Solution> {
  return agent<Solution>(fill(prompt("solve"), {
    PUZZLE: playerView(puzzle, cipher),
    PAIRING: puzzle.shuffle ? "- pairing: the letter of the English line for each numbered row, in row order.\n" : "",
  }), { tools: [], model, schema: solveSchema(!!puzzle.shuffle) });
}

function solverIssues(puzzle: Puzzle, cipher: Cipher, solution: Solution, number: number): string[] {
  const issues: string[] = [];
  const locale = puzzle.language.locale;
  const note = `(it inferred: ${solution.rules}${solution.uncertain ? `; unsure about: ${solution.uncertain}` : ""}; it saw the language disguised, so decode its words with ${cipherKey(cipher, puzzle)})`;
  const english = grade(puzzle.toEnglish[0], solution.toEnglish, locale, true);
  if (english !== "ok") issues.push(`Blind solver ${number} translated the into-English item as "${solution.toEnglish}" (${english}) ${note}`);
  const intoLanguage = cipher.decode(solution.toLang);
  const languageGrade = grade(puzzle.toLang[0], intoLanguage, locale, false);
  if (languageGrade !== "ok") issues.push(`Blind solver ${number} translated the into-language item as "${intoLanguage}" (${languageGrade}) ${note}`);
  if (puzzle.shuffle) {
    const wanted = correctPairing(puzzle);
    const wrongRows = wanted.flatMap((target, row) => (solution.pairing?.[row]?.trim().toUpperCase() === target ? [] : [row + 1]));
    if (wrongRows.length) issues.push(`Blind solver ${number} paired rows ${wrongRows.join(", ")} wrongly on the shuffled day ${note}`);
  }
  return issues;
}

/** One solver's rating is noisy, so only the average counts, and only when it is two or more off. */
function difficultyIssue(rating: number, target: number): string[] {
  if (Math.abs(rating - target) < 2) return [];
  return [`The blind solvers rated it difficulty ${rating} on average, but the target is ${target}: make it ${rating > target ? "easier" : "harder"}.`];
}

const cipherKey = (cipher: Cipher, puzzle: Puzzle) => {
  const letters = [...new Set(puzzle.corpus.map(line => line.lang).join("").toLocaleLowerCase().split("").filter(character => /\p{L}/u.test(character)))].sort();
  return letters.map(original => `${cipher.encode(original)}=${original}`).join(" ");
};

function attackIssue(puzzle: Puzzle, cipher: Cipher, alternative: Attack["alternatives"][number]): string[] {
  const locale = puzzle.language.locale;
  if (alternative.item === "pairing") return [`Attacker: the shuffled rows can also be paired as ${alternative.answer} (${alternative.rule}). Make the pairing unique.`];
  const isEnglish = alternative.item === "toEnglish";
  const answer = isEnglish ? alternative.answer : cipher.decode(alternative.answer);
  const item = isEnglish ? puzzle.toEnglish[0] : puzzle.toLang[0];
  if (grade(item, answer, locale, isEnglish) === "ok") return [];
  return [`Attacker: the data also supports "${answer}" for the ${isEnglish ? "into-English" : "into-language"} item, by this rule: ${alternative.rule}. ` +
    `Add data that rules it out, or accept it if it is also correct ${isEnglish ? "English" : "in the language"}.`];
}

function place(puzzle: Puzzle, settings: Settings, state: RunState, save: () => void) {
  const slug = slugOf(settings.language);
  let path: string;
  if (settings.placement.to === "draft") {
    mkdirSync(join(PUZZLE_DIRECTORY, "drafts"), { recursive: true });
    path = join(PUZZLE_DIRECTORY, "drafts", `draft-${slug}.json`);
  } else if (settings.placement.to === "shelve") {
    mkdirSync(join(PUZZLE_DIRECTORY, "shelved"), { recursive: true });
    path = join(PUZZLE_DIRECTORY, "shelved", `${slug}-${settings.kind}-${puzzle.date}.json`);
  } else {
    path = join(PUZZLE_DIRECTORY, `${settings.placement.date}-${slug}.json`);
  }
  writeFileSync(`${path}.tmp`, JSON.stringify(puzzle, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
  if (settings.placement.to === "schedule") {
    const date = settings.placement.date;
    const index: PuzzleIndex = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    index.puzzles = index.puzzles.filter(entry => entry.date !== date);
    index.puzzles.push({ date, file: `${date}-${slug}.json`, ...(settings.shuffle ? { shuffle: true } : {}) });
    index.puzzles.sort((first, second) => first.date.localeCompare(second.date));
    writeFileSync(`${INDEX_PATH}.tmp`, JSON.stringify(index, null, 2) + "\n");
    renameSync(`${INDEX_PATH}.tmp`, INDEX_PATH);
    console.log(`Scheduled on ${date}. Play it at http://localhost:5173/#${date}`);
  } else if (settings.placement.to === "draft") {
    console.log(`Play it at http://localhost:5173/#draft-${slug}`);
  } else {
    console.log(`Shelved as ${path}`);
  }
  state.placed = path;
  save();
}

/* ---------- entry ---------- */

const argumentList = process.argv.slice(2);
if (import.meta.url !== `file://${process.argv[1]}`) {
  // imported (by tests): don't run
} else if (argumentList[0] === "validate") {
  const puzzle: Puzzle = JSON.parse(readFileSync(argumentList[1], "utf8"));
  const problems = mechanicalProblems(puzzle, !!puzzle.shuffle);
  console.log(problems.length ? problems.join("\n") : "ok");
  process.exit(blocking(problems).length ? 1 : 0);
} else {
  const { settings, fresh } = parseArguments(argumentList);
  process.on("SIGINT", () => {
    console.log("\nStopped. Finished steps are saved; run the same command to resume.");
    process.exit(130);
  });
  run(settings, fresh).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

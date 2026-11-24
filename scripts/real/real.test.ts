import { describe, expect, it } from "vitest";
import { makeCipher } from "./cipher";
import { glossFeatures } from "./unimorph";
import { finalise, mechanicalProblems, playerView } from "./pipeline";
import type { Puzzle } from "../../src/puzzle";

const puzzle = (): Puzzle => ({
  id: "x", number: 0, date: "2000-01-01", difficulty: 3, checks: 3, keys: ["ä"],
  language: { name: "Test", real: true, locale: "de" }, hint: "h", theme: "t",
  corpus: ["Der Hund schläft", "Die Katze schläft", "Der Hund sieht die Katze", "Die Katze sieht den Hund"]
    .map((lang, row) => ({ lang, en: `line ${row}`, gloss: lang.split(" ").map(() => "x") })),
  toEnglish: [{ prompt: "Der Hund sieht den Hund", accepted: ["the dog sees the dog"], explanation: "" }],
  toLang: [{ prompt: "the cat sleeps", accepted: ["Die Katze schläft"], explanation: "" }],
  explain: { words: [], grammar: [], fact: "f" },
  shuffle: { anchors: [0], order: [0, 1, 2, 3] },
});

describe("real-language pipeline", () => {
  it("disguises a language reversibly, keeping capitals and repeated pieces", () => {
    const cipher = makeCipher(["Der Hund schläft über die Straße"], "seed");
    const text = "Der Hund schläft über die Straße";
    const encoded = cipher.encode(text);
    expect(encoded).not.toBe(text);
    expect(cipher.decode(encoded)).toBe(text);
    expect(encoded[0]).toBe(encoded[0].toLocaleUpperCase());
    expect(cipher.encode("Der der")).toBe(`${cipher.encode("Der")} ${cipher.encode("der")}`);
  });

  it("reads UniMorph features out of Leipzig glosses", () => {
    expect(glossFeatures("dog-DAT.PL")).toEqual(["DAT", "PL"]);
    expect(glossFeatures("sleep-3SG")).toEqual(["3", "SG"]);
    expect(glossFeatures("the.M.ACC")).toEqual(["MASC", "ACC"]);
  });

  it("scrambles a shuffled puzzle with anchors fixed and no loose row in place", () => {
    const settings = { language: "Test", kind: "sentences", difficulty: "3", theme: "", shuffle: true, placement: { to: "draft" }, rounds: 1 } as const;
    const result = finalise(puzzle(), settings, "run");
    expect(result.shuffle!.order[0]).toBe(0);
    expect(result.shuffle!.order.slice(1).every((row, position) => row !== position + 1)).toBe(true);
    expect(mechanicalProblems(result, true).filter(problem => !problem.startsWith("note"))).toEqual([]);
    const view = playerView(result, makeCipher(result.corpus.map(line => line.lang), "v"));
    expect(view).not.toMatch(/Hund|Katze/);
  });

  it("catches accepted answers that don't grade and a missing anchor", () => {
    const broken = puzzle();
    broken.toLang[0].accepted.push("");
    broken.shuffle = undefined;
    const problems = mechanicalProblems(broken, true);
    expect(problems.some(problem => problem.includes("doesn't grade"))).toBe(true);
    expect(problems.some(problem => problem.includes("anchors"))).toBe(true);
  });
});

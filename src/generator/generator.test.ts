import { describe, expect, it } from "vitest";
import { validatePuzzle } from "../puzzle";
import { checkSolvability, type TestItem } from "./checker";
import { englishAnswers, englishSentence, makeVerbEnglish, pluralOf, type EnglishLexicon } from "./english";
import { featureCondition, roleCondition, type Grammar } from "./grammar";
import { generatePuzzle, themeForDate } from "./index";
import { looksEnglish, type Lexicon } from "./lexicon";
import { enumerateMeanings, type Meaning } from "./meaning";
import { realise, sentenceText } from "./realise";
import { Rng } from "./rng";
import { THEMES } from "./themes";

const dateAfter = (offset: number) => new Date(Date.UTC(2027, 0, 1 + offset)).toISOString().slice(0, 10);

describe("determinism", () => {
  it("gives the same puzzle for the same date", () => {
    expect(generatePuzzle("2026-12-01").puzzle).toEqual(generatePuzzle("2026-12-01").puzzle);
  });
  it("gives different puzzles for different dates", () => {
    expect(generatePuzzle("2026-12-01").puzzle.corpus).not.toEqual(generatePuzzle("2026-12-02").puzzle.corpus);
  });
  it("seeds the RNG from the string", () => {
    const first = new Rng("abc"), second = new Rng("abc"), third = new Rng("abd");
    const draw = (rng: Rng) => Array.from({ length: 5 }, () => rng.int(0, 1000));
    expect(draw(first)).toEqual(draw(second));
    expect(draw(new Rng("abc"))).not.toEqual(draw(third));
  });
  it("picks the theme from the date", () => {
    expect(themeForDate("2026-12-01").id).toBe(themeForDate("2026-12-01").id);
  });
});

describe("generated puzzles", () => {
  const dates = Array.from({ length: 55 }, (_, offset) => dateAfter(offset));
  const generated = dates.map(date => generatePuzzle(date));

  it("pass validatePuzzle for 55 dates", () => {
    for (const { puzzle } of generated) expect(validatePuzzle(puzzle), puzzle.date).toEqual([]);
  });

  it("never put a test sentence in the corpus, and list every non-ASCII letter as a key", () => {
    for (const { puzzle } of generated) {
      const corpusLang = puzzle.corpus.map(line => line.lang.toLowerCase().replace(/\.$/, ""));
      const corpusEnglish = puzzle.corpus.map(line => line.en);
      for (const item of puzzle.toEnglish) expect(corpusLang).not.toContain(item.prompt.toLowerCase().replace(/\.$/, ""));
      for (const item of puzzle.toLang) expect(corpusEnglish).not.toContain(item.prompt);
      const letters = new Set([...puzzle.corpus.map(line => line.lang).join("").toLowerCase()].filter(letter => /\p{L}/u.test(letter) && !/[a-z]/.test(letter)));
      for (const letter of letters) expect(puzzle.keys).toContain(letter);
      expect(puzzle.language.real).toBe(false);
      expect(puzzle.explain.fact).toBeUndefined();
    }
  });

  it("leave no competitor that fits the corpus but changes an answer", () => {
    for (const { report } of generated) expect(report.competitorsKilled).toBeGreaterThan(50);
  });

  it("cover several headline phenomena", () => {
    expect(new Set(generated.map(({ report }) => report.headline)).size).toBeGreaterThanOrEqual(5);
  });
}, 120_000);

/** A hand-built ergative SOV grammar for checker tests. */
function ergativeGrammar(): Grammar {
  const verb = (id: string, form: string, transitive: boolean): Lexicon["verbs"][number] => ({
    id, form, transitive, agents: ["p", "b"], patients: transitive ? ["p", "b"] : [], patientIds: [], english: makeVerbEnglish(id),
  });
  const noun = (id: string, form: string, semanticClass: "p" | "b"): Lexicon["nouns"][number] => ({
    id, form, semanticClass, english: { singular: id, plural: pluralOf(id) },
  });
  return {
    wordOrder: "SOV",
    intransitiveSubjectFirst: true,
    morphemes: [
      { id: "PL", gloss: "PL", host: "noun", exponent: { kind: "suffix", form: "ti" }, condition: featureCondition("plural"), slot: 1 },
      { id: "ERG", gloss: "ERG", host: "noun", exponent: { kind: "suffix", form: "ka" }, condition: roleCondition("A"), slot: 3 },
      { id: "NEG", gloss: "NEG", host: "verb", exponent: { kind: "particle", form: "mo", side: "before" }, condition: featureCondition("negative"), slot: 3 },
    ],
    harmonyCondition: null,
    phonology: { consonants: ["t", "k", "m", "n", "s", "l"], vowels: ["a", "e", "i", "o", "u"], codas: [], codaProbability: 0, harmony: null },
    lexicon: {
      nouns: [noun("woman", "selu", "p"), noun("dog", "napo", "b"), noun("hunter", "kirime", "p")],
      verbs: [verb("see", "lumi", true), verb("sleep", "nase", false)],
    },
    info: { alignment: "ergative", headline: "ergative", supporting: [], dimensions: { definiteness: false, tense: false } },
  };
}

const englishOf = (grammar: Grammar): EnglishLexicon => ({
  noun: id => grammar.lexicon.nouns.find(entry => entry.id === id)!.english,
  verb: id => grammar.lexicon.verbs.find(entry => entry.id === id)!.english,
});
const options = { marksDefiniteness: false, marksTense: false };
const np = (noun: string, plural = false) => ({ noun, plural, definite: true });

describe("solvability checker", () => {
  const grammar = ergativeGrammar();
  const pool = enumerateMeanings(grammar.lexicon, grammar.info.dimensions);
  const transitiveOnly: Meaning[] = [
    { verb: "see", subject: np("woman"), object: np("dog"), negative: false, past: false },
    { verb: "see", subject: np("dog", true), object: np("hunter"), negative: true, past: false },
    { verb: "see", subject: np("hunter"), object: np("woman", true), negative: false, past: false },
  ];
  const intransitiveTest: TestItem = { direction: "toLang", meaning: { verb: "sleep", subject: np("hunter"), negative: false, past: false } };

  it("realises the ergative grammar as expected", () => {
    expect(sentenceText(realise(grammar, transitiveOnly[1]))).toBe("napotika kirime mo lumi");
  });

  it("flags a corpus with no intransitive sentences as ambiguous", () => {
    // With only transitive data, "-ka marks the subject" (nominative) fits as well as "-ka marks the agent".
    const result = checkSolvability({ grammar, corpus: transitiveOnly, tests: [intransitiveTest], meaningPool: pool, english: englishOf(grammar), englishOptions: options });
    expect(result.harmful.length).toBeGreaterThan(0);
    expect(result.harmful.map(verdict => verdict.competitor.description).join("\n")).toMatch(/-ka appears when: agent\/lone subject/);
  });

  it("accepts the corpus once an intransitive sentence with a bare animate subject is added", () => {
    const corpus = [...transitiveOnly,
      { verb: "sleep", subject: np("woman"), negative: false, past: false },
      { verb: "sleep", subject: np("dog", true), negative: true, past: false }];
    const result = checkSolvability({ grammar, corpus, tests: [intransitiveTest], meaningPool: pool, english: englishOf(grammar), englishOptions: options });
    expect(result.harmful).toEqual([]);
  });

  it("catches an unevidenced affix order", () => {
    // Plural and ergative never co-occur in this corpus, so stem-PL-ERG vs stem-ERG-PL is undecided.
    const corpus: Meaning[] = [
      { verb: "see", subject: np("woman"), object: np("dog", true), negative: false, past: false },
      { verb: "sleep", subject: np("hunter", true), negative: false, past: false },
      { verb: "sleep", subject: np("woman"), negative: true, past: false },
      { verb: "see", subject: np("dog"), object: np("hunter"), negative: true, past: false },
    ];
    const test: TestItem = { direction: "toLang", meaning: { verb: "see", subject: np("hunter", true), object: np("woman"), negative: false, past: false } };
    const result = checkSolvability({ grammar, corpus, tests: [test], meaningPool: pool, english: englishOf(grammar), englishOptions: options });
    expect(result.harmful.some(verdict => verdict.competitor.family === "slotOrder")).toBe(true);
  });

  it("checks into-English items by reading them under each competitor", () => {
    const test: TestItem = { direction: "toEnglish", meaning: intransitiveTest.meaning };
    const result = checkSolvability({ grammar, corpus: transitiveOnly, tests: [test], meaningPool: pool, english: englishOf(grammar), englishOptions: options });
    // No intransitive data: "kirime nase" could be "the hunters sleep" if -ti only marks plurals in
    // two-participant clauses. The checker reads the test under that competitor and flags the clash.
    const descriptions = result.harmful.map(verdict => verdict.competitor.description);
    expect(descriptions).toContain("-ti appears when: plural & two-participant clause");
  });
});

describe("English realisation", () => {
  const lexicon: EnglishLexicon = {
    noun: id => ({ wolf: { singular: "wolf", plural: "wolves" }, envoy: { singular: "envoy", plural: pluralOf("envoy") }, witch: { singular: "witch", plural: pluralOf("witch") }, ox: { singular: "ox", plural: "oxen" } })[id]!,
    verb: id => ({ bless: makeVerbEnglish("bless"), see: makeVerbEnglish("see", "saw"), carry: makeVerbEnglish("carry"), run: makeVerbEnglish("run", "ran"), stir: makeVerbEnglish("stir", "stirred") })[id]!,
  };
  const tensed = { marksDefiniteness: true, marksTense: true };

  it("inflects nouns and verbs", () => {
    expect(pluralOf("witch")).toBe("witches");
    expect(pluralOf("fairy")).toBe("fairies");
    expect(pluralOf("envoy")).toBe("envoys");
    expect(makeVerbEnglish("carry")).toEqual({ base: "carry", thirdSingular: "carries", past: "carried", progressive: "carrying" });
    expect(makeVerbEnglish("run", "ran").progressive).toBe("running");
    expect(makeVerbEnglish("stir", "stirred").progressive).toBe("stirring");
    expect(makeVerbEnglish("bless").thirdSingular).toBe("blesses");
  });

  it("builds negative, past and plural sentences", () => {
    expect(englishSentence({ verb: "bless", subject: np("envoy"), object: np("witch", true), negative: true, past: true }, lexicon, tensed))
      .toBe("The envoy did not bless the witches.");
    expect(englishSentence({ verb: "see", subject: np("wolf", true), object: np("ox"), negative: true, past: false }, lexicon, tensed))
      .toBe("The wolves do not see the ox.");
    expect(englishSentence({ verb: "carry", subject: np("ox"), object: { noun: "envoy", plural: false, definite: false }, negative: false, past: false }, lexicon, tensed))
      .toBe("The ox carries an envoy.");
    expect(englishSentence({ verb: "run", subject: { noun: "wolf", plural: true, definite: false }, negative: false, past: true }, lexicon, tensed))
      .toBe("Wolves ran.");
  });

  it("accepts both articles and tenses only when the language does not mark them", () => {
    const meaning: Meaning = { verb: "see", subject: np("ox"), negative: false, past: false };
    expect(englishAnswers(meaning, lexicon, tensed)).toEqual(["the ox sees", "the ox is seeing", "the ox will see"]);
    expect(englishAnswers(meaning, lexicon, { marksDefiniteness: false, marksTense: false }))
      .toEqual(expect.arrayContaining(["the ox sees", "the ox saw", "an ox sees", "an ox saw"]));
  });
});

describe("themes and word forms", () => {
  it("every theme parses and has transitive and intransitive verbs", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(15);
    for (const theme of THEMES) {
      expect(theme.verbs.some(verb => verb.transitive), theme.id).toBe(true);
      expect(theme.verbs.some(verb => !verb.transitive), theme.id).toBe(true);
      for (const verb of theme.verbs) for (const id of verb.patientIds) expect(theme.nouns.map(noun => noun.id), `${theme.id}/${verb.id}`).toContain(id);
    }
  });

  it("rejects English words and echoes of the gloss", () => {
    expect(looksEnglish("grif", "griffin")).toBe(true);
    expect(looksEnglish("dog")).toBe(true);
    expect(looksEnglish("tumalo", "griffin")).toBe(false);
  });
});

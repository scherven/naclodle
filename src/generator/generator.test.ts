import { describe, expect, it } from "vitest";
import { validatePuzzle } from "../puzzle";
import { checkShufflePairing, checkSolvability, type TestItem } from "./checker";
import { englishAnswers, englishSentence, makeVerbEnglish, pluralOf, type EnglishLexicon } from "./english";
import { featureCondition, roleCondition, type Grammar } from "./grammar";
import { generatePuzzle, themeForDate } from "./index";
import { looksEnglish, type Lexicon } from "./lexicon";
import type { Meaning } from "./meaning";
import { planForDate, addDays } from "./plan";
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

  it("match the day plan's difficulty and vary verbs", () => {
    for (const { puzzle, report } of generated) {
      expect(puzzle.difficulty, puzzle.date).toBe(report.plan.difficulty);
      const counts = Object.values(report.verbUsage);
      expect(Math.max(...counts), puzzle.date).toBeLessThanOrEqual(Math.ceil(puzzle.corpus.length / 2));
      expect(counts.length, puzzle.date).toBeGreaterThanOrEqual(3);
    }
  });

  it("leave no competitor that fits the corpus but changes an answer", () => {
    for (const { report } of generated) expect(report.competitorsKilled).toBeGreaterThan(20);
  });

  it("cover several headline phenomena", () => {
    expect(new Set(generated.map(({ report }) => report.headline)).size).toBeGreaterThanOrEqual(5);
  });

  it("vary the sentence frame: negation is optional, and place / “with” phrases appear", () => {
    const english = generated.map(({ puzzle }) => puzzle.corpus.map(line => line.en).join(" "));
    const withNegation = english.filter(text => / not /.test(text)).length;
    expect(withNegation).toBeGreaterThan(5);
    expect(withNegation).toBeLessThan(generated.length - 10);
    expect(english.filter(text => / (in|on|at|by|with) the /.test(text)).length).toBeGreaterThan(5);
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
    adjectives: null,
    possessorPosition: null,
    adverbPosition: null,
    obliquePosition: null,
    phonology: { style: "plain", consonants: ["t", "k", "m", "n", "s", "l"], vowels: ["a", "e", "i", "o", "u"], codas: [], codaProbability: 0, harmony: null },
    lexicon: {
      nouns: [noun("woman", "selu", "p"), noun("dog", "napo", "b"), noun("hunter", "kirime", "p")],
      verbs: [verb("see", "lumi", true), verb("sleep", "nase", false)],
      adjectives: [{ id: "old", describes: ["p", "b"], form: "tiro" }],
      adverbs: [],
    },
    info: {
      alignment: "ergative", headline: "ergative", supporting: [], difficulty: 3, narrativePast: false,
      dimensions: { definiteness: false, tense: false, adjectives: false, possession: false, adverbs: false, negation: true, obliques: [] },
    },
  };
}

const englishOf = (grammar: Grammar): EnglishLexicon => ({
  noun: id => grammar.lexicon.nouns.find(entry => entry.id === id)!.english,
  preposition: () => "with",
  verb: id => grammar.lexicon.verbs.find(entry => entry.id === id)!.english,
  adjective: id => id,
  adverb: id => ({ english: id, time: false }),
});
const options = { marksDefiniteness: false, marksTense: false };
const np = (noun: string, plural = false) => ({ noun, plural, definite: true });

describe("solvability checker", () => {
  const grammar = ergativeGrammar();
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
    const result = checkSolvability({ grammar, corpus: transitiveOnly, tests: [intransitiveTest], english: englishOf(grammar), englishOptions: options });
    expect(result.harmful.length).toBeGreaterThan(0);
    expect(result.harmful.map(verdict => verdict.competitor.description).join("\n")).toMatch(/-ka appears when: agent\/lone subject/);
  });

  it("accepts the corpus once an intransitive sentence with a bare animate subject is added", () => {
    const corpus = [...transitiveOnly,
      { verb: "sleep", subject: np("woman"), negative: false, past: false },
      { verb: "sleep", subject: np("dog", true), negative: true, past: false }];
    const result = checkSolvability({ grammar, corpus, tests: [intransitiveTest], english: englishOf(grammar), englishOptions: options });
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
    const result = checkSolvability({ grammar, corpus, tests: [test], english: englishOf(grammar), englishOptions: options });
    expect(result.harmful.some(verdict => verdict.competitor.family === "slotOrder")).toBe(true);
  });

  it("checks into-English items by reading them under each competitor", () => {
    const test: TestItem = { direction: "toEnglish", meaning: intransitiveTest.meaning };
    const result = checkSolvability({ grammar, corpus: transitiveOnly, tests: [test], english: englishOf(grammar), englishOptions: options });
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
    preposition: () => "in",
    adjective: id => id,
    adverb: id => ({ yesterday: { english: "yesterday", time: true }, quietly: { english: "quietly", time: false } })[id]!,
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

  it("builds adjectives, possessors and adverbs", () => {
    expect(englishSentence({ verb: "bless", subject: { noun: "envoy", plural: false, definite: false, adjective: "ancient" }, object: { noun: "ox", plural: true, definite: true, possessor: { noun: "witch", plural: false } }, negative: true, past: true, adverb: "yesterday" }, lexicon, tensed))
      .toBe("An ancient envoy did not bless the witch's oxen yesterday.");
    expect(englishSentence({ verb: "see", subject: { noun: "ox", plural: false, definite: true, possessor: { noun: "witch", plural: true } }, negative: false, past: false, adverb: "quietly" }, lexicon, tensed))
      .toBe("The witches' ox sees quietly.");
    const answers = englishAnswers({ verb: "run", subject: np("wolf", true), negative: false, past: true, adverb: "yesterday" }, lexicon, tensed);
    expect(answers).toEqual(["the wolves ran yesterday", "yesterday the wolves ran"]);
  });

  it("accepts both articles and tenses only when the language does not mark them", () => {
    const meaning: Meaning = { verb: "see", subject: np("ox"), negative: false, past: false };
    expect(englishAnswers(meaning, lexicon, tensed)).toEqual(["the ox sees", "the ox is seeing", "the ox will see"]);
    expect(englishAnswers(meaning, lexicon, { marksDefiniteness: false, marksTense: false }))
      .toEqual(expect.arrayContaining(["the ox sees", "the ox saw", "an ox sees", "an ox saw"]));
  });
});

describe("noun phrase structures", () => {
  const meaning: Meaning = { verb: "sleep", subject: { noun: "dog", plural: true, definite: true, adjective: "old" }, negative: false, past: false };
  it("puts endings on the noun, copies them, or puts them on the last word", () => {
    const grammar = ergativeGrammar();
    grammar.adjectives = { position: "after", marking: "head", concord: [] };
    expect(sentenceText(realise(grammar, meaning))).toBe("napoti tiro nase");
    grammar.adjectives = { position: "after", marking: "concord", concord: ["PL"] };
    expect(sentenceText(realise(grammar, meaning))).toBe("napoti tiroti nase");
    grammar.adjectives = { position: "after", marking: "edge", concord: [] };
    expect(sentenceText(realise(grammar, meaning))).toBe("napo tiroti nase");
  });
  it("marks the possessor or the possessed noun", () => {
    const grammar = ergativeGrammar();
    grammar.possessorPosition = "before";
    const owned: Meaning = { verb: "sleep", subject: { noun: "dog", plural: false, definite: true, possessor: { noun: "woman", plural: false } }, negative: false, past: false };
    grammar.morphemes.push({ id: "GEN", gloss: "GEN", host: "noun", exponent: { kind: "suffix", form: "su" }, condition: featureCondition("possessor"), slot: 4 });
    expect(sentenceText(realise(grammar, owned))).toBe("selusu napo nase");
    grammar.morphemes[grammar.morphemes.length - 1] = { id: "POSS", gloss: "POSS", host: "noun", exponent: { kind: "suffix", form: "su" }, condition: featureCondition("possessed"), slot: 2 };
    expect(sentenceText(realise(grammar, owned))).toBe("selu naposu nase");
  });
});

describe("shuffle pairing check", () => {
  it("finds the rival pairing when two nouns are interchangeable, and anchors it away", () => {
    // "selu" and "napo" each occur once in the same frame, so either could be "woman".
    const grammar = ergativeGrammar();
    const corpus: Meaning[] = [
      { verb: "sleep", subject: np("woman"), negative: false, past: false },
      { verb: "sleep", subject: np("dog"), negative: false, past: false },
      { verb: "sleep", subject: np("hunter"), negative: true, past: false },
    ];
    const result = checkShufflePairing(grammar, corpus, new Rng("anchors"));
    expect(result.rivalCount).toBeGreaterThan(0);
    expect(result.unique).toBe(true);
    expect(result.anchors.some(anchor => anchor === 0 || anchor === 1)).toBe(true);
  });
});

describe("day plan", () => {
  const dates = Array.from({ length: 60 }, (_, offset) => addDays("2026-12-01", offset));
  const plans = dates.map(planForDate);
  it("varies headline and word order across days", () => {
    plans.forEach((plan, index) => {
      if (index >= 1) expect(plan.headline).not.toBe(plans[index - 1].headline);
      if (index >= 2) expect(plan.headline).not.toBe(plans[index - 2].headline);
      if (index >= 2) expect(plan.wordOrder === plans[index - 1].wordOrder && plan.wordOrder === plans[index - 2].wordOrder).toBe(false);
      for (const back of [1, 2, 3]) if (index >= back) expect(plan.theme).not.toBe(plans[index - back].theme);
    });
  });
  it("follows the weekday difficulty ramp, with shuffled Saturdays", () => {
    expect(planForDate("2026-12-05")).toMatchObject({ difficulty: 5, shuffle: true });
    expect(planForDate("2026-12-07").difficulty).toBe(1);
    expect(new Set(plans.slice(0, 7).map(plan => plan.difficulty))).toEqual(new Set([1, 2, 3, 4, 5]));
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

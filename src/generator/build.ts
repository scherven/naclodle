/** Turns a grammar + selected data into the Puzzle JSON: glosses, answers, explanations, hint, keys. */

import type { CorpusLine, Item, Puzzle } from "../puzzle";
import type { CheckResult, TestItem } from "./checker";
import { englishAnswers, englishSentence, type EnglishLexicon, type EnglishOptions } from "./english";
import type { Grammar, Headline, Morpheme } from "./grammar";
import { affixVariants } from "./lexicon";
import type { Meaning } from "./meaning";
import { displaySentence, realise, sentenceText, type RealisedWord } from "./realise";
import { isHarmonising } from "./select";

const HINTS: Record<Headline, string> = {
  ergative: "Compare the noun doing the action when the verb has one participant and when it has two.",
  differentialObject: "Not every object gets the same ending. What do the marked ones have in common?",
  reduplication: "How does a noun change when there is more than one? Look at the start of the word.",
  circumfix: "Negation touches the verb in two places.",
  harmony: "Some endings come in two shapes. Look at the vowels of the word they attach to.",
  definiteness: "Watch for “the” versus “a” in the English.",
  wordOrder: "Find the verb first, then work out which noun is doing the action.",
};

const ORDER_NAMES: Record<string, string> = { S: "subject", O: "object", V: "verb" };

export function englishLexiconOf(grammar: Grammar): EnglishLexicon {
  return {
    noun: id => grammar.lexicon.nouns.find(entry => entry.id === id)!.english,
    verb: id => grammar.lexicon.verbs.find(entry => entry.id === id)!.english,
  };
}

export function englishOptionsOf(grammar: Grammar): EnglishOptions {
  return { marksDefiniteness: grammar.info.dimensions.definiteness, marksTense: grammar.info.dimensions.tense };
}

function morphemeForms(grammar: Grammar, morpheme: Morpheme): string {
  const exponent = morpheme.exponent;
  const variants = (affix: string) => affixVariants(grammar.phonology, affix);
  switch (exponent.kind) {
    case "suffix": return variants(exponent.form).map(form => `-${form}`).join(" / ");
    case "prefix": return `${exponent.form}-`;
    case "circumfix": return `${exponent.prefix}- … ${variants(exponent.suffix).map(form => `-${form}`).join(" / ")}`;
    case "particle": return exponent.form;
    case "reduplication": return exponent.copy === "full" ? "X-X" : "CV~";
    case "consonantCopyPrefix": return `C${exponent.vowel}~`;
  }
}

function describeMorpheme(grammar: Grammar, morpheme: Morpheme): string {
  const exponent = morpheme.exponent;
  const exampleNoun = grammar.lexicon.nouns[0];
  switch (morpheme.id) {
    case "PL": {
      if (exponent.kind !== "reduplication") return "Plural.";
      const plural = realise(grammar, { verb: grammar.lexicon.verbs.find(verb => verb.agents.includes(exampleNoun.semanticClass))?.id ?? grammar.lexicon.verbs[0].id, subject: { noun: exampleNoun.id, plural: true, definite: true }, negative: false, past: false })
        .find(word => word.lexeme === exampleNoun.id)?.form;
      return exponent.copy === "full"
        ? `Plural: say the noun twice (${exampleNoun.form} → ${plural ?? exampleNoun.form + "-" + exampleNoun.form}).`
        : `Plural: copy the noun's first consonant and vowel in front (${exampleNoun.form} → ${plural}).`;
    }
    case "ERG": return "Ergative: marks the doer of a two-participant verb. The lone participant of a one-participant verb is bare, just like the object.";
    case "ACC": {
      if (morpheme.condition.type === "and") {
        const human = JSON.stringify(morpheme.condition).includes("human");
        return `Marks the object, but only when it is ${human ? "a person" : "alive (a person, animal or spirit)"}. Other objects are bare.`;
      }
      return "Accusative: marks the object.";
    }
    case "DEF": return "Definite (“the”). A noun without it means “a” (or plain plural).";
    case "PST": return "Past tense. Without it the verb is present or future.";
    case "AGR": return morpheme.gloss === "PL.ABS"
      ? "On the verb when the lone participant, or the object, is plural. A plural doer does not trigger it."
      : "On the verb when the subject is plural.";
    case "NEG":
      if (exponent.kind === "particle") return `Negation: a separate word ${exponent.side} the verb.`;
      if (exponent.kind === "circumfix") return "Negation: both parts wrap around the verb.";
      return "Negation, on the verb.";
    default: return "";
  }
}

function orderLine(grammar: Grammar): [string, string] {
  const order = grammar.wordOrder.split("");
  const intransitive = grammar.intransitiveSubjectFirst ? "subject, verb" : "verb, subject";
  return [order.join(" "), `Word order: ${order.map(letter => ORDER_NAMES[letter]).join(", ")}. With one participant: ${intransitive}.`];
}

function itemExplanation(grammar: Grammar, meaning: Meaning, words: RealisedWord[]): string {
  const parts = words.map(word => `${word.segmented} = ${word.gloss}`);
  const clauseOrder = meaning.object ? grammar.wordOrder : grammar.intransitiveSubjectFirst ? "SV" : "VS";
  let note = `${clauseOrder.split("").join(" ")} order. ${parts.join("; ")}.`;
  if (grammar.info.alignment === "ergative" && !meaning.object) note += " One participant, so no ergative ending.";
  if (grammar.info.headline === "differentialObject" && meaning.object && !words.some(word => word.applied.some(applied => applied.morpheme.id === "ACC")))
    note += " This object is not marked.";
  return note;
}

function difficultyOf(grammar: Grammar): Puzzle["difficulty"] {
  const base: Record<Headline, number> = {
    ergative: 3, differentialObject: 3, harmony: 2.5, reduplication: 2, circumfix: 2, definiteness: 2, wordOrder: 2,
  };
  let score = base[grammar.info.headline] + 0.5 * grammar.info.supporting.length;
  if (!["SOV", "SVO"].includes(grammar.wordOrder)) score += 0.5;
  if (grammar.morphemes.some(morpheme => morpheme.gloss === "PL.ABS")) score += 0.5;
  return Math.max(1, Math.min(5, Math.round(score))) as Puzzle["difficulty"];
}

export const PUZZLE_EPOCH = "2026-11-22";
export function puzzleNumber(date: string): number {
  return Math.round((Date.parse(date) - Date.parse(PUZZLE_EPOCH)) / 86_400_000);
}

export interface BuildInput {
  date: string;
  languageName: string;
  grammar: Grammar;
  corpus: Meaning[];
  tests: TestItem[];
  check: CheckResult;
  blocked: string[];
}

export function buildPuzzle({ date, languageName, grammar, corpus, tests, check, blocked }: BuildInput): Puzzle {
  const english = englishLexiconOf(grammar);
  const englishOptions = englishOptionsOf(grammar);

  const corpusLines: CorpusLine[] = corpus.map(meaning => {
    const words = realise(grammar, meaning);
    return { lang: displaySentence(words), en: englishSentence(meaning, english, englishOptions), gloss: words.map(word => word.gloss) };
  });
  const item = (test: TestItem): Item => {
    const words = realise(grammar, test.meaning);
    const explanation = itemExplanation(grammar, test.meaning, words);
    return test.direction === "toEnglish"
      ? { prompt: displaySentence(words), accepted: englishAnswers(test.meaning, english, englishOptions), explanation }
      : { prompt: englishSentence(test.meaning, english, englishOptions), accepted: [sentenceText(words)], explanation };
  };

  const allText = [...corpusLines.map(line => line.lang), ...tests.map(test => sentenceText(realise(grammar, test.meaning)))].join(" ");
  const keys = [...new Set([...allText.toLowerCase()].filter(letter => /\p{L}/u.test(letter) && !/[a-z]/.test(letter)))];

  // Word list: every lexeme the player meets.
  const usedLexemes = new Set([...corpus, ...tests.map(test => test.meaning)].flatMap(meaning => [meaning.verb, meaning.subject.noun, ...(meaning.object ? [meaning.object.noun] : [])]));
  const verbsTakeAffixes = grammar.morphemes.some(morpheme => morpheme.host === "verb" && morpheme.exponent.kind !== "particle");
  const words: [string, string][] = [
    ...grammar.lexicon.nouns.filter(noun => usedLexemes.has(noun.id)).map(noun => [noun.form, noun.english.singular] as [string, string]),
    ...grammar.lexicon.verbs.filter(verb => usedLexemes.has(verb.id)).map(verb => [verbsTakeAffixes ? `${verb.form}-` : verb.form, verb.english.base] as [string, string]),
  ];

  const grammarLines: [string, string][] = [orderLine(grammar)];
  for (const morpheme of [...grammar.morphemes].sort((first, second) => (first.host === second.host ? first.slot - second.slot : first.host === "noun" ? -1 : 1)))
    grammarLines.push([morphemeForms(grammar, morpheme), describeMorpheme(grammar, morpheme)]);
  const nounSuffixes = grammar.morphemes.filter(morpheme => morpheme.host === "noun" && morpheme.exponent.kind === "suffix");
  if (nounSuffixes.length >= 2)
    grammarLines.push(["Suffix order", `On nouns: stem-${[...nounSuffixes].sort((first, second) => first.slot - second.slot).map(morpheme => morpheme.gloss).join("-")}.`]);

  const notes: string[] = [];
  if (grammar.harmonyCondition && grammar.phonology.harmony && grammar.morphemes.some(isHarmonising)) {
    const backs = grammar.phonology.harmony.pairs.map(pair => pair[0]).join(", ");
    const fronts = grammar.phonology.harmony.pairs.map(pair => pair[1]).join(", ");
    notes.push(`Vowel harmony: a word's vowels are either all back (${backs}) or all front (${fronts}), and suffix vowels follow the stem.`);
  }
  const killed = check.verdicts.filter(verdict => verdict.killedBy >= 0).length;
  const ruledOut = blocked.length ? blocked : check.verdicts.filter(verdict => verdict.killedBy >= 0 && verdict.competitor.family === "condition").slice(0, 2).map(verdict => verdict.competitor.description);
  notes.push(`Checked against ${check.verdicts.length} alternative analyses; the sentences rule out ${killed}, including: ${ruledOut.slice(0, 3).join("; ")}.`);

  return {
    id: `gen-${date}`,
    number: puzzleNumber(date),
    date,
    difficulty: difficultyOf(grammar),
    language: { name: languageName, real: false },
    checks: 3,
    keys,
    hint: HINTS[grammar.info.headline],
    corpus: corpusLines,
    toEnglish: tests.filter(test => test.direction === "toEnglish").map(item),
    toLang: tests.filter(test => test.direction === "toLang").map(item),
    explain: { words, grammar: grammarLines, notes: notes.join(" ") },
  };
}

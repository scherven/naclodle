/** English morphology and sentence realisation for the closed puzzle vocabulary. */

import type { Meaning, NounPhrase } from "./meaning";

export interface NounEnglish { singular: string; plural: string }
export interface VerbEnglish { base: string; thirdSingular: string; past: string; progressive: string }

const SIBILANT_ENDING = /(s|x|z|ch|sh)$/;
const CONSONANT_Y_ENDING = /[^aeiou]y$/;

export function pluralOf(singular: string): string {
  if (SIBILANT_ENDING.test(singular)) return singular + "es";
  if (CONSONANT_Y_ENDING.test(singular)) return singular.slice(0, -1) + "ies";
  return singular + "s";
}

export function thirdSingularOf(base: string): string {
  if (SIBILANT_ENDING.test(base) || /o$/.test(base)) return base + "es";
  if (CONSONANT_Y_ENDING.test(base)) return base.slice(0, -1) + "ies";
  return base + "s";
}

export function regularPastOf(base: string): string {
  if (/e$/.test(base)) return base + "d";
  if (CONSONANT_Y_ENDING.test(base)) return base.slice(0, -1) + "ied";
  return base + "ed";
}

/** -ing form. Consonant doubling follows the past tense (stab/stabbed) or a short CVC base (run). */
export function progressiveOf(base: string, past: string): string {
  const lastLetter = base[base.length - 1];
  if (past === base + lastLetter + "ed") return base + lastLetter + "ing";
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(base)) return base + lastLetter + "ing";
  if (/ie$/.test(base)) return base.slice(0, -2) + "ying";
  if (/[^e]e$/.test(base)) return base.slice(0, -1) + "ing";
  return base + "ing";
}

export function makeVerbEnglish(base: string, irregularPast?: string): VerbEnglish {
  const past = irregularPast ?? regularPastOf(base);
  return { base, thirdSingular: thirdSingularOf(base), past, progressive: progressiveOf(base, past) };
}

export function indefiniteArticle(word: string): string {
  return /^[aeio]/.test(word) || /^u(?!ni)/.test(word) ? "an" : "a";
}

export interface EnglishLexicon {
  noun(nounId: string): NounEnglish;
  verb(verbId: string): VerbEnglish;
  adjective(adjectiveId: string): string;
  adverb(adverbId: string): { english: string; time: boolean };
}

/** Which distinctions the conlang makes. Anything it doesn't mark is accepted either way in English. */
export interface EnglishOptions { marksDefiniteness: boolean; marksTense: boolean }

type EnglishTense = "present" | "past" | "progressive" | "future";

/** "the king's", "the kings'", "the children's". */
function possessiveOf(word: string): string {
  return word.endsWith("s") ? `${word}'` : `${word}'s`;
}

function nounPhraseVariants(phrase: NounPhrase, lexicon: EnglishLexicon, options: EnglishOptions): string[] {
  const noun = lexicon.noun(phrase.noun);
  const head = (phrase.adjective ? lexicon.adjective(phrase.adjective) + " " : "") + (phrase.plural ? noun.plural : noun.singular);
  if (phrase.possessor) {
    const owner = lexicon.noun(phrase.possessor.noun);
    const ownerWord = possessiveOf(phrase.possessor.plural ? owner.plural : owner.singular);
    // Possessors are definite; if the language doesn't mark definiteness, "a king's horse" is fine too.
    const ownerVariants = options.marksDefiniteness ? [`the ${ownerWord}`]
      : [`the ${ownerWord}`, phrase.possessor.plural ? ownerWord : `${indefiniteArticle(ownerWord)} ${ownerWord}`];
    return ownerVariants.map(owner => `${owner} ${head}`);
  }
  const indefinite = phrase.plural ? head : `${indefiniteArticle(head)} ${head}`;
  if (!options.marksDefiniteness) return [`the ${head}`, indefinite];
  return [phrase.definite ? `the ${head}` : indefinite];
}

function verbPhrase(meaning: Meaning, lexicon: EnglishLexicon, tense: EnglishTense): string {
  const verb = lexicon.verb(meaning.verb);
  const pluralSubject = meaning.subject.plural;
  const not = meaning.negative ? " not" : "";
  switch (tense) {
    case "past": return meaning.negative ? `did not ${verb.base}` : verb.past;
    case "present":
      if (meaning.negative) return `${pluralSubject ? "do" : "does"} not ${verb.base}`;
      return pluralSubject ? verb.base : verb.thirdSingular;
    case "progressive": return `${pluralSubject ? "are" : "is"}${not} ${verb.progressive}`;
    case "future": return `will${not} ${verb.base}`;
  }
}

/** The first tense is the one displayed; the rest are accepted answers. */
function acceptedTenses(meaning: Meaning, options: EnglishOptions): EnglishTense[] {
  if (!options.marksTense) return ["present", "past", "progressive"];
  return meaning.past ? ["past"] : ["present", "progressive", "future"];
}

const capitalise = (text: string) => text[0].toUpperCase() + text.slice(1);

/** Clause variants: adverbs go at the end (displayed), or at the start for time words. */
function clauses(meaning: Meaning, subject: string, verb: string, object: string, lexicon: EnglishLexicon): string[] {
  const core = `${subject} ${verb}${object ? " " + object : ""}`;
  if (!meaning.adverb) return [core];
  const adverb = lexicon.adverb(meaning.adverb);
  const variants = [`${core} ${adverb.english}`];
  if (adverb.time) variants.push(`${adverb.english} ${core}`);
  return variants;
}

/** The sentence shown to the player. */
export function englishSentence(meaning: Meaning, lexicon: EnglishLexicon, options: EnglishOptions): string {
  const subject = nounPhraseVariants(meaning.subject, lexicon, options)[0];
  const object = meaning.object ? nounPhraseVariants(meaning.object, lexicon, options)[0] : "";
  const verb = verbPhrase(meaning, lexicon, acceptedTenses(meaning, options)[0]);
  return capitalise(clauses(meaning, subject, verb, object, lexicon)[0]) + ".";
}

/** Every accepted English answer, lowercased without final punctuation (the app normalises further). */
export function englishAnswers(meaning: Meaning, lexicon: EnglishLexicon, options: EnglishOptions): string[] {
  const answers: string[] = [];
  const objects = meaning.object ? nounPhraseVariants(meaning.object, lexicon, options) : [""];
  for (const subject of nounPhraseVariants(meaning.subject, lexicon, options))
    for (const tense of acceptedTenses(meaning, options))
      for (const object of objects)
        answers.push(...clauses(meaning, subject, verbPhrase(meaning, lexicon, tense), object, lexicon));
  return [...new Set(answers)];
}

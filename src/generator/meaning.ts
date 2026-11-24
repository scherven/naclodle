/** Meaning representations: what a sentence says, independent of either language. */

import type { Lexicon } from "./lexicon";
import { allowsAgent, allowsPatient } from "./themes";

export interface NounPhrase { noun: string; plural: boolean; definite: boolean }

/** `subject` is the transitive agent (A) or the lone intransitive argument (S); `object` is the patient (P). */
export interface Meaning { verb: string; subject: NounPhrase; object?: NounPhrase; negative: boolean; past: boolean }

/** Which meaning dimensions the language distinguishes (others are fixed: definite, non-past). */
export interface MeaningDimensions { definiteness: boolean; tense: boolean }

const nounPhraseKey = (phrase: NounPhrase) =>
  `${phrase.noun}${phrase.plural ? "+pl" : ""}${phrase.definite ? "" : "+indef"}`;

export const meaningKey = (meaning: Meaning) =>
  [meaning.verb, nounPhraseKey(meaning.subject), meaning.object ? nounPhraseKey(meaning.object) : "-",
    meaning.negative ? "neg" : "pos", meaning.past ? "past" : "nonpast"].join("|");

const nounPhraseDistance = (first: NounPhrase, second: NounPhrase) =>
  Number(first.noun !== second.noun) + Number(first.plural !== second.plural) + Number(first.definite !== second.definite);

/** Number of edits between two meanings: each differing lexeme or feature counts one. */
export function meaningDistance(first: Meaning, second: Meaning): number {
  let distance = Number(first.verb !== second.verb) + nounPhraseDistance(first.subject, second.subject);
  if (!!first.object !== !!second.object) distance += 3;
  else if (first.object && second.object) distance += nounPhraseDistance(first.object, second.object);
  distance += Number(first.negative !== second.negative) + Number(first.past !== second.past);
  return distance;
}

/** Every meaning the lexicon allows under its selectional restrictions. */
export function enumerateMeanings(lexicon: Lexicon, dimensions: MeaningDimensions): Meaning[] {
  const meanings: Meaning[] = [];
  const booleans = [false, true];
  const definiteValues = dimensions.definiteness ? booleans : [true];
  const pastValues = dimensions.tense ? booleans : [false];
  const phrasesFor = (noun: string): NounPhrase[] =>
    booleans.flatMap(plural => definiteValues.map(definite => ({ noun, plural, definite })));
  for (const verb of lexicon.verbs) {
    for (const agent of lexicon.nouns.filter(noun => allowsAgent(verb, noun))) {
      const patients = verb.transitive
        ? lexicon.nouns.filter(noun => noun.id !== agent.id && allowsPatient(verb, noun))
        : [null];
      for (const patient of patients)
        for (const subject of phrasesFor(agent.id))
          for (const object of patient ? phrasesFor(patient.id) : [undefined])
            for (const negative of booleans)
              for (const past of pastValues) meanings.push({ verb: verb.id, subject, object, negative, past });
    }
  }
  return meanings;
}

export const lexemesOf = (meaning: Meaning) =>
  [meaning.verb, meaning.subject.noun, ...(meaning.object ? [meaning.object.noun] : [])];

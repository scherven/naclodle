/** Meaning representations: what a sentence says, independent of either language. */

import type { Rng } from "./rng";
import type { Lexicon } from "./lexicon";
import { allowsAdjective, allowsAgent, allowsPatient, canPossess } from "./themes";

/** "the king's": possessors are always definite. */
export interface Possessor { noun: string; plural: boolean }

export interface NounPhrase {
  noun: string;
  plural: boolean;
  /** Always true when there is a possessor ("the king's horse"). */
  definite: boolean;
  adjective?: string;
  possessor?: Possessor;
}

/** `subject` is the transitive agent (A) or the lone intransitive argument (S); `object` is the patient (P). */
export interface Meaning {
  verb: string;
  subject: NounPhrase;
  object?: NounPhrase;
  negative: boolean;
  past: boolean;
  adverb?: string;
}

/** Which meaning dimensions and structures the language uses. */
export interface MeaningDimensions {
  definiteness: boolean;
  tense: boolean;
  adjectives: boolean;
  possession: boolean;
  adverbs: boolean;
}

const nounPhraseKey = (phrase: NounPhrase) =>
  `${phrase.possessor ? `${phrase.possessor.noun}${phrase.possessor.plural ? "+pl" : ""}'s ` : ""}` +
  `${phrase.adjective ? phrase.adjective + " " : ""}${phrase.noun}${phrase.plural ? "+pl" : ""}${phrase.definite ? "" : "+indef"}`;

export const meaningKey = (meaning: Meaning) =>
  [meaning.verb, nounPhraseKey(meaning.subject), meaning.object ? nounPhraseKey(meaning.object) : "-",
    meaning.negative ? "neg" : "pos", meaning.past ? "past" : "nonpast", meaning.adverb ?? "-"].join("|");

function nounPhraseDistance(first: NounPhrase, second: NounPhrase): number {
  let distance = Number(first.noun !== second.noun) + Number(first.plural !== second.plural) + Number(first.definite !== second.definite);
  distance += Number(first.adjective !== second.adjective);
  if (!!first.possessor !== !!second.possessor) distance += 2;
  else if (first.possessor && second.possessor)
    distance += Number(first.possessor.noun !== second.possessor.noun) + Number(first.possessor.plural !== second.possessor.plural);
  return distance;
}

/** Number of edits between two meanings: each differing lexeme, feature or modifier counts. */
export function meaningDistance(first: Meaning, second: Meaning): number {
  let distance = Number(first.verb !== second.verb) + nounPhraseDistance(first.subject, second.subject);
  if (!!first.object !== !!second.object) distance += 3;
  else if (first.object && second.object) distance += nounPhraseDistance(first.object, second.object);
  distance += Number(first.negative !== second.negative) + Number(first.past !== second.past);
  distance += Number(first.adverb !== second.adverb);
  return distance;
}

const phraseLexemes = (phrase: NounPhrase) =>
  [phrase.noun, ...(phrase.adjective ? [`adj:${phrase.adjective}`] : []), ...(phrase.possessor ? [phrase.possessor.noun] : [])];

/** Every lexeme in a meaning (adjectives and adverbs prefixed so they never clash with nouns). */
export const lexemesOf = (meaning: Meaning) => [
  meaning.verb, ...phraseLexemes(meaning.subject), ...(meaning.object ? phraseLexemes(meaning.object) : []),
  ...(meaning.adverb ? [`adv:${meaning.adverb}`] : []),
];

/** Meanings without adjectives, possessors or adverbs. */
export function enumerateBaseMeanings(lexicon: Lexicon, dimensions: MeaningDimensions): Meaning[] {
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

/** Variants of a base meaning with at most one noun-phrase modifier and at most one adverb. */
export function decorate(lexicon: Lexicon, dimensions: MeaningDimensions, base: Meaning): Meaning[] {
  const nounOf = (id: string) => lexicon.nouns.find(noun => noun.id === id)!;
  const usedNouns = new Set([base.subject.noun, base.object?.noun]);
  const phraseVariants = (phrase: NounPhrase): NounPhrase[] => {
    const variants: NounPhrase[] = [];
    if (dimensions.adjectives)
      for (const adjective of lexicon.adjectives)
        if (allowsAdjective(adjective, nounOf(phrase.noun))) variants.push({ ...phrase, adjective: adjective.id });
    if (dimensions.possession)
      for (const possessor of lexicon.nouns)
        if (!usedNouns.has(possessor.id) && canPossess(possessor, nounOf(phrase.noun)))
          for (const plural of [false, true]) variants.push({ ...phrase, definite: true, possessor: { noun: possessor.id, plural } });
    return variants;
  };
  const withModifier: Meaning[] = [base];
  for (const subject of phraseVariants(base.subject)) withModifier.push({ ...base, subject });
  if (base.object) for (const object of phraseVariants(base.object)) withModifier.push({ ...base, object });
  if (!dimensions.adverbs) return withModifier;
  const decorated: Meaning[] = [];
  for (const meaning of withModifier) {
    decorated.push(meaning);
    for (const adverb of lexicon.adverbs)
      if (!adverb.requiresPast || meaning.past) decorated.push({ ...meaning, adverb: adverb.id });
  }
  return decorated;
}

/**
 * Candidate sentences for the corpus: every base meaning, plus a deterministic sample of decorated ones
 * (the full decorated space can run to hundreds of thousands).
 */
export function meaningPool(lexicon: Lexicon, dimensions: MeaningDimensions, rng: Rng, decoratedLimit = 5000): Meaning[] {
  const base = enumerateBaseMeanings(lexicon, dimensions);
  if (!dimensions.adjectives && !dimensions.possession && !dimensions.adverbs) return base;
  const decorated = base.flatMap(meaning => decorate(lexicon, dimensions, meaning).slice(1));
  const sampled = decorated.length <= decoratedLimit ? decorated : rng.shuffle(decorated).slice(0, decoratedLimit);
  return [...base, ...sampled];
}

/**
 * Every meaning that uses exactly the same lexemes as `meaning`, in any arrangement (who does what to
 * whom, which noun owns which, which noun the adjective describes) and with any feature values. These
 * are the possible readings of a test sentence under a competitor grammar.
 */
export function relatedMeanings(lexicon: Lexicon, dimensions: MeaningDimensions, meaning: Meaning): Meaning[] {
  const verb = lexicon.verbs.find(entry => entry.id === meaning.verb)!;
  const nounOf = (id: string) => lexicon.nouns.find(noun => noun.id === id)!;
  const nouns = [meaning.subject.noun, meaning.object?.noun, meaning.subject.possessor?.noun, meaning.object?.possessor?.noun]
    .filter((noun): noun is string => !!noun);
  const adjective = meaning.subject.adjective ?? meaning.object?.adjective;
  const booleans = [false, true];
  const definiteValues = dimensions.definiteness ? booleans : [true];
  const pastValues = meaning.adverb && lexicon.adverbs.find(adverb => adverb.id === meaning.adverb)?.requiresPast ? [true]
    : dimensions.tense ? booleans : [false];
  const results: Meaning[] = [];

  const headCount = verb.transitive ? 2 : 1;
  const permutations = (items: string[]): string[][] =>
    items.length <= 1 ? [items] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
  for (const arrangement of permutations(nouns)) {
    const [subjectNoun, objectNoun] = verb.transitive ? arrangement : [arrangement[0], undefined];
    const possessorNoun = arrangement[headCount];
    if (!allowsAgent(verb, nounOf(subjectNoun))) continue;
    if (objectNoun && !allowsPatient(verb, nounOf(objectNoun))) continue;
    const owners = possessorNoun ? (objectNoun ? ["subject", "object"] : ["subject"]) : [null];
    for (const owner of owners) {
      const ownedNoun = owner === "object" ? objectNoun! : subjectNoun;
      if (possessorNoun && !canPossess(nounOf(possessorNoun), nounOf(ownedNoun))) continue;
      const describedOptions = adjective ? (objectNoun ? ["subject", "object"] : ["subject"]) : [null];
      for (const described of describedOptions) {
        const describedNoun = described === "object" ? objectNoun! : subjectNoun;
        const adjectiveEntry = lexicon.adjectives.find(entry => entry.id === adjective);
        if (adjectiveEntry && !allowsAdjective(adjectiveEntry, nounOf(describedNoun))) continue;
        const phrases = (noun: string, slot: "subject" | "object"): NounPhrase[] => {
          const owned = owner === slot;
          const out: NounPhrase[] = [];
          for (const plural of booleans)
            for (const definite of owned ? [true] : definiteValues)
              for (const possessorPlural of owned ? booleans : [false])
                out.push({
                  noun, plural, definite,
                  ...(described === slot ? { adjective } : {}),
                  ...(owned ? { possessor: { noun: possessorNoun!, plural: possessorPlural } } : {}),
                });
          return out;
        };
        for (const subject of phrases(subjectNoun, "subject"))
          for (const object of objectNoun ? phrases(objectNoun, "object") : [undefined])
            for (const negative of booleans)
              for (const past of pastValues)
                results.push({ verb: verb.id, subject, object, negative, past, ...(meaning.adverb ? { adverb: meaning.adverb } : {}) });
      }
    }
  }
  return results;
}

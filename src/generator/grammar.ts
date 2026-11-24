/**
 * The grammar: a small typed spec. Everything (conlang realisation, competitor grammars, explanations)
 * is derived from this one object.
 *
 * Morphology is a list of morphemes. Each has a host (noun or verb word), an exponent (how it is spelled)
 * and a condition (when it appears). Conditions are small predicates over the word's context, which is
 * what lets the solvability checker express parasitic hypotheses such as "-ka marks every animate noun".
 */

import type { Lexicon } from "./lexicon";
import type { MeaningDimensions } from "./meaning";
import type { Phonology } from "./phonology";

/** A agent, S lone subject, P object; LOC/INS/COM are the oblique phrases (place, instrument, companion). */
export type Role = "A" | "S" | "P" | "LOC" | "INS" | "COM";
export type WordOrder = "SOV" | "SVO" | "VSO" | "VOS" | "OVS" | "OSV";
export const WORD_ORDERS: WordOrder[] = ["SOV", "SVO", "VSO", "VOS", "OVS", "OSV"];

/** Context features. Noun words see their own noun-phrase features; every word sees clause features. */
export type Feature =
  | "plural" | "definite" | "animate" | "human" | "firstNoun" | "frontStem" | "possessor" | "possessed"
  | "transitive" | "past" | "negative" | "subjectPlural" | "absolutivePlural" | "objectPlural" | "anyPlural"
  | "pastTimeWord";

export const NOUN_FEATURES: Feature[] = [
  "plural", "definite", "animate", "human", "firstNoun", "frontStem", "possessor", "possessed", "transitive", "past", "negative",
];
export const VERB_FEATURES: Feature[] = [
  "subjectPlural", "absolutivePlural", "objectPlural", "anyPlural", "transitive", "past", "negative", "frontStem", "pastTimeWord",
];

export type Condition =
  | { type: "always" }
  | { type: "never" }
  | { type: "feature"; feature: Feature }
  | { type: "role"; roles: Role[] }
  | { type: "not"; inner: Condition }
  | { type: "and"; left: Condition; right: Condition }
  | { type: "or"; left: Condition; right: Condition };

export type Exponent =
  | { kind: "suffix"; form: string }
  | { kind: "prefix"; form: string }
  | { kind: "circumfix"; prefix: string; suffix: string }
  /** Copy of the stem: whole stem, first CV, or first CVC. */
  | { kind: "reduplication"; copy: "full" | "CV" | "CVC" }
  /** First consonant + a fixed vowel (only used as a parasitic reading of CV reduplication). */
  | { kind: "consonantCopyPrefix"; vowel: string }
  /** A separate word: next to the verb (verb hosts) or at the edge of the noun phrase (adpositions). */
  | { kind: "particle"; form: string; side: "before" | "after" };

export type MorphemeId = "PL" | "ACC" | "ERG" | "DEF" | "GEN" | "POSS" | "NEG" | "PST" | "AGR" | "LOC" | "INS" | "COM" | "SPLIT";

export interface Morpheme {
  id: MorphemeId;
  /** Leipzig gloss label, e.g. "ERG". */
  gloss: string;
  host: "noun" | "verb";
  exponent: Exponent;
  condition: Condition;
  /** Lower = closer to the stem. */
  slot: number;
}

export type Headline =
  | "ergative" | "differentialObject" | "reduplication" | "circumfix" | "harmony" | "definiteness" | "wordOrder"
  | "possessive" | "adjectivePhrase" | "oblique";
export const HEADLINES: Headline[] = [
  "ergative", "differentialObject", "reduplication", "circumfix", "harmony", "definiteness", "wordOrder", "possessive", "adjectivePhrase",
  "oblique",
];

/**
 * Where noun-phrase morphology goes when an adjective is present:
 *   head    only on the noun ("ancient shrine-PL")
 *   concord on the noun, and the `concord` morphemes are copied onto the adjective ("ancient-PL shrine-PL")
 *   edge    suffixes on the last word of the phrase, prefixes on the first ("shrine ancient-PL")
 */
export interface AdjectiveRules {
  position: "before" | "after";
  marking: "head" | "concord" | "edge";
  concord: MorphemeId[];
}

export type AdverbPosition = "initial" | "final" | "beforeVerb" | "afterVerb";

export interface Grammar {
  wordOrder: WordOrder;
  /** Does the lone intransitive subject precede the verb? */
  intransitiveSubjectFirst: boolean;
  morphemes: Morpheme[];
  /** Harmonising suffixes take their front form when this holds (true grammar: the stem is front). */
  harmonyCondition: Condition | null;
  adjectives: AdjectiveRules | null;
  /** Where the possessor goes relative to the possessed noun (and its adjective). */
  possessorPosition: "before" | "after" | null;
  adverbPosition: AdverbPosition | null;
  /** Where place / instrument / companion phrases go. */
  obliquePosition: AdverbPosition | null;
  phonology: Phonology;
  lexicon: Lexicon;
  info: {
    alignment: "none" | "nominativeAccusative" | "ergative";
    headline: Headline;
    supporting: string[];
    dimensions: MeaningDimensions;
    /** Weekday target the grammar was sampled for. */
    difficulty: number;
    /** No tense marking: the English tells the story in the past (both tenses are still accepted). */
    narrativePast: boolean;
  };
}

export interface WordContext extends Record<Feature, boolean> {
  role: Role | null;
}

export function holds(condition: Condition, context: WordContext): boolean {
  switch (condition.type) {
    case "always": return true;
    case "never": return false;
    case "feature": return context[condition.feature];
    case "role": return context.role !== null && condition.roles.includes(context.role);
    case "not": return !holds(condition.inner, context);
    case "and": return holds(condition.left, context) && holds(condition.right, context);
    case "or": return holds(condition.left, context) || holds(condition.right, context);
  }
}

const FEATURE_DESCRIPTIONS: Record<Feature, string> = {
  plural: "plural", definite: "definite", animate: "animate", human: "human", firstNoun: "first noun",
  possessor: "possessor", possessed: "possessed noun", pastTimeWord: "with 'yesterday'",
  frontStem: "front-vowel stem", transitive: "two-participant clause", past: "past", negative: "negative",
  subjectPlural: "plural subject", absolutivePlural: "plural lone-subject/object", objectPlural: "plural object",
  anyPlural: "any plural noun",
};
const ROLE_DESCRIPTIONS: Record<Role, string> = {
  A: "agent", S: "lone subject", P: "object", LOC: "place phrase", INS: "instrument phrase", COM: "companion phrase",
};

/** Short human-readable rendering, used in competitor reports. */
export function describeCondition(condition: Condition): string {
  switch (condition.type) {
    case "always": return "always";
    case "never": return "never";
    case "feature": return FEATURE_DESCRIPTIONS[condition.feature];
    case "role": return condition.roles.map(role => ROLE_DESCRIPTIONS[role]).join("/");
    case "not": return `not ${describeCondition(condition.inner)}`;
    case "and": return `${describeCondition(condition.left)} & ${describeCondition(condition.right)}`;
    case "or": return `(${describeCondition(condition.left)} or ${describeCondition(condition.right)})`;
  }
}

export const featureCondition = (feature: Feature): Condition => ({ type: "feature", feature });
export const roleCondition = (...roles: Role[]): Condition => ({ type: "role", roles });

/** Copy deep enough for mutation: morphemes and lexicon entries are copied. */
export function cloneGrammar(grammar: Grammar): Grammar {
  return {
    ...grammar,
    morphemes: grammar.morphemes.map(morpheme => ({ ...morpheme, exponent: { ...morpheme.exponent } })),
    adjectives: grammar.adjectives ? { ...grammar.adjectives, concord: [...grammar.adjectives.concord] } : null,
    lexicon: {
      nouns: grammar.lexicon.nouns.map(noun => ({ ...noun })),
      verbs: grammar.lexicon.verbs.map(verb => ({ ...verb })),
      adjectives: grammar.lexicon.adjectives.map(adjective => ({ ...adjective })),
      adverbs: grammar.lexicon.adverbs.map(adverb => ({ ...adverb })),
    },
    info: { ...grammar.info },
  };
}

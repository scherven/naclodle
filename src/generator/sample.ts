/**
 * Samples a coherent language for a day plan: the planned headline and word order, then supporting
 * phenomena and structures (adjectives, possessives, adverbs) chosen to hit the planned difficulty.
 * Typological weights come from WALS counts (see research/04-artificial-languages.md).
 *
 * Difficulty is a score (difficultyScore) summed from feature costs; sampling fills the day's budget
 * and the caller rejects grammars whose rounded score misses the target.
 */

import type { Rng } from "./rng";
import {
  featureCondition, roleCondition,
  type AdjectiveRules, type AdverbPosition, type Condition, type Exponent, type Grammar, type Headline, type Morpheme, type WordOrder,
} from "./grammar";
import { affixVariants, assignForms, chooseVocabulary, looksEnglish } from "./lexicon";
import { makeAffix, samplePhonology, type Phonology } from "./phonology";
import type { DayPlan } from "./plan";
import { ADVERBS, type ObliqueKind, type Theme } from "./themes";

const HEADLINE_COST: Record<Headline, number> = {
  reduplication: 1, circumfix: 1, definiteness: 1.25, wordOrder: 1.25, harmony: 2,
  differentialObject: 2, possessive: 2, adjectivePhrase: 2, ergative: 2.5, oblique: 1.5,
};
const ORDER_COST: Record<WordOrder, number> = { SOV: 0, SVO: 0, VSO: 0.5, VOS: 1, OVS: 1, OSV: 1 };

/** Difficulty from the grammar's features. Rounded and clamped to 1..5 by the caller. */
export function difficultyScore(grammar: Grammar): number {
  const headline = grammar.info.headline;
  let score = HEADLINE_COST[headline];
  if (headline !== "wordOrder") score += ORDER_COST[grammar.wordOrder];
  const has = (id: Morpheme["id"]) => grammar.morphemes.some(morpheme => morpheme.id === id);
  if ((has("ACC") || has("ERG")) && headline !== "ergative" && headline !== "differentialObject") score += 0.5;
  if (has("PST")) score += 0.5;
  if (has("AGR")) score += grammar.morphemes.some(morpheme => morpheme.gloss === "PL.ABS") ? 1 : 0.5;
  if (has("DEF") && headline !== "definiteness") score += 0.5;
  if (grammar.harmonyCondition && headline !== "harmony") score += 1;
  if (grammar.adjectives && headline !== "adjectivePhrase")
    score += { head: 0.5, concord: 1, edge: 1.5 }[grammar.adjectives.marking];
  if (grammar.possessorPosition && headline !== "possessive") score += has("POSS") ? 1.5 : 1;
  if (grammar.adverbPosition) score += 0.5;
  const obliqueCount = grammar.info.dimensions.obliques.length;
  if (headline !== "oblique") score += 0.5 * obliqueCount;
  else if (obliqueCount > 2) score += 0.5;
  if (grammar.morphemes.some(morpheme => morpheme.id === "PST" && JSON.stringify(morpheme.condition).includes("pastTimeWord"))) score += 0.5;
  return score;
}

/** P(case marking) and P(ergative | case) by order: case is rarer in SVO, ergativity rarest there. */
const CASE_PROBABILITY: Record<WordOrder, number> = { SOV: 0.75, SVO: 0.35, VSO: 0.6, VOS: 0.6, OVS: 0.9, OSV: 0.9 };
const ERGATIVE_PROBABILITY: Record<WordOrder, number> = { SOV: 0.35, SVO: 0.1, VSO: 0.35, VOS: 0.35, OVS: 0.4, OSV: 0.4 };

/** Does the lone subject sit where the agent sits? (S before V iff A before V.) */
const agentBeforeVerb = (order: WordOrder) => order.indexOf("S") < order.indexOf("V");
const verbFinal = (order: WordOrder) => order.endsWith("V");

interface AffixFactory { suffix(): string; prefix(): string; particle(): string }

/** Hands out affixes on distinct consonants, so no two morphemes look alike. */
function affixFactory(rng: Rng, phonology: Phonology): AffixFactory {
  const unused = rng.shuffle(phonology.consonants.filter(consonant => !["y", "w", "h"].includes(consonant)));
  const nextConsonant = () => unused.shift() ?? rng.pick(phonology.consonants);
  return {
    suffix: () => makeAffix(rng, phonology, nextConsonant(), true),
    prefix: () => makeAffix(rng, phonology, nextConsonant(), false),
    particle: () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const word = makeAffix(rng, phonology, nextConsonant(), false) + (rng.chance(0.4) && phonology.codas.length ? rng.pick(phonology.codas) : "");
        if (!looksEnglish(word)) return word;
      }
      return "ma";
    },
  };
}

/** Why sampleGrammar returned null, counted per reason (for diagnosing hard-to-fill day plans). */
export const sampleFailures: Record<string, number> = {};
const fail = (reason: string) => { sampleFailures[reason] = (sampleFailures[reason] ?? 0) + 1; return null; };

type Option = "case" | "tense" | "agreement" | "definiteness" | "harmony" | "adjectives" | "possession" | "adverbs" | "timeWordTense" | "obliques";
const STRUCTURES: Option[] = ["adjectives", "possession", "adverbs", "obliques"];
/** Share of languages whose puzzle shows negative sentences at all (circumfix days always do). */
const NEGATION_CHANCE = 0.4;

export function sampleGrammar(rng: Rng, theme: Theme, plan: DayPlan): Grammar | null {
  const { headline, wordOrder } = plan;
  const target = plan.difficulty;
  let budget = target - HEADLINE_COST[headline] - (headline === "wordOrder" ? 0 : ORDER_COST[wordOrder]);
  const chosen = new Set<Option>();
  const cost = (option: Option): number => ({
    case: 0.5, tense: 0.5, agreement: 0.5, definiteness: 0.5, harmony: 1,
    adjectives: 0.5, possession: 1, adverbs: 0.5, timeWordTense: 0.5, obliques: 0.5,
  })[option];
  const take = (option: Option) => { chosen.add(option); budget -= cost(option); };

  // Headline-implied features.
  if (headline === "harmony") chosen.add("harmony");
  if (headline === "definiteness") chosen.add("definiteness");
  if (headline === "possessive") chosen.add("possession");
  if (headline === "adjectivePhrase") chosen.add("adjectives");
  if (headline === "oblique") chosen.add("obliques");
  const caseFromHeadline = headline === "ergative" || headline === "differentialObject";

  // Harder days get at least one structure beyond "S O V + affixes"; middling days often get a place phrase or an adverb.
  if (target >= 3 && budget >= 0.5 && !STRUCTURES.some(structure => chosen.has(structure))) take(rng.pick(STRUCTURES));
  if (target === 2 && !chosen.has("obliques") && rng.chance(0.4)) take(rng.pick(["obliques", "adverbs"] as Option[]));
  const optional: Option[] = rng.shuffle(["case", "tense", "agreement", "definiteness", "harmony", "adjectives", "possession", "adverbs", "obliques"] as Option[])
    .filter(option => !chosen.has(option) && !(option === "case" && caseFromHeadline))
    .filter(option => target >= 3 || !STRUCTURES.includes(option));
  for (const option of optional) {
    if (budget < 0.5) break;
    if (cost(option) <= budget + 0.25 && rng.chance(0.6)) take(option);
  }
  if (chosen.has("adverbs") && chosen.has("tense") && budget >= 0.5 && rng.chance(0.7)) take("timeWordTense");
  // Case marking is the common pairing for verb-final and object-initial orders; give it a chance even when unbudgeted.
  if (!chosen.has("case") && !caseFromHeadline && budget >= 0.25 && rng.chance(CASE_PROBABILITY[wordOrder])) take("case");

  let alignment: Grammar["info"]["alignment"] = "none";
  if (headline === "ergative") alignment = "ergative";
  else if (headline === "differentialObject") alignment = "nominativeAccusative";
  else if (chosen.has("case")) alignment = rng.chance(ERGATIVE_PROBABILITY[wordOrder]) ? "ergative" : "nominativeAccusative";

  const hasHarmony = chosen.has("harmony");
  const phonology = samplePhonology(rng, hasHarmony, plan.style);
  const affixes = affixFactory(rng, phonology);
  const suffixWeight = verbFinal(wordOrder) ? 5 : 3; // suffixing preference (WALS 26A), stronger when verb-final
  const affixExponent = (allowPrefix = true): Exponent =>
    allowPrefix && !hasHarmony && rng.chance(1 / (suffixWeight + 1))
      ? { kind: "prefix", form: affixes.prefix() }
      : { kind: "suffix", form: affixes.suffix() };

  const morphemes: Morpheme[] = [];
  const add = (id: Morpheme["id"], gloss: string, host: Morpheme["host"], exponent: Exponent, condition: Condition, slot: number) =>
    morphemes.push({ id, gloss, host, exponent, condition, slot });

  // Plural (WALS 33A: suffix 513, prefix 126, reduplication rare -> boosted).
  const pluralKind = headline === "reduplication"
    ? rng.weighted([["CV", 3], ["full", 2]] as const)
    : rng.weighted([["suffix", 5], ["prefix", hasHarmony ? 0 : 1.5], ["CV", 0.6], ["full", 0.4]] as const);
  const pluralExponent: Exponent = pluralKind === "suffix" ? { kind: "suffix", form: affixes.suffix() }
    : pluralKind === "prefix" ? { kind: "prefix", form: affixes.prefix() }
    : { kind: "reduplication", copy: pluralKind };
  add("PL", "PL", "noun", pluralExponent, featureCondition("plural"), 1);

  let possessorPosition: Grammar["possessorPosition"] = null;
  if (chosen.has("possession")) {
    // Head-marking (POSS on the possessed noun) vs dependent-marking (GEN on the possessor).
    const headMarking = rng.chance(headline === "possessive" ? 0.6 : 0.35);
    if (headMarking) add("POSS", "POSS", "noun", { kind: "suffix", form: affixes.suffix() }, featureCondition("possessed"), 2);
    else add("GEN", "GEN", "noun", affixExponent(!verbFinal(wordOrder)), featureCondition("possessor"), 4);
    // Genitive-noun order correlates with OV (Dryer 1992).
    possessorPosition = rng.chance(verbFinal(wordOrder) ? 0.85 : 0.35) ? "before" : "after";
  }
  if (chosen.has("definiteness")) add("DEF", "DEF", "noun", affixExponent(), featureCondition("definite"), 3);
  if (alignment === "ergative") add("ERG", "ERG", "noun", affixExponent(!verbFinal(wordOrder)), roleCondition("A"), 4);
  if (alignment === "nominativeAccusative") {
    const condition: Condition = headline === "differentialObject"
      ? { type: "and", left: roleCondition("P"), right: featureCondition(rng.chance(0.5) ? "human" : "animate") }
      : roleCondition("P");
    add("ACC", "ACC", "noun", affixExponent(!verbFinal(wordOrder)), condition, 4);
  }

  if (chosen.has("tense")) {
    const condition: Condition = chosen.has("timeWordTense")
      ? { type: "and", left: featureCondition("past"), right: { type: "not", inner: featureCondition("pastTimeWord") } }
      : featureCondition("past");
    add("PST", "PST", "verb", affixExponent(), condition, 1);
  }
  if (chosen.has("agreement")) {
    const controller = alignment === "ergative" && rng.chance(0.75) ? "absolutivePlural" : "subjectPlural";
    add("AGR", controller === "absolutivePlural" ? "PL.ABS" : "3PL", "verb", { kind: "suffix", form: affixes.suffix() }, featureCondition(controller), 2);
  }

  // Oblique phrases: case suffixes, or adpositions (postpositions in verb-final languages, prepositions otherwise).
  let obliques: ObliqueKind[] = [];
  if (chosen.has("obliques"))
    obliques = headline === "oblique"
      ? (rng.chance(0.5) ? ["LOC", "INS", "COM"] : ["INS", "COM"])
      : rng.weighted<ObliqueKind[]>([[["LOC"], 4], [["COM"], 1.5], [["INS"], 1]]);
  if (obliques.length) {
    const useCase = rng.chance(alignment !== "none" || verbFinal(wordOrder) ? 0.7 : 0.35);
    const side = verbFinal(wordOrder) ? "after" : "before";
    for (const kind of obliques)
      add(kind, kind, "noun", useCase ? { kind: "suffix", form: affixes.suffix() } : { kind: "particle", form: affixes.particle(), side }, roleCondition(kind), 5);
  }
  const obliquePosition: AdverbPosition | null = !obliques.length ? null
    : verbFinal(wordOrder) ? rng.weighted<AdverbPosition>([["beforeVerb", 3], ["initial", 1]])
    : rng.weighted<AdverbPosition>([["final", 3], ["afterVerb", wordOrder.startsWith("V") ? 0 : 1], ["initial", 0.5]]);

  // Negation (WALS 112A/143A: particles slightly more common than affixes; NegV preferred). Not every puzzle has it.
  // Harmony needs two harmonising suffixes; when nothing else supplies the second, negation does.
  const suffixCount = morphemes.filter(morpheme => morpheme.exponent.kind === "suffix").length;
  const negationForHarmony = headline === "harmony" && suffixCount < 2;
  const hasNegation = headline === "circumfix" || negationForHarmony || rng.chance(NEGATION_CHANCE);
  const negationKind = headline === "circumfix"
    ? "circumfix"
    : negationForHarmony ? "suffix"
    : rng.weighted([["particleBefore", 4], ["particleAfter", 1.5], ["prefix", hasHarmony ? 0 : 1.5], ["suffix", 2]] as const);
  const negationExponent: Exponent =
    negationKind === "circumfix" ? { kind: "circumfix", prefix: affixes.prefix(), suffix: affixes.suffix() }
    : negationKind === "prefix" ? { kind: "prefix", form: affixes.prefix() }
    : negationKind === "suffix" ? { kind: "suffix", form: affixes.suffix() }
    : { kind: "particle", form: affixes.particle(), side: negationKind === "particleBefore" ? "before" : "after" };
  if (hasNegation) add("NEG", "NEG", "verb", negationExponent, featureCondition("negative"), 3);

  if (headline === "harmony" && morphemes.filter(morpheme => morpheme.exponent.kind === "suffix").length < 2) return fail("harmony needs suffixes");

  let adjectives: AdjectiveRules | null = null;
  if (chosen.has("adjectives")) {
    const marking = headline === "adjectivePhrase" ? rng.weighted([["concord", 1], ["edge", 1.2]] as const) : rng.weighted([["head", 2], ["concord", 1]] as const);
    // Edge marking is only visible when the adjective comes last (suffixes) - otherwise it looks like head marking.
    const position = marking === "edge" ? "after" : rng.chance(verbFinal(wordOrder) ? 0.4 : 0.65) ? "after" : "before";
    const caseIds = morphemes.filter(morpheme => ["ACC", "ERG"].includes(morpheme.id)).map(morpheme => morpheme.id);
    const concord = marking === "concord" ? (["PL", ...(rng.chance(0.4) ? caseIds : [])] as Morpheme["id"][]) : [];
    adjectives = { position, marking, concord };
  }
  let adverbPosition: AdverbPosition | null = null;
  if (chosen.has("adverbs"))
    adverbPosition = rng.weighted<AdverbPosition>([["initial", 2], ["final", 1.5], ["beforeVerb", verbFinal(wordOrder) ? 2.5 : 1], ["afterVerb", 1]]);

  const adverbs = !chosen.has("adverbs") ? []
    : rng.shuffle(ADVERBS.filter(adverb => !adverb.requiresPast || chosen.has("tense")))
      .filter(adverb => adverb.requiresPast === chosen.has("timeWordTense") || !adverb.requiresPast)
      .slice(0, 3);
  if (chosen.has("timeWordTense") && !adverbs.some(adverb => adverb.requiresPast)) adverbs.unshift(ADVERBS[0]);

  const vocabulary = chooseVocabulary(rng, theme, adverbs, obliques);
  if (!vocabulary) return fail("vocabulary");
  if (!chosen.has("adjectives")) vocabulary.adjectives = [];
  else if (vocabulary.adjectives.length < 2) return fail("adjectives");
  const suffixes = morphemes.flatMap(morpheme =>
    morpheme.exponent.kind === "suffix" ? affixVariants(phonology, morpheme.exponent.form)
    : morpheme.exponent.kind === "circumfix" ? affixVariants(phonology, morpheme.exponent.suffix) : []);
  const prefixes = morphemes.flatMap(morpheme =>
    morpheme.exponent.kind === "prefix" ? [morpheme.exponent.form]
    : morpheme.exponent.kind === "circumfix" ? [morpheme.exponent.prefix] : []);
  const particles = morphemes.flatMap(morpheme => morpheme.exponent.kind === "particle" ? [morpheme.exponent.form] : []);
  const lexicon = assignForms(rng, phonology, vocabulary,
    { suffixes, prefixes, words: particles, consonantInitial: pluralExponent.kind === "reduplication" });
  if (!lexicon) return fail("forms");

  const supporting = [...chosen].filter(option =>
    !(headline === "harmony" && option === "harmony") && !(headline === "definiteness" && option === "definiteness") &&
    !(headline === "possessive" && option === "possession") && !(headline === "adjectivePhrase" && option === "adjectives") &&
    !(headline === "oblique" && option === "obliques"));
  const grammar: Grammar = {
    wordOrder,
    intransitiveSubjectFirst: agentBeforeVerb(wordOrder),
    morphemes,
    harmonyCondition: hasHarmony ? featureCondition("frontStem") : null,
    adjectives,
    possessorPosition,
    adverbPosition,
    obliquePosition,
    phonology,
    lexicon,
    info: {
      alignment, headline, supporting, difficulty: target,
      narrativePast: !chosen.has("tense") && rng.chance(0.5),
      dimensions: {
        definiteness: chosen.has("definiteness"), tense: chosen.has("tense"),
        adjectives: chosen.has("adjectives"), possession: chosen.has("possession"), adverbs: chosen.has("adverbs"),
        negation: hasNegation, obliques,
      },
    },
  };
  const difficulty = Math.max(1, Math.min(5, Math.round(difficultyScore(grammar))));
  return difficulty === target ? grammar : fail(`difficulty ${difficulty} for target ${target}`);
}

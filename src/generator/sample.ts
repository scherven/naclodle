/**
 * Samples a coherent language: one headline ("aha") phenomenon, 1-3 supporting ones, and typologically
 * weighted defaults. Weights are WALS counts multiplied by an "interest" boost for un-English values
 * (see research/04-artificial-languages.md for the counts).
 */

import type { Rng } from "./rng";
import {
  featureCondition, roleCondition,
  type Condition, type Exponent, type Grammar, type Headline, type Morpheme, type WordOrder,
} from "./grammar";
import { affixVariants, assignForms, chooseVocabulary, looksEnglish } from "./lexicon";
import { makeAffix, samplePhonology, type Phonology } from "./phonology";
import type { Theme } from "./themes";

const HEADLINES: [Headline, number][] = [
  ["ergative", 3], ["differentialObject", 1.5], ["reduplication", 2], ["circumfix", 1.5],
  ["harmony", 2], ["definiteness", 1.5], ["wordOrder", 1],
];

/** WALS 81A counts x interest boost. */
const WORD_ORDER_WEIGHTS: [WordOrder, number][] = [
  ["SOV", 564], ["SVO", 244], ["VSO", 285], ["VOS", 150], ["OVS", 110], ["OSV", 80],
];

/** P(case marking) and P(ergative | case) by order: case is rarer in SVO, ergativity rarest there. */
const CASE_PROBABILITY: Record<WordOrder, number> = { SOV: 0.75, SVO: 0.35, VSO: 0.6, VOS: 0.6, OVS: 0.9, OSV: 0.9 };
const ERGATIVE_PROBABILITY: Record<WordOrder, number> = { SOV: 0.35, SVO: 0.1, VSO: 0.35, VOS: 0.35, OVS: 0.4, OSV: 0.4 };

/** Does the lone subject sit where the agent sits? (S before V iff A before V.) */
const agentBeforeVerb = (order: WordOrder) => order.indexOf("S") < order.indexOf("V");

interface AffixFactory {
  suffix(): string;
  prefix(): string;
  particle(): string;
}

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

export function sampleGrammar(rng: Rng, theme: Theme): Grammar | null {
  const headline = rng.weighted(HEADLINES);
  const wordOrder: WordOrder = headline === "wordOrder"
    ? rng.weighted<WordOrder>([["VOS", 3], ["OVS", 3], ["OSV", 3], ["VSO", 1]])
    : rng.weighted(WORD_ORDER_WEIGHTS);

  let alignment: Grammar["info"]["alignment"] = "none";
  if (headline === "ergative") alignment = "ergative";
  else if (headline === "differentialObject") alignment = "nominativeAccusative";
  else if (rng.chance(CASE_PROBABILITY[wordOrder]))
    alignment = rng.chance(ERGATIVE_PROBABILITY[wordOrder]) ? "ergative" : "nominativeAccusative";

  const supporting: string[] = [];
  if (alignment !== "none" && headline !== "ergative" && headline !== "differentialObject") supporting.push("case");
  const optional = rng.shuffle(["tense", "agreement", "definiteness", "harmony"] as const)
    .filter(feature => feature !== headline)
    .filter(feature => rng.chance({ tense: 0.5, agreement: alignment === "ergative" ? 0.5 : 0.3, definiteness: 0.2, harmony: 0.25 }[feature]));
  for (const feature of optional) if (supporting.length < 3) supporting.push(feature);
  if (supporting.length === 0) supporting.push(rng.pick(["tense", "agreement"]));

  const hasHarmony = headline === "harmony" || supporting.includes("harmony");
  const hasDefiniteness = headline === "definiteness" || supporting.includes("definiteness");
  const hasTense = supporting.includes("tense");
  const hasAgreement = supporting.includes("agreement");

  const phonology = samplePhonology(rng, hasHarmony);
  const affixes = affixFactory(rng, phonology);
  // Suffixing preference (WALS 26A), stronger in verb-final languages.
  const suffixWeight = wordOrder.endsWith("V") ? 5 : 3;
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

  if (hasDefiniteness) add("DEF", "DEF", "noun", affixExponent(), featureCondition("definite"), 2);
  if (alignment === "ergative") add("ERG", "ERG", "noun", affixExponent(!wordOrder.endsWith("V")), roleCondition("A"), 3);
  if (alignment === "nominativeAccusative") {
    const condition: Condition = headline === "differentialObject"
      ? { type: "and", left: roleCondition("P"), right: featureCondition(rng.chance(0.5) ? "human" : "animate") }
      : roleCondition("P");
    add("ACC", "ACC", "noun", affixExponent(!wordOrder.endsWith("V")), condition, 3);
  }

  if (hasTense) add("PST", "PST", "verb", affixExponent(), featureCondition("past"), 1);
  if (hasAgreement) {
    const controller = alignment === "ergative" && rng.chance(0.75) ? "absolutivePlural" : "subjectPlural";
    add("AGR", controller === "absolutivePlural" ? "PL.ABS" : "3PL", "verb", { kind: "suffix", form: affixes.suffix() }, featureCondition(controller), 2);
  }

  // Negation (WALS 112A/143A: particles slightly more common than affixes; NegV preferred).
  const negationKind = headline === "circumfix"
    ? "circumfix"
    : rng.weighted([["particleBefore", 4], ["particleAfter", 1.5], ["prefix", hasHarmony ? 0 : 1.5], ["suffix", 2]] as const);
  const negationExponent: Exponent =
    negationKind === "circumfix" ? { kind: "circumfix", prefix: affixes.prefix(), suffix: affixes.suffix() }
    : negationKind === "prefix" ? { kind: "prefix", form: affixes.prefix() }
    : negationKind === "suffix" ? { kind: "suffix", form: affixes.suffix() }
    : { kind: "particle", form: affixes.particle(), side: negationKind === "particleBefore" ? "before" : "after" };
  add("NEG", "NEG", "verb", negationExponent, featureCondition("negative"), 3);

  if (headline === "harmony" && morphemes.filter(morpheme => morpheme.exponent.kind === "suffix").length < 2) return null;

  const vocabulary = chooseVocabulary(rng, theme);
  if (!vocabulary) return null;
  const suffixes = morphemes.flatMap(morpheme =>
    morpheme.exponent.kind === "suffix" ? affixVariants(phonology, morpheme.exponent.form)
    : morpheme.exponent.kind === "circumfix" ? affixVariants(phonology, morpheme.exponent.suffix) : []);
  const prefixes = morphemes.flatMap(morpheme =>
    morpheme.exponent.kind === "prefix" ? [morpheme.exponent.form]
    : morpheme.exponent.kind === "circumfix" ? [morpheme.exponent.prefix] : []);
  const particles = morphemes.flatMap(morpheme => morpheme.exponent.kind === "particle" ? [morpheme.exponent.form] : []);
  const lexicon = assignForms(rng, phonology, vocabulary, { suffixes, prefixes, words: particles, consonantInitial: pluralExponent.kind === "reduplication" });
  if (!lexicon) return null;

  return {
    wordOrder,
    intransitiveSubjectFirst: agentBeforeVerb(wordOrder),
    morphemes,
    harmonyCondition: hasHarmony ? featureCondition("frontStem") : null,
    phonology,
    lexicon,
    info: { alignment, headline, supporting, dimensions: { definiteness: hasDefiniteness, tense: hasTense } },
  };
}

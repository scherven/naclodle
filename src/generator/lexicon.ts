/** Lexicon: a themed subset of English concepts, each given a conlang stem from the sampled phonology. */

import type { Rng } from "./rng";
import { allowsAgent, allowsPatient, type Adverb, type Theme, type ThemeAdjective, type ThemeNoun, type ThemeVerb } from "./themes";
import { ENGLISH_WORDS } from "./blocklist";
import { editDistance, makeStem, resolveHarmony, type Phonology } from "./phonology";

export interface LexiconNoun extends ThemeNoun { form: string }
export interface LexiconVerb extends ThemeVerb { form: string }
export interface LexiconAdjective extends ThemeAdjective { form: string }
export interface LexiconAdverb extends Adverb { form: string }
export interface Lexicon {
  nouns: LexiconNoun[];
  verbs: LexiconVerb[];
  adjectives: LexiconAdjective[];
  adverbs: LexiconAdverb[];
}

export interface Vocabulary {
  nouns: ThemeNoun[];
  verbs: ThemeVerb[];
  adjectives: ThemeAdjective[];
  adverbs: Adverb[];
}

const ANIMATE_CLASSES = new Set(["p", "b", "s"]);
export const isAnimate = (noun: ThemeNoun) => ANIMATE_CLASSES.has(noun.semanticClass);
export const isHuman = (noun: ThemeNoun) => noun.semanticClass === "p";

/**
 * Pick 3-4 transitive and 1-2 intransitive verbs, then 6-8 nouns such that every verb has at least two
 * possible subjects and an object, and some transitive verb has at least two possible objects.
 * Adjectives and adverbs are only included when the grammar uses them.
 */
export function chooseVocabulary(rng: Rng, theme: Theme, adverbs: Adverb[]): Vocabulary | null {
  for (let attempt = 0; attempt < 30; attempt++) {
    const vocabulary = tryVocabulary(rng, theme, adverbs);
    if (vocabulary) return vocabulary;
  }
  return null;
}

function tryVocabulary(rng: Rng, theme: Theme, adverbs: Adverb[]): Vocabulary | null {
  const transitiveVerbs = rng.shuffle(theme.verbs.filter(verb => verb.transitive)).slice(0, rng.int(3, 4));
  const intransitiveVerbs = rng.shuffle(theme.verbs.filter(verb => !verb.transitive)).slice(0, rng.int(1, 2));
  const verbs = [...transitiveVerbs, ...intransitiveVerbs];
  const usefulNouns = theme.nouns.filter(noun => verbs.some(verb => allowsAgent(verb, noun) || allowsPatient(verb, noun)));
  const nouns = rng.shuffle(usefulNouns).slice(0, rng.int(6, 8));
  const agentCount = (verb: ThemeVerb) => nouns.filter(noun => allowsAgent(verb, noun)).length;
  const patientCount = (verb: ThemeVerb) => nouns.filter(noun => allowsPatient(verb, noun)).length;
  const usable = verbs.every(verb => agentCount(verb) >= 2 && (!verb.transitive || patientCount(verb) >= 1)) &&
    transitiveVerbs.some(verb => patientCount(verb) >= 2);
  const adjectives = theme.adjectives.filter(adjective => nouns.filter(noun => adjective.describes.includes(noun.semanticClass)).length >= 2);
  return usable && transitiveVerbs.length >= 2 && intransitiveVerbs.length >= 1 ? { nouns, verbs, adjectives, adverbs } : null;
}

/** Would this form read as English, or echo its own gloss (griffin -> "grif")? */
export function looksEnglish(form: string, gloss?: string): boolean {
  if (ENGLISH_WORDS.has(form)) return true;
  if (!gloss) return false;
  if (form.slice(0, 3) === gloss.slice(0, 3)) return true;
  return editDistance(form, gloss) <= Math.ceil(gloss.length / 2);
}

export interface AffixConstraints {
  /** Strings no stem may end with (resolved suffix forms). */
  suffixes: string[];
  /** Strings no stem may start with (prefix forms). */
  prefixes: string[];
  /** Whole words (particles) stems must stay well away from. */
  words: string[];
  /** Reduplicating languages get consonant-initial stems (u-uyatu reads badly). */
  consonantInitial: boolean;
}

/**
 * Assign stems: distinct (edit distance >= 2 from each other and from particles), not English, not
 * ending in a suffix or starting with a prefix (which would make the morpheme boundary ambiguous).
 * With harmony, roughly half the stems are front and half back.
 */
export function assignForms(
  rng: Rng,
  phonology: Phonology,
  vocabulary: Vocabulary,
  constraints: AffixConstraints,
): Lexicon | null {
  const taken: string[] = [...constraints.words];
  const harmonyClasses = (count: number) =>
    rng.shuffle(Array.from({ length: count }, (_, index) => index % 2 === 0));
  const makeFor = (gloss: string, syllableCount: () => number, front: boolean | null): string | null => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const form = makeStem(rng, phonology, syllableCount(), front);
      const clashes =
        looksEnglish(form, gloss) ||
        (constraints.consonantInitial && /^[aeiouäöü]/.test(form)) ||
        taken.some(other => editDistance(form, other) < 2) ||
        constraints.suffixes.some(suffix => form.endsWith(suffix)) ||
        constraints.prefixes.some(prefix => form.startsWith(prefix));
      if (!clashes) {
        taken.push(form);
        return form;
      }
    }
    return null;
  };
  const nounFronts = phonology.harmony ? harmonyClasses(vocabulary.nouns.length) : [];
  const verbFronts = phonology.harmony ? harmonyClasses(vocabulary.verbs.length) : [];
  const nouns: LexiconNoun[] = [];
  for (const [index, noun] of vocabulary.nouns.entries()) {
    const form = makeFor(noun.id, () => rng.weighted([[2, 7], [3, 3]]), phonology.harmony ? nounFronts[index] : null);
    if (!form) return null;
    nouns.push({ ...noun, form });
  }
  const verbs: LexiconVerb[] = [];
  for (const [index, verb] of vocabulary.verbs.entries()) {
    const form = makeFor(verb.id, () => 2, phonology.harmony ? verbFronts[index] : null);
    if (!form) return null;
    verbs.push({ ...verb, form });
  }
  const adjectives: LexiconAdjective[] = [];
  for (const adjective of vocabulary.adjectives) {
    const form = makeFor(adjective.id, () => 2, phonology.harmony ? rng.chance(0.5) : null);
    if (!form) return null;
    adjectives.push({ ...adjective, form });
  }
  const adverbs: LexiconAdverb[] = [];
  for (const adverb of vocabulary.adverbs) {
    const form = makeFor(adverb.english.replace(/^at /, ""), () => rng.int(2, 3), phonology.harmony ? rng.chance(0.5) : null);
    if (!form) return null;
    adverbs.push({ ...adverb, form });
  }
  return { nouns, verbs, adjectives, adverbs };
}

/** Both harmony variants of an affix (or just the affix). */
export function affixVariants(phonology: Phonology, affix: string): string[] {
  return [...new Set([resolveHarmony(phonology, affix, false), resolveHarmony(phonology, affix, true)])];
}

/** A language name in the language's own sound system. */
export function makeLanguageName(rng: Rng, phonology: Phonology): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = makeStem(rng, phonology, rng.int(2, 3), phonology.harmony ? rng.chance(0.5) : null);
    if (!looksEnglish(name)) return name[0].toUpperCase() + name.slice(1);
  }
  return "Tanu";
}

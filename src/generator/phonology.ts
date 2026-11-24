/**
 * Sampled phonology: a consonant subset biased to the cross-linguistic core (/m k n j/ are in >90% of
 * PHOIBLE inventories), at most one "flavour" consonant, a vowel system (optionally with front/back
 * harmony), and (C)V(C) syllables with a small coda set. Segments are drawn with a power-law dropoff so
 * a few sounds dominate, as in real lexicons. See research/04-artificial-languages.md.
 */

import type { Rng } from "./rng";

export interface VowelHarmony {
  /** [back, front] vowel pairs. Harmonising affixes spell the back vowel in uppercase ("kA"). */
  pairs: [string, string][];
}

export interface Phonology {
  /** Ordered most to least frequent. */
  consonants: string[];
  vowels: string[];
  codas: string[];
  codaProbability: number;
  harmony: VowelHarmony | null;
}

const CONSONANT_POOL: [string, number][] = [
  ["p", 0.85], ["s", 0.8], ["l", 0.7], ["w", 0.5], ["y", 0.5], ["r", 0.55], ["b", 0.45], ["d", 0.4],
  ["g", 0.35], ["h", 0.4], ["f", 0.2], ["v", 0.15], ["z", 0.12],
];
const FLAVOUR_CONSONANTS = ["ŋ", "š", "q", "x", "č", "ñ"];

const VOWEL_SYSTEMS: [string[], number][] = [
  [["a", "e", "i", "o", "u"], 6], [["a", "i", "u"], 2], [["a", "e", "i", "u"], 1.5],
];
/** [back vowels, front vowels], paired by position. */
const HARMONY_SYSTEMS: [string[], string[]][] = [
  [["a", "o", "u"], ["e", "ö", "i"]],
  [["a", "o", "u"], ["ä", "ö", "ü"]],
  [["a", "u"], ["e", "i"]],
];

export function samplePhonology(rng: Rng, wantHarmony: boolean): Phonology {
  const extraConsonants = rng.shuffle(CONSONANT_POOL)
    .filter(([, probability]) => rng.chance(probability))
    .map(([consonant]) => consonant)
    .slice(0, rng.int(6, 9));
  const consonants = ["t", "k", "n", "m", ...extraConsonants];
  if (rng.chance(0.55)) consonants.splice(rng.int(3, consonants.length), 0, rng.pick(FLAVOUR_CONSONANTS));
  let vowels: string[];
  let harmony: VowelHarmony | null = null;
  if (wantHarmony) {
    const [backVowels, frontVowels] = rng.pick(HARMONY_SYSTEMS);
    harmony = { pairs: backVowels.map((back, index) => [back, frontVowels[index]] as [string, string]) };
    vowels = [...backVowels, ...frontVowels];
  } else {
    vowels = rng.weighted(VOWEL_SYSTEMS);
  }
  const codas = ["n", "m", "l", "r", "s"].filter(consonant => consonants.includes(consonant)).slice(0, rng.int(1, 3));
  return { consonants, vowels, codas, codaProbability: codas.length ? rng.pick([0, 0.15, 0.3]) : 0, harmony };
}

/** Vowels available to a stem of the given harmony class (null = any). */
export function stemVowels(phonology: Phonology, front: boolean | null): string[] {
  if (!phonology.harmony || front === null) return phonology.vowels;
  return phonology.harmony.pairs.map(pair => pair[front ? 1 : 0]);
}

/** Is this word front-harmonic? Decided by its last harmony vowel. */
export function isFrontWord(phonology: Phonology, word: string): boolean {
  if (!phonology.harmony) return false;
  const frontVowels = new Set(phonology.harmony.pairs.map(pair => pair[1]));
  const backVowels = new Set(phonology.harmony.pairs.map(pair => pair[0]));
  for (let i = word.length - 1; i >= 0; i--) {
    if (frontVowels.has(word[i])) return true;
    if (backVowels.has(word[i])) return false;
  }
  return false;
}

/** Replace uppercase vowel placeholders with the back or front member of their pair. */
export function resolveHarmony(phonology: Phonology, affix: string, front: boolean): string {
  if (!phonology.harmony) return affix;
  let resolved = affix;
  for (const [back, frontVowel] of phonology.harmony.pairs)
    resolved = resolved.split(back.toUpperCase()).join(front ? frontVowel : back);
  return resolved;
}

/** Sequences that look unnatural in romanisation: yi, wu, and doubled consonants. */
const UNNATURAL_SEQUENCE = /yi|wu|([^aeiouäöü])\1/;

function makeSyllable(rng: Rng, phonology: Phonology, vowels: string[], wordInitial: boolean, wordFinal: boolean): string {
  const onsetChoices = phonology.consonants.filter(consonant => consonant !== "ŋ" || !wordInitial);
  const onset = wordInitial && rng.chance(0.08) ? "" : rng.dropoff(onsetChoices);
  const vowel = rng.dropoff(vowels, 0.5);
  const coda = !wordFinal && rng.chance(phonology.codaProbability) ? rng.pick(phonology.codas) : "";
  return onset + vowel + coda;
}

/** A vowel-final stem. Vowel-final stems keep suffix boundaries clean (no hiatus repair needed). */
export function makeStem(rng: Rng, phonology: Phonology, syllableCount: number, front: boolean | null): string {
  const vowels = stemVowels(phonology, front);
  for (let attempt = 0; attempt < 50; attempt++) {
    const syllables = Array.from({ length: syllableCount }, (_, index) =>
      makeSyllable(rng, phonology, vowels, index === 0, index === syllableCount - 1));
    if (new Set(syllables).size < syllables.length) continue; // "tata" would look like reduplication
    const stem = syllables.join("")
      .replace(/n(?=[pb])/g, "m").replace(/m(?=[tdsl])/g, "n"); // nasal place assimilation
    if (!UNNATURAL_SEQUENCE.test(stem)) return stem;
  }
  return makeSyllable(rng, phonology, vowels, true, false) + makeSyllable(rng, phonology, vowels, false, true);
}

/** CV affix on the given consonant. With harmony, suffix vowels are placeholders so they alternate. */
export function makeAffix(rng: Rng, phonology: Phonology, consonant: string, harmonising: boolean): string {
  if (harmonising && phonology.harmony) return consonant + rng.pick(phonology.harmony.pairs)[0].toUpperCase();
  const allowedVowels = phonology.vowels.filter(vowel =>
    !(consonant === "y" && vowel === "i") && !(consonant === "w" && vowel === "u"));
  return consonant + rng.dropoff(allowedVowels, 0.5);
}

export function editDistance(first: string, second: string): number {
  const table = Array.from({ length: first.length + 1 }, (_, row) => [row, ...Array(second.length).fill(0)]);
  for (let column = 1; column <= second.length; column++) table[0][column] = column;
  for (let row = 1; row <= first.length; row++)
    for (let column = 1; column <= second.length; column++)
      table[row][column] = Math.min(
        table[row - 1][column] + 1,
        table[row][column - 1] + 1,
        table[row - 1][column - 1] + (first[row - 1] === second[column - 1] ? 0 : 1));
  return table[first.length][second.length];
}

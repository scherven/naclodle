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
  /** The sound style: "plain", or one of the SOUND_STYLES below. */
  style: string;
  /** Ordered most to least frequent. A "consonant" may be a cluster ("tkʼ") or a click ("ǃ"). */
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

/** Every vowel letter any style uses. Used wherever code needs to tell vowels from consonants. */
export const VOWEL_LETTERS = "aeiouäöüæøåáàéèíìóòúùāēīōūãẽõũëïıăâơưôêạảốőű";

/**
 * Optional sound styles, for fun: some days the language sounds alien. Consonant lists are ordered
 * most to least frequent; vowels are ignored when the grammar needs vowel harmony (harmony keeps its pairs).
 */
interface SoundStyle { consonants: string[]; vowels: string[]; codas: string[]; codaProbability: number }
export const SOUND_STYLES: Record<string, SoundStyle> = {
  // Salish/Caucasus-like: consonant clusters, ejectives (ʼ), lateral fricatives (ɬ), uvulars (q), few vowels
  clusters: { consonants: ["t", "k", "q", "s", "tk", "kʼ", "x", "ɬ", "qʼ", "sk", "tɬ", "xʷ", "sq", "m", "n", "l"], vowels: ["a", "i", "u"], codas: [], codaProbability: 0 },
  // liquids and glides everywhere: soft, flowing words
  glides: { consonants: ["l", "w", "y", "r", "n", "h", "m"], vowels: ["a", "e", "i", "o", "u"], codas: ["l", "r", "n"], codaProbability: 0.2 },
  // Khoisan-like click consonants
  clicks: { consonants: ["ǃ", "k", "ǀ", "n", "ǂ", "t", "ǁ", "s", "h", "g", "m"], vowels: ["a", "e", "i", "o", "u"], codas: ["n"], codaProbability: 0.15 },
  // tone written with accents (high ´, low `), plus prenasalised stops
  tones: { consonants: ["mb", "nd", "k", "ŋg", "t", "s", "l", "m", "n", "b", "d", "w", "y", "f"], vowels: ["a", "á", "à", "i", "í", "ì", "u", "ú", "ù", "e", "é", "è", "o", "ó", "ò"], codas: [], codaProbability: 0 },
  // Polynesian-like: tiny inventory, glottal stop (ʻ), long vowels (macron)
  island: { consonants: ["k", "ʻ", "h", "l", "m", "n", "p", "w"], vowels: ["a", "e", "i", "o", "u", "ā", "ē", "ī", "ō", "ū"], codas: [], codaProbability: 0 },
  // Old Norse look: thorn, eth, ash, slashed o
  northern: { consonants: ["t", "r", "k", "þ", "s", "l", "ð", "n", "m", "v", "g", "h", "sk", "st"], vowels: ["a", "e", "i", "o", "u", "æ", "ø", "å"], codas: ["r", "n", "l", "s"], codaProbability: 0.3 },
  // nasal vowels with tildes
  nasal: { consonants: ["n", "m", "s", "t", "k", "ñ", "w", "p", "ŋ", "y", "r"], vowels: ["a", "ã", "e", "ẽ", "i", "o", "õ", "u", "ũ"], codas: [], codaProbability: 0 },
  // Sanskrit-like: aspirated and retroflex (dotted) consonants, long vowels
  dotted: { consonants: ["t", "k", "th", "ṭ", "n", "ṇ", "kh", "ṣ", "ḍ", "ph", "r", "v", "m", "s", "dh", "bh"], vowels: ["a", "ā", "i", "ī", "u", "ū", "e", "o"], codas: ["n", "r"], codaProbability: 0.15 },
  // Finnish-like: long vowels written double, soft consonants
  lakes: { consonants: ["t", "k", "s", "l", "v", "j", "h", "n", "r", "m", "p"], vowels: ["a", "aa", "i", "ii", "u", "uu", "e", "ee", "o", "oo", "ä", "ö"], codas: ["n", "l", "s"], codaProbability: 0.25 },
  // Semitic-like: pharyngeals ʕ ḥ, glottal stop ʔ, emphatic ṣ ṭ, three vowels plus long ones
  desert: { consonants: ["q", "ḥ", "ʔ", "s", "ṣ", "ʕ", "ṭ", "k", "r", "l", "m", "n", "d", "b", "z", "š"], vowels: ["a", "i", "u", "ā", "ī", "ū"], codas: ["r", "l", "n", "m"], codaProbability: 0.3 },
  // Nahuatl-like: tl, tz, x and ch
  highland: { consonants: ["tl", "t", "tz", "x", "k", "ch", "m", "n", "w", "y", "l", "p", "s"], vowels: ["a", "e", "i", "o"], codas: ["n", "l", "x"], codaProbability: 0.2 },
  // airy and elvish: soft consonants, vowels with diaereses
  airy: { consonants: ["l", "th", "s", "n", "r", "v", "f", "m", "d", "w"], vowels: ["a", "e", "i", "ë", "ï", "o"], codas: ["l", "n", "r", "th"], codaProbability: 0.3 },
  // Slavic-like: háčeks everywhere
  carved: { consonants: ["č", "ž", "k", "š", "dž", "v", "r", "t", "z", "l", "n", "m", "s", "p"], vowels: ["a", "e", "i", "o", "u"], codas: ["r", "v", "š", "n"], codaProbability: 0.3 },
  // Old English/Icelandic-like breathed sonorants: hl, hr, hn, hw
  breath: { consonants: ["hl", "r", "hr", "w", "hn", "l", "hw", "n", "f", "m", "g", "d"], vowels: ["a", "e", "i", "o", "u", "ā", "ē"], codas: ["l", "r", "n", "f"], codaProbability: 0.25 },
  // something from the stars: z, x, q and breaks (ʼ) between vowels
  void: { consonants: ["z", "x", "v", "q", "k", "r", "th", "n", "s"], vowels: ["a", "o", "u", "ʼa", "ʼo", "e"], codas: ["x", "z", "r"], codaProbability: 0.25 },
  // Turkic steppe: dotless ı, ğ, ş, ç
  steppe: { consonants: ["ğ", "k", "q", "ş", "t", "ç", "n", "m", "r", "l", "y", "b", "s"], vowels: ["a", "ı", "o", "u", "e", "ö", "ü"], codas: ["r", "n", "l", "ş"], codaProbability: 0.3 },
  // Vietnamese-like: stacked diacritics, ng/nh/tr/đ
  delta: { consonants: ["ng", "nh", "t", "th", "đ", "tr", "kh", "m", "n", "l", "b", "ph"], vowels: ["a", "ă", "â", "ơ", "ư", "ô", "ê", "ạ", "ả", "ố", "i", "o"], codas: ["n", "m"], codaProbability: 0.2 },
  // Irish-like lenited consonants: bh, mh, dh, gh, ch, accented vowels
  mists: { consonants: ["bh", "t", "mh", "c", "dh", "l", "gh", "r", "ch", "s", "n", "f"], vowels: ["a", "á", "e", "é", "i", "í", "o", "ó", "u", "ú"], codas: ["n", "r", "l"], codaProbability: 0.25 },
  // Hungarian-like: sz, zs, gy, ny, cs, double-acute vowels
  puszta: { consonants: ["sz", "k", "gy", "t", "zs", "ny", "cs", "m", "l", "r", "v", "b", "h"], vowels: ["a", "á", "e", "é", "i", "o", "ö", "ő", "u", "ü", "ű"], codas: ["r", "l", "n"], codaProbability: 0.3 },
  // Inuit-like: q, ng, rl, three vowels long and short
  ice: { consonants: ["q", "k", "t", "ng", "rl", "s", "v", "j", "m", "n", "p", "l"], vowels: ["a", "aa", "i", "ii", "u", "uu"], codas: ["q", "k", "t"], codaProbability: 0.2 },
};
export const SOUND_STYLE_NAMES = Object.keys(SOUND_STYLES);

/** `styleName` comes from the day plan ("plain" or a SOUND_STYLES key), so styles are spread across days. */
export function samplePhonology(rng: Rng, wantHarmony: boolean, styleName = "plain"): Phonology {
  const style = SOUND_STYLES[styleName];
  let consonants: string[];
  if (style) {
    // keep the most frequent few, then a random selection of the rest, so each language of a style differs
    const core = style.consonants.slice(0, 4);
    const rest = rng.shuffle(style.consonants.slice(4)).slice(0, rng.int(3, 6));
    consonants = [...core, ...rest];
  } else {
    const extraConsonants = rng.shuffle(CONSONANT_POOL)
      .filter(([, probability]) => rng.chance(probability))
      .map(([consonant]) => consonant)
      .slice(0, rng.int(6, 9));
    consonants = ["t", "k", "n", "m", ...extraConsonants];
    if (rng.chance(0.55)) consonants.splice(rng.int(3, consonants.length), 0, rng.pick(FLAVOUR_CONSONANTS));
  }
  let vowels: string[];
  let harmony: VowelHarmony | null = null;
  if (wantHarmony) {
    const [backVowels, frontVowels] = rng.pick(HARMONY_SYSTEMS);
    harmony = { pairs: backVowels.map((back, index) => [back, frontVowels[index]] as [string, string]) };
    vowels = [...backVowels, ...frontVowels];
  } else {
    vowels = style ? style.vowels : rng.weighted(VOWEL_SYSTEMS);
  }
  if (style) {
    const codas = style.codas.filter(coda => consonants.includes(coda));
    return { style: styleName, consonants, vowels, codas, codaProbability: codas.length ? style.codaProbability : 0, harmony };
  }
  const codas = ["n", "m", "l", "r", "s"].filter(consonant => consonants.includes(consonant)).slice(0, rng.int(1, 3));
  return { style: "plain", consonants, vowels, codas, codaProbability: codas.length ? rng.pick([0, 0.15, 0.3]) : 0, harmony };
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
const UNNATURAL_SEQUENCE = new RegExp(`yi|wu|([^${VOWEL_LETTERS}])\\1`);

function makeSyllable(rng: Rng, phonology: Phonology, vowels: string[], wordInitial: boolean, wordFinal: boolean): string {
  const onsetChoices = phonology.consonants.filter(consonant => !consonant.startsWith("ŋ") || consonant.length > 1 || !wordInitial);
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

/** Segments that make a style recognisable: anything non-ASCII or written with more than one letter. */
export function distinctiveSegments(phonology: Phonology): string[] {
  if (phonology.style === "plain") return [];
  return [...phonology.consonants, ...phonology.vowels].filter(segment => segment.length > 1 || /[^a-z]/.test(segment));
}

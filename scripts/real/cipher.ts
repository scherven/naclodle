/**
 * A letter-for-letter disguise for a real language, so a blind solver or attacker can't lean on knowing it:
 * "Der Hund schläft" might become "Mav Qikl ywfnöbu". Word boundaries, capitals and every repeated piece
 * of a word survive, so the puzzle stays exactly as solvable from the data as the original.
 */

import { Rng } from "../../src/generator/rng";

const TARGET_LETTERS = [..."abcdefghijklmnopqrstuvwxyzäöüéèáàíóúñçšžčđłøåæ"];

export interface Cipher {
  encode(text: string): string;
  decode(text: string): string;
}

export function makeCipher(languageTexts: string[], seed: string): Cipher {
  const letters = [...new Set(languageTexts.join(" ").toLocaleLowerCase().split("").filter(character => /\p{L}/u.test(character)))].sort();
  if (letters.length > TARGET_LETTERS.length) throw new Error(`too many letters to disguise (${letters.length})`);
  const rng = new Rng(`cipher:${seed}`);
  const targets = rng.shuffle([...TARGET_LETTERS]).slice(0, letters.length);
  const forward = new Map(letters.map((letter, position) => [letter, targets[position]]));
  const backward = new Map(letters.map((letter, position) => [targets[position], letter]));
  const swap = (text: string, table: Map<string, string>) =>
    [...text].map(character => {
      const lower = character.toLocaleLowerCase();
      const swapped = table.get(lower);
      if (!swapped) return character;
      return character === lower ? swapped : swapped.toLocaleUpperCase();
    }).join("");
  return { encode: text => swap(text, forward), decode: text => swap(text, backward) };
}

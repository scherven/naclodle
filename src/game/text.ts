/** Text normalisation and answer grading. Pure functions, no DOM. */

import type { Item } from "../puzzle";

export type Verdict = "ok" | "near" | "bad";

const ENGLISH_CONTRACTIONS: [RegExp, string][] = [
  [/\bdidn't\b/g, "did not"], [/\bdoesn't\b/g, "does not"], [/\bdon't\b/g, "do not"],
  [/\bisn't\b/g, "is not"], [/\baren't\b/g, "are not"], [/\bwasn't\b/g, "was not"],
  [/\bweren't\b/g, "were not"], [/\bwon't\b/g, "will not"], [/\bcan't\b/g, "cannot"],
];

/** Case-fold (locale-aware), expand English contractions, drop punctuation and morpheme hyphens, collapse spaces. */
export function normalise(text: string, locale: string | undefined, isEnglish: boolean): string {
  let result = text.toLocaleLowerCase(isEnglish ? "en" : locale || "und").replace(/[’‘`]/g, "'");
  if (isEnglish) for (const [pattern, expansion] of ENGLISH_CONTRACTIONS) result = result.replace(pattern, expansion);
  return result.replace(/-/g, "").replace(/[.,!?;:"“”«»()]/g, "").replace(/\s+/g, " ").trim();
}

/** Strip diacritics (and dotless ı) so "near" can forgive accent slips. */
export const removeAccents = (text: string) => text.replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");

export const words = (text: string) => (text ? text.split(" ") : []);

/** Longest common subsequence of two word lists: which words of `first` are kept, and how many. */
export function longestCommonSubsequence(first: string[], second: string[]): { kept: boolean[]; length: number } {
  const table = Array.from({ length: first.length + 1 }, () => Array<number>(second.length + 1).fill(0));
  for (let i = first.length - 1; i >= 0; i--)
    for (let j = second.length - 1; j >= 0; j--)
      table[i][j] = first[i] === second[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const kept = Array<boolean>(first.length).fill(false);
  let i = 0, j = 0;
  while (i < first.length && j < second.length) {
    if (first[i] === second[j]) { kept[i] = true; i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return { kept, length: table[0][0] };
}

/**
 * ok   = matches an accepted answer.
 * near = right apart from accents, or exactly one word wrong (same word count).
 * bad  = anything else (including empty).
 */
export function grade(item: Item, answer: string, locale: string | undefined, isEnglish: boolean): Verdict {
  const given = normalise(answer, locale, isEnglish);
  if (!given) return "bad";
  const accepted = item.accepted.map(option => normalise(option, locale, isEnglish));
  if (accepted.includes(given)) return "ok";
  if (accepted.some(option => removeAccents(option) === removeAccents(given))) return "near";
  const givenWords = words(given);
  const oneWordOff = accepted.some(option => {
    const optionWords = words(option);
    return optionWords.length === givenWords.length && optionWords.filter((word, index) => word !== givenWords[index]).length === 1;
  });
  return oneWordOff ? "near" : "bad";
}

/** The accepted answer closest to what the player wrote (for the end-of-game key). */
export function closestAccepted(item: Item, answer: string, locale: string | undefined, isEnglish: boolean): string {
  const givenWords = words(normalise(answer, locale, isEnglish));
  let best = item.accepted[0], bestOverlap = -1;
  for (const option of item.accepted) {
    const overlap = longestCommonSubsequence(givenWords, words(normalise(option, locale, isEnglish))).length;
    if (overlap > bestOverlap) { bestOverlap = overlap; best = option; }
  }
  return best;
}

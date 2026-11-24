/**
 * Every piece of interface copy. `null` means "no copy here" (decided in the design mock).
 * {lang} is replaced with the puzzle's language name.
 */
export const COPY = {
  tagline: null,
  intro: "Here are some sentences in {lang} and their English translations.",
  note: null,
  pairIntro: "Drag the translations into place.",
  taskA: "Translate into English.",
  taskB: "Translate into {lang}.",
  solved: "Solved.",
  over: "Failed :(",
  exWords: "Words",
  exGrammar: "Grammar",
  exFact: "Did you know",
  footer: null,
} as const satisfies Record<string, string | null>;

export type CopyKey = keyof typeof COPY;

export function copy(key: CopyKey, languageName: string): string | null {
  const text = COPY[key] as string | null;
  return text === null ? null : text.replace(/\{lang\}/g, languageName);
}

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

/**
 * The "How to play" panel behind the ⓘ button. Each row pairs a control (drawn by main.ts, keyed by `control`)
 * with its description. Sections and rows show in this order.
 */
export const RULES = {
  title: "How to play",
  goal: "Work out the grammar from the example sentences, then translate one sentence into English and one into the language.",
  sections: [
    {
      heading: "Markup",
      rows: [
        { control: "colours", text: "Pick a color, then click a word or select some letters to become that color." },
        { control: "numberKeys", text: "Pick the nth color." },
        { control: "addColour", text: "Adds a new color." },
        { control: "allOne", text: "Color every match, or only the one you choose." },
        { control: "split", text: "Click between two letters to mark where a word splits into morphemes." },
        { control: "clear", text: "Removes the selected color, or all if none is selected." },
        { control: "drag", text: "Drag the sentences around (for shuffled puzzles)." },
      ],
    },
    {
      heading: "Hints",
      rows: [
        { control: "hint", text: "Shows a clue. Costs 1 point." },
        { control: "checkPairs", text: "Locks every translation that's in the right place (for shuffled puzzles). Costs 1 point." },
      ],
    },
    {
      heading: "Answering",
      rows: [
        { control: "letterKeys", text: "Types letters unique to the language. ⇧ or Shift for capital letters." },
        { control: "check", text: "Check your answers." },
      ],
    },
    {
      heading: "Checking",
      rows: [
        { control: "right", text: "Right. 3 points." },
        { control: "almost", text: "Right apart from accents, or one word wrong. 2 points." },
        { control: "wrong", text: "Not yet. 0 points." },
      ],
    },
  ],
} as const;

export type RulesControl = (typeof RULES)["sections"][number]["rows"][number]["control"];

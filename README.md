# naclodle

A daily linguistics puzzle in the style of NACLO "Rosetta stone" problems. You get a handful of sentences in an unfamiliar language with their English translations, work out the grammar, and translate new sentences both ways.

## Playing

- Three checks per puzzle. Each answer is marked ✓ (right), ≈ (right apart from accents or one word), or ✗.
- One hint, which costs a point.
- On shuffled days the translations start out of order: drag them into place. "Check pairs" locks the correct ones and costs a point.
- Highlighter: pick a colour, then click a word or select part of one to colour every match, in the examples, the questions and your answers. "one" colours only what you click. `a|b` marks where a word splits. Keys 1–9 pick colours, Esc puts the pen down.
- Click a sentence number to dim it.
- `#YYYY-MM-DD` in the URL plays an earlier puzzle.

## Development

```bash
npm install
npm run dev        # local server
npm test           # vitest
npm run typecheck
npm run build      # static site in dist/
```

## Layout

| Path | What |
|---|---|
| `src/puzzle.ts` | The puzzle format and `validatePuzzle`. |
| `src/game/text.ts` | Normalisation and grading. |
| `src/game/state.ts` | Checks, pairing, scoring, share text. |
| `src/game/colours.ts` | Highlighter colours (OKLCH, maximally distinct). |
| `src/main.ts`, `src/style.css` | The page. |
| `src/copy.ts` | All interface copy; `null` means no copy in that spot. |
| `src/generator/` | Artificial-language puzzle generator. |
| `scripts/generate.ts` | CLI: `npm run generate -- --date 2026-11-24 --days 7 --schedule` |
| `public/puzzles/` | Puzzle files plus `index.json`, the schedule. |

## Adding a puzzle

Write a JSON file matching `Puzzle` in `src/puzzle.ts` into `public/puzzles/`, add `{ "date", "file" }` to `public/puzzles/index.json`, and run `npm test`. The tests check every listed file is valid and that each accepted answer grades as correct.

Shuffling is set per day in the schedule: add `"shuffle": true` to an entry. That puzzle file must carry a `shuffle` block (anchors and a starting order whose correct pairing is unique); files can carry one without being shuffled.

The site shows the puzzle for today's date, or the latest one before it.

## Deploying

`.github/workflows/pages.yml` tests, builds and publishes to GitHub Pages on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

Answers ship inside the puzzle JSON, so anyone who opens the network tab can read them. That's normal for a static daily game.

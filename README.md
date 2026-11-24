# naclodle

A daily linguistics puzzle in the style of NACLO "Rosetta stone" problems. You get a handful of sentences in an unfamiliar language with their English translations, work out the grammar, and translate new sentences both ways.

## Playing

- Three checks per puzzle. Each answer is marked ✓ (right), ≈ (right apart from accents or one word), or ✗.
- One hint, which costs a point.
- On shuffled days the translations start out of order: drag them into place. "Check pairs" locks the correct ones and costs a point.
- Highlighter: pick a colour, then click a word or select part of one to colour every match, in the examples, the questions and your answers. "one" colours only what you click. `a|b` marks where a word splits. Keys 1–9 pick the nth colour, Esc puts it down.
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
| `scripts/generate.ts` | Generator CLI (see below). |
| `scripts/real-puzzle.ts`, `scripts/prompts/` | Has Claude Code write a real-language puzzle. |
| `public/puzzles/` | Puzzle files plus `index.json`, the schedule. |

## Making puzzles

Artificial languages (instant, free):

```bash
npm run generate -- next                    # the next 7 days after the last scheduled puzzle
npm run generate -- next --days 14
npm run generate -- date 2026-12-20         # a specific date (add --days N for a run)
npm run generate -- draft --difficulty 5    # a one-off, not scheduled: play it at #draft-<seed>
npm run generate -- list                    # what's scheduled, without spoilers
```

`--difficulty 1-5` overrides the weekday difficulty (Mon 1 … Sat 5, Sun 4), `--shuffle` / `--no-shuffle` overrides shuffled Saturdays, `--force` replaces existing puzzles. Runs are resumable and Ctrl-C finishes the current puzzle before stopping. Drafts live in `public/puzzles/drafts/` (gitignored).

Real languages (uses your Claude account through Claude Code's headless mode; takes a few minutes):

```bash
npm run real -- Basque --difficulty 4 --theme "shepherds and witches in the Pyrenees"
```

Claude writes and checks the puzzle against dictionaries without showing you its contents; the script then validates it and schedules it on the day after the last scheduled puzzle (or `--date`). The instructions it follows are in `scripts/prompts/real-language-puzzle.md`.

## Adding a puzzle by hand

Write a JSON file matching `Puzzle` in `src/puzzle.ts` into `public/puzzles/`, add `{ "date", "file" }` to `public/puzzles/index.json`, and run `npm test`. The tests check every listed file is valid and that each accepted answer grades as correct.

Shuffling is set per day in the schedule: add `"shuffle": true` to an entry. That puzzle file must carry a `shuffle` block (anchors and a starting order whose correct pairing is unique); files can carry one without being shuffled.

The site shows the puzzle for today's date (the player's local date), or the latest one before it. Nothing needs redeploying day to day: deploy a batch of scheduled puzzles and each day picks itself.

## Deploying

`.github/workflows/pages.yml` tests, builds and publishes to GitHub Pages on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

Answers ship inside the puzzle JSON, so anyone who opens the network tab can read them. That's normal for a static daily game.

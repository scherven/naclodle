# naclodle

A daily linguistics puzzle in the style of NACLO "Rosetta stone" problems. You get a handful of sentences in an unfamiliar language with their English translations, work out the grammar, and translate new sentences both ways.

## Playing

- Three checks per puzzle. Each answer is marked ✓ (right), ≈ (right apart from accents or one word), or ✗.
- One hint, which costs a point.
- On shuffled days the translations start out of order: drag them into place. "Check pairs" locks the correct ones and costs a point.
- Highlighter: pick a colour, then click a word or select part of one to colour every match, in the examples, the questions and your answers. "one" colours only what you click. `a|b` marks where a word splits. Keys 1–9 pick the nth colour, Esc puts it down.
- `#YYYY-MM-DD` in the URL plays an earlier puzzle.
- Stats (played, solved, streak, scores) are kept in the browser's localStorage and shown when a game ends. Streaks count puzzles solved on their own day; drafts don't count.

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
| `scripts/real/`, `scripts/prompts/` | Real-language puzzles: a designer agent plus independent reviewers (see below). |
| `public/puzzles/` | Puzzle files plus `index.json`, the schedule. `shelved/` holds finished puzzles that aren't scheduled; `#shelved-<name>` plays `shelved/<name>.json`. |

## Making puzzles

Artificial languages (instant, free):

```bash
npm run generate -- next                    # the next 7 days after the last scheduled puzzle
npm run generate -- next --days 14
npm run generate -- date 2026-12-20         # a specific date (add --days N for a run)
npm run generate -- draft --difficulty 5    # a one-off, not scheduled: play it at #draft-<seed>
npm run generate -- list                    # what's scheduled, without spoilers
```

`--difficulty 1-5` overrides the weekday difficulty (Mon 1 … Sat 5, Sun 4), `--shuffle` / `--no-shuffle` overrides shuffled Saturdays, `--style clicks` (or any style in `SOUND_STYLES` in `src/generator/phonology.ts`, or plain) picks the sound style, `--force` replaces existing puzzles. Runs are resumable and Ctrl-C finishes the current puzzle before stopping. Drafts live in `public/puzzles/drafts/` (gitignored).

Real languages (uses your Claude account through Claude Code's headless mode; takes 15–40 minutes):

```bash
npm run real -- Basque --difficulty 4 --theme "shepherds and witches in the Pyrenees"
npm run real -- German --difficulty 4 --shuffle --draft      # play at #draft-german, not scheduled
npm run real -- Yoruba --kind numbers                         # a counting-system puzzle
```

A designer agent writes the puzzle; then reviewers that never see its reasoning check it, and whatever they find goes back to the designer (up to `--rounds`, default 3). The puzzle is placed only when a round comes back clean:

- **UniMorph check:** every word form must be in the [UniMorph](https://unimorph.github.io) tables and match its gloss. Forms that aren't need a source from the fact-checker.
- **Back-translator:** sees only the language text, translates it, and flags anything ungrammatical or unnatural. Its English is compared with the puzzle's.
- **Fact-checker:** cites a source for every line, answer and the fact, and lists correct answers that `accepted` is missing.
- **Two blind solvers:** see exactly what the player sees, with the language disguised by a letter cipher so knowing it doesn't help. Both must get both answers (and the pairing, on shuffled days), and their average difficulty rating must be within two of the target.
- **Attacker:** looks for a second answer the data allows.
- **Novelty check:** compares the puzzle with past olympiad problems on the same language.

Nothing printed gives the puzzle away. Working files (spoilers) and every finished step are kept in `research/real-runs/`, so Ctrl-C or a failure loses nothing and the same command resumes. Without `--date` the puzzle goes on the day after the last scheduled one; `--shelve` puts it in `shelved/`. `npm run real -- validate FILE` runs the mechanical checks alone. Without headless Claude, set `NACLODLE_AGENT_RELAY=<folder>`: each agent call is written there as `<id>.request.json` and waits for someone (such as an interactive Claude session using subagents) to write `<id>.response.json`. The prompts are in `scripts/prompts/`.

Past olympiad problems: download NACLO (or IOL) PDFs in a browser into `research/naclo/pdfs/`; naclo.org doesn't serve them to scripts. Then `npm run naclo -- cards` turns each one into an abstract card: what it teaches and its "aha", never its text. Designers read a few cards for style, and the novelty check reads the ones on the same language. `npx tsx scripts/real/unimorph.ts deu paradigm Hund` looks up a table. UniMorph tables and cards stay in the gitignored `research/`.

## Adding a puzzle by hand

Write a JSON file matching `Puzzle` in `src/puzzle.ts` into `public/puzzles/`, add `{ "date", "file" }` to `public/puzzles/index.json`, and run `npm test`. The tests check every listed file is valid and that each accepted answer grades as correct.

Shuffling is set per day in the schedule: add `"shuffle": true` to an entry. That puzzle file must carry a `shuffle` block (anchors and a starting order whose correct pairing is unique); files can carry one without being shuffled.

The site shows the puzzle for today's date (the player's local date), or the latest one before it. Nothing needs redeploying day to day: deploy a batch of scheduled puzzles and each day picks itself.

## Deploying

`.github/workflows/pages.yml` tests, builds and publishes to GitHub Pages on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

Answers ship inside the puzzle JSON, so anyone who opens the network tab can read them. That's normal for a static daily game.

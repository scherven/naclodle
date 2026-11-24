Write one hand-crafted real-language puzzle for naclodle, a daily NACLO-style "Rosetta stone" linguistics puzzle. The player sees example sentences in a language with English translations, works out the grammar, then translates ONE new sentence into English and ONE into the language.

Language: {{LANGUAGE}}
Date: {{DATE}}
Target difficulty (1 easy – 5 hard): {{DIFFICULTY}}
Theme: {{THEME}}
Output file: public/puzzles/{{FILE}}

The person who runs this wants to play the puzzle unspoiled. Your final message must NOT contain any sentence, word, answer or grammar point from the puzzle. Describe it only vaguely, e.g. "8 sentences, medieval theme, difficulty 3", and mention anything you are unsure is correct, again without revealing content.

Read first:
- src/puzzle.ts: the format and validatePuzzle. There must be exactly one toEnglish and one toLang item, and one gloss per whitespace-separated word of each corpus `lang` line, in Leipzig style like "apple-ACC".
- public/puzzles/2026-11-23-turkish.json: the style to match (corpus, hint, per-item explanation, explain.words/grammar/notes/fact).
- src/game/text.ts: grading. It lowercases with the puzzle's locale, strips punctuation and hyphens, and expands English contractions. "near" covers accent slips or one wrong word. `accepted` must list EVERY acceptable answer, including English variants (a/the only where the language leaves it open, present simple vs progressive where both fit, he/she where unmarked, and alternative word orders the language allows).

Design:
- Teach 1–2 things that surprise an English speaker, with a real "aha", solvable uniquely from the data alone without knowing the language. Players may know some of a widely studied language, so pick phenomena that still puzzle them. Harder targets combine more features.
- Theme: specific to the language's culture, whimsical, fantastical or ancient in vibe, with a small story running through the sentences, not unrelated nouns. If a theme is given above, use it. Loanwords are fine EXCEPT English loanwords.
- 6–10 corpus lines. Every rule the test items need appears at least twice, with minimal pairs. The test sentences are not in the corpus. Every word in the test items appears in the corpus, or can be derived by a rule the data shows.
- `keys`: the special characters needed to type the into-language answer (tone-marked vowels, ä ö ü ß, é è ç, and so on). For non-Latin scripts, use the standard romanisation (e.g. pinyin with tone marks, Hepburn) unless the puzzle is about the script.
- `language`: { name, real: true, locale: the BCP 47 tag }. Also set `theme`, `difficulty`, `checks: 3`, `id` (short, unique), `date`, `number` = days since 2026-11-22, and a true, interesting `fact` checked against a web source.

Verify, because mistakes in real languages are embarrassing:
- Check every sentence's grammar, agreement, spelling, tones/accents and word choice against reliable sources (Wiktionary, dictionaries, grammar references) using web search.
- Then solve the puzzle yourself from the data alone, pretending you don't know the language. Confirm both answers are uniquely determined; if not, add data.
- Validate from the repo root:
  npx tsx -e "import {validatePuzzle} from './src/puzzle.ts'; import fs from 'node:fs'; console.log(validatePuzzle(JSON.parse(fs.readFileSync('public/puzzles/{{FILE}}','utf8'))))"
  It must print []. Also confirm with grade() from src/game/text.ts that every accepted answer grades "ok" for its item.

Write only public/puzzles/{{FILE}}. Do not edit public/puzzles/index.json or any code; the calling script schedules the puzzle.

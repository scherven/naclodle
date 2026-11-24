Write one hand-crafted real-language puzzle for naclodle, a daily NACLO-style "Rosetta stone" linguistics puzzle. The player sees example sentences in a language with English translations, works out the grammar, then translates ONE new sentence into English and ONE into the language.

Language: {{LANGUAGE}}
Target difficulty (1 easy – 5 hard): {{DIFFICULTY}}
Theme: {{THEME}}
Write the puzzle to: {{PUZZLE_PATH}}

The person who runs this wants to play the puzzle unspoiled. Your final message must NOT contain any sentence, word, answer or grammar point from the puzzle. End with one vague line, e.g. "8 sentences, medieval theme".

Read first:
- src/puzzle.ts: the format and validatePuzzle. There must be exactly one toEnglish and one toLang item, and one gloss per whitespace-separated word of each corpus `lang` line, in Leipzig style like "apple-ACC" or "the.DAT.SG".
- public/puzzles/2026-11-22-turkish.json: the style to match (corpus, hint, per-item explanation, explain.words/grammar/notes/fact).
- src/game/text.ts: grading. It lowercases with the puzzle's locale, strips punctuation and hyphens, and expands English contractions. "near" covers accent slips or one wrong word. `accepted` must list EVERY acceptable answer, including English variants (a/the only where the language leaves it open, present simple vs progressive where both fit, he/she where unmarked, and alternative word orders the language allows).

{{KIND}}

Design:
- Teach 1–2 things that surprise an English speaker, with a real "aha", solvable uniquely from the data alone without knowing the language. Players may know some of a widely studied language, so pick phenomena that still puzzle them. Harder targets combine more features.
- Theme: specific to the language's culture, whimsical, fantastical or ancient in vibe, with a small story running through the sentences, not unrelated nouns. If a theme is given above, use it. Loanwords are fine EXCEPT English loanwords.
- 6–10 corpus lines. Every rule the test items need appears at least twice, with minimal pairs. The test sentences are not in the corpus. Every word in the test items appears in the corpus, or can be derived by a rule the data shows.
- `keys`: the special characters needed to type the into-language answer (tone-marked vowels, ä ö ü ß, é è ç, and so on). For non-Latin scripts, use the standard romanisation (e.g. pinyin with tone marks, Hepburn) unless the puzzle is about the script.
- `language`: { name, real: true, locale: the BCP 47 tag }. Also set `theme`, `difficulty`, `checks: 3` and a true, interesting `fact` checked against a web source. Leave `id`, `date` and `number` as placeholders ("x", "2000-01-01", 0): the calling script fills them in.

{{SHUFFLE}}

{{UNIMORPH}}

{{NACLO}}

Verify, because mistakes in real languages are embarrassing:
- Check every sentence's grammar, agreement, spelling, tones/accents and word choice against reliable sources (Wiktionary, dictionaries, grammar references) using web search.
- Then solve the puzzle yourself from the data alone, pretending you don't know the language. Confirm both answers are uniquely determined; if not, add data.
- Validate from the repo root: npx tsx scripts/real/pipeline.ts validate {{PUZZLE_PATH}}
  It must print "ok".

After you finish, independent reviewers who never see your reasoning will back-translate it, fact-check it with sources, solve it blind with the language disguised by a letter cipher, and try to find a second answer the data allows. Anything they find comes back to you.

Write only {{PUZZLE_PATH}}. Do not edit any other file.

{{REVISION}}

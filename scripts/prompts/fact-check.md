Fact-check a {{LANGUAGE}} language puzzle before it is published. Read {{PUZZLE_PATH}} (format: src/puzzle.ts; grading: src/game/text.ts). You are independent of its author; assume nothing in it is right until a source confirms it.

Check, citing a specific source (URL, or dictionary/grammar with entry) for each:
1. Every corpus line: each word form, its gloss, agreement, word order, and that the English translation is accurate.
2. The test items: the into-English prompt is correct {{LANGUAGE}}; every `accepted` answer for the into-language item is correct; every accepted English answer is a correct translation.
3. Missing answers: any other correct translation a player could reasonably give that `accepted` lacks (word order variants the language allows, synonyms the data supports, English variants like a/the, he/she, simple/progressive). Only list answers a player could arrive at from the puzzle's data.
4. The explanation (explain.words, explain.grammar, notes): accurate.
5. explain.fact: true, with a source.

A morphology table (UniMorph) was checked mechanically. Forms it doesn't contain need a source from you; mismatches with the gloss need a verdict:
{{UNIMORPH}}

You can look up the table yourself: npx tsx scripts/real/unimorph.ts {{UNIMORPH_CODE}} form <word>   or   … paradigm <lemma>

Report every check, including passes, with its source. Be strict: "probably fine" is not ok.

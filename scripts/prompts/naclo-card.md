Read {{TEXT_FILE}}: the text of a linguistics olympiad PDF (NACLO, IOL or similar). It may hold one problem or a whole round, with or without solutions.

For each problem in it, write one abstract card describing HOW the problem works, for a designer who will write new, different puzzles. The cards must not reproduce the problem: no sentences, no words or forms from the language, no answers, no quoted text. Describe in your own words, at the level of "verbs agree with the object's noun class; the solver must spot that the prefix changes with the object, not the subject".

Fields:
- title: the problem's title.
- year: the competition year if stated, else null.
- language: the language name, or "none" for problems without a natural language (e.g. pure computational problems).
- family: the language family if stated or well known, else null.
- kind: rosetta (translate sentences/phrases both ways), numbers (a counting system), morphology (word forms without sentences), phonology (sound rules), script (a writing system), semantics (meanings, kinship, colours), computational (algorithms, formal grammars), or other.
- phenomena: 1 to 5 short labels for the grammar or system being taught, e.g. "split ergativity", "vowel harmony", "base-20 numerals", "inclusive/exclusive we".
- aha: one or two sentences on the insight that cracks it.
- layout: one sentence on how the data is presented (how many items, matching vs translation, any trick like shuffled lines or missing forms).
- difficulty: 1 (easy round 1) to 5 (hard round 2), your estimate.

Skip anything that is not a problem (cover pages, rules, answer sheets). If the file has no problems, return an empty list.

/** The conlang realiser: Grammar + Meaning -> words with glosses. One engine for corpus, tests and competitors. */

import { holds, type Grammar, type Morpheme, type Role, type WordContext } from "./grammar";
import { isAnimate, isHuman } from "./lexicon";
import type { Meaning, NounPhrase } from "./meaning";
import { isFrontWord, resolveHarmony } from "./phonology";

export interface AppliedMorpheme { morpheme: Morpheme; form: string }

export interface RealisedWord {
  form: string;
  /** Form with morpheme boundaries marked ("pemu-ka"), for explanations. */
  segmented: string;
  gloss: string;
  /** Lexeme id for stems, null for particles. */
  lexeme: string | null;
  applied: AppliedMorpheme[];
}

type ClauseContext = Omit<WordContext, "role" | "plural" | "definite" | "animate" | "human" | "firstNoun" | "frontStem">;

function clauseContext(meaning: Meaning): ClauseContext {
  const subjectPlural = meaning.subject.plural;
  const objectPlural = !!meaning.object?.plural;
  return {
    transitive: !!meaning.object,
    past: meaning.past,
    negative: meaning.negative,
    subjectPlural,
    objectPlural,
    absolutivePlural: meaning.object ? objectPlural : subjectPlural,
    anyPlural: subjectPlural || objectPlural,
  };
}

const firstConsonantVowel = (word: string) => /^[^aeiouäöü]*[aeiouäöü]/.exec(word)?.[0] ?? word.slice(0, 1);
const firstConsonantVowelConsonant = (word: string) =>
  /^[^aeiouäöü]*[aeiouäöü][^aeiouäöü]?/.exec(word)?.[0] ?? word.slice(0, 1);
const firstConsonant = (word: string) => /^[^aeiouäöü]*/.exec(word)?.[0] ?? "";

/** Apply the host's morphemes (inner slots first) to a stem. Particles are returned separately. */
function inflect(grammar: Grammar, stem: string, stemGloss: string, lexeme: string, host: "noun" | "verb", context: WordContext) {
  let form = stem;
  let segmented = stem;
  let gloss = stemGloss;
  const applied: AppliedMorpheme[] = [];
  const particles: { word: RealisedWord; side: "before" | "after" }[] = [];
  const front = grammar.harmonyCondition ? holds(grammar.harmonyCondition, context) : false;
  const harmonise = (affix: string) => resolveHarmony(grammar.phonology, affix, front);
  const morphemes = grammar.morphemes
    .filter(morpheme => morpheme.host === host && holds(morpheme.condition, context))
    .sort((first, second) => first.slot - second.slot);
  for (const morpheme of morphemes) {
    const exponent = morpheme.exponent;
    switch (exponent.kind) {
      case "suffix": {
        const suffix = harmonise(exponent.form);
        form += suffix; segmented += "-" + suffix; gloss = `${gloss}-${morpheme.gloss}`;
        applied.push({ morpheme, form: suffix });
        break;
      }
      case "prefix":
        form = exponent.form + form; segmented = exponent.form + "-" + segmented; gloss = `${morpheme.gloss}-${gloss}`;
        applied.push({ morpheme, form: exponent.form });
        break;
      case "circumfix": {
        const suffix = harmonise(exponent.suffix);
        form = exponent.prefix + form + suffix; segmented = `${exponent.prefix}-${segmented}-${suffix}`; gloss = `${morpheme.gloss}-${gloss}-${morpheme.gloss}`;
        applied.push({ morpheme, form: `${exponent.prefix}…${suffix}` });
        break;
      }
      case "reduplication": {
        const copy = exponent.copy === "full" ? form + "-"
          : exponent.copy === "CV" ? firstConsonantVowel(form) : firstConsonantVowelConsonant(form);
        form = copy + form; segmented = (copy.endsWith("-") ? copy : copy + "~") + segmented; gloss = `${morpheme.gloss}~${gloss}`;
        applied.push({ morpheme, form: copy });
        break;
      }
      case "consonantCopyPrefix": {
        const copy = firstConsonant(form) + exponent.vowel;
        form = copy + form; segmented = copy + "~" + segmented; gloss = `${morpheme.gloss}~${gloss}`;
        applied.push({ morpheme, form: copy });
        break;
      }
      case "particle":
        particles.push({
          word: { form: exponent.form, segmented: exponent.form, gloss: morpheme.gloss, lexeme: null, applied: [{ morpheme, form: exponent.form }] },
          side: exponent.side,
        });
        break;
    }
  }
  return { word: { form, segmented, gloss, lexeme, applied }, particles };
}

export function realise(grammar: Grammar, meaning: Meaning): RealisedWord[] {
  const clause = clauseContext(meaning);
  const transitive = !!meaning.object;
  const subjectRole: Role = transitive ? "A" : "S";
  // Linear positions of S(ubject), O(bject), V(erb).
  const order = transitive ? grammar.wordOrder : grammar.intransitiveSubjectFirst ? "SV" : "VS";
  const subjectFirst = !transitive || order.indexOf("S") < order.indexOf("O");

  const nounWord = (phrase: NounPhrase, role: Role, firstNoun: boolean) => {
    const noun = grammar.lexicon.nouns.find(entry => entry.id === phrase.noun);
    if (!noun) throw new Error(`unknown noun ${phrase.noun}`);
    const context: WordContext = {
      ...clause, role, plural: phrase.plural, definite: phrase.definite, animate: isAnimate(noun),
      human: isHuman(noun), firstNoun, frontStem: isFrontWord(grammar.phonology, noun.form),
    };
    return inflect(grammar, noun.form, noun.english.singular, noun.id, "noun", context).word;
  };

  const verb = grammar.lexicon.verbs.find(entry => entry.id === meaning.verb);
  if (!verb) throw new Error(`unknown verb ${meaning.verb}`);
  const verbContext: WordContext = {
    ...clause, role: null, plural: false, definite: false, animate: false, human: false, firstNoun: false,
    frontStem: isFrontWord(grammar.phonology, verb.form),
  };
  const inflectedVerb = inflect(grammar, verb.form, verb.english.base, verb.id, "verb", verbContext);
  const verbGroup = [
    ...inflectedVerb.particles.filter(particle => particle.side === "before").map(particle => particle.word),
    inflectedVerb.word,
    ...inflectedVerb.particles.filter(particle => particle.side === "after").map(particle => particle.word),
  ];

  const slots: Record<string, RealisedWord[]> = {
    S: [nounWord(meaning.subject, subjectRole, subjectFirst)],
    O: meaning.object ? [nounWord(meaning.object, "P", !subjectFirst)] : [],
    V: verbGroup,
  };
  return [...order].flatMap(letter => slots[letter]);
}

/** Sentence as a comparable string (lowercase, single spaces, no punctuation). */
export const sentenceText = (words: RealisedWord[]) => words.map(word => word.form).join(" ");

/** Sentence as displayed: capitalised with a full stop. */
export function displaySentence(words: RealisedWord[]): string {
  const text = sentenceText(words);
  return text[0].toUpperCase() + text.slice(1) + ".";
}

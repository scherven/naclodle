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
  /** Lexeme id for stems ("adj:ancient", "adv:yesterday" for modifiers), null for particles. */
  lexeme: string | null;
  applied: AppliedMorpheme[];
}

type ClauseContext = Pick<WordContext,
  "transitive" | "past" | "negative" | "subjectPlural" | "objectPlural" | "absolutivePlural" | "anyPlural" | "pastTimeWord">;

function clauseContext(grammar: Grammar, meaning: Meaning): ClauseContext {
  const subjectPlural = meaning.subject.plural;
  const objectPlural = !!meaning.object?.plural;
  const adverb = meaning.adverb ? grammar.lexicon.adverbs.find(entry => entry.id === meaning.adverb) : undefined;
  return {
    transitive: !!meaning.object,
    past: meaning.past,
    negative: meaning.negative,
    subjectPlural,
    objectPlural,
    absolutivePlural: meaning.object ? objectPlural : subjectPlural,
    anyPlural: subjectPlural || objectPlural,
    pastTimeWord: !!adverb?.requiresPast,
  };
}

const VOWEL = "aeiouäöü";
const firstConsonantVowel = (word: string) => new RegExp(`^[^${VOWEL}]*[${VOWEL}]`).exec(word)?.[0] ?? word.slice(0, 1);
const firstConsonantVowelConsonant = (word: string) =>
  new RegExp(`^[^${VOWEL}]*[${VOWEL}][^${VOWEL}]?`).exec(word)?.[0] ?? word.slice(0, 1);
const firstConsonant = (word: string) => new RegExp(`^[^${VOWEL}]*`).exec(word)?.[0] ?? "";

interface Inflected { word: RealisedWord; particles: { word: RealisedWord; side: "before" | "after" }[] }

/**
 * Apply the given morphemes (inner slots first) to a stem. `context` decides harmony; the caller has
 * already decided which morphemes apply to this word. Particles are returned separately.
 */
function inflect(grammar: Grammar, stem: string, stemGloss: string, lexeme: string, morphemes: Morpheme[], context: WordContext): Inflected {
  let form = stem;
  let segmented = stem;
  let gloss = stemGloss;
  const applied: AppliedMorpheme[] = [];
  const particles: Inflected["particles"] = [];
  const front = grammar.harmonyCondition ? holds(grammar.harmonyCondition, context) : false;
  const harmonise = (affix: string) => resolveHarmony(grammar.phonology, affix, front);
  for (const morpheme of [...morphemes].sort((first, second) => first.slot - second.slot)) {
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
        form = exponent.prefix + form + suffix; segmented = `${exponent.prefix}-${segmented}-${suffix}`;
        gloss = `${morpheme.gloss}-${gloss}-${morpheme.gloss}`;
        applied.push({ morpheme, form: `${exponent.prefix}…${suffix}` });
        break;
      }
      case "reduplication": {
        const copy = exponent.copy === "full" ? form + "-"
          : exponent.copy === "CV" ? firstConsonantVowel(form) : firstConsonantVowelConsonant(form);
        form = copy + form; segmented = (copy.endsWith("-") ? copy : copy + "~") + segmented;
        gloss = `${morpheme.gloss}~${gloss}`;
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

const isPrefixLike = (morpheme: Morpheme) => morpheme.exponent.kind === "prefix" || morpheme.exponent.kind === "consonantCopyPrefix";
const isStemProcess = (morpheme: Morpheme) => morpheme.exponent.kind === "reduplication";

/** Words of one noun phrase: [possessor] + (adjective, noun in the grammar's order), or the mirror image. */
function nounPhraseWords(grammar: Grammar, clause: ClauseContext, phrase: NounPhrase, role: Role, firstNoun: boolean): RealisedWord[] {
  const noun = grammar.lexicon.nouns.find(entry => entry.id === phrase.noun);
  if (!noun) throw new Error(`unknown noun ${phrase.noun}`);
  const headContext: WordContext = {
    ...clause, role, plural: phrase.plural, definite: phrase.definite, animate: isAnimate(noun), human: isHuman(noun),
    firstNoun, frontStem: isFrontWord(grammar.phonology, noun.form), possessor: false, possessed: !!phrase.possessor,
  };
  const nounMorphemes = grammar.morphemes.filter(morpheme => morpheme.host === "noun" && holds(morpheme.condition, headContext));
  const adjective = phrase.adjective ? grammar.lexicon.adjectives.find(entry => entry.id === phrase.adjective) : undefined;
  if (phrase.adjective && !adjective) throw new Error(`unknown adjective ${phrase.adjective}`);

  let group: RealisedWord[];
  if (!adjective || !grammar.adjectives) {
    group = [inflect(grammar, noun.form, noun.english.singular, noun.id, nounMorphemes, headContext).word];
  } else {
    const rules = grammar.adjectives;
    const adjectiveFirst = rules.position === "before";
    const adjectiveContext = { ...headContext, frontStem: isFrontWord(grammar.phonology, adjective.form) };
    let onNoun = nounMorphemes;
    let onAdjective: Morpheme[] = [];
    if (rules.marking === "concord") onAdjective = nounMorphemes.filter(morpheme => rules.concord.includes(morpheme.id) && !isStemProcess(morpheme));
    if (rules.marking === "edge") {
      // Suffixes go on the last word, prefixes on the first; reduplication stays on the noun.
      const adjectiveGetsSuffixes = adjectiveFirst === false;
      onAdjective = nounMorphemes.filter(morpheme => !isStemProcess(morpheme) && (isPrefixLike(morpheme) ? adjectiveFirst : adjectiveGetsSuffixes));
      onNoun = nounMorphemes.filter(morpheme => !onAdjective.includes(morpheme));
    }
    const nounWord = inflect(grammar, noun.form, noun.english.singular, noun.id, onNoun, headContext).word;
    const adjectiveWord = inflect(grammar, adjective.form, adjective.id, `adj:${adjective.id}`, onAdjective, adjectiveContext).word;
    group = adjectiveFirst ? [adjectiveWord, nounWord] : [nounWord, adjectiveWord];
  }

  if (!phrase.possessor) return group;
  const owner = grammar.lexicon.nouns.find(entry => entry.id === phrase.possessor!.noun);
  if (!owner) throw new Error(`unknown noun ${phrase.possessor.noun}`);
  const ownerContext: WordContext = {
    ...clause, role: null, plural: phrase.possessor.plural, definite: true, animate: isAnimate(owner), human: isHuman(owner),
    firstNoun: false, frontStem: isFrontWord(grammar.phonology, owner.form), possessor: true, possessed: false,
  };
  const ownerMorphemes = grammar.morphemes.filter(morpheme => morpheme.host === "noun" && holds(morpheme.condition, ownerContext));
  const ownerWord = inflect(grammar, owner.form, owner.english.singular, owner.id, ownerMorphemes, ownerContext).word;
  return grammar.possessorPosition === "after" ? [...group, ownerWord] : [ownerWord, ...group];
}

export function realise(grammar: Grammar, meaning: Meaning): RealisedWord[] {
  const clause = clauseContext(grammar, meaning);
  const transitive = !!meaning.object;
  const subjectRole: Role = transitive ? "A" : "S";
  // Linear positions of S(ubject), O(bject), V(erb).
  const order = transitive ? grammar.wordOrder : grammar.intransitiveSubjectFirst ? "SV" : "VS";
  const subjectFirst = !transitive || order.indexOf("S") < order.indexOf("O");

  const verb = grammar.lexicon.verbs.find(entry => entry.id === meaning.verb);
  if (!verb) throw new Error(`unknown verb ${meaning.verb}`);
  const verbContext: WordContext = {
    ...clause, role: null, plural: false, definite: false, animate: false, human: false, firstNoun: false,
    frontStem: isFrontWord(grammar.phonology, verb.form), possessor: false, possessed: false,
  };
  const verbMorphemes = grammar.morphemes.filter(morpheme => morpheme.host === "verb" && holds(morpheme.condition, verbContext));
  const inflectedVerb = inflect(grammar, verb.form, verb.english.base, verb.id, verbMorphemes, verbContext);
  const verbGroup = [
    ...inflectedVerb.particles.filter(particle => particle.side === "before").map(particle => particle.word),
    inflectedVerb.word,
    ...inflectedVerb.particles.filter(particle => particle.side === "after").map(particle => particle.word),
  ];

  let adverbWord: RealisedWord | null = null;
  if (meaning.adverb) {
    const adverb = grammar.lexicon.adverbs.find(entry => entry.id === meaning.adverb);
    if (!adverb) throw new Error(`unknown adverb ${meaning.adverb}`);
    adverbWord = { form: adverb.form, segmented: adverb.form, gloss: adverb.english.replace(/ /g, "."), lexeme: `adv:${adverb.id}`, applied: [] };
  }
  const position = grammar.adverbPosition ?? "final";
  const slots: Record<string, RealisedWord[]> = {
    S: nounPhraseWords(grammar, clause, meaning.subject, subjectRole, subjectFirst),
    O: meaning.object ? nounPhraseWords(grammar, clause, meaning.object, "P", !subjectFirst) : [],
    V: adverbWord && position === "beforeVerb" ? [adverbWord, ...verbGroup]
      : adverbWord && position === "afterVerb" ? [...verbGroup, adverbWord] : verbGroup,
  };
  const words = [...order].flatMap(letter => slots[letter]);
  if (adverbWord && position === "initial") words.unshift(adverbWord);
  if (adverbWord && position === "final") words.push(adverbWord);
  return words;
}

/** Sentence as a comparable string (lowercase, single spaces, no punctuation). */
export const sentenceText = (words: RealisedWord[]) => words.map(word => word.form).join(" ");

/** Sentence as displayed: capitalised with a full stop. */
export function displaySentence(words: RealisedWord[]): string {
  const text = sentenceText(words);
  return text[0].toUpperCase() + text.slice(1) + ".";
}

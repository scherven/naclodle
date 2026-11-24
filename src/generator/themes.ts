/**
 * Themed vocabularies. Each puzzle draws its lexicon from one theme, a single scene with a small cast,
 * so the sentences read like story beats ("The envoy did not bless the shrines.").
 *
 * Compact notation, parsed by parseTheme():
 *   nouns:      "gloss:class[:plural]"   class = p person, b beast, s spirit/creature, t thing, l place
 *   verbs:      "base[/past]:agents>patients" (transitive) or "base[/past]:subjects" (intransitive);
 *               agents/patients/subjects are strings of class letters, "=bell|horn" lists specific objects.
 *   adjectives: "gloss:classes" (which noun classes it can describe)
 * Rules: no noun whose plural equals its singular (sheep), no verb whose past equals its base (hit),
 * no word that is both a noun and a verb in the same theme.
 */

import { makeVerbEnglish, pluralOf, type NounEnglish, type VerbEnglish } from "./english";

/** p person, b beast, s spirit/creature, t thing, l place. */
export type SemanticClass = "p" | "b" | "s" | "t" | "l";

export interface ThemeNoun { id: string; semanticClass: SemanticClass; english: NounEnglish }
export interface ThemeVerb {
  id: string;
  transitive: boolean;
  /** Classes allowed as subject (agent or lone subject). */
  agents: SemanticClass[];
  /** Classes allowed as object (empty for intransitives). */
  patients: SemanticClass[];
  /** Specific nouns allowed as object, for verbs that only make sense with a few ("ring" the bell). */
  patientIds: string[];
  english: VerbEnglish;
}
export interface ThemeAdjective { id: string; describes: SemanticClass[] }
export interface Theme {
  id: string;
  title: string;
  nouns: ThemeNoun[];
  verbs: ThemeVerb[];
  adjectives: ThemeAdjective[];
}

/** Adverbs are shared by all themes. "yesterday" forces past tense, so it needs a tense contrast. */
export interface Adverb { id: string; english: string; time: boolean; requiresPast: boolean }
export const ADVERBS: Adverb[] = [
  { id: "yesterday", english: "yesterday", time: true, requiresPast: true },
  { id: "at-night", english: "at night", time: true, requiresPast: false },
  { id: "at-dawn", english: "at dawn", time: true, requiresPast: false },
  { id: "quietly", english: "quietly", time: false, requiresPast: false },
  { id: "again", english: "again", time: false, requiresPast: false },
];

interface RawTheme { id: string; title: string; nouns: string; verbs: string; adjectives: string }

const RAW_THEMES: RawTheme[] = [
  { id: "elven-cliffs", title: "elves defending a cliff tower",
    nouns: "elf:p:elves, archer:p, queen:p, eagle:b, wolf:b:wolves, sword:t, bow:t, tower:l",
    verbs: "guard:pb>=tower|queen|sword, carry:p>=sword|bow, find/found:pb>=sword|bow|queen, follow:pb>pb, drop/dropped:p>=sword|bow, sleep/slept:pb, sing/sang:p, wait:pb",
    adjectives: "silver:t, tall:pl, grey:b" },
  { id: "temple-guard", title: "priests and soldiers guarding a temple",
    nouns: "priest:p, soldier:p, navigator:p, king:p, shield:t, crown:t, temple:l, altar:t",
    verbs: "bless:p>=king|soldier|shield|temple, carry:p>=shield|crown, guard:p>=temple|altar|king|crown, praise:p>=king|priest, polish:p>=shield|crown|altar, kneel/knelt:p, pray:p, weep/wept:p",
    adjectives: "golden:t, holy:tl, young:p" },
  { id: "scribe-king", title: "a scribe at the king's gate",
    nouns: "scribe:p, king:p, horse:b, rope:t, spear:t, scroll:t, gate:l, messenger:p",
    verbs: "copy:p>=scroll, carry:pb>=scroll|spear|rope, summon:p>=scribe|messenger, follow:pb>pb, send/sent:p>=messenger|scroll|horse, flee/fled:pb, laugh:p, rest:pb",
    adjectives: "old:pt, swift:b, long:t" },
  { id: "forbidden-forest", title: "a forbidden forest",
    nouns: "ox:b:oxen, guard:p, smith:p, fairy:s, owl:b, axe:t, anvil:t, grove:l",
    verbs: "pull:b>=axe|anvil, chase:pbs>pb, enchant:s>=guard|smith|ox|axe, fear:pb>=fairy, find/found:pbs>=axe|anvil|grove, dance:ps, vanish:s, wander:pbs",
    adjectives: "forbidden:l, ancient:tl, wild:bs" },
  { id: "augur-envoy", title: "an augur and an envoy at a shrine",
    nouns: "singer:p, augur:p, envoy:p, ancestor:s, messenger:p, flute:t, omen:t, shrine:l",
    verbs: "summon:p>=ancestor|envoy|messenger, bless:ps>=envoy|shrine|flute, greet:p>=envoy|augur|ancestor, hear/heard:ps>=singer|flute|omen, ignore:p>=omen|augur, sing/sang:ps, arrive:p, weep/wept:ps",
    adjectives: "ancient:st, sacred:tl, silent:ps" },
  { id: "griffin-stables", title: "the griffin stables",
    nouns: "griffin:b, mule:b, groom:p, rider:p, shrine:l, bath:l, saddle:t, bucket:t",
    verbs: "ride/rode:p>b, wash:p>=griffin|mule|saddle, feed/fed:p>b, carry:b>=rider|groom|saddle, kick:b>=groom|rider|bucket, fly/flew:b, bathe:pb, rest:pb",
    adjectives: "muddy:bt, proud:pb, heavy:t" },
  { id: "captain-spirits", title: "a captain and the harbour spirits",
    nouns: "captain:p, sailor:p, spirit:s, guardian:s, lantern:t, anchor:t, stable:l, harbour:l",
    verbs: "lead/led:ps>=sailor|captain|spirit, haunt:s>=captain|sailor|harbour|stable, lift:p>=lantern|anchor, guard:s>=harbour|captain, warn:ps>=captain|sailor, whisper:ps, vanish:s, wait:p",
    adjectives: "pale:s, rusty:t, drowned:ps" },
  { id: "dragon-hoard", title: "a dragon's hoard",
    nouns: "dragon:b, knight:p, thief:p:thieves, princess:p, goblet:t, jewel:t, cave:l",
    verbs: "steal/stole:p>=goblet|jewel, wake/woke:pb>=dragon|knight|princess, guard:b>=goblet|jewel|cave|princess, defeat:p>=dragon|thief, roar:b, hide/hid:pb, flee/fled:pb",
    adjectives: "golden:t, sleeping:b, brave:p" },
  { id: "witch-hut", title: "a witch's hut",
    nouns: "witch:p:witches, raven:b, toad:b, cauldron:t, broom:t, potion:t, hut:l, apprentice:p",
    verbs: "stir/stirred:p>=cauldron|potion, brew:p>=potion, curse:p>=apprentice|raven|toad, feed/fed:p>=raven|toad, chase:pb>=toad|raven|apprentice, cackle:p, croak:b, sleep/slept:pb",
    adjectives: "black:bt, bitter:t, clumsy:p" },
  { id: "desert-caravan", title: "a desert caravan",
    nouns: "merchant:p, camel:b, scout:p, sultan:p, carpet:t, jar:t, oasis:l:oases, tent:l",
    verbs: "sell/sold:p>=camel|carpet|jar, pack/packed:p>=carpet|jar|tent, lead/led:p>=camel|merchant, guard:p>=tent|jar|oasis|sultan, rest:pb, drink/drank:pb, shout:p",
    adjectives: "thirsty:pb, red:t, distant:l" },
  { id: "sea-voyage", title: "a navigator's sea voyage",
    nouns: "navigator:p, sailor:p, whale:b, gull:b, net:t, map:t, island:l, ship:t",
    verbs: "steer:p>=ship, mend:p>=net|map|ship, spot/spotted:pb>=whale|island|ship, follow:pb>=ship|whale|navigator, swim/swam:pb, drift:t, sing/sang:p",
    adjectives: "torn:t, white:b, distant:l" },
  { id: "mountain-monastery", title: "a mountain monastery",
    nouns: "monk:p, abbot:p, yak:b, bell:t, scroll:t, lamp:t, peak:l, pilgrim:p",
    verbs: "ring/rang:p>=bell, light/lit:p>=lamp, copy:p>=scroll, bless:p>=pilgrim|yak|monk, climb:pb>=peak, feed/fed:p>=yak|pilgrim, greet:p>=pilgrim|abbot, chant:p, sleep/slept:pb",
    adjectives: "old:pbt, bronze:t, snowy:l" },
  { id: "ancient-tomb", title: "explorers in an ancient tomb",
    nouns: "pharaoh:p, mummy:s:mummies, jackal:b, scarab:b, tomb:l, urn:t, mask:t, explorer:p",
    verbs: "open:p>=tomb|urn, seal:ps>=tomb|urn, curse:s>=explorer|jackal, wake/woke:p>=mummy|jackal|pharaoh, guard:bs>=tomb|urn|mask, wander:pbs, howl:b",
    adjectives: "ancient:tls, golden:t, sacred:bt" },
  { id: "royal-hunt", title: "a royal hunt",
    nouns: "hunter:p, prince:p, hound:b, stag:b, boar:b, horn:t, arrow:t, meadow:l",
    verbs: "chase:pb>=stag|boar, track:pb>=stag|boar, blow/blew:p>=horn, shoot/shot:p>=stag|boar, catch/caught:pb>=stag|boar|arrow, run/ran:pb, hide/hid:pb",
    adjectives: "young:pb, wild:b, sharp:t" },
  { id: "harvest-festival", title: "a village harvest festival",
    nouns: "farmer:p, piper:p, goose:b:geese, goat:b, drum:t, basket:t, barn:l, field:l",
    verbs: "carry:p>=drum|basket|goose, play:p>=drum, chase:pb>=goose|goat|piper, milk:p>=goat, fill:p>=basket|barn, dance:p, sing/sang:p, laugh:p",
    adjectives: "full:tl, noisy:pb, old:pbt" },
  { id: "underworld-ferry", title: "the ferry of the underworld",
    nouns: "ferryman:p:ferrymen, ghost:s, hound:b, coin:t, oar:t, river:l, gate:l, judge:p",
    verbs: "pay/paid:ps>=ferryman|judge, carry:ps>=coin|oar|ghost, cross:ps>=river, guard:bp>=gate|river|judge, weep/wept:ps, wait:ps, howl:b",
    adjectives: "pale:s, silver:t, dark:l" },
  { id: "sky-giants", title: "giants above the clouds",
    nouns: "giant:p, shepherd:p, sheepdog:b, harp:t, castle:l, hen:b",
    verbs: "climb:p>=castle, steal/stole:p>=harp|hen, guard:pb>=harp|hen|castle, play:p>=harp, wake/woke:pb>=giant|shepherd|sheepdog, snore:p, stomp:p, cackle:b",
    adjectives: "golden:bt, sleepy:pb, huge:pl" },
];

function parseTheme(rawTheme: RawTheme): Theme {
  const entries = (list: string) => list.split(",").map(entry => entry.trim());
  const nouns = entries(rawTheme.nouns).map(entry => {
    const [gloss, semanticClass, irregularPlural] = entry.split(":");
    return {
      id: gloss,
      semanticClass: semanticClass as SemanticClass,
      english: { singular: gloss, plural: irregularPlural ?? pluralOf(gloss) },
    };
  });
  const verbs = entries(rawTheme.verbs).map(entry => {
    const [forms, roles] = entry.split(":");
    const [base, irregularPast] = forms.split("/");
    const [agentSpec, patientSpec] = roles.split(">");
    const patientIds = patientSpec?.startsWith("=") ? patientSpec.slice(1).split("|") : [];
    return {
      id: base,
      transitive: patientSpec !== undefined,
      agents: [...agentSpec] as SemanticClass[],
      patients: patientSpec && !patientSpec.startsWith("=") ? [...patientSpec] as SemanticClass[] : [],
      patientIds,
      english: makeVerbEnglish(base, irregularPast),
    };
  });
  const adjectives = entries(rawTheme.adjectives).map(entry => {
    const [id, classes] = entry.split(":");
    return { id, describes: [...classes] as SemanticClass[] };
  });
  return { id: rawTheme.id, title: rawTheme.title, nouns, verbs, adjectives };
}

export const THEMES: Theme[] = RAW_THEMES.map(parseTheme);

export const allowsAgent = (verb: ThemeVerb, noun: ThemeNoun) => verb.agents.includes(noun.semanticClass);
export const allowsPatient = (verb: ThemeVerb, noun: ThemeNoun) =>
  verb.transitive && (verb.patients.includes(noun.semanticClass) || verb.patientIds.includes(noun.id));
export const allowsAdjective = (adjective: ThemeAdjective, noun: ThemeNoun) => adjective.describes.includes(noun.semanticClass);
/** Rulers can "have" people ("the king's messenger"); otherwise possessed nouns are beasts, things or places. */
const RULERS = new Set(["king", "queen", "sultan", "pharaoh", "captain", "witch", "abbot", "prince", "princess", "judge"]);

/** Possessors are people or spirits ("the envoy's flute", "the ghost's coin"). */
export function canPossess(possessor: ThemeNoun, possessed: ThemeNoun): boolean {
  if (possessor.id === possessed.id || !["p", "s"].includes(possessor.semanticClass)) return false;
  if (possessed.semanticClass === "p" || possessed.semanticClass === "s") return RULERS.has(possessor.id) && possessed.semanticClass === "p";
  return true;
}

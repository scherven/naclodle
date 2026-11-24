/**
 * Themed vocabularies. Each puzzle draws its lexicon from one theme so the sentences read like
 * small story beats ("The envoy did not bless the shrines.").
 *
 * Compact notation, parsed by parseTheme():
 *   nouns: "gloss:class[:plural]"   class = p person, b beast, s spirit/creature, t thing, l place
 *   verbs: "base[/past]:agents>patients" (transitive) or "base[/past]:subjects" (intransitive)
 *          agents/patients/subjects are strings of class letters; "=bell|horn" lists specific objects.
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
export interface Theme { id: string; title: string; nouns: ThemeNoun[]; verbs: ThemeVerb[] }

interface RawTheme { id: string; title: string; nouns: string; verbs: string }

const RAW_THEMES: RawTheme[] = [
  { id: "elven-cliffs", title: "The elves of the high cliffs",
    nouns: "elf:p:elves, archer:p, queen:p, eagle:b, wolf:b:wolves, sword:t, bow:t, tower:l",
    verbs: "guard:pb>pl, carry:p>=sword|bow, find/found:pb>pbt, follow:pb>pb, drop/dropped:p>=sword|bow, sleep/slept:pb, sing/sang:p, wait:pb" },
  { id: "temple-guard", title: "Priests and soldiers of the temple",
    nouns: "priest:p, soldier:p, navigator:p, king:p, shield:t, crown:t, temple:l, altar:t",
    verbs: "bless:p>ptl, carry:p>=shield|crown, guard:p>pl, praise:p>p, polish:p>=shield|crown|altar, kneel/knelt:p, pray:p, weep/wept:p" },
  { id: "scribe-king", title: "The scribe at the king's gate",
    nouns: "scribe:p, king:p, horse:b, rope:t, spear:t, scroll:t, gate:l, messenger:p",
    verbs: "copy:p>=scroll, carry:pb>t, summon:p>p, follow:pb>pb, send/sent:p>=messenger|scribe|horse|scroll, flee/fled:pb, laugh:p, rest:pb" },
  { id: "forbidden-forest", title: "The forbidden forest",
    nouns: "ox:b:oxen, guard:p, smith:p, fairy:s, owl:b, axe:t, anvil:t, grove:l",
    verbs: "pull:pb>t, chase:pbs>pb, enchant:s>pbt, fear:pb>s, find/found:pbs>pbt, dance:ps, vanish:s, wander:pbs" },
  { id: "augur-envoy", title: "The augur and the envoy",
    nouns: "singer:p, augur:p, envoy:p, ancestor:s, messenger:p, flute:t, omen:t, shrine:l",
    verbs: "summon:p>ps, bless:ps>ptl, greet:p>ps, hear/heard:ps>=singer|flute|omen|messenger, ignore:ps>=omen|envoy|messenger|augur, sing/sang:ps, arrive:p, weep/wept:ps" },
  { id: "griffin-stables", title: "The griffin stables",
    nouns: "griffin:b, mule:b, groom:p, rider:p, shrine:l, bath:l, saddle:t, bucket:t",
    verbs: "ride/rode:p>b, wash:p>=griffin|mule|saddle|bucket, feed/fed:p>b, carry:b>=rider|groom|saddle|bucket, kick:b>=groom|rider|bucket, fly/flew:b, bathe:pb, rest:pb" },
  { id: "captain-spirits", title: "The captain and the harbour spirits",
    nouns: "captain:p, sailor:p, spirit:s, guardian:s, lantern:t, anchor:t, stable:l, harbour:l",
    verbs: "lead/led:ps>p, haunt:s>pl, lift:p>=lantern|anchor, guard:s>pl, warn:ps>p, whisper:ps, vanish:s, wait:p" },
  { id: "dragon-hoard", title: "The dragon's hoard",
    nouns: "dragon:b, knight:p, thief:p:thieves, princess:p, goblet:t, jewel:t, cave:l",
    verbs: "steal/stole:p>=goblet|jewel, wake/woke:pb>pb, guard:pb>=goblet|jewel|cave|princess, defeat:p>=dragon|knight|thief, roar:b, hide/hid:pb, flee/fled:pb" },
  { id: "witch-hut", title: "The witch's hut",
    nouns: "witch:p:witches, raven:b, toad:b, cauldron:t, broom:t, potion:t, hut:l, apprentice:p",
    verbs: "stir/stirred:p>=cauldron|potion, brew:p>=potion, curse:p>pb, feed/fed:p>b, chase:pb>pb, cackle:p, croak:b, sleep/slept:pb" },
  { id: "desert-caravan", title: "The desert caravan",
    nouns: "merchant:p, camel:b, scout:p, sultan:p, carpet:t, jar:t, oasis:l:oases, tent:l",
    verbs: "sell/sold:p>=camel|carpet|jar, pack/packed:p>=carpet|jar|tent, lead/led:p>=camel|merchant, guard:p>tl, rest:pb, drink/drank:pb, shout:p" },
  { id: "sea-voyage", title: "The navigator's voyage",
    nouns: "navigator:p, sailor:p, whale:b, gull:b, net:t, map:t, island:l, ship:t",
    verbs: "steer:p>=ship, mend:p>=net|map|ship, spot/spotted:pb>=whale|gull|island|ship, follow:pb>pb, swim/swam:pb, drift:t, sing/sang:p" },
  { id: "mountain-monastery", title: "The mountain monastery",
    nouns: "monk:p, abbot:p, yak:b, bell:t, scroll:t, lamp:t, peak:l, pilgrim:p",
    verbs: "ring/rang:p>=bell, light/lit:p>=lamp, copy:p>=scroll, bless:p>pb, climb:pb>l, feed/fed:p>b, greet:p>p, chant:p, sleep/slept:pb" },
  { id: "ancient-tomb", title: "The ancient tomb",
    nouns: "pharaoh:p, mummy:s:mummies, jackal:b, scarab:b, tomb:l, urn:t, mask:t, explorer:p",
    verbs: "open:p>=tomb|urn, seal:ps>=tomb|urn, curse:ps>p, wake/woke:ps>ps, guard:bs>=tomb|urn|mask|pharaoh, wander:pbs, howl:b" },
  { id: "royal-hunt", title: "The royal hunt",
    nouns: "hunter:p, prince:p, hound:b, stag:b, boar:b, horn:t, arrow:t, meadow:l",
    verbs: "chase:pb>b, track:pb>b, blow/blew:p>=horn, shoot/shot:p>b, catch/caught:pb>b, run/ran:pb, hide/hid:pb" },
  { id: "harvest-festival", title: "The harvest festival",
    nouns: "farmer:p, piper:p, goose:b:geese, goat:b, drum:t, basket:t, barn:l, field:l",
    verbs: "carry:p>=drum|basket|goose, play:p>=drum, chase:pb>pb, milk:p>=goat, fill:p>=basket|barn, dance:p, sing/sang:p, laugh:p" },
  { id: "underworld-ferry", title: "The ferry of the underworld",
    nouns: "ferryman:p:ferrymen, ghost:s, hound:b, coin:t, oar:t, river:l, gate:l, judge:p",
    verbs: "pay/paid:s>=ferryman|judge, carry:ps>=coin|oar|ghost, cross:ps>=river, guard:bp>=gate|river, weep/wept:ps, wait:ps, howl:b" },
  { id: "sky-giants", title: "The giants above the clouds",
    nouns: "giant:p, shepherd:p, sheepdog:b, harp:t, castle:l, hen:b",
    verbs: "climb:p>=castle, steal/stole:p>=harp|hen, guard:pb>=harp|hen|castle, play:p>=harp, wake/woke:pb>pb, snore:p, stomp:p, cackle:b" },
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
  return { id: rawTheme.id, title: rawTheme.title, nouns, verbs };
}

export const THEMES: Theme[] = RAW_THEMES.map(parseTheme);

export const allowsAgent = (verb: ThemeVerb, noun: ThemeNoun) => verb.agents.includes(noun.semanticClass);
export const allowsPatient = (verb: ThemeVerb, noun: ThemeNoun) =>
  verb.transitive && (verb.patients.includes(noun.semanticClass) || verb.patientIds.includes(noun.id));

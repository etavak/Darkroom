import { getFamily } from '../presets/catalog.js';
import { tagExistsInFamily } from '../tags/dictionary.js';

/**
 * Random starting prompts for the dice button. Tag families get tags from the family's own
 * dictionaries (Danbooru, plus an e621 anthro set when the family has e621); others get a
 * sentence.
 */

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const chance = (p: number) => Math.random() < p;

const ANIME = {
  count: ['1girl', '1girl', '1girl', '1boy', '1boy', '2girls', '1girl, 1boy'],
  type: ['fox girl', 'cat girl', 'elf', 'demon girl', 'android', 'knight', 'witch', 'maid', 'nun', 'vampire', 'angel', 'mermaid', 'samurai', 'ninja', 'princess', 'idol'],
  hairColor: ['blonde hair', 'black hair', 'white hair', 'grey hair', 'red hair', 'blue hair', 'pink hair', 'brown hair', 'green hair', 'purple hair'],
  hairStyle: ['long hair', 'short hair', 'very long hair', 'ponytail', 'twintails', 'braid', 'bob cut', 'messy hair', 'hair bun', 'side ponytail'],
  eyes: ['blue eyes', 'red eyes', 'green eyes', 'yellow eyes', 'purple eyes', 'brown eyes', 'heterochromia'],
  outfit: ['school uniform', 'serafuku', 'kimono', 'armor', 'hooded cloak', 'sweater', 'hoodie', 'dress', 'sundress', 'jacket', 'witch hat', 'coat', 'military uniform', 'gothic lolita', 'scarf'],
  expression: ['smile', 'light smile', 'open mouth', 'closed eyes', 'serious', 'blush', 'expressionless', 'grin'],
  pose: ['standing', 'sitting', 'walking', 'running', 'looking at viewer', 'looking back', 'looking up', 'arms behind back', 'hand on own chest', 'outstretched arm', 'leaning forward', 'lying'],
  framing: ['upper body', 'full body', 'cowboy shot', 'portrait', 'from below', 'from above', 'from side', 'close-up', 'dutch angle'],
  setting: ['outdoors', 'indoors', 'city', 'street', 'rooftop', 'forest', 'beach', 'classroom', 'library', 'cafe', 'ruins', 'flower field', 'snow', 'night sky', 'starry sky', 'mountain', 'ocean', 'shrine', 'bedroom', 'cityscape'],
  light: ['sunlight', 'sunset', 'backlighting', 'night', 'rain', 'cherry blossoms', 'falling petals', 'dappled sunlight', 'light rays', 'lens flare', 'neon lights', 'fog'],
  scenery: ['sky', 'cloud', 'tree', 'water', 'reflection', 'mountain', 'ocean', 'forest', 'ruins', 'cityscape', 'flower field', 'starry sky'],
} as const;

const ANTHRO = {
  sex: ['male', 'female'],
  species: ['wolf', 'fox', 'dragon', 'domestic cat', 'domestic dog', 'rabbit', 'bird'],
  body: ['orange body', 'white body', 'grey body', 'brown body', 'black body', 'red body', 'blue body'],
  extra: ['fluffy', 'fluffy tail', 'fur', 'tail'],
  outfit: ['hoodie', 'jacket', 'scarf', 'hat', 'clothed', 'cloak', 'hood up'],
  pose: ['standing', 'sitting', 'walking', 'looking at viewer', 'smile', 'open mouth'],
  setting: ['outside', 'inside', 'forest', 'city', 'grass', 'building', 'beach', 'snow', 'raining', 'night', 'sunset'],
} as const;

const SENTENCE = {
  subject: ['An old fisherman', 'A lone astronaut', 'A red fox', 'A tiny cottage', 'A street musician', 'A lighthouse keeper', 'A paper boat', 'A glass greenhouse', 'An abandoned train station', 'A vintage motorcycle'],
  action: ['resting by', 'standing in', 'half hidden in', 'glowing inside', 'waiting beside', 'reflected in', 'drifting across', 'perched above'],
  place: ['a misty pine forest', 'a rain-soaked city street', 'a quiet harbour at dawn', 'a field of tall grass', 'a cluttered workshop', 'snow-covered mountains', 'a desert at dusk', 'a moonlit lake'],
  style: ['shot on 35mm film', 'soft natural light', 'cinematic, shallow depth of field', 'warm golden hour light', 'muted colours, overcast', 'detailed digital painting', 'moody blue hour', 'high contrast, dramatic shadows'],
} as const;

export function randomPromptFor(familyId: string | null): string {
  const family = familyId ? getFamily(familyId) : null;
  const sources = family?.tagSources ?? [];
  if (!family || sources.length === 0) {
    return `${pick(SENTENCE.subject)} ${pick(SENTENCE.action)} ${pick(SENTENCE.place)}, ${pick(SENTENCE.style)}.`;
  }
  const ok = (t: string) => tagExistsInFamily(family.id, t);
  /** One known tag from a list (several tries), or nothing */
  const one = (list: readonly string[]): string | null => {
    const known = list.filter(ok);
    return known.length ? pick(known) : null;
  };
  const parts: Array<string | null> = [];

  if (sources.includes('e621') && chance(0.3)) {
    parts.push('anthro', 'solo', one(ANTHRO.sex), one(ANTHRO.species), one(ANTHRO.body), one(ANTHRO.extra), one(ANTHRO.outfit), one(ANTHRO.pose), one(ANTHRO.setting));
  } else if (chance(0.12)) {
    parts.push(ok('no humans') ? 'no humans' : null, one(['scenery', 'landscape']), one(ANIME.scenery), one(ANIME.scenery), one(ANIME.light));
  } else {
    // count may be "1girl, 1boy" — check each half
    const count = pick(ANIME.count);
    parts.push(count.split(', ').every(ok) ? count : one(['1girl', '1boy', 'solo']));
    if (chance(0.35)) parts.push(one(ANIME.type));
    parts.push(
      one(ANIME.hairColor),
      one(ANIME.hairStyle),
      one(ANIME.eyes),
      one(ANIME.outfit),
      one(ANIME.expression),
      one(ANIME.pose),
      one(ANIME.framing),
      one(ANIME.setting),
      one(ANIME.light),
    );
  }
  return [...new Set(parts.filter((p): p is string => Boolean(p)))].join(', ');
}

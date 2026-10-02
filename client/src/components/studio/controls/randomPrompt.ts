/**
 * A random starting prompt for the dice button. Tag-style families (Danbooru-trained:
 * Illustrious, Pony, NoobAI…) get comma-separated tags; everything else gets a sentence.
 */
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

const TAG = {
  subject: ['1girl', '1boy', '2girls', '1girl, 1boy', 'no humans, scenery', 'dragon', 'fox girl', 'knight', 'witch', 'android'],
  look: ['long hair', 'short hair, messy hair', 'silver hair', 'red eyes', 'twintails', 'hooded cloak', 'school uniform', 'kimono', 'armor', 'wide-brimmed hat'],
  pose: ['standing', 'sitting', 'looking at viewer', 'looking back', 'from below', 'from above', 'upper body', 'full body', 'running', 'reaching out'],
  place: ['cherry blossoms', 'rooftop, city lights', 'forest, sunbeams', 'library, candlelight', 'beach, sunset', 'ruins, overgrown', 'snowy mountain', 'rainy street, neon lights', 'starry sky', 'flower field'],
  light: ['golden hour', 'dramatic lighting', 'backlighting', 'soft lighting', 'night', 'volumetric lighting', 'rim lighting'],
} as const;

const SENTENCE = {
  subject: ['An old fisherman', 'A lone astronaut', 'A red fox', 'A tiny cottage', 'A street musician', 'A lighthouse keeper', 'A paper boat', 'A glass greenhouse', 'An abandoned train station', 'A vintage motorcycle'],
  action: ['resting by', 'standing in', 'half hidden in', 'glowing inside', 'waiting beside', 'reflected in', 'drifting across', 'perched above'],
  place: ['a misty pine forest', 'a rain-soaked city street', 'a quiet harbour at dawn', 'a field of tall grass', 'a cluttered workshop', 'snow-covered mountains', 'a desert at dusk', 'a moonlit lake'],
  style: ['shot on 35mm film', 'soft natural light', 'cinematic, shallow depth of field', 'warm golden hour light', 'muted colours, overcast', 'detailed digital painting', 'moody blue hour', 'high contrast, dramatic shadows'],
} as const;

export function randomPrompt(tagStyle: boolean): string {
  if (tagStyle) {
    return [pick(TAG.subject), pick(TAG.look), pick(TAG.pose), pick(TAG.place), pick(TAG.light)].join(', ');
  }
  return `${pick(SENTENCE.subject)} ${pick(SENTENCE.action)} ${pick(SENTENCE.place)}, ${pick(SENTENCE.style)}.`;
}

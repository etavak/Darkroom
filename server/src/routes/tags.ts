import { Router } from 'express';
import { getFamily } from '../presets/catalog.js';
import {
  dictionaryKey,
  getFamilyTagMeta,
  searchTags,
  tagCategoryInFamily,
  tagExistsInFamily,
} from '../tags/dictionary.js';

export const tagsRouter = Router();

/** GET /api/tags?q=&family=&limit= */
tagsRouter.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const family = typeof req.query.family === 'string' ? req.query.family : '';
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

  if (!family) {
    res.json({ suggestions: [], enabled: false, tagFormat: 'underscores' });
    return;
  }

  const result = searchTags({ q, familyId: family, limit });
  res.json(result);
});

/** POST /api/tags/validate { family, tags: string[] } → { unknown: string[] } */
tagsRouter.post('/validate', (req, res) => {
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
    string,
    unknown
  >;
  const family = typeof b.family === 'string' ? b.family : '';
  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === 'string')
    : [];

  if (!family) {
    res.json({ unknown: [], enabled: false });
    return;
  }

  const meta = getFamilyTagMeta(family);
  if (!meta.enabled) {
    res.json({ unknown: [], enabled: false });
    return;
  }

  // The family's own preset tags (masterpiece, score_9…) count as known meta tags even when
  // the dictionary doesn't list them
  const fam = getFamily(family);
  const presetTags = new Set(
    [
      ...(fam?.positive ?? []),
      ...(fam?.negative ?? []),
      ...(fam?.qualityPresets ?? []).flatMap((l) => l.tags),
      ...(fam?.negativePresets ?? []).flatMap((l) => l.tags),
    ].map((t) => dictionaryKey(t)),
  );

  const unknown: string[] = [];
  // Non-general categories (character, copyright, artist, meta) for colouring the prompt
  const categories: Record<string, string> = {};
  for (const tag of tags) {
    const lookup = stripWeightForLookup(tag);
    if (!lookup) continue;
    if (presetTags.has(dictionaryKey(lookup))) {
      categories[tag] = 'meta';
      continue;
    }
    if (!tagExistsInFamily(family, lookup)) {
      unknown.push(tag);
      continue;
    }
    const cat = tagCategoryInFamily(family, lookup);
    if (cat && cat !== 'general') categories[tag] = cat;
  }
  res.json({ unknown, categories, enabled: true });
});

/** Unwrap (tag:1.2) weight syntax for dictionary lookup. */
function stripWeightForLookup(raw: string): string {
  let t = raw.trim();
  if (!t) return '';
  // Repeated weight wrappers: ((tag:1.1):1.2) uncommon; handle single outer.
  const m = t.match(/^\((.+):([0-9]*\.?[0-9]+)\)$/);
  if (m) t = m[1].trim();
  return t;
}

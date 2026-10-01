import { Router } from 'express';
import {
  getFamilyTagMeta,
  searchTags,
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

  const unknown: string[] = [];
  for (const tag of tags) {
    const lookup = stripWeightForLookup(tag);
    if (!lookup) continue;
    if (!tagExistsInFamily(family, lookup)) unknown.push(tag);
  }
  res.json({ unknown, enabled: true });
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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFamily } from '../presets/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const tagsDir = path.resolve(__dirname, '../../tags');

export type TagCategory = 'general' | 'artist' | 'character' | 'copyright' | 'meta';

export type TagEntry = {
  name: string;
  category: TagCategory;
  postCount: number;
  aliases: string[];
  source: string;
};

export type TagSuggestion = {
  name: string;
  displayName: string;
  category: TagCategory;
  postCount: number;
  matchedAlias?: string;
};

const CATEGORY_BY_NUM: Record<number, TagCategory> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
};

const CATEGORY_BY_NAME: Record<string, TagCategory> = {
  general: 'general',
  artist: 'artist',
  character: 'character',
  copyright: 'copyright',
  meta: 'meta',
};

type Dictionary = {
  tags: TagEntry[];
  /** lowercase name/alias → tag index */
  index: Map<string, number>;
};

const dictionaries = new Map<string, Dictionary>();
let loaded = false;

function parseCategory(raw: string): TagCategory {
  const n = Number(raw);
  if (Number.isFinite(n) && CATEGORY_BY_NUM[n]) return CATEGORY_BY_NUM[n];
  const key = raw.trim().toLowerCase();
  return CATEGORY_BY_NAME[key] ?? 'general';
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function loadCsv(source: string): Dictionary {
  const file = path.join(tagsDir, `${source}.csv`);
  if (!fs.existsSync(file)) {
    console.warn(`[tags] missing dictionary: ${file}`);
    return { tags: [], index: new Map() };
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { tags: [], index: new Map() };

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const hasHeader =
    header.includes('name') || header.includes('tag') || header[0] === 'name';
  const start = hasHeader ? 1 : 0;
  const nameIdx = hasHeader ? Math.max(0, header.indexOf('name'), header.indexOf('tag')) : 0;
  const catIdx = hasHeader
    ? header.indexOf('category') >= 0
      ? header.indexOf('category')
      : 1
    : 1;
  const countIdx = hasHeader
    ? header.indexOf('post_count') >= 0
      ? header.indexOf('post_count')
      : header.indexOf('count') >= 0
        ? header.indexOf('count')
        : 2
    : 2;
  const aliasIdx = hasHeader
    ? header.indexOf('aliases') >= 0
      ? header.indexOf('aliases')
      : 3
    : 3;

  const tags: TagEntry[] = [];
  const index = new Map<string, number>();

  for (let li = start; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    const name = (cols[nameIdx] ?? '').trim();
    if (!name || name === 'name') continue;
    const category = parseCategory(cols[catIdx] ?? '0');
    const postCount = Number(cols[countIdx] ?? 0) || 0;
    const aliasRaw = cols[aliasIdx] ?? '';
    const aliases = aliasRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const entry: TagEntry = { name, category, postCount, aliases, source };
    const idx = tags.length;
    tags.push(entry);
    index.set(name.toLowerCase(), idx);
    for (const a of aliases) {
      const key = a.toLowerCase();
      if (!index.has(key)) index.set(key, idx);
    }
  }

  console.log(`[tags] loaded ${source}: ${tags.length} tags`);
  return { tags, index };
}

export function loadAllTagDictionaries(): void {
  if (loaded) return;
  if (!fs.existsSync(tagsDir)) {
    loaded = true;
    return;
  }
  const files = fs.readdirSync(tagsDir).filter((f) => f.endsWith('.csv'));
  for (const file of files) {
    const source = file.replace(/\.csv$/i, '');
    dictionaries.set(source, loadCsv(source));
  }
  loaded = true;
}

export function escapeParens(tag: string): string {
  return tag.replace(/(?<!\\)\(/g, '\\(').replace(/(?<!\\)\)/g, '\\)');
}

export function formatTagForInsert(name: string, tagFormat: 'spaces' | 'underscores'): string {
  const escaped = escapeParens(name);
  if (tagFormat === 'spaces') return escaped.replace(/_/g, ' ');
  return escaped.replace(/ /g, '_');
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/ /g, '_');
}

/** Canonical key for dictionary lookup (underscores, lowercased, unescaped parens) */
export function dictionaryKey(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/\\([()])/g, '$1')
    .replace(/ /g, '_');
}

/**
 * How well a tag name matches the query (lower is better, -1 = no match):
 * 0 prefix · 2 a word starts with it (light → dramatic_lighting) · 3 substring ·
 * 4 every query word appears, in any order. 1 is an alias prefix (checked by the caller).
 */
function matchRank(name: string, q: string, words: string[]): number {
  if (name.startsWith(q)) return 0;
  if (name.includes(`_${q}`) || name.includes(`(${q}`)) return 2;
  if (name.includes(q)) return 3;
  if (words.length > 1 && words.every((w) => name.includes(w))) return 4;
  return -1;
}

/**
 * q's letters appear in name in order, starting at the beginning of the name or of a word
 * (drmtc → drumsticks). Returns how many extra letters the match spans (lower is tighter), or -1.
 */
function looseSpan(q: string, name: string): number {
  if (q.length < 3) return -1;
  let best = -1;
  for (let start = name.indexOf(q[0]); start >= 0; start = name.indexOf(q[0], start + 1)) {
    if (start > 0 && name[start - 1] !== '_') continue;
    let i = 1;
    let j = start + 1;
    for (; j < name.length && i < q.length; j++) if (name[j] === q[i]) i++;
    if (i < q.length) break;
    const extra = j - start - q.length;
    if (best < 0 || extra < best) best = extra;
  }
  return best;
}

function toHit(entry: TagEntry, tagFormat: 'spaces' | 'underscores', rank: number): TagSuggestion & { rank: number } {
  return {
    name: entry.name,
    displayName: formatTagForInsert(entry.name, tagFormat),
    category: entry.category,
    postCount: entry.postCount,
    rank,
  };
}

export function searchTags(params: {
  q: string;
  familyId: string;
  limit?: number;
}): { suggestions: TagSuggestion[]; enabled: boolean; tagFormat: 'spaces' | 'underscores' } {
  loadAllTagDictionaries();
  const family = getFamily(params.familyId);
  const sources = family?.tagSources ?? [];
  const tagFormat = family?.tagFormat ?? 'underscores';
  if (sources.length === 0) {
    return { suggestions: [], enabled: false, tagFormat };
  }

  const q = normalizeQuery(params.q);
  if (!q) return { suggestions: [], enabled: true, tagFormat };

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  type Hit = TagSuggestion & { rank: number };
  const hits: Hit[] = [];
  const loose: Hit[] = [];
  const seen = new Set<string>();
  const words = q.split('_').filter(Boolean);

  for (const source of sources) {
    const dict = dictionaries.get(source);
    if (!dict) continue;

    for (const entry of dict.tags) {
      const nameKey = entry.name.toLowerCase();
      if (seen.has(nameKey)) continue;

      let matchedAlias: string | undefined;
      const rank = matchRank(nameKey, q, words);
      let best = rank;
      if (best !== 0) {
        // An alias that starts with the query beats a looser match on the name (smiling → smile)
        for (const a of entry.aliases) {
          if (a.toLowerCase().startsWith(q)) {
            if (best < 0 || best > 1) {
              best = 1;
              matchedAlias = a;
            }
            break;
          }
        }
      }
      if (best < 0) {
        const span = loose.length < 2000 ? looseSpan(q.replace(/_/g, ''), nameKey) : -1;
        if (span >= 0) loose.push(toHit(entry, tagFormat, 5 + span / 100));
        continue;
      }

      seen.add(nameKey);
      hits.push({ ...toHit(entry, tagFormat, best), matchedAlias });
    }
  }

  const byRank = (a: Hit, b: Hit) => a.rank - b.rank || b.postCount - a.postCount;
  hits.sort(byRank);
  // Loose letter matches only when nothing better is found
  if (hits.length === 0) {
    loose.sort(byRank);
    for (const h of loose) {
      if (hits.length >= limit) break;
      if (seen.has(h.name.toLowerCase())) continue;
      seen.add(h.name.toLowerCase());
      hits.push(h);
    }
  }

  return {
    suggestions: hits.slice(0, limit).map(({ rank: _r, ...rest }) => rest),
    enabled: true,
    tagFormat,
  };
}

export function tagExistsInFamily(familyId: string, tag: string): boolean {
  loadAllTagDictionaries();
  const family = getFamily(familyId);
  const sources = family?.tagSources ?? [];
  if (sources.length === 0) return true; // no dictionary → don't underline
  const key = dictionaryKey(tag);
  if (!key) return true;
  for (const source of sources) {
    const dict = dictionaries.get(source);
    if (dict?.index.has(key)) return true;
  }
  return false;
}

/** Category of a tag in the family's dictionaries (null when it isn't in any of them). */
export function tagCategoryInFamily(familyId: string, tag: string): TagCategory | null {
  loadAllTagDictionaries();
  const sources = getFamily(familyId)?.tagSources ?? [];
  const key = dictionaryKey(tag);
  if (!key) return null;
  for (const source of sources) {
    const dict = dictionaries.get(source);
    const idx = dict?.index.get(key);
    if (dict && idx !== undefined) return dict.tags[idx]?.category ?? 'general';
  }
  return null;
}

export function getFamilyTagMeta(familyId: string): {
  enabled: boolean;
  tagFormat: 'spaces' | 'underscores';
  sources: string[];
} {
  const family = getFamily(familyId);
  const sources = family?.tagSources ?? [];
  return {
    enabled: sources.length > 0,
    tagFormat: family?.tagFormat ?? 'underscores',
    sources,
  };
}

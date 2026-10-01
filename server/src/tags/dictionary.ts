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
  type Hit = TagSuggestion & { score: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const dict = dictionaries.get(source);
    if (!dict) continue;

    for (const entry of dict.tags) {
      const nameKey = entry.name.toLowerCase();
      if (seen.has(nameKey)) continue;

      let matchedAlias: string | undefined;
      let rank = -1;
      if (nameKey.startsWith(q)) {
        rank = 0;
      } else {
        for (const a of entry.aliases) {
          if (a.toLowerCase().startsWith(q)) {
            rank = 1;
            matchedAlias = a;
            break;
          }
        }
      }
      if (rank < 0) continue;

      seen.add(nameKey);
      hits.push({
        name: entry.name,
        displayName: formatTagForInsert(entry.name, tagFormat),
        category: entry.category,
        postCount: entry.postCount,
        matchedAlias,
        score: rank * 1e15 + (1e15 - Math.min(entry.postCount, 1e15 - 1)),
      });
    }
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return b.postCount - a.postCount;
  });

  return {
    suggestions: hits.slice(0, limit).map(({ score: _s, ...rest }) => rest),
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

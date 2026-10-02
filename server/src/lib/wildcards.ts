import fs from 'node:fs';
import path from 'node:path';

/** Deterministic PRNG so a locked seed reproduces the same wildcard picks. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WILDCARD_EXTS = ['.txt', '.wildcard', '.wildcards'];
const MAX_DEPTH = 8;

/** Read options from `<folder>/<name>.txt` (or .wildcard[s]); null when absent or outside folder. */
function readWildcardFile(folder: string, name: string): string[] | null {
  if (!folder || !name || name.includes('..') || path.isAbsolute(name)) return null;
  const root = path.resolve(folder);
  for (const ext of ['', ...WILDCARD_EXTS]) {
    const full = path.resolve(root, name + ext);
    if (!full.startsWith(root + path.sep)) return null;
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    return fs
      .readFileSync(full, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  return null;
}

/**
 * Expand `{a|b|c}` choices (nestable) once, left to right.
 * `{x}` without a top-level `|` and unbalanced braces are kept literally;
 * `\{ \} \|` are escapes for literal characters.
 */
function expandChoices(text: string, rand: () => number): string {
  let i = 0;

  const parseUntil = (stopAtGroupEnd: boolean): { parts: string[]; closed: boolean } => {
    const parts: string[] = [''];
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length && '{}|'.includes(text[i + 1])) {
        // Keep the escape so a later pass still sees a literal
        parts[parts.length - 1] += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '{') {
        const start = i;
        i++;
        const inner = parseUntil(true);
        if (!inner.closed) {
          parts[parts.length - 1] += text.slice(start, i);
        } else if (inner.parts.length > 1) {
          parts[parts.length - 1] += inner.parts[Math.floor(rand() * inner.parts.length)];
        } else {
          parts[parts.length - 1] += `{${inner.parts[0]}}`;
        }
        continue;
      }
      if (stopAtGroupEnd && ch === '}') {
        i++;
        return { parts, closed: true };
      }
      if (stopAtGroupEnd && ch === '|') {
        parts.push('');
        i++;
        continue;
      }
      parts[parts.length - 1] += ch;
      i++;
    }
    return { parts, closed: false };
  };

  return parseUntil(false).parts.join('|');
}

/**
 * Resolve dynamic-prompt syntax before the prompt reaches ComfyUI (its API does not):
 * - `{a|b|c}` picks one option (nested groups allowed)
 * - `__name__` picks a line from `<wildcardsFolder>/name.txt` (unknown names stay literal)
 */
export function expandWildcards(text: string, opts: { seed: number; folder: string }): string {
  if (!text || (!text.includes('{') && !text.includes('__'))) return text;
  const rand = mulberry32(opts.seed);
  let out = text;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const before = out;
    out = out.replace(/__([\w\-./ ]+?)__/g, (whole, name: string) => {
      const options = readWildcardFile(opts.folder, name.trim());
      if (!options?.length) return whole;
      return options[Math.floor(rand() * options.length)];
    });
    out = expandChoices(out, rand);
    if (out === before) break;
  }
  return out.replace(/\\([{}|])/g, '$1');
}

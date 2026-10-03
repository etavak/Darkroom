import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type VersionInfo = {
  version: string;
  /** Installed commit (git HEAD, or the release the launcher last applied) */
  sha: string | null;
  updatedAt: string | null;
  git: boolean;
};

export type UpdateCheck = VersionInfo & {
  latest: string | null;
  updateAvailable: boolean | null;
  checkedAt: string;
  error?: string;
};

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** HEAD's commit without spawning git (loose ref or packed-refs). */
function gitHead(root: string): string | null {
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head || null;
    const ref = head.slice(5);
    const loose = path.join(root, '.git', ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    const packed = fs.readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0] : null;
  } catch {
    return null;
  }
}

export function currentVersion(): VersionInfo {
  const root = config.rootDir;
  const version = String(readJson(path.join(root, 'package.json'))?.version ?? '?');
  const git = fs.existsSync(path.join(root, '.git'));
  if (git) return { version, sha: gitHead(root), updatedAt: null, git };
  const installed = readJson(path.join(root, 'runtime', 'darkroom-version.json'));
  return {
    version,
    sha: typeof installed?.sha === 'string' ? installed.sha : null,
    updatedAt: typeof installed?.updatedAt === 'string' ? installed.updatedAt : null,
    git,
  };
}

let cached: { at: number; result: UpdateCheck } | null = null;

/** Compare the installed commit with the newest on GitHub (cached for 10 minutes). */
export async function checkForUpdate(force = false): Promise<UpdateCheck> {
  if (!force && cached && Date.now() - cached.at < 10 * 60_000) return cached.result;
  const cur = currentVersion();
  const pins = readJson(path.join(config.rootDir, 'scripts', 'cli', 'components.json')) as { darkroom?: { githubRepo?: string; branch?: string } } | null;
  const repo = pins?.darkroom?.githubRepo || 'etavak/Darkroom';
  const branch = pins?.darkroom?.branch || 'main';
  const base = { ...cur, checkedAt: new Date().toISOString() };
  let result: UpdateCheck;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
      headers: { 'User-Agent': 'Darkroom', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await r.json().catch(() => null)) as { sha?: unknown } | null;
    const latest = r.ok && typeof body?.sha === 'string' ? body.sha : null;
    if (!latest) {
      throw new Error(
        r.status === 404
          ? `GitHub can’t see ${repo} (private or renamed?)`
          : r.status === 403 || r.status === 429
            ? 'GitHub is rate-limiting checks — try again later'
            : `GitHub answered ${r.status}`,
      );
    }
    result = { ...base, latest, updateAvailable: cur.sha ? cur.sha !== latest : null };
  } catch (err) {
    result = { ...base, latest: null, updateAvailable: null, error: err instanceof Error ? err.message : 'Check failed' };
  }
  cached = { at: Date.now(), result };
  return result;
}

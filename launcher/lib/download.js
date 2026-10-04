import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { URL } from 'node:url';
import { getConfig, loadEnvFile } from './env.js';
import { httpGetJson } from './http.js';
import { ensureLogsDir, logsDir } from './paths.js';

const WEIGHT_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i;

/** Civitai's sites share one account and API (civitai.red is the mature-content site; .green redirects to .com). */
export const isCivitaiHost = (/** @type {string} */ host) => /(^|\.)civitai\.(com|red|green)$/i.test(host);
/** Hugging Face itself and its short domain (keys only ever go to these). */
export const isHuggingFaceHost = (/** @type {string} */ host) => /(^|\.)(huggingface\.co|hf\.co)$/i.test(host);
/** hf-mirror.com: a third-party Hugging Face mirror (popular where huggingface.co is blocked) — never sent a token. */
const isHfMirrorHost = (/** @type {string} */ host) => /(^|\.)hf-mirror\.com$/i.test(host);
const isModelScopeHost = (/** @type {string} */ host) => /(^|\.)modelscope\.(cn|ai)$/i.test(host);

export const SUPPORTED_SITES =
  'Civitai (civitai.com / .red / .green), Hugging Face (or hf-mirror.com), ModelScope, GitHub, OpenModelDB, Google Drive, Dropbox, or a direct file link';

/**
 * @param {NodeJS.WritableStream} stream
 * @param {number} transferred
 * @param {number} total
 */
function writeProgress(stream, transferred, total) {
  const pct = total > 0 ? Math.min(100, (transferred / total) * 100) : 0;
  const width = 28;
  const filled = total > 0 ? Math.round((pct / 100) * width) : transferred % (width + 1);
  const bar =
    total > 0
      ? `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
      : `[${'#'.repeat(Math.min(width, filled))}${'-'.repeat(Math.max(0, width - filled))}]`;
  const mb = (transferred / 1e6).toFixed(1);
  const totalMb = total > 0 ? (total / 1e6).toFixed(1) : '?';
  const line = `  ${bar} ${total > 0 ? pct.toFixed(1) : '?'}%  ${mb}/${totalMb} MB`;
  stream.write(`\r${line}`);
}

/**
 * Download a URL to destPath with a simple progress bar.
 * @param {string} url
 * @param {string} destPath
 * @param {{
 *   headers?: Record<string, string>,
 *   onProgress?: (transferred: number, total: number) => void,
 *   quiet?: boolean,
 * }} [opts]
 */
/**
 * What to tell the user when a download is refused.
 * @param {number} code
 * @param {string} host
 * @param {boolean} sentKey
 */
export function downloadErrorMessage(code, host, sentKey) {
  if ((code === 401 || code === 403) && isCivitaiHost(host)) {
    if (!sentKey && getConfig().civitaiTokenInvalid) {
      return `The saved Civitai key isn't a valid key (it looks like a link or has spaces), so it wasn't used — and this file needs sign-in (HTTP ${code}). Paste the key itself from civitai.com → Account settings → API keys.`;
    }
    return sentKey
      ? `Civitai refused your API key (HTTP ${code}). Check the key in Preferences → Models & folders — or the file is early access and needs a supporter account.`
      : `No Civitai API key is saved, and this file's creator requires sign-in to download it (HTTP ${code}). Add your key in Preferences → Models & folders — get one at civitai.com → Account settings → API keys.`;
  }
  if ((code === 401 || code === 403) && (isHuggingFaceHost(host) || isHfMirrorHost(host))) {
    return sentKey
      ? `Hugging Face refused the download (HTTP ${code}) — accept the model's licence on its page, then check your token.`
      : `No Hugging Face token is saved, and this file is gated (HTTP ${code}). Accept its licence on the model page, then add a token in Preferences → Models & folders.`;
  }
  return `Download failed HTTP ${code}`;
}

export function downloadFile(url, destPath, opts = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = `${destPath}.partial`;
    /** @type {http.ClientRequest} */
    let req;

    const firstHost = new URL(url).hostname;
    const go = (currentUrl, redirects = 0) => {
      if (redirects > 10) {
        reject(new Error('Too many redirects'));
        return;
      }
      const u = new URL(currentUrl);
      const lib = u.protocol === 'https:' ? https : http;
      // Keys stay with the site they belong to: Civitai / HF redirect to signed storage URLs,
      // which reject (and must not see) an extra Authorization header
      const headers = { 'User-Agent': 'Darkroom/1.0', ...(opts.headers ?? {}) };
      if (u.hostname !== firstHost) delete headers.Authorization;
      req = lib.get(
        currentUrl,
        {
          headers,
          timeout: 120_000,
        },
        (res) => {
          const code = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, currentUrl).toString();
            go(next, redirects + 1);
            return;
          }
          if (code < 200 || code >= 300) {
            res.resume();
            reject(new Error(downloadErrorMessage(code, u.hostname, Boolean(opts.headers?.Authorization))));
            return;
          }
          const ctype = String(res.headers['content-type'] || '');
          if (/text\/html/i.test(ctype)) {
            res.resume();
            reject(
              new Error(
                `The link opened a web page instead of a model file. Paste a model page from ${SUPPORTED_SITES}.`,
              ),
            );
            return;
          }
          const total = Number(res.headers['content-length'] || 0);
          let transferred = 0;
          const out = fs.createWriteStream(tmp);
          res.on('data', (chunk) => {
            transferred += chunk.length;
            if (typeof opts.onProgress === 'function') {
              opts.onProgress(transferred, total);
            }
            if (!opts.quiet) writeProgress(process.stdout, transferred, total);
          });
          res.pipe(out);
          res.on('aborted', () => out.destroy(new Error('The download was cut off — try again.')));
          out.on('finish', () => {
            if (!opts.quiet) process.stdout.write('\n');
            // a dropped connection can end the stream early; never keep half a file
            if (total > 0 && transferred !== total) {
              fs.rmSync(tmp, { force: true });
              reject(new Error(`The download was cut off at ${formatBytes(transferred)} of ${formatBytes(total)} — try again.`));
              return;
            }
            fs.renameSync(tmp, destPath);
            resolve({ destPath, bytes: transferred });
          });
          out.on('error', (err) => {
            fs.rmSync(tmp, { force: true });
            reject(err);
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timed out'));
      });
    };

    go(url);
  });
}

/**
 * Companion files from the same model page (e.g. Civitai VAE).
 * @typedef {{
 *   path: string,
 *   size: number,
 *   downloadUrl: string,
 *   filename: string,
 *   fileType: string,
 *   sha256?: string,
 * }} ResolvedCompanion
 *
 * @typedef {{
 *   downloadUrl: string,
 *   filename: string,
 *   triggerWords: string[],
 *   previewUrl: string | null,
 *   modelName: string,
 *   baseModel?: string | null,
 *   headers?: Record<string, string>,
 *   candidates?: { path: string, size: number, downloadUrl: string, filename: string, fileType?: string }[],
 *   companions?: ResolvedCompanion[],
 * }} ResolvedModel
 */

/**
 * Rewrite a share / viewer link into one that downloads the file itself
 * (Google Drive, Dropbox, GitHub "blob" pages). Other links come back unchanged.
 * @param {string} pageUrl
 */
export function directLink(pageUrl) {
  const u = new URL(pageUrl);
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get('id');
    if (id) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  if (host === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) return `https://github.com/${m[1]}/${m[2]}/raw/${m[3]}`;
  }
  return pageUrl;
}

/** The file name a server gives in Content-Disposition, if any. */
export function dispositionFilename(/** @type {string | null} */ header) {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i);
  if (star) {
    try {
      return path.basename(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return name ? path.basename(name) : null;
}

/**
 * Peek at a link without downloading it: the file name it would save as and what it is.
 * Used for links whose path doesn't end in a file name (Drive, signed storage URLs…).
 * @param {string} url
 */
async function probeLink(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Darkroom/1.0', Range: 'bytes=0-0' }, redirect: 'follow' });
  void res.body?.cancel();
  if (!res.ok) throw new Error(downloadErrorMessage(res.status, new URL(res.url || url).hostname, false));
  const finalName = path.basename(new URL(res.url || url).pathname);
  return {
    filename: dispositionFilename(res.headers.get('content-disposition')) || (WEIGHT_RE.test(finalName) ? finalName : null),
    html: /text\/html/i.test(res.headers.get('content-type') || ''),
  };
}

/**
 * A file name every OS accepts. Windows refuses \\ / : * ? " < > | and control characters,
 * device names (CON, NUL, COM1…) and a trailing dot or space — names macOS takes happily, so a
 * download named that way would only fail on Windows.
 * @param {string} name
 * @param {string} [fallback]
 */
export function safeFileName(name, fallback = 'model.safetensors') {
  let n = [...String(name ?? '')]
    .map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `_${n}`;
  return n || fallback;
}

/**
 * Resolve a model link to a download (see SUPPORTED_SITES), with file names safe on every OS.
 * @param {string} pageUrl
 * @returns {Promise<ResolvedModel>}
 */
export async function resolveModelUrl(pageUrl) {
  const meta = await resolveModelUrlRaw(pageUrl);
  return {
    ...meta,
    filename: safeFileName(meta.filename),
    candidates: meta.candidates?.map((c) => ({ ...c, filename: safeFileName(c.filename) })),
    companions: meta.companions?.map((c) => ({ ...c, filename: safeFileName(c.filename) })),
  };
}

/**
 * @param {string} pageUrl
 * @returns {Promise<ResolvedModel>}
 */
async function resolveModelUrlRaw(pageUrl) {
  const cfg = getConfig();
  let u;
  try {
    u = new URL(pageUrl.trim());
  } catch {
    throw new Error(`That isn't a link. Paste a model page from ${SUPPORTED_SITES}.`);
  }
  const host = u.hostname.toLowerCase();

  if (isCivitaiHost(host)) return resolveCivitai(u.toString(), cfg.civitaiToken);
  if (isHuggingFaceHost(host)) return resolveHuggingFace(u.toString(), cfg.hfToken, 'https://huggingface.co');
  if (isHfMirrorHost(host)) return resolveHuggingFace(u.toString(), '', `https://${host}`);
  if (isModelScopeHost(host)) return resolveModelScope(u);
  if (host === 'openmodeldb.info') return resolveOpenModelDb(u);
  if (host === 'github.com' && /^\/[^/]+\/[^/]+\/releases(\/(tag\/[^/]+|latest))?\/?$/.test(u.pathname)) {
    return resolveGitHubRelease(u);
  }

  // A direct file link, or a share link that becomes one
  const downloadUrl = directLink(u.toString());
  let filename = path.basename(new URL(downloadUrl).pathname);
  if (!WEIGHT_RE.test(filename)) {
    const probe = await probeLink(downloadUrl).catch((err) => {
      throw new Error(`Couldn't open that link: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!probe.filename || !WEIGHT_RE.test(probe.filename)) {
      throw new Error(
        probe.html
          ? `That's a web page, not a model file. Paste a model page from ${SUPPORTED_SITES}.`
          : `That link isn't a model file (.safetensors, .ckpt, .pt, .pth, .bin or .gguf).`,
      );
    }
    filename = probe.filename;
  }
  return {
    downloadUrl,
    filename,
    triggerWords: [],
    previewUrl: null,
    modelName: filename,
  };
}

/**
 * ModelScope (modelscope.cn / modelscope.ai) — the Hugging Face of China; same repo layout.
 * Accepts the repo page, a folder or a single file link.
 * @param {URL} u
 * @returns {Promise<ResolvedModel>}
 */
async function resolveModelScope(u) {
  const parts = u.pathname.split('/').filter(Boolean);
  const at = parts.indexOf('models');
  if (at < 0 || parts.length < at + 3) throw new Error('Unrecognised ModelScope link — expected modelscope.cn/models/owner/name');
  const repoId = `${parts[at + 1]}/${parts[at + 2]}`;
  const rest = parts.slice(at + 3);
  let rev = 'master';
  /** @type {string | null} */
  let filePath = null;
  // …/resolve/<rev>/<file>, …/file/view/<rev>/<file>, …/files/<folder>
  if (rest[0] === 'resolve' && rest[1]) [rev, filePath] = [rest[1], rest.slice(2).join('/')];
  else if (rest[0] === 'file' && rest[1] === 'view' && rest[2]) [rev, filePath] = [rest[2], rest.slice(3).join('/')];
  else if (rest[0] === 'files' && rest.length > 1) filePath = rest.slice(1).join('/');
  if (filePath) filePath = decodeURIComponent(filePath);
  const origin = `https://${u.hostname}`;
  const fileUrl = (/** @type {string} */ p) => `${origin}/models/${repoId}/resolve/${encodeURIComponent(rev)}/${p.split('/').map(encodeURIComponent).join('/')}`;

  if (filePath && WEIGHT_RE.test(filePath)) {
    return { downloadUrl: fileUrl(filePath), filename: path.basename(filePath), triggerWords: [], previewUrl: null, modelName: `${repoId}/${filePath}` };
  }
  const res = await httpGetJson(`${origin}/api/v1/models/${repoId}/repo/files?Recursive=true&Revision=${encodeURIComponent(rev)}`, {
    headers: { 'User-Agent': 'Darkroom/1.0' },
  });
  const files = res.json?.Data?.Files;
  if (res.status !== 200 || !Array.isArray(files)) throw new Error(`ModelScope listing failed (${res.status}). Check the link.`);
  const prefix = filePath ? `${filePath.replace(/\/$/, '')}/` : '';
  const candidates = files
    .filter((f) => f?.Type === 'blob' && typeof f.Path === 'string' && WEIGHT_RE.test(f.Path) && (!prefix || f.Path.startsWith(prefix)))
    .filter((f) => !(Number(f.Size) > 0 && Number(f.Size) < 1024 * 1024))
    .map((f) => ({ path: f.Path, size: Number(f.Size) || 0, downloadUrl: fileUrl(f.Path), filename: path.basename(f.Path) }))
    .sort((a, b) => b.size - a.size);
  return pickCandidate(candidates, repoId);
}

/**
 * A GitHub release page — lists its model-file assets (upscalers often ship this way).
 * @param {URL} u
 * @returns {Promise<ResolvedModel>}
 */
async function resolveGitHubRelease(u) {
  const [owner, repo, , kind, tag] = u.pathname.split('/').filter(Boolean);
  const which = kind === 'tag' && tag ? `tags/${encodeURIComponent(decodeURIComponent(tag))}` : 'latest';
  const res = await httpGetJson(`https://api.github.com/repos/${owner}/${repo}/releases/${which}`, {
    headers: { 'User-Agent': 'Darkroom/1.0', Accept: 'application/vnd.github+json' },
  });
  if (res.status !== 200 || !res.json) throw new Error(`GitHub release lookup failed (${res.status}).`);
  const candidates = (res.json.assets || [])
    .filter((a) => typeof a?.name === 'string' && WEIGHT_RE.test(a.name) && a.browser_download_url)
    .map((a) => ({ path: a.name, size: Number(a.size) || 0, downloadUrl: a.browser_download_url, filename: a.name }))
    .sort((a, b) => b.size - a.size);
  return pickCandidate(candidates, `${owner}/${repo} ${res.json.tag_name || ''}`.trim());
}

/**
 * OpenModelDB (openmodeldb.info) — the upscaler catalogue. Its entries link out to GitHub,
 * Hugging Face, Drive or plain storage; the first one we can download is used.
 * @param {URL} u
 * @returns {Promise<ResolvedModel>}
 */
async function resolveOpenModelDb(u) {
  const id = u.pathname.match(/^\/models\/([^/]+)/)?.[1];
  if (!id) throw new Error('Unrecognised OpenModelDB link — open a model page (openmodeldb.info/models/…)');
  const res = await httpGetJson(
    `https://raw.githubusercontent.com/OpenModelDB/open-model-database/main/data/models/${encodeURIComponent(decodeURIComponent(id))}.json`,
    { headers: { 'User-Agent': 'Darkroom/1.0' } },
  );
  if (res.status !== 200 || !res.json) throw new Error(`OpenModelDB lookup failed (${res.status}).`);
  const urls = (res.json.resources || [])
    .filter((r) => r?.platform === 'pytorch' || /^(pth|safetensors)$/i.test(String(r?.type)))
    .flatMap((r) => r.urls || []);
  for (const link of urls) {
    try {
      const host = new URL(link).hostname;
      // folders and sites that need a browser (Mega, Icedrive, Drive folders) can't be fetched
      if (/(^|\.)(mega\.nz|icedrive\.net)$/i.test(host) || /\/folders\//.test(link)) continue;
      const found = await resolveModelUrl(link);
      return { ...found, modelName: res.json.name ? `${res.json.name} (${id})` : found.modelName };
    } catch {
      // try the next mirror
    }
  }
  throw new Error(`None of this model's download links can be fetched automatically (${urls.join(', ') || 'none listed'}). Download it in your browser, then add the file with "Local path" or "Or upload a copy".`);
}

/**
 * @param {{ path: string, size: number, downloadUrl: string, filename: string }[]} candidates biggest first
 * @param {string} modelName
 * @returns {ResolvedModel}
 */
function pickCandidate(candidates, modelName) {
  if (!candidates.length) throw new Error(`No model files (.safetensors, .pth…) found in ${modelName}`);
  const first = candidates[0];
  return {
    downloadUrl: first.downloadUrl,
    filename: first.filename,
    triggerWords: [],
    previewUrl: null,
    modelName: candidates.length === 1 ? `${modelName}/${first.path}` : modelName,
    candidates,
  };
}

/**
 * @param {string} pageUrl
 * @param {string} token
 */
async function resolveCivitai(pageUrl, token) {
  const u = new URL(pageUrl);
  // civitai.red has the same API (and shows mature models .com hides); .green just redirects to .com
  const api = /(^|\.)civitai\.red$/i.test(u.hostname) ? 'https://civitai.red' : 'https://civitai.com';
  const versionParam = u.searchParams.get('modelVersionId');
  let versionId = versionParam;
  const downloadMatch = u.pathname.match(/\/api\/download\/models\/(\d+)/);
  const modelMatch = downloadMatch ? null : u.pathname.match(/\/models\/(\d+)/);
  const versionMatch = u.pathname.match(/\/model-versions\/(\d+)/) || downloadMatch;
  if (versionMatch) versionId = versionMatch[1];

  /** @type {any} */
  let version;
  const headers = {
    'User-Agent': 'Darkroom/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (versionId) {
    const res = await httpGetJson(`${api}/api/v1/model-versions/${versionId}`, {
      headers,
    });
    if (res.status !== 200 || !res.json) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? downloadErrorMessage(res.status, 'civitai.com', Boolean(token))
          : `Civitai version lookup failed (${res.status}).`,
      );
    }
    version = res.json;
  } else if (modelMatch) {
    const res = await httpGetJson(`${api}/api/v1/models/${modelMatch[1]}`, {
      headers,
    });
    if (res.status !== 200 || !res.json) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? downloadErrorMessage(res.status, 'civitai.com', Boolean(token))
          : `Civitai model lookup failed (${res.status})`,
      );
    }
    version = res.json.modelVersions?.[0];
    if (!version) throw new Error('No model versions found on Civitai');
  } else {
    throw new Error('Unrecognised Civitai link — open a model page (civitai.com/models/…)');
  }

  const files = Array.isArray(version.files) ? version.files : [];
  const file =
    files.find((f) => /\.safetensors$/i.test(f.name || '') && String(f.type || '') !== 'VAE') ||
    files.find((f) => /\.safetensors$/i.test(f.name || '')) ||
    files.find((f) => f.downloadUrl) ||
    null;
  if (!file?.downloadUrl) throw new Error('No downloadable file found on this Civitai version');

  const preview =
    (version.images || []).find((img) => img.url && !/\.mp4$/i.test(img.url))?.url || null;

  /** @type {ResolvedModel['companions']} */
  const companions = [];
  for (const f of files) {
    if (!f?.downloadUrl || !f.name) continue;
    const fType = String(f.type || '');
    if (fType !== 'VAE' && !/vae/i.test(f.name)) continue;
    if (f.name === file.name) continue;
    const hashes = f.hashes || {};
    companions.push({
      path: f.name,
      size: Number(f.sizeKB ? f.sizeKB * 1024 : f.size || 0) || 0,
      downloadUrl: f.downloadUrl,
      filename: f.name,
      fileType: 'VAE',
      sha256: hashes.SHA256 || hashes.sha256 || undefined,
    });
  }

  return {
    downloadUrl: file.downloadUrl,
    filename: file.name || `civitai_${version.id}.safetensors`,
    triggerWords: Array.isArray(version.trainedWords) ? version.trainedWords : [],
    previewUrl: preview,
    modelName: version.model?.name || version.name || file.name,
    baseModel: typeof version.baseModel === 'string' ? version.baseModel : null,
    companions: companions.length ? companions : undefined,
    // Files whose creator requires sign-in only download with the key
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/**
 * @param {string} pageUrl
 */
function parseHuggingFaceUrl(pageUrl) {
  const u = new URL(pageUrl);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Unrecognised Hugging Face link — expected huggingface.co/owner/repo');
  }
  const owner = parts[0];
  const repo = parts[1];
  /** @type {string | null} */
  let rev = 'main';
  /** @type {string | null} */
  let filePath = null;

  if (parts[2] === 'blob' || parts[2] === 'resolve' || parts[2] === 'tree') {
    rev = parts[3] || 'main';
    const rest = parts.slice(4).join('/');
    filePath = rest ? decodeURIComponent(rest) : null;
  }

  return { owner, repo, rev, filePath, repoId: `${owner}/${repo}` };
}

/**
 * @param {string} pageUrl
 * @param {string} token
 * @param {string} origin https://huggingface.co, or a mirror (which is never sent the token)
 * @returns {Promise<ResolvedModel>}
 */
async function resolveHuggingFace(pageUrl, token, origin) {
  const { rev, filePath, repoId } = parseHuggingFaceUrl(pageUrl);
  const headers = {
    'User-Agent': 'Darkroom/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Direct file link: .../blob|resolve/<rev>/<file>
  if (filePath && WEIGHT_RE.test(filePath)) {
    const downloadUrl = `${origin}/${repoId}/resolve/${rev}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
    const filename = path.basename(filePath);
    return {
      downloadUrl,
      filename,
      triggerWords: [],
      previewUrl: null,
      modelName: `${repoId}/${filePath}`,
      headers,
    };
  }

  // Repo (or folder) page — list weight files via the HF API
  const treeUrl = `${origin}/api/models/${repoId}/tree/${encodeURIComponent(rev || 'main')}?recursive=true`;
  const res = await httpGetJson(treeUrl, { headers });
  if (res.status !== 200 || !Array.isArray(res.json)) {
    throw new Error(
      `Hugging Face listing failed (${res.status}). Check the repo URL` +
        (token ? '' : ' or set HF_TOKEN for gated models') +
        '.',
    );
  }

  const prefix = filePath ? `${filePath.replace(/\/$/, '')}/` : '';
  /** @type {{ path: string, size: number, downloadUrl: string, filename: string }[]} */
  const candidates = [];
  for (const entry of res.json) {
    if (entry?.type !== 'file' || typeof entry.path !== 'string') continue;
    if (!WEIGHT_RE.test(entry.path)) continue;
    if (prefix && !entry.path.startsWith(prefix) && entry.path !== filePath) continue;
    const size = Number(entry.size) || 0;
    // Skip tiny non-models (configs sometimes misnamed); keep real shards
    if (size > 0 && size < 1024 * 1024) continue;
    candidates.push({
      path: entry.path,
      size,
      downloadUrl: `${origin}/${repoId}/resolve/${rev}/${entry.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      filename: path.basename(entry.path),
    });
  }

  candidates.sort((a, b) => b.size - a.size);
  if (candidates.length === 0) {
    throw new Error(`No .safetensors / weight files found in ${repoId}`);
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      downloadUrl: only.downloadUrl,
      filename: only.filename,
      triggerWords: [],
      previewUrl: null,
      modelName: `${repoId}/${only.path}`,
      headers,
      candidates,
    };
  }

  // Multiple files — caller should prompt; still set a default to the largest
  const largest = candidates[0];
  return {
    downloadUrl: largest.downloadUrl,
    filename: largest.filename,
    triggerWords: [],
    previewUrl: null,
    modelName: repoId,
    headers,
    candidates,
  };
}

/**
 * Save sidecar metadata next to the model.
 * @param {string} modelDest
 * @param {{ triggerWords?: string[], previewUrl?: string | null, sourceUrl?: string, modelName?: string, baseModel?: string | null, headers?: Record<string, string> }} meta
 */
export async function saveModelSidecars(modelDest, meta) {
  const base = modelDest.replace(/\.[^.]+$/, '');
  const metaPath = `${base}.darkroom.json`;
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        modelName: meta.modelName || null,
        sourceUrl: meta.sourceUrl || null,
        triggerWords: meta.triggerWords || [],
        baseModel: meta.baseModel || null,
        preview: meta.previewUrl ? path.basename(`${base}.preview.jpg`) : null,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  if (meta.previewUrl) {
    const previewPath = `${base}.preview.jpg`;
    try {
      await downloadFile(meta.previewUrl, previewPath, { headers: meta.headers });
    } catch {
      // preview is best-effort
    }
  }
}

/** Settings → Models → Civitai auto-fetch (mirrored to .env as CIVITAI_AUTO_FETCH). */
export function civitaiAutoFetchEnabled() {
  const value = loadEnvFile().CIVITAI_AUTO_FETCH ?? process.env.CIVITAI_AUTO_FETCH ?? '';
  return value.toLowerCase() === 'true';
}

/** @param {string} filePath */
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Identify a local model file on Civitai by its SHA256 and save sidecars
 * (trigger words + preview). Returns false when Civitai doesn't know the file.
 * @param {string} modelDest installed model path (symlinks are followed)
 */
export async function fetchCivitaiSidecarsByHash(modelDest) {
  const cfg = getConfig();
  const sha = await sha256OfFile(modelDest);
  const res = await httpGetJson(`https://civitai.com/api/v1/model-versions/by-hash/${sha}`, {
    headers: {
      'User-Agent': 'Darkroom/1.0',
      ...(cfg.civitaiToken ? { Authorization: `Bearer ${cfg.civitaiToken}` } : {}),
    },
  });
  if (res.status === 404 || !res.json?.id) return false;
  if (res.status !== 200) throw new Error(`Civitai lookup failed (${res.status})`);
  const version = res.json;
  const preview =
    (version.images || []).find((img) => img.url && !/\.mp4$/i.test(img.url))?.url || null;
  await saveModelSidecars(modelDest, {
    triggerWords: Array.isArray(version.trainedWords) ? version.trainedWords : [],
    previewUrl: preview,
    sourceUrl: `https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`,
    modelName: version.model?.name || version.name,
    baseModel: typeof version.baseModel === 'string' ? version.baseModel : null,
  });
  return true;
}

export function downloadsCacheDir() {
  ensureLogsDir();
  const dir = path.join(logsDir, 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

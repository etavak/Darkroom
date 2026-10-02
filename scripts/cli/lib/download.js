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
export function downloadFile(url, destPath, opts = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = `${destPath}.partial`;
    /** @type {http.ClientRequest} */
    let req;

    const go = (currentUrl, redirects = 0) => {
      if (redirects > 10) {
        reject(new Error('Too many redirects'));
        return;
      }
      const u = new URL(currentUrl);
      const lib = u.protocol === 'https:' ? https : http;
      req = lib.get(
        currentUrl,
        {
          headers: {
            'User-Agent': 'Darkroom/1.0',
            ...(opts.headers ?? {}),
          },
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
            reject(new Error(`Download failed HTTP ${code}`));
            return;
          }
          const ctype = String(res.headers['content-type'] || '');
          if (/text\/html/i.test(ctype)) {
            res.resume();
            reject(
              new Error(
                'URL returned HTML instead of a model file. Use a direct file link, or a Hugging Face / Civitai model page.',
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
          out.on('finish', () => {
            if (!opts.quiet) process.stdout.write('\n');
            fs.renameSync(tmp, destPath);
            resolve({ destPath, bytes: transferred });
          });
          out.on('error', reject);
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
 *   headers?: Record<string, string>,
 *   candidates?: { path: string, size: number, downloadUrl: string, filename: string, fileType?: string }[],
 *   companions?: ResolvedCompanion[],
 * }} ResolvedModel
 */

/**
 * @param {string} pageUrl
 * @returns {Promise<ResolvedModel>}
 */
export async function resolveModelUrl(pageUrl) {
  const cfg = getConfig();
  if (/civitai\.com/i.test(pageUrl)) {
    return resolveCivitai(pageUrl, cfg.civitaiToken);
  }
  if (/huggingface\.co/i.test(pageUrl)) {
    return resolveHuggingFace(pageUrl, cfg.hfToken);
  }
  // Direct file URL
  const u = new URL(pageUrl);
  const filename = path.basename(u.pathname) || 'model.safetensors';
  if (!WEIGHT_RE.test(filename)) {
    throw new Error(
      'That looks like a page URL, not a model file. Paste a Hugging Face / Civitai model page, or a direct .safetensors link.',
    );
  }
  return {
    downloadUrl: pageUrl,
    filename,
    triggerWords: [],
    previewUrl: null,
    modelName: filename,
  };
}

/**
 * @param {string} pageUrl
 * @param {string} token
 */
async function resolveCivitai(pageUrl, token) {
  const u = new URL(pageUrl);
  const versionParam = u.searchParams.get('modelVersionId');
  let versionId = versionParam;
  const modelMatch = u.pathname.match(/\/models\/(\d+)/);
  const versionMatch = u.pathname.match(/\/model-versions\/(\d+)/);
  if (versionMatch) versionId = versionMatch[1];

  /** @type {any} */
  let version;
  const headers = {
    'User-Agent': 'Darkroom/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (versionId) {
    const res = await httpGetJson(`https://civitai.com/api/v1/model-versions/${versionId}`, {
      headers,
    });
    if (res.status !== 200 || !res.json) {
      throw new Error(`Civitai version lookup failed (${res.status}). Check CIVITAI_TOKEN for early-access files.`);
    }
    version = res.json;
  } else if (modelMatch) {
    const res = await httpGetJson(`https://civitai.com/api/v1/models/${modelMatch[1]}`, {
      headers,
    });
    if (res.status !== 200 || !res.json) {
      throw new Error(`Civitai model lookup failed (${res.status})`);
    }
    version = res.json.modelVersions?.[0];
    if (!version) throw new Error('No model versions found on Civitai');
  } else {
    throw new Error('Unrecognized Civitai URL — use a model or model version page');
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
    companions: companions.length ? companions : undefined,
  };
}

/**
 * @param {string} pageUrl
 */
function parseHuggingFaceUrl(pageUrl) {
  const u = new URL(pageUrl);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Unrecognized Hugging Face URL — expected huggingface.co/owner/repo');
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
 * @returns {Promise<ResolvedModel>}
 */
async function resolveHuggingFace(pageUrl, token) {
  const { rev, filePath, repoId } = parseHuggingFaceUrl(pageUrl);
  const headers = {
    'User-Agent': 'Darkroom/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Direct file link: .../blob|resolve/<rev>/<file>
  if (filePath && WEIGHT_RE.test(filePath)) {
    const downloadUrl = `https://huggingface.co/${repoId}/resolve/${rev}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
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
  const treeUrl = `https://huggingface.co/api/models/${repoId}/tree/${encodeURIComponent(rev || 'main')}?recursive=true`;
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
      downloadUrl: `https://huggingface.co/${repoId}/resolve/${rev}/${entry.path
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
 * @param {{ triggerWords?: string[], previewUrl?: string | null, sourceUrl?: string, modelName?: string, headers?: Record<string, string> }} meta
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

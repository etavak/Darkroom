import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { URL } from 'node:url';
import { getConfig } from './env.js';
import { httpGetJson } from './http.js';
import { ensureLogsDir, logsDir } from './paths.js';

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
 * @param {{ headers?: Record<string, string> }} [opts]
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
          const total = Number(res.headers['content-length'] || 0);
          let transferred = 0;
          const out = fs.createWriteStream(tmp);
          res.on('data', (chunk) => {
            transferred += chunk.length;
            writeProgress(process.stdout, transferred, total);
          });
          res.pipe(out);
          out.on('finish', () => {
            process.stdout.write('\n');
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
 * @param {string} pageUrl
 * @returns {Promise<{ downloadUrl: string, filename: string, triggerWords: string[], previewUrl: string | null, modelName: string }>}
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

  const file =
    (version.files || []).find((f) => /\.safetensors$/i.test(f.name || '')) ||
    (version.files || []).find((f) => f.downloadUrl) ||
    null;
  if (!file?.downloadUrl) throw new Error('No downloadable file found on this Civitai version');

  const preview =
    (version.images || []).find((img) => img.url && !/\.mp4$/i.test(img.url))?.url || null;

  return {
    downloadUrl: file.downloadUrl,
    filename: file.name || `civitai_${version.id}.safetensors`,
    triggerWords: Array.isArray(version.trainedWords) ? version.trainedWords : [],
    previewUrl: preview,
    modelName: version.model?.name || version.name || file.name,
  };
}

/**
 * @param {string} pageUrl
 * @param {string} token
 */
async function resolveHuggingFace(pageUrl, token) {
  // Accept resolve/main/... direct links or blob links
  let downloadUrl = pageUrl;
  if (pageUrl.includes('/blob/')) {
    downloadUrl = pageUrl.replace('/blob/', '/resolve/');
  }
  const u = new URL(downloadUrl);
  const filename = path.basename(u.pathname) || 'model.safetensors';
  return {
    downloadUrl,
    filename,
    triggerWords: [],
    previewUrl: null,
    modelName: filename,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

export function downloadsCacheDir() {
  ensureLogsDir();
  const dir = path.join(logsDir, 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

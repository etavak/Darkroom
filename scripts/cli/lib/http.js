import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function httpGetOk(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let lib;
    try {
      lib = url.startsWith('https') ? https : http;
    } catch {
      resolve(false);
      return;
    }
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * @param {string} url
 * @param {{ headers?: Record<string, string>, timeoutMs?: number }} [opts]
 * @returns {Promise<{ status: number, json: any, text: string }>}
 */
export function httpGetJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      { headers: opts.headers ?? {}, timeout: opts.timeoutMs ?? 30_000 },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // ignore
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out: ${url}`));
    });
  });
}

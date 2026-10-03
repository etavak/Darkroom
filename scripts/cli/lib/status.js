import os from 'node:os';
import { getConfig } from './env.js';
import { httpGetJson, httpGetOk } from './http.js';
import { isPidAlive, readPids } from './process.js';
import { buildStale } from './server.js';

/**
 * @returns {Promise<{ comfy: boolean, server: boolean, comfyUrl: string, appUrl: string, lanUrls: string[], pin: string | null, devices: number | null, stale: { client: boolean, server: boolean } }>}
 */
export async function getServiceStatus() {
  const cfg = getConfig();
  const [comfy, server] = await Promise.all([httpGetOk(`${cfg.comfyUrl}/system_stats`), httpGetOk(`${cfg.appUrl}/api/health`)]);
  let pin = null;
  let devices = null;
  if (server) {
    // The server only answers these for requests from this computer
    const [lan, dev] = await Promise.all([
      httpGetJson(`${cfg.appUrl}/api/auth/lan`, { timeoutMs: 3000 }).catch(() => null),
      httpGetJson(`${cfg.appUrl}/api/auth/devices`, { timeoutMs: 3000 }).catch(() => null),
    ]);
    if (lan?.status === 200 && typeof lan.json?.pin === 'string') pin = lan.json.pin;
    if (dev?.status === 200 && Array.isArray(dev.json?.items)) devices = dev.json.items.length;
  }
  let stale = { client: false, server: false };
  try {
    stale = buildStale();
  } catch {
    // no build yet
  }
  return { comfy, server, comfyUrl: cfg.comfyUrl, appUrl: cfg.appUrl, lanUrls: listLanUrls(cfg.port), pin, devices, stale };
}

export function listLanUrls(port) {
  /** @type {string[]} */
  const urls = [];
  let nets;
  try {
    nets = os.networkInterfaces();
  } catch {
    return urls;
  }
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const e of entries) {
      if (e.family !== 'IPv4' && e.family !== 4) continue;
      if (e.internal) continue;
      urls.push(`http://${e.address}:${port}`);
    }
  }
  return urls;
}

export function formatStatusHeader(status) {
  const pids = readPids();
  const pidOf = (k) => (pids[k] && isPidAlive(pids[k].pid) ? `  pid ${pids[k].pid}` : '');
  const host = (u) => u.replace(/^https?:\/\//, '');
  const lines = [
    `ComfyUI    ${status.comfy ? 'online ' : 'offline'}  ${host(status.comfyUrl)}${pidOf('comfy')}`,
    `Darkroom   ${status.server ? 'online ' : 'offline'}  ${status.appUrl}${pidOf('server')}`,
  ];
  if (status.server && status.lanUrls.length) {
    const devices =
      status.devices === null ? '' : status.devices === 0 ? '  ·  no devices signed in' : `  ·  ${status.devices} device${status.devices === 1 ? '' : 's'} signed in`;
    lines.push(`Phones     ${status.lanUrls[0]}${status.pin ? `  ·  PIN ${status.pin}` : ''}${devices}`);
  }
  if (status.server && (status.stale.server || status.stale.client)) {
    lines.push('', 'Update ready — choose “Restart server” to apply it (ComfyUI keeps running).');
  }
  return lines.join('\n');
}

import os from 'node:os';
import { getConfig } from './env.js';
import { httpGetOk } from './http.js';
import { isPidAlive, readPids } from './process.js';

/**
 * @returns {Promise<{ comfy: boolean, server: boolean, comfyUrl: string, appUrl: string, lanUrls: string[] }>}
 */
export async function getServiceStatus() {
  const cfg = getConfig();
  const comfy = await httpGetOk(`${cfg.comfyUrl}/system_stats`);
  const server = await httpGetOk(`${cfg.appUrl}/api/health`);
  return {
    comfy,
    server,
    comfyUrl: cfg.comfyUrl,
    appUrl: cfg.appUrl,
    lanUrls: listLanUrls(cfg.port),
  };
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
  const comfyLabel = status.comfy ? 'online' : 'offline';
  const serverLabel = status.server ? 'online' : 'offline';
  const pids = readPids();
  const comfyPid =
    pids.comfy && isPidAlive(pids.comfy.pid) ? ` pid ${pids.comfy.pid}` : '';
  const serverPid =
    pids.server && isPidAlive(pids.server.pid) ? ` pid ${pids.server.pid}` : '';
  return `ComfyUI ${comfyLabel}${comfyPid}  ·  Server ${serverLabel}${serverPid}`;
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { config } from '../config.js';

/**
 * LAN access control. Requests from this computer are trusted; other devices
 * must enter a PIN once (shown in the launcher / Preferences on this computer)
 * and then carry a session cookie.
 */

const authPath = path.join(config.dataDir, 'lan-auth.json');
export const SESSION_COOKIE = 'darkroom_session';
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 365;
const MAX_FAILS = 5;
const LOCKOUT_MS = 60_000;

type Session = { hash: string; createdAt: number; lastSeen: number; userAgent: string };
type AuthFile = { pin: string; sessions: Session[] };

let cache: AuthFile | null = null;

function newPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function load(): AuthFile {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Partial<AuthFile>;
    if (typeof raw.pin === 'string' && /^\d{6}$/.test(raw.pin)) {
      cache = { pin: raw.pin, sessions: Array.isArray(raw.sessions) ? raw.sessions : [] };
      return cache;
    }
  } catch {
    // first run — create below
  }
  cache = { pin: newPin(), sessions: [] };
  save();
  return cache;
}

function save() {
  if (!cache) return;
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(cache, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function getLanPin(): string {
  return load().pin;
}

/** New PIN; every device signed in with the old one must enter the new PIN. */
export function regenerateLanPin(): string {
  const file = load();
  file.pin = newPin();
  file.sessions = [];
  save();
  return file.pin;
}

// ── Who is asking ───────────────────────────────────────────────────────────

function normalizeIp(addr: string | undefined): string {
  return (addr ?? '').replace(/^::ffff:/, '');
}

function ownAddresses(): Set<string> {
  const out = new Set<string>(['127.0.0.1', '::1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries ?? []) out.add(normalizeIp(e.address));
  }
  return out;
}

/** True when the request comes from this computer (loopback or one of its own IPs). */
export function isLocalRequest(req: IncomingMessage): boolean {
  const ip = normalizeIp(req.socket.remoteAddress);
  return ip.startsWith('127.') || ownAddresses().has(ip);
}

/**
 * Reject Host headers that aren't this machine (defeats DNS-rebinding pages that
 * point a hostile domain at 127.0.0.1). Extra names: DARKROOM_ALLOWED_HOSTS.
 */
export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true; // HTTP/1.0 clients; browsers always send Host
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true; // IP literal
  const machine = os.hostname().toLowerCase().replace(/\.local$/, '');
  if (host === machine || host === `${machine}.local`) return true;
  const extra = (process.env.DARKROOM_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(host);
}

/** Browser-sent Origin must match the Host it is talking to (blocks cross-site requests). */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (the CLI, curl)
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function hasValidSession(req: IncomingMessage): boolean {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const hash = hashToken(token);
  const session = load().sessions.find((s) => s.hash === hash);
  if (!session) return false;
  // Persist "last seen" at most hourly
  if (Date.now() - session.lastSeen > 3_600_000) {
    session.lastSeen = Date.now();
    save();
  }
  return true;
}

/** Local requests, or remote ones with a valid session. */
export function isAuthorized(req: IncomingMessage): boolean {
  return isLocalRequest(req) || hasValidSession(req);
}

const fails = new Map<string, { count: number; lockedUntil: number }>();

/**
 * Check a PIN from another device. Returns the Set-Cookie value on success.
 * Locks the IP out for a minute after repeated wrong guesses.
 */
export function attemptPin(
  req: IncomingMessage,
  pin: string,
): { ok: true; cookie: string } | { ok: false; error: string; retryAfterS?: number } {
  const ip = normalizeIp(req.socket.remoteAddress);
  const state = fails.get(ip) ?? { count: 0, lockedUntil: 0 };
  if (state.lockedUntil > Date.now()) {
    return {
      ok: false,
      error: 'Too many attempts — wait a minute',
      retryAfterS: Math.ceil((state.lockedUntil - Date.now()) / 1000),
    };
  }
  const expected = Buffer.from(getLanPin());
  const given = Buffer.from(String(pin).replace(/\D/g, '').padEnd(6, 'x').slice(0, 6));
  if (!crypto.timingSafeEqual(expected, given)) {
    state.count += 1;
    if (state.count >= MAX_FAILS) {
      state.count = 0;
      state.lockedUntil = Date.now() + LOCKOUT_MS;
    }
    fails.set(ip, state);
    return { ok: false, error: 'Wrong PIN' };
  }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  const file = load();
  file.sessions.push({
    hash: hashToken(token),
    createdAt: Date.now(),
    lastSeen: Date.now(),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
  });
  save();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_S}; HttpOnly; SameSite=Lax`;
  return { ok: true, cookie };
}

/** A short, readable device description from a user agent ("iPhone · Safari"). */
function describeDevice(ua: string): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return browser ? `${os} · ${browser}` : os;
}

/** Devices signed in with the PIN (ids are a prefix of the session hash, never the token). */
export function listSessions(): Array<{ id: string; device: string; createdAt: number; lastSeen: number }> {
  return load()
    .sessions.map((s) => ({ id: s.hash.slice(0, 16), device: describeDevice(s.userAgent), createdAt: s.createdAt, lastSeen: s.lastSeen }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Sign one device out (host only). */
export function revokeSession(id: string): boolean {
  const file = load();
  const before = file.sessions.length;
  file.sessions = file.sessions.filter((s) => !s.hash.startsWith(id) || id.length < 8);
  if (file.sessions.length === before) return false;
  save();
  return true;
}

/** Sign this device out; returns the Set-Cookie value that clears its cookie. */
export function endOwnSession(req: IncomingMessage): string {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const hash = hashToken(token);
    const file = load();
    const before = file.sessions.length;
    file.sessions = file.sessions.filter((s) => s.hash !== hash);
    if (file.sessions.length !== before) save();
  }
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function lanUrls(): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries ?? []) {
      if ((e.family === 'IPv4' || (e.family as unknown) === 4) && !e.internal) {
        urls.push(`http://${e.address}:${config.port}`);
      }
    }
  }
  return urls;
}

import { Router } from 'express';
import {
  attemptPin,
  endOwnSession,
  listSessions,
  revokeSession,
  getLanPin,
  hasValidSession,
  isLocalRequest,
  lanUrls,
  regenerateLanPin,
} from '../services/lanAuth.js';

export const authRouter = Router();

/** Whether this browser needs the PIN screen. */
authRouter.get('/status', (req, res) => {
  const local = isLocalRequest(req);
  res.json({ local, authorized: local || hasValidSession(req) });
});

/** Another device enters the PIN shown on this computer. */
authRouter.post('/pin', (req, res) => {
  const result = attemptPin(req, String(req.body?.pin ?? ''));
  if (!result.ok) {
    if (result.retryAfterS) res.setHeader('Retry-After', String(result.retryAfterS));
    res.status(result.retryAfterS ? 429 : 401).json({ error: result.error });
    return;
  }
  res.setHeader('Set-Cookie', result.cookie);
  res.json({ ok: true });
});

/** PIN + LAN URLs — only ever shown on this computer (launcher / Preferences). */
authRouter.get('/lan', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Only available on the computer running Darkroom' });
    return;
  }
  res.json({ ...getLanPin(), urls: lanUrls() });
});

authRouter.post('/lan/regenerate', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Only available on the computer running Darkroom' });
    return;
  }
  res.json({ ...regenerateLanPin(), urls: lanUrls() });
});

/** Devices signed in with the PIN — host only. */
authRouter.get('/devices', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Only available on the computer running Darkroom' });
    return;
  }
  res.json({ items: listSessions() });
});

authRouter.delete('/devices/:id', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Only available on the computer running Darkroom' });
    return;
  }
  res.json({ ok: revokeSession(String(req.params.id)) });
});

/** This device signs itself out (it will need the PIN again). */
authRouter.post('/signout', (req, res) => {
  res.setHeader('Set-Cookie', endOwnSession(req));
  res.json({ ok: true });
});

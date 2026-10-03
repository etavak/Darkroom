import { clearInterval, setInterval } from 'node:timers';
import * as p from '@clack/prompts';
import { getConfig } from '../lib/env.js';
import { httpGetJson, httpJson } from '../lib/http.js';
import { handleCancel } from '../lib/prompt.js';
import { listLanUrls } from '../lib/status.js';

/** Wait for any key (Ctrl+C quits). */
function waitForKey() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', (d) => {
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      if (d.toString() === '\u0003') process.exit(0);
      resolve(undefined);
    });
  });
}

/**
 * The sign-in code, live: it changes every 30 seconds, so show it with a countdown until a
 * key is pressed.
 */
async function showLiveCode(appUrl) {
  const fetchCode = async () => {
    const r = await httpGetJson(`${appUrl}/api/auth/lan`, { timeoutMs: 5000 }).catch(() => null);
    return r?.status === 200 && r.json?.pin ? { pin: r.json.pin, until: Date.now() + (r.json.expiresInMs ?? 30_000) } : null;
  };
  let code = await fetchCode();
  if (!code) return;
  const fmt = () => {
    const left = Math.max(0, Math.ceil((code.until - Date.now()) / 1000));
    return `Code  ${code.pin.slice(0, 3)} ${code.pin.slice(3)}   ·   new code in ${left}s   ·   press any key when done`;
  };
  const s = p.spinner();
  s.start(fmt());
  let busy = false;
  const tick = setInterval(async () => {
    if (Date.now() >= code.until && !busy) {
      busy = true;
      code = (await fetchCode()) ?? code;
      busy = false;
    }
    s.message(fmt());
  }, 500);
  await waitForKey();
  clearInterval(tick);
  s.stop('Code shown');
}

/** "3 min ago", "2 h ago", "4 d ago" */
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/**
 * Phones & tablets: the address and PIN to sign in with, the devices signed in (sign one
 * out), or a new PIN (signs every device out). Same as Preferences → Network on this computer.
 */
export async function phonesAndTablets() {
  const cfg = getConfig();
  for (;;) {
    let lan;
    let devices;
    try {
      [lan, devices] = await Promise.all([httpGetJson(`${cfg.appUrl}/api/auth/lan`, { timeoutMs: 5000 }), httpGetJson(`${cfg.appUrl}/api/auth/devices`, { timeoutMs: 5000 })]);
    } catch {
      p.log.warn('The Darkroom server isn’t running — start it first.');
      return;
    }
    if (lan.status !== 200) {
      p.log.warn('The server didn’t share the PIN (it only does for this computer).');
      return;
    }
    const urls = lan.json?.urls?.length ? lan.json.urls : listLanUrls(cfg.port);
    const items = devices.status === 200 && Array.isArray(devices.json?.items) ? devices.json.items : null;
    p.note(
      [
        urls.length ? `Open ${urls[0]} on the phone or tablet` : 'No network address found — is this computer on Wi-Fi?',
        ...urls.slice(1).map((u) => `  or ${u}`),
        'and type the code below. It changes every 30 seconds; signed-in devices stay signed in.',
        '',
        items === null
          ? 'Signed-in devices: restart the server to see them (needs the latest version).'
          : items.length
            ? `Signed in:\n${items.map((d) => `  ${d.device}  ·  last seen ${ago(d.lastSeen)}`).join('\n')}`
            : 'No devices signed in yet.',
      ].join('\n'),
      'Phones & tablets',
    );

    await showLiveCode(cfg.appUrl);

    /** @type {{ value: string, label: string, hint?: string }[]} */
    const options = [];
    if (items?.length) options.push({ value: 'signout', label: 'Sign a device out' });
    options.push(
      { value: 'code', label: 'Show the code again' },
      { value: 'newpin', label: 'Reset codes', hint: 'signs every device out' },
      { value: 'back', label: 'Back' },
    );
    const choice = await p.select({ message: 'Phones & tablets', options });
    if (handleCancel(choice) || choice === 'back') return;

    if (choice === 'signout' && items) {
      const id = await p.select({
        message: 'Sign which device out?',
        options: [...items.map((d) => ({ value: d.id, label: d.device, hint: `last seen ${ago(d.lastSeen)}` })), { value: '', label: 'Cancel' }],
      });
      if (handleCancel(id) || !id) continue;
      const r = await httpJson('DELETE', `${cfg.appUrl}/api/auth/devices/${encodeURIComponent(String(id))}`).catch(() => null);
      if (r?.status === 200) p.log.success('Signed out — it will need the PIN again.');
      else p.log.error('Couldn’t sign that device out.');
    }

    if (choice === 'newpin') {
      const ok = await p.confirm({ message: 'Reset the codes? Every signed-in phone and tablet will need to enter a code again.', initialValue: false });
      if (handleCancel(ok) || !ok) continue;
      const r = await httpJson('POST', `${cfg.appUrl}/api/auth/lan/regenerate`, {}).catch(() => null);
      if (r?.status === 200 && r.json?.pin) p.log.success('Codes reset — every device has been signed out.');
      else p.log.error('Couldn’t reset the codes.');
    }
  }
}

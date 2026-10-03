import * as p from '@clack/prompts';
import { getConfig } from '../lib/env.js';
import { httpGetJson, httpJson } from '../lib/http.js';
import { handleCancel } from '../lib/prompt.js';
import { listLanUrls } from '../lib/status.js';

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
        `and enter PIN ${lan.json.pin}`,
        '',
        items === null
          ? 'Signed-in devices: restart the server to see them (needs the latest version).'
          : items.length
            ? `Signed in:\n${items.map((d) => `  ${d.device}  ·  last seen ${ago(d.lastSeen)}`).join('\n')}`
            : 'No devices signed in yet.',
      ].join('\n'),
      'Phones & tablets',
    );

    /** @type {{ value: string, label: string, hint?: string }[]} */
    const options = [];
    if (items?.length) options.push({ value: 'signout', label: 'Sign a device out' });
    options.push({ value: 'newpin', label: 'Make a new PIN', hint: 'signs every device out' }, { value: 'back', label: 'Back' });
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
      const ok = await p.confirm({ message: 'Make a new PIN? Every phone and tablet will need to enter it again.', initialValue: false });
      if (handleCancel(ok) || !ok) continue;
      const r = await httpJson('POST', `${cfg.appUrl}/api/auth/lan/regenerate`, {}).catch(() => null);
      if (r?.status === 200 && r.json?.pin) p.log.success(`New PIN: ${r.json.pin}`);
      else p.log.error('Couldn’t make a new PIN.');
    }
  }
}

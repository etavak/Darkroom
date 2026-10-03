import fs from 'node:fs';
import path from 'node:path';
import { root } from './paths.js';

const OLD = { mac: 'Darkroom.command', linux: 'Darkroom.sh', windows: 'Darkroom.bat' };

/** What an old Darkroom.bat becomes: opens the new start file once, then deletes itself. */
const WINDOWS_FORWARDER = [
  '@echo off',
  'REM Darkroom\'s start file is now "Start Darkroom (Windows).bat". This opens it once, then removes itself.',
  'cd /d "%~dp0"',
  'call "%~dp0Start Darkroom (Windows).bat" %*',
  '(goto) 2>nul & del "%~f0"',
  '',
].join('\r\n');

/**
 * The start files were renamed ("Darkroom.command" → "Start Darkroom (Mac).command", …).
 * Remove the old ones so there's one obvious file to open. macOS / Linux start scripts
 * replace themselves with node (exec), so deleting them is safe; a running Windows .bat
 * can't be touched, so its own update block swaps in a forwarder next time instead.
 * @param {string} [dir] the Darkroom folder (tests pass a scratch one)
 * @returns {string | null} a note for the user when something was retired
 */
export function retireOldStartFiles(dir = root) {
  const removed = [];
  try {
    for (const name of [OLD.mac, OLD.linux]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        removed.push(name);
      }
    }
    const bat = path.join(dir, OLD.windows);
    if (fs.existsSync(bat) && !fs.existsSync(`${bat}.new`)) {
      if (process.platform === 'win32') fs.writeFileSync(`${bat}.new`, WINDOWS_FORWARDER, 'utf8');
      else fs.rmSync(bat, { force: true });
      removed.push(OLD.windows);
    }
  } catch {
    return null;
  }
  if (!removed.length) return null;
  return process.platform === 'win32'
    ? 'Darkroom\'s start file is now "Start Darkroom (Windows).bat" — the old Darkroom.bat forwards to it once, then disappears.'
    : process.platform === 'darwin'
      ? 'Darkroom\'s start file is now "Start Darkroom (Mac).command" — use that from now on.'
      : 'Darkroom now starts with ./launcher/start-linux.sh.';
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bannerPath = path.join(__dirname, '../assets/banner.txt');

const FALLBACK = `       ########       ######     ########     ####  ####   ########       ######       ######     ####      ####
      ####..####   ####..####   ####..####   ####..##.... ####..####   ####..####   ####..####   ######  ######..
     ####....##.. ####..####.. ####..####.. ######.......####..####.. ####..####.. ####..####.. ##############....
    ####....##...##########...########.....######..  .. ########.....####..####...####..####...####..##..####....
   ####....##...####..####...######.......######....   ######.......####..####...####..####...####......####....
  ####..####...####..####...####..##.... ####..##..   ####..##.... ####..####...####..####...####....  ####....
 ########.....####..####...####..####   ####..####   ####..####     ######...... ######.....####....  ####....
  ............ ............ ..........   ..........   ..........     ..........   .......... ......    ......
   ........     ....  ....   ....  ....   ....  ....   ....  ....     ......       ......     ....      ....`;

/** @returns {string} */
export function getBannerText() {
  try {
    if (fs.existsSync(bannerPath)) {
      return fs.readFileSync(bannerPath, 'utf8').replace(/\s+$/, '');
    }
  } catch {
    // fall through
  }
  return FALLBACK;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Style one character for the shimmer sweep.
 * @param {string} ch
 * @param {number} x
 * @param {number} beamX
 */
function styleChar(ch, x, beamX) {
  if (ch === ' ') return ' ';
  const dist = Math.abs(x - beamX);
  if (dist <= 2) return `\x1b[1m\x1b[97m${ch}\x1b[0m`; // bright white core
  if (dist <= 5) return `\x1b[37m${ch}\x1b[0m`; // white
  if (dist <= 10) return `\x1b[90m${ch}\x1b[0m`; // gray
  return `\x1b[2m${ch}\x1b[0m`; // dim
}

/**
 * Print the Darkroom ASCII banner.
 * Animates a light sweep on interactive TTYs; static otherwise.
 */
export async function printBanner() {
  const art = getBannerText();
  const lines = art.split('\n');
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length), 0);

  if (!process.stdout.isTTY) {
    console.log(`${art}\n`);
    return;
  }

  const frames = 28;
  const span = width + 16;

  for (let f = 0; f < frames; f++) {
    if (f > 0) process.stdout.write(`\x1b[${height}A`);
    const beamX = (f / (frames - 1)) * span - 8;
    for (const line of lines) {
      const padded = line.padEnd(width, ' ');
      let out = '';
      for (let x = 0; x < padded.length; x++) {
        out += styleChar(padded[x], x, beamX);
      }
      process.stdout.write(`\x1b[2K${out}\n`);
    }
    await sleep(28);
  }

  // Settle on dim static banner
  process.stdout.write(`\x1b[${height}A`);
  for (const line of lines) {
    process.stdout.write(`\x1b[2K\x1b[2m${line.padEnd(width, ' ')}\x1b[0m\n`);
  }
  process.stdout.write('\n');
}

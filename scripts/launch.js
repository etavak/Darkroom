#!/usr/bin/env node
/** @deprecated Prefer `node scripts/cli/index.js` — kept for `npm run launch` alias. */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(__dirname, 'cli', 'index.js')).href);

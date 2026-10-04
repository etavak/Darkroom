import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The launcher reads .env through getConfig(); point it at an empty temp file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkroom-launcher-test-'));
process.env.DARKROOM_ENV_FILE = path.join(tmp, '.env');
fs.writeFileSync(process.env.DARKROOM_ENV_FILE, '');
// …and the database (linked-model records) at a temp folder, never server/data
process.env.DARKROOM_DATA_DIR = path.join(tmp, 'data');
for (const k of ['CIVITAI_TOKEN', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'COMFY_DIR']) process.env[k] = '';

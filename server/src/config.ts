import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const serverDir = path.resolve(__dirname, '..');
// History, images, settings and sign-ins. DARKROOM_DATA_DIR points elsewhere (tests use a temp folder).
const dataDir = process.env.DARKROOM_DATA_DIR ? path.resolve(process.env.DARKROOM_DATA_DIR) : path.join(serverDir, 'data');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  comfyUrl: process.env.COMFY_URL ?? 'http://127.0.0.1:8188',
  dataDir,
  imagesDir: path.join(dataDir, 'images'),
  dbPath: path.join(dataDir, 'darkroom.db'),
  rootDir,
  clientDist: path.join(rootDir, 'client', 'dist'),
};

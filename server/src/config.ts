import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const serverDir = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  comfyUrl: process.env.COMFY_URL ?? 'http://127.0.0.1:8188',
  dataDir: path.join(serverDir, 'data'),
  imagesDir: path.join(serverDir, 'data', 'images'),
  dbPath: path.join(serverDir, 'data', 'darkroom.db'),
  clientDist: path.join(rootDir, 'client', 'dist'),
};

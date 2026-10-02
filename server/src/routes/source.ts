import fs from 'node:fs';
import path from 'node:path';
import { Router, raw } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { uploadImage } from '../services/comfyClient.js';

export const sourceRouter = Router();

const expressRawUpload = raw({
  type: '*/*',
  limit: '80mb',
});

function probePngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  // IHDR at offset 16 after signature + length + type
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function probeJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

sourceRouter.post('/upload', expressRawUpload, async (req, res) => {
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
    if (!buf.length) {
      res.status(400).json({ error: 'Empty upload' });
      return;
    }
    const nameParam = typeof req.query.name === 'string' ? req.query.name : 'source.png';
    const ext = path.extname(nameParam) || '.png';
    const localName = `src_${uuidv4()}${ext}`;
    const localPath = path.join(config.imagesDir, localName);
    fs.mkdirSync(config.imagesDir, { recursive: true });
    fs.writeFileSync(localPath, buf);

    const comfyName = await uploadImage(buf, localName);
    const size = probePngSize(buf) ?? probeJpegSize(buf) ?? { width: 0, height: 0 };

    res.json({
      localName,
      comfyName,
      width: size.width,
      height: size.height,
      url: `/api/images/${encodeURIComponent(localName)}`,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

/** Re-upload an existing gallery image into Comfy input. */
sourceRouter.post('/from-gallery', async (req, res) => {
  try {
    const filename = typeof req.body?.filename === 'string' ? path.basename(req.body.filename) : '';
    if (!filename) {
      res.status(400).json({ error: 'filename required' });
      return;
    }
    const localPath = path.join(config.imagesDir, filename);
    if (!fs.existsSync(localPath)) {
      res.status(404).json({ error: 'Gallery image not found' });
      return;
    }
    const buf = fs.readFileSync(localPath);
    const comfyName = await uploadImage(buf, filename);
    const size = probePngSize(buf) ?? probeJpegSize(buf) ?? { width: 0, height: 0 };
    res.json({
      localName: filename,
      comfyName,
      width: size.width,
      height: size.height,
      url: `/api/images/${encodeURIComponent(filename)}`,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

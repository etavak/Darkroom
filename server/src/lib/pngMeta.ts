import type { GenerationSettings } from '../workflow/types.js';

/** CRC32 for PNG chunks. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeTextChunk(key: string, value: string): Buffer {
  const keyBuf = Buffer.from(key, 'latin1');
  const valBuf = Buffer.from(value, 'utf8');
  const data = Buffer.concat([keyBuf, Buffer.from([0]), valBuf]);
  const type = Buffer.from('tEXt');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([len, type, data, crcBuf]);
}

/** Insert tEXt chunks before IEND. No-op if not a PNG. */
export function injectPngText(png: Buffer, texts: Record<string, string>): Buffer {
  if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) return png;
  let offset = 8;
  let iendAt = -1;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > png.length) break;
    if (type === 'IEND') {
      iendAt = offset;
      break;
    }
    offset = dataEnd + 4;
  }
  if (iendAt < 0) return png;

  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(texts)) {
    if (!key || value == null) continue;
    // tEXt keys are latin1; keep short ASCII keys
    const safeKey = key.replace(/[^\x20-\x7E]/g, '').slice(0, 79);
    if (!safeKey) continue;
    chunks.push(makeTextChunk(safeKey, value));
  }
  if (chunks.length === 0) return png;
  return Buffer.concat([png.subarray(0, iendAt), ...chunks, png.subarray(iendAt)]);
}

/** A1111-style parameters string + Darkroom JSON. */
export function buildPngMetadataTexts(settings: GenerationSettings): Record<string, string> {
  const parts = [
    `Steps: ${settings.steps}`,
    `Sampler: ${settings.sampler}`,
    `Schedule type: ${settings.scheduler}`,
    `CFG scale: ${settings.cfg}`,
    `Seed: ${settings.seed}`,
    `Size: ${settings.width}x${settings.height}`,
    `Model: ${settings.checkpoint}`,
  ];
  if (typeof settings.clipSkip === 'number') parts.push(`Clip skip: ${settings.clipSkip}`);
  if (typeof settings.guidance === 'number') parts.push(`Guidance: ${settings.guidance}`);
  if (typeof settings.denoise === 'number' && settings.denoise < 1) {
    parts.push(`Denoising strength: ${settings.denoise}`);
  }

  const parameters = [
    settings.prompt,
    `Negative prompt: ${settings.negative_prompt}`,
    parts.join(', '),
  ].join('\n');

  return {
    parameters,
    darkroom: JSON.stringify({
      version: 1,
      settings,
    }),
  };
}

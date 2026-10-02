export type ParsedImageSettings = {
  prompt?: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  sampler?: string;
  scheduler?: string;
  checkpoint?: string;
  clipSkip?: number;
  guidance?: number;
  denoise?: number;
  /** Full settings blob when Darkroom embedded JSON is present */
  settings?: Record<string, unknown>;
  raw?: Record<string, string>;
};

/** Parse PNG tEXt / iTXt chunks for generation metadata. */
export async function parseImageSettings(file: File): Promise<ParsedImageSettings | null> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // PNG signature
  const isPng =
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (!isPng) return null;

  /** @type {Record<string, string>} */
  const texts: Record<string, string> = {};
  let offset = 8;
  const view = new DataView(buf);

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;

    if (type === 'tEXt') {
      const data = bytes.slice(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = new TextDecoder().decode(data.slice(0, nul));
        const value = new TextDecoder().decode(data.slice(nul + 1));
        texts[key] = value;
      }
    } else if (type === 'iTXt') {
      const data = bytes.slice(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = new TextDecoder().decode(data.slice(0, nul));
        // skip compression flag, method, language, translated key
        let i = nul + 1;
        i += 2; // compression
        while (i < data.length && data[i] !== 0) i++;
        i++;
        while (i < data.length && data[i] !== 0) i++;
        i++;
        const value = new TextDecoder().decode(data.slice(i));
        texts[key] = value;
      }
    }

    if (type === 'IEND') break;
    offset = dataEnd + 4; // CRC
  }

  if (Object.keys(texts).length === 0) return null;

  // Darkroom full settings JSON
  if (texts.darkroom) {
    try {
      const parsed = JSON.parse(texts.darkroom) as {
        settings?: Record<string, unknown>;
      };
      const s = parsed.settings;
      if (s && typeof s === 'object') {
        return {
          prompt: typeof s.prompt === 'string' ? s.prompt : undefined,
          negative_prompt:
            typeof s.negative_prompt === 'string' ? s.negative_prompt : undefined,
          seed: typeof s.seed === 'number' ? s.seed : undefined,
          steps: typeof s.steps === 'number' ? s.steps : undefined,
          cfg: typeof s.cfg === 'number' ? s.cfg : undefined,
          width: typeof s.width === 'number' ? s.width : undefined,
          height: typeof s.height === 'number' ? s.height : undefined,
          sampler: typeof s.sampler === 'string' ? s.sampler : undefined,
          scheduler: typeof s.scheduler === 'string' ? s.scheduler : undefined,
          checkpoint: typeof s.checkpoint === 'string' ? s.checkpoint : undefined,
          clipSkip: typeof s.clipSkip === 'number' ? s.clipSkip : undefined,
          guidance: typeof s.guidance === 'number' ? s.guidance : undefined,
          denoise: typeof s.denoise === 'number' ? s.denoise : undefined,
          settings: s,
          raw: texts,
        };
      }
    } catch {
      // fall through
    }
  }

  // A1111-style "parameters"
  if (texts.parameters) {
    return parseA1111Parameters(texts.parameters, texts);
  }

  // ComfyUI prompt JSON
  if (texts.prompt) {
    try {
      const graph = JSON.parse(texts.prompt) as Record<
        string,
        { class_type?: string; inputs?: Record<string, unknown> }
      >;
      return parseComfyPrompt(graph, texts);
    } catch {
      // fall through
    }
  }

  return { raw: texts };
}

function parseA1111Parameters(params: string, raw: Record<string, string>) {
  const lines = params.split(/\r?\n/);
  const prompt = lines[0] ?? '';
  let negative = '';
  let metaLine = '';
  for (const line of lines.slice(1)) {
    if (line.startsWith('Negative prompt:')) {
      negative = line.replace(/^Negative prompt:\s*/, '');
    } else if (line.includes('Steps:') || line.includes('Seed:')) {
      metaLine = line;
    }
  }
  const num = (re: RegExp) => {
    const m = metaLine.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const str = (re: RegExp) => {
    const m = metaLine.match(re);
    return m ? m[1] : undefined;
  };
  const size = metaLine.match(/Size:\s*(\d+)x(\d+)/i);
  return {
    prompt,
    negative_prompt: negative,
    steps: num(/Steps:\s*([\d.]+)/i),
    seed: num(/Seed:\s*(\d+)/i),
    cfg: num(/CFG scale:\s*([\d.]+)/i),
    width: size ? Number(size[1]) : undefined,
    height: size ? Number(size[2]) : undefined,
    sampler: str(/Sampler:\s*([^,]+)/i)?.trim(),
    checkpoint: str(/Model:\s*([^,]+)/i)?.trim(),
    raw,
  };
}

function parseComfyPrompt(
  graph: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>,
  raw: Record<string, string>,
) {
  let prompt: string | undefined;
  let negative: string | undefined;
  let seed: number | undefined;
  let steps: number | undefined;
  let cfg: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let sampler: string | undefined;
  let checkpoint: string | undefined;

  for (const node of Object.values(graph)) {
    const t = node.class_type ?? '';
    const inputs = node.inputs ?? {};
    if (t === 'CLIPTextEncode' && typeof inputs.text === 'string') {
      if (!prompt) prompt = inputs.text;
      else if (!negative) negative = inputs.text;
    }
    if (t === 'KSampler' || t === 'KSamplerAdvanced') {
      if (typeof inputs.seed === 'number') seed = inputs.seed;
      if (typeof inputs.steps === 'number') steps = inputs.steps;
      if (typeof inputs.cfg === 'number') cfg = inputs.cfg;
      if (typeof inputs.sampler_name === 'string') sampler = inputs.sampler_name;
    }
    if (t === 'EmptyLatentImage') {
      if (typeof inputs.width === 'number') width = inputs.width;
      if (typeof inputs.height === 'number') height = inputs.height;
    }
    if (t === 'CheckpointLoaderSimple' && typeof inputs.ckpt_name === 'string') {
      checkpoint = inputs.ckpt_name;
    }
  }

  return { prompt, negative_prompt: negative, seed, steps, cfg, width, height, sampler, checkpoint, raw };
}

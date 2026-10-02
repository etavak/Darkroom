import type { ModelCatalog, ModelLoadMode } from '@/types/generation';
import type { FamilySummary } from '@/types/presets';

export type MissingSlot = {
  kind: 'text_encoder' | 'vae' | 'diffusion' | 'checkpoint';
  key: string;
  label: string;
  /** Index into clipName / clipName2 for TE slots */
  slotIndex?: number;
};

export type Readiness = {
  ready: boolean;
  reason: string | null;
  missing: MissingSlot[];
  needsGguf: boolean;
  nothingInstalled: boolean;
};

function matchHint(filename: string, hints: string[]): boolean {
  const lower = filename.toLowerCase();
  return hints.some((h) => lower.includes(h.toLowerCase()));
}

export function findByHints(options: string[], hints: string[]): string | undefined {
  if (!hints.length) return undefined;
  return options.find((o) => matchHint(o, hints));
}

/** Infer a likely family from diffusion filename when unmapped. */
export function inferFamilyFromDiffusion(
  unet: string,
  families: FamilySummary[],
): FamilySummary | null {
  const lower = unet.toLowerCase();
  if (lower.includes('klein') || lower.includes('flux-2') || lower.includes('flux2')) {
    return (
      families.find((f) => f.id === 'flux2-klein') ??
      families.find((f) => f.id === 'flux') ??
      null
    );
  }
  if (lower.includes('flux') || lower.includes('schnell') || lower.includes('dev-')) {
    return families.find((f) => f.id === 'flux') ?? null;
  }
  if (lower.includes('sd3') || lower.includes('stable-diffusion-3')) {
    return families.find((f) => f.id === 'sd3') ?? null;
  }
  return null;
}

/** Auto-pick TE/VAE when diffusion changes, using family filename hints. */
export function autoPickStack(
  family: FamilySummary | null | undefined,
  catalog: ModelCatalog,
  families: FamilySummary[] = [],
  unet = '',
): { clipName?: string; clipName2?: string; vaeName?: string; clipType?: string } {
  const resolved = family ?? inferFamilyFromDiffusion(unet, families);
  if (!resolved) {
    // Generic fallbacks
    const clipL = findByHints(catalog.text_encoders, ['clip_l', 'clip-l']);
    const t5 = findByHints(catalog.text_encoders, ['t5xxl', 't5_xxl', 't5-xxl']);
    const ae = findByHints(catalog.vae, ['ae.safetensors', 'ae.sft', 'ae.']);
    return {
      clipName: clipL,
      clipName2: t5,
      vaeName: ae,
      clipType: t5 || clipL ? 'flux' : undefined,
    };
  }

  const hints = resolved.filenameHints ?? {};
  const req = resolved.requiredComponents ?? {};
  const teKeys = req.text_encoders ?? [];
  const vaeKeys = req.vae ?? [];

  const out: {
    clipName?: string;
    clipName2?: string;
    vaeName?: string;
    clipType?: string;
  } = {};

  if (teKeys[0]) {
    const hit = findByHints(catalog.text_encoders, hints[teKeys[0]] ?? [teKeys[0]]);
    if (hit) out.clipName = hit;
  }
  if (teKeys[1]) {
    const hit = findByHints(catalog.text_encoders, hints[teKeys[1]] ?? [teKeys[1]]);
    if (hit) out.clipName2 = hit;
  }
  if (teKeys[2] && !out.clipName2) {
    // sd3 third encoder — DualCLIP only has 2 slots in UI for now; prefer clip_l + t5
  }
  if (vaeKeys[0]) {
    const hit = findByHints(catalog.vae, hints[vaeKeys[0]] ?? [vaeKeys[0]]);
    if (hit) out.vaeName = hit;
  }

  if (resolved.id === 'flux2-klein' || (resolved as { defaultClipType?: string }).defaultClipType) {
    out.clipType =
      (resolved as { defaultClipType?: string }).defaultClipType ||
      (resolved.id === 'flux2-klein' ? 'flux2' : undefined);
  } else if (resolved.id === 'flux') out.clipType = 'flux';
  else if (resolved.id === 'sd3') out.clipType = 'sd3';

  return out;
}

function slotLabel(key: string): string {
  const map: Record<string, string> = {
    clip_l: 'CLIP-L',
    clip_g: 'CLIP-G',
    t5xxl: 'T5-XXL',
    ae: 'VAE (ae)',
    sd3_vae: 'VAE',
    qwen_3_4b: 'Qwen 3 4B',
    flux2_vae: 'Flux.2 VAE',
  };
  return map[key] || key;
}

export function evaluateReadiness(opts: {
  mode: ModelLoadMode;
  checkpoint: string;
  unet: string;
  clipName: string;
  clipName2: string;
  vaeName: string;
  catalog: ModelCatalog;
  family: FamilySummary | null | undefined;
  families?: FamilySummary[];
  mapped: boolean;
}): Readiness {
  const {
    mode,
    checkpoint,
    unet,
    clipName,
    clipName2,
    vaeName,
    catalog,
    family,
    families = [],
    mapped,
  } = opts;

  const nothingInstalled =
    catalog.checkpoints.length === 0 &&
    catalog.diffusion_models.length === 0 &&
    catalog.text_encoders.length === 0 &&
    catalog.vae.length === 0;

  if (nothingInstalled) {
    return {
      ready: false,
      reason: 'Add a model to start',
      missing: [{ kind: 'checkpoint', key: 'model', label: 'Model' }],
      needsGguf: false,
      nothingInstalled: true,
    };
  }

  const missing: MissingSlot[] = [];
  const usesGguf =
    mode === 'split' &&
    (/\.gguf$/i.test(unet) || /\.gguf$/i.test(clipName) || /\.gguf$/i.test(clipName2));

  if (usesGguf) {
    const needUnet = /\.gguf$/i.test(unet) && !catalog.available.ggufUnet;
    const needClip =
      (/\.gguf$/i.test(clipName) || /\.gguf$/i.test(clipName2)) &&
      !(catalog.available.ggufClip || catalog.available.ggufDualClip);
    if (needUnet || needClip) {
      return {
        ready: false,
        reason: 'Install GGUF support',
        missing: [],
        needsGguf: true,
        nothingInstalled: false,
      };
    }
  }

  if (mode === 'checkpoint') {
    if (!checkpoint) {
      return {
        ready: false,
        reason: 'Add a model to start',
        missing: [{ kind: 'checkpoint', key: 'checkpoint', label: 'Checkpoint' }],
        needsGguf: false,
        nothingInstalled: false,
      };
    }
    if (!mapped) {
      return {
        ready: false,
        reason: 'Map a model family',
        missing: [],
        needsGguf: false,
        nothingInstalled: false,
      };
    }
    return {
      ready: true,
      reason: null,
      missing: [],
      needsGguf: false,
      nothingInstalled: false,
    };
  }

  // Split stack
  if (!unet) {
    missing.push({ kind: 'diffusion', key: 'diffusion', label: 'Diffusion model' });
  }

  // Prefer mapped family; else infer from diffusion filename so Flux.2 Klein
  // requires Qwen (1 TE) instead of Flux.1 DualCLIP slots.
  const effectiveFamily = family ?? inferFamilyFromDiffusion(unet, families);
  const teKeys = effectiveFamily?.requiredComponents?.text_encoders ?? ['text_encoder'];
  const vaeKeys = effectiveFamily?.requiredComponents?.vae ?? ['vae'];

  if (teKeys.length === 0) {
    if (!clipName) {
      missing.push({
        kind: 'text_encoder',
        key: 'text_encoder',
        label: 'Text encoder',
        slotIndex: 0,
      });
    }
  } else {
    teKeys.forEach((key, i) => {
      const value = i === 0 ? clipName : clipName2;
      if (!value) {
        missing.push({
          kind: 'text_encoder',
          key,
          label: slotLabel(key),
          slotIndex: i,
        });
      }
    });
  }

  if (vaeKeys.length === 0) {
    if (!vaeName) {
      missing.push({ kind: 'vae', key: 'vae', label: 'VAE' });
    }
  } else {
    for (const key of vaeKeys) {
      if (!vaeName) {
        missing.push({ kind: 'vae', key, label: slotLabel(key) });
      }
    }
  }

  if (missing.some((m) => m.kind === 'diffusion')) {
    return {
      ready: false,
      reason: 'Add a model to start',
      missing,
      needsGguf: false,
      nothingInstalled: false,
    };
  }
  if (missing.some((m) => m.kind === 'text_encoder')) {
    return {
      ready: false,
      reason: 'Select a text encoder',
      missing,
      needsGguf: false,
      nothingInstalled: false,
    };
  }
  if (missing.some((m) => m.kind === 'vae')) {
    return {
      ready: false,
      reason: 'Select a VAE',
      missing,
      needsGguf: false,
      nothingInstalled: false,
    };
  }
  if (!mapped) {
    return {
      ready: false,
      reason: 'Map a model family',
      missing: [],
      needsGguf: false,
      nothingInstalled: false,
    };
  }

  return {
    ready: true,
    reason: null,
    missing: [],
    needsGguf: false,
    nothingInstalled: false,
  };
}

import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { loadAndApplyEnv } from '../lib/env.js';
import { downloadAndInstallComponent, freeDiskBytes } from '../lib/dependencies.js';
import { formatBytes } from '../lib/download.js';
import { modelDirForType } from '../lib/paths.js';
import {
  ARCH_LABELS,
  controlNetCatalog,
  installedArchitectures,
  installedControlNetIds,
} from '../lib/controlnetModels.js';
import { createAllNodeComponents } from '../components/nodes.js';

/**
 * ControlNet models for the image models installed here: one SDXL union file covers
 * SDXL / Illustrious / NoobAI / Pony; SD 1.5 needs one file per guide type; Flux has its own.
 * Also offers ControlNet Aux, which turns photos into pose / depth / edge maps.
 */
export async function controlnetModels() {
  loadAndApplyEnv();
  const catalog = controlNetCatalog();
  if (!catalog.length) {
    p.log.warn('No ControlNet models in server/presets/components.json.');
    return;
  }
  const installed = installedControlNetIds();
  const archs = installedArchitectures();

  // Grouped by architecture, the ones for models you have first
  const groups = [...new Set(catalog.flatMap((c) => c.arch ?? []))].sort(
    (a, b) => Number(archs.has(b)) - Number(archs.has(a)),
  );
  p.note(
    groups
      .map((a) => {
        const items = catalog.filter((c) => c.arch?.includes(a));
        const have = items.filter((c) => installed.has(c.id)).map((c) => c.title ?? c.filename);
        const label = ARCH_LABELS[/** @type {keyof typeof ARCH_LABELS} */ (a)] ?? a;
        const yours = archs.has(a) ? '' : '  (no models of this kind installed)';
        return `${label}${yours}\n  ${have.length ? `✓ ${have.join(', ')}` : 'none installed'}`;
      })
      .join('\n'),
    'ControlNet models',
  );

  const missing = catalog.filter((c) => !installed.has(c.id));
  if (!missing.length) {
    p.log.success('Every ControlNet model in the list is installed.');
  } else {
    const picked = await p.multiselect({
      message: 'Download which? (space to toggle)',
      options: missing.map((c) => {
        const arch = c.arch?.[0] ?? '';
        const label = ARCH_LABELS[/** @type {keyof typeof ARCH_LABELS} */ (arch)] ?? arch;
        return {
          value: c.id,
          label: `${c.title ?? c.filename} · ${formatBytes(c.sizeBytes)}`,
          hint: `${label}${c.licenseUrl?.includes('FLUX.1-dev') ? ' · non-commercial licence' : ''}`,
        };
      }),
      // Recommended files for the kinds of models you have
      initialValues: missing.filter((c) => c.recommended && c.arch?.some((a) => archs.has(a))).map((c) => c.id),
      required: false,
    });
    if (handleCancel(picked)) return;
    const chosen = missing.filter((c) => /** @type {string[]} */ (picked).includes(c.id));

    if (chosen.length) {
      const total = chosen.reduce((n, c) => n + c.sizeBytes, 0);
      const free = freeDiskBytes(modelDirForType('controlnet') || process.cwd());
      if (free !== null && free < total * 1.05) {
        p.log.error(`Not enough space: needs ${formatBytes(total)}, ${formatBytes(free)} free.`);
        return;
      }
      const ok = await p.confirm({
        message: `Download ${chosen.length} file${chosen.length === 1 ? '' : 's'} (${formatBytes(total)})?${free !== null ? ` ${formatBytes(free)} free.` : ''}`,
      });
      if (handleCancel(ok) || !ok) return;

      for (const c of chosen) {
        const s = p.spinner();
        s.start(`${c.title ?? c.filename} — starting…`);
        let last = 0;
        try {
          await downloadAndInstallComponent(c, {
            quiet: true,
            onProgress: (done, size) => {
              const now = Date.now();
              if (now - last < 250) return;
              last = now;
              const pct = size ? Math.floor((done / size) * 100) : 0;
              s.message(`${c.title ?? c.filename} — ${pct}% of ${formatBytes(size || c.sizeBytes)}`);
            },
          });
          s.stop(`${c.title ?? c.filename} installed (checked sha256)`);
        } catch (err) {
          s.stop(`${c.title ?? c.filename} failed`);
          p.log.error(err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  // Pose / depth / edge maps from photos need ControlNet Aux
  const aux = createAllNodeComponents().find((n) => n.id === 'node:controlnet-aux');
  if (aux) {
    const st = await aux.status();
    if (st.state === 'missing') {
      const yes = await p.confirm({
        message: 'Install ControlNet Aux too? It turns photos into pose, depth and edge maps (without it, guides must already be maps).',
        initialValue: true,
      });
      if (!handleCancel(yes) && yes) {
        await aux.install({});
        p.log.success('ControlNet Aux installed — restart ComfyUI to load it.');
      }
    }
  }
  p.log.info('Darkroom lists new ControlNet models within a few seconds — no restart needed.');
}

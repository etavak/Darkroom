import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, upsertEnvValue } from './env.js';
import { downloadFile, downloadsCacheDir, formatBytes } from './download.js';
import { httpGetJson } from './http.js';
import {
  installModelFile,
  listFamilies,
  listModels,
  normalizeDraggedPath,
} from './models.js';
import { familiesDir, modelComponentsPath, modelDirForType } from './paths.js';

/**
 * @typedef {{
 *   id: string,
 *   type: string,
 *   filename: string,
 *   url: string,
 *   sizeBytes: number,
 *   sha256: string,
 *   gated?: boolean,
 *   licenseUrl?: string,
 *   notes?: string,
 * }} ComponentDef
 *
 * @typedef {{
 *   role: string,
 *   required: boolean,
 *   options: string[],
 *   recommend?: { vramUnderGB?: number, pick: string },
 * }} FamilyDependency
 *
 * @typedef {{
 *   id: string,
 *   filename: string,
 *   type: string,
 *   notes?: string,
 *   sizeBytes: number,
 *   sha256: string,
 *   gated: boolean,
 *   licenseUrl?: string,
 *   recommended: boolean,
 * }} DependencyOption
 *
 * @typedef {{
 *   role: string,
 *   required: boolean,
 *   status: 'satisfied' | 'missing' | 'choice',
 *   satisfiedBy?: { filename: string, path: string },
 *   options: DependencyOption[],
 *   preselected?: string | null,
 * }} RoleAnalysis
 */

/** @type {Map<string, ComponentDef> | null} */
let componentCache = null;

export function invalidateComponentCache() {
  componentCache = null;
}

/** @returns {Map<string, ComponentDef>} */
export function loadComponents() {
  if (componentCache) return componentCache;
  /** @type {Map<string, ComponentDef>} */
  const map = new Map();
  if (!fs.existsSync(modelComponentsPath)) {
    componentCache = map;
    return map;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(modelComponentsPath, 'utf8'));
    for (const c of raw.components || []) {
      if (c?.id && c.filename && c.url && c.sha256) {
        map.set(c.id, {
          id: c.id,
          type: c.type || 'checkpoint',
          filename: c.filename,
          url: c.url,
          sizeBytes: Number(c.sizeBytes) || 0,
          sha256: String(c.sha256).toLowerCase(),
          gated: Boolean(c.gated),
          licenseUrl: c.licenseUrl || undefined,
          notes: c.notes || undefined,
        });
      }
    }
  } catch {
    // empty catalog
  }
  componentCache = map;
  return map;
}

/**
 * @param {string} familyId
 * @returns {FamilyDependency[]}
 */
export function loadFamilyDependencies(familyId) {
  const file = path.join(familiesDir, `${familyId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw.dependencies) ? raw.dependencies : [];
  } catch {
    return [];
  }
}

/**
 * Free bytes on the volume containing dir (Node fs.statfs when available).
 * @param {string} dir
 * @returns {number | null}
 */
export function freeDiskBytes(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync(dir);
      const bsize = Number(st.bavail != null ? st.bavail : st.bfree) || 0;
      const frsize = Number(st.bsize || st.frsize || 0) || 0;
      if (bsize > 0 && frsize > 0) return bsize * frsize;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * @param {string} filePath
 * @param {string} expected
 */
export async function verifySha256(filePath, expected) {
  const actual = await sha256File(filePath);
  if (actual.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(
      `sha256 mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`,
    );
  }
  return actual;
}

/**
 * Detect VRAM total in GB from ComfyUI system_stats (null if offline).
 * @returns {Promise<number | null>}
 */
export async function detectVramGB() {
  const cfg = getConfig();
  try {
    const res = await httpGetJson(`${cfg.comfyUrl}/system_stats`);
    if (res.status !== 200 || !res.json) return null;
    const devices = Array.isArray(res.json.devices) ? res.json.devices : [];
    const primary =
      devices.find((d) => {
        const t = String(d.type || d.name || '').toLowerCase();
        return t.includes('cuda') || t.includes('mps') || t.includes('gpu');
      }) || devices[0];
    const bytes = Number(primary?.vram_total || primary?.torch_vram_total || 0);
    if (!bytes) return null;
    return bytes / 1e9;
  } catch {
    return null;
  }
}

/**
 * @param {ComponentDef} comp
 * @param {Array<{ type: string, name: string, path: string, size: number }>} installed
 * @param {Record<string, string[]>} [filenameHints]
 */
function findSatisfyingFile(comp, installed, filenameHints) {
  const exact = installed.find(
    (m) => m.type === comp.type && m.name.toLowerCase() === comp.filename.toLowerCase(),
  );
  if (exact) return exact;

  // Hint match for role aliases (e.g. t5xxl_fp8 matches t5xxl hints)
  const hints = filenameHints?.[comp.id] || [];
  const baseHints = [
    path.basename(comp.filename, path.extname(comp.filename)).toLowerCase(),
    ...hints.map((h) => h.toLowerCase()),
  ];
  const byHint = installed.find((m) => {
    if (m.type !== comp.type) return false;
    const lower = m.name.toLowerCase();
    return baseHints.some((h) => h && lower.includes(h));
  });
  if (byHint) return byHint;

  // Size match as soft signal (same sizeBytes as catalog)
  if (comp.sizeBytes > 0) {
    const bySize = installed.find(
      (m) => m.type === comp.type && m.size === comp.sizeBytes,
    );
    if (bySize) return bySize;
  }
  return null;
}

/**
 * Pick recommended option id given VRAM.
 * @param {FamilyDependency} dep
 * @param {number | null} vramGB
 */
export function pickRecommended(dep, vramGB) {
  const rec = dep.recommend;
  if (!rec?.pick) return dep.options[0] || null;
  if (rec.vramUnderGB != null && vramGB != null && vramGB < rec.vramUnderGB) {
    return rec.pick;
  }
  // Prefer higher-quality (first listed that isn't the low-VRAM pick) when VRAM is ample
  if (rec.vramUnderGB != null && vramGB != null && vramGB >= rec.vramUnderGB) {
    const hi = dep.options.find((id) => id !== rec.pick);
    return hi || rec.pick;
  }
  return rec.pick;
}

/**
 * Analyze which dependency roles still need action for a family.
 * @param {string} familyId
 * @param {{
 *   vramGB?: number | null,
 *   installed?: Array<{ type: string, name: string, path: string, size: number }>,
 *   extras?: ComponentDef[],
 * }} [opts]
 * @returns {{
 *   familyId: string,
 *   vramGB: number | null,
 *   roles: RoleAnalysis[],
 *   freeDiskBytes: number | null,
 *   freeDiskLabel: string,
 * }}
 */
export function analyzeDependencies(familyId, opts = {}) {
  const catalog = loadComponents();
  /** @type {FamilyDependency[]} */
  const deps = [...loadFamilyDependencies(familyId)];
  const installed = opts.installed || listModels();
  const vramGB = opts.vramGB ?? null;

  // Civitai (etc.) VAE companions — inject optional role when family has no VAE dep
  const vaeExtras = (opts.extras || []).filter((e) => e.type === 'vae');
  if (vaeExtras.length && !deps.some((d) => d.role === 'vae')) {
    deps.push({
      role: 'vae',
      required: false,
      options: [],
      recommend: { pick: vaeExtras[0].id },
    });
  }

  let filenameHints = {};
  try {
    const famFile = path.join(familiesDir, `${familyId}.json`);
    if (fs.existsSync(famFile)) {
      filenameHints = JSON.parse(fs.readFileSync(famFile, 'utf8')).filenameHints || {};
    }
  } catch {
    // ignore
  }

  /** @type {RoleAnalysis[]} */
  const roles = [];

  for (const dep of deps) {
    /** @type {DependencyOption[]} */
    const options = [];
    for (const id of dep.options || []) {
      const comp = catalog.get(id);
      if (!comp) continue;
      options.push({
        id: comp.id,
        filename: comp.filename,
        type: comp.type,
        notes: comp.notes,
        sizeBytes: comp.sizeBytes,
        sha256: comp.sha256,
        gated: Boolean(comp.gated),
        licenseUrl: comp.licenseUrl,
        recommended: false,
      });
    }

    // Civitai / ad-hoc extras for this role (e.g. VAE from file list)
    if (vaeExtras.length && dep.role === 'vae') {
      for (const extra of vaeExtras) {
        if (options.some((o) => o.id === extra.id || o.filename === extra.filename)) continue;
        options.push({
          id: extra.id,
          filename: extra.filename,
          type: extra.type,
          notes: extra.notes || 'From model page',
          sizeBytes: extra.sizeBytes,
          sha256: extra.sha256 || '',
          gated: Boolean(extra.gated),
          licenseUrl: extra.licenseUrl,
          recommended: true,
        });
      }
    }

    if (options.length === 0) continue;

    const preselected = pickRecommended(dep, vramGB);
    for (const o of options) {
      o.recommended = o.id === preselected;
    }

    /** @type {{ filename: string, path: string } | undefined} */
    let satisfiedBy;
    // Merge filenameHints for role + any hint key overlapping an option id (t5 ↔ t5xxl)
    /** @type {string[]} */
    const roleHints = [
      ...(filenameHints[dep.role] || []),
      ...Object.entries(filenameHints).flatMap(([key, hints]) => {
        const k = key.toLowerCase();
        if (k === dep.role.toLowerCase()) return hints;
        if (dep.options.some((id) => id.toLowerCase().includes(k) || k.includes(id.toLowerCase().split('_')[0]))) {
          return hints;
        }
        return [];
      }),
    ];

    for (const o of options) {
      const hit = findSatisfyingFile(
        {
          id: o.id,
          type: o.type,
          filename: o.filename,
          url: '',
          sizeBytes: o.sizeBytes,
          sha256: o.sha256,
        },
        installed,
        { ...filenameHints, [o.id]: [...(filenameHints[o.id] || []), ...roleHints] },
      );
      if (hit) {
        satisfiedBy = { filename: hit.name, path: hit.path };
        break;
      }
    }
    if (!satisfiedBy && roleHints.length) {
      const type = options[0]?.type;
      const byRole = installed.find((m) => {
        if (type && m.type !== type) return false;
        const lower = m.name.toLowerCase();
        return roleHints.some((h) => lower.includes(String(h).toLowerCase()));
      });
      if (byRole) {
        satisfiedBy = { filename: byRole.name, path: byRole.path };
      }
    }

    if (satisfiedBy) {
      roles.push({
        role: dep.role,
        required: Boolean(dep.required),
        status: 'satisfied',
        satisfiedBy,
        options,
        preselected,
      });
      continue;
    }

    roles.push({
      role: dep.role,
      required: Boolean(dep.required),
      status: options.length === 1 ? 'missing' : 'choice',
      options,
      preselected,
    });
  }

  const modelsRoot =
    modelDirForType('vae') || modelDirForType('text_encoder') || process.cwd();
  const free = freeDiskBytes(modelsRoot || process.cwd());

  return {
    familyId,
    vramGB,
    roles,
    freeDiskBytes: free,
    freeDiskLabel: free != null ? formatBytes(free) : 'unknown',
  };
}

/**
 * @typedef {{
 *   role: string,
 *   action: 'download' | 'skip' | 'local',
 *   componentId?: string,
 *   localPath?: string,
 *   mode?: 'copy' | 'move' | 'link',
 * }} RoleChoice
 *
 * @typedef {{
 *   role: string,
 *   action: 'download' | 'local',
 *   component?: ComponentDef,
 *   localPath?: string,
 *   mode?: 'copy' | 'move' | 'link',
 *   type: string,
 *   filename: string,
 *   sizeBytes: number,
 *   gated: boolean,
 *   licenseUrl?: string,
 *   notes?: string,
 * }} PlanItem
 */

/**
 * Build a download/install plan from user choices.
 * @param {string} familyId
 * @param {RoleChoice[]} choices
 * @param {{ extras?: ComponentDef[] }} [opts]
 */
export function buildDependencyPlan(familyId, choices, opts = {}) {
  const catalog = loadComponents();
  const analysis = analyzeDependencies(familyId, { extras: opts.extras });
  /** @type {PlanItem[]} */
  const items = [];
  /** @type {string[]} */
  const gatedLicenseUrls = [];

  for (const roleInfo of analysis.roles) {
    if (roleInfo.status === 'satisfied') continue;
    const choice =
      choices.find((c) => c.role === roleInfo.role) ||
      (roleInfo.status === 'missing' && roleInfo.preselected
        ? { role: roleInfo.role, action: /** @type {'download'} */ ('download'), componentId: roleInfo.preselected }
        : null);

    if (!choice || choice.action === 'skip') continue;

    if (choice.action === 'local') {
      const localPath = normalizeDraggedPath(choice.localPath || '');
      if (!localPath || !fs.existsSync(localPath)) {
        throw new Error(`Local file missing for role ${roleInfo.role}`);
      }
      const opt =
        roleInfo.options.find((o) => o.id === choice.componentId) || roleInfo.options[0];
      items.push({
        role: roleInfo.role,
        action: 'local',
        localPath,
        mode: choice.mode || 'link',
        type: opt?.type || 'text_encoder',
        filename: path.basename(localPath),
        sizeBytes: fs.statSync(localPath).size,
        gated: false,
        notes: 'Already on disk',
      });
      continue;
    }

    const componentId = choice.componentId || roleInfo.preselected || roleInfo.options[0]?.id;
    if (!componentId) continue;
    const fromCatalog = catalog.get(componentId);
    const fromExtra = (opts.extras || []).find((e) => e.id === componentId);
    const comp = fromCatalog || fromExtra;
    if (!comp) throw new Error(`Unknown component ${componentId}`);

    items.push({
      role: roleInfo.role,
      action: 'download',
      component: comp,
      type: comp.type,
      filename: comp.filename,
      sizeBytes: comp.sizeBytes,
      gated: Boolean(comp.gated),
      licenseUrl: comp.licenseUrl,
      notes: comp.notes,
    });
    if (comp.gated && comp.licenseUrl) gatedLicenseUrls.push(comp.licenseUrl);
  }

  const totalBytes = items.reduce((s, i) => s + (i.sizeBytes || 0), 0);
  const modelsRoot =
    modelDirForType('vae') || modelDirForType('text_encoder') || process.cwd();
  const free = freeDiskBytes(modelsRoot || process.cwd());

  return {
    familyId,
    items,
    totalBytes,
    totalLabel: formatBytes(totalBytes),
    freeDiskBytes: free,
    freeDiskLabel: free != null ? formatBytes(free) : 'unknown',
    gatedLicenseUrls: [...new Set(gatedLicenseUrls)],
    needsHfToken: items.some((i) => i.gated),
  };
}

/**
 * Ensure HF_TOKEN is available for gated downloads; optionally persist.
 * @param {string} [token]
 * @param {{ save?: boolean }} [opts]
 */
export function ensureHfToken(token, opts = {}) {
  const cfg = getConfig();
  const value = (token || cfg.hfToken || '').trim();
  if (!value) return null;
  if (opts.save !== false && value !== cfg.hfToken) {
    upsertEnvValue('HF_TOKEN', value);
  } else {
    process.env.HF_TOKEN = value;
  }
  return value;
}

/**
 * Download one catalog component, verify sha256, install into Comfy models.
 * @param {ComponentDef} comp
 * @param {{
 *   hfToken?: string,
 *   onProgress?: (transferred: number, total: number) => void,
 *   quiet?: boolean,
 *   mode?: 'copy' | 'move' | 'link',
 * }} [opts]
 */
export async function downloadAndInstallComponent(comp, opts = {}) {
  const cfg = getConfig();
  const token = opts.hfToken || cfg.hfToken;
  if (comp.gated && !token) {
    const err = new Error(
      `Gated file ${comp.filename} needs HF_TOKEN. Accept the license at ${comp.licenseUrl || 'huggingface.co'} then set HF_TOKEN.`,
    );
    /** @type {any} */ (err).code = 'HF_TOKEN_REQUIRED';
    /** @type {any} */ (err).licenseUrl = comp.licenseUrl;
    throw err;
  }

  const cache = downloadsCacheDir();
  const safeName = comp.filename.replace(/[\\/]/g, '__');
  const tempPath = path.join(cache, `dep-${safeName}`);

  await downloadFile(comp.url, tempPath, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    onProgress: opts.onProgress,
    quiet: opts.quiet,
  });

  if (comp.sha256) {
    await verifySha256(tempPath, comp.sha256);
  }

  const result = installModelFile(tempPath, comp.type, opts.mode || 'move');
  return result;
}

/**
 * Install a local file the user already has for a dependency role.
 * @param {string} localPath
 * @param {string} type
 * @param {'copy'|'move'|'link'} mode
 */
export function installLocalDependency(localPath, type, mode) {
  const resolved = normalizeDraggedPath(localPath);
  return installModelFile(resolved, type, mode);
}

/**
 * Interactive CLI resolver — call after a model is installed and family is known.
 * @param {string} familyId
 * @param {{
 *   extras?: ComponentDef[],
 *   prompt: typeof import('@clack/prompts'),
 *   handleCancel: (v: unknown) => boolean,
 * }} ctx
 */
export async function resolveDependenciesInteractive(familyId, ctx) {
  const { prompt: p, handleCancel } = ctx;
  if (!familyId) return { downloaded: [], skipped: true };

  const fam = listFamilies().find((f) => f.id === familyId);
  if (!fam) return { downloaded: [], skipped: true };

  const deps = loadFamilyDependencies(familyId);
  if (!deps.length && !ctx.extras?.length) return { downloaded: [], skipped: true };

  const s = p.spinner();
  s.start('Checking companion models…');
  const vramGB = await detectVramGB();
  const analysis = analyzeDependencies(familyId, { vramGB, extras: ctx.extras });
  s.stop(
    vramGB != null
      ? `VRAM ~${vramGB.toFixed(1)} GB — checking dependencies for ${fam.name}`
      : `Checking dependencies for ${fam.name}`,
  );

  const pending = analysis.roles.filter((r) => r.status !== 'satisfied');
  if (pending.length === 0) {
    p.log.success('All companion models already installed');
    return { downloaded: [], skipped: false };
  }

  /** @type {RoleChoice[]} */
  const choices = [];

  for (const role of pending) {
    if (role.status === 'satisfied') continue;

    if (role.options.length === 1 && role.required) {
      const only = role.options[0];
      p.log.info(
        `${role.role}: will download ${only.filename} (${formatBytes(only.sizeBytes)})` +
          (only.notes ? ` — ${only.notes}` : ''),
      );
      const action = await p.select({
        message: `Companion: ${role.role}`,
        options: [
          {
            value: 'download',
            label: `Download ${only.filename}`,
            hint: formatBytes(only.sizeBytes),
          },
          { value: 'skip', label: 'Skip' },
          { value: 'local', label: 'I already have it' },
        ],
        initialValue: 'download',
      });
      if (handleCancel(action)) return { downloaded: [], skipped: true };
      if (action === 'skip') {
        choices.push({ role: role.role, action: 'skip' });
        continue;
      }
      if (action === 'local') {
        const local = await promptLocalInstall(p, handleCancel, only.type);
        if (!local) {
          choices.push({ role: role.role, action: 'skip' });
          continue;
        }
        choices.push({
          role: role.role,
          action: 'local',
          componentId: only.id,
          localPath: local.path,
          mode: local.mode,
        });
        continue;
      }
      choices.push({ role: role.role, action: 'download', componentId: only.id });
      continue;
    }

    // Multi-option or optional single
    const optionValues = role.options.map((o) => ({
      value: o.id,
      label: o.filename,
      hint: [
        formatBytes(o.sizeBytes),
        o.recommended ? 'recommended' : '',
        o.notes || '',
      ]
        .filter(Boolean)
        .join(' · '),
    }));

    const pick = await p.select({
      message: `Choose ${role.role}${role.required ? '' : ' (optional)'}`,
      options: [
        ...optionValues,
        { value: '__skip__', label: 'Skip' },
        { value: '__local__', label: 'I already have it' },
      ],
      initialValue: role.preselected || role.options[0]?.id || '__skip__',
    });
    if (handleCancel(pick)) return { downloaded: [], skipped: true };

    if (pick === '__skip__') {
      choices.push({ role: role.role, action: 'skip' });
      continue;
    }
    if (pick === '__local__') {
      const type = role.options[0]?.type || 'text_encoder';
      const local = await promptLocalInstall(p, handleCancel, type);
      if (!local) {
        choices.push({ role: role.role, action: 'skip' });
        continue;
      }
      choices.push({
        role: role.role,
        action: 'local',
        componentId: role.preselected || role.options[0]?.id,
        localPath: local.path,
        mode: local.mode,
      });
      continue;
    }

    choices.push({
      role: role.role,
      action: 'download',
      componentId: /** @type {string} */ (pick),
    });
  }

  const plan = buildDependencyPlan(familyId, choices, { extras: ctx.extras });
  if (plan.items.length === 0) {
    p.log.info('No companion downloads selected');
    return { downloaded: [], skipped: false };
  }

  const lines = plan.items.map(
    (i) =>
      `• ${i.filename} (${formatBytes(i.sizeBytes)})${i.gated ? ' [gated]' : ''}${i.notes ? ` — ${i.notes}` : ''}`,
  );
  lines.push('', `Total: ${plan.totalLabel}`, `Free disk: ${plan.freeDiskLabel}`);
  p.note(lines.join('\n'), 'Download plan');

  if (plan.freeDiskBytes != null && plan.totalBytes > plan.freeDiskBytes) {
    p.log.warn('Not enough free disk space for the full plan');
  }

  if (plan.needsHfToken) {
    for (const url of plan.gatedLicenseUrls) {
      p.log.warn(`Accept the license on Hugging Face: ${url}`);
    }
    let token = getConfig().hfToken;
    if (!token) {
      const entered = await p.text({
        message: 'HF_TOKEN (saved to .env)',
        placeholder: 'hf_…',
        validate: (v) => (!v?.trim() ? 'Token required for gated files' : undefined),
      });
      if (handleCancel(entered)) return { downloaded: [], skipped: true };
      token = ensureHfToken(String(entered), { save: true });
      p.log.success('HF_TOKEN saved to .env');
    }
  }

  const ok = await p.confirm({
    message: `Download ${plan.items.length} file(s) (${plan.totalLabel})?`,
    initialValue: true,
  });
  if (handleCancel(ok) || !ok) return { downloaded: [], skipped: true };

  /** @type {string[]} */
  const downloaded = [];
  for (const item of plan.items) {
    try {
      if (item.action === 'local' && item.localPath) {
        const r = installLocalDependency(item.localPath, item.type, item.mode || 'link');
        p.log.success(`Installed ${r.filename}`);
        downloaded.push(r.filename);
        continue;
      }
      if (!item.component) continue;
      p.log.info(`Downloading ${item.filename}…`);
      const r = await downloadAndInstallComponent(item.component, {
        quiet: false,
      });
      p.log.success(`Installed ${r.filename} (sha256 ok)`);
      downloaded.push(r.filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      p.log.error(message);
      if (/** @type {any} */ (err).code === 'HF_TOKEN_REQUIRED') {
        const entered = await p.text({
          message: 'HF_TOKEN',
          placeholder: 'hf_…',
        });
        if (!handleCancel(entered) && entered) {
          ensureHfToken(String(entered), { save: true });
          try {
            const r = await downloadAndInstallComponent(item.component, { quiet: false });
            p.log.success(`Installed ${r.filename}`);
            downloaded.push(r.filename);
            continue;
          } catch (err2) {
            p.log.error(err2 instanceof Error ? err2.message : String(err2));
          }
        }
      }
    }
  }

  return { downloaded, skipped: false };
}

/**
 * @param {typeof import('@clack/prompts')} p
 * @param {(v: unknown) => boolean} handleCancel
 * @param {string} type
 */
async function promptLocalInstall(p, handleCancel, type) {
  const raw = await p.text({
    message: 'Path to existing file',
    placeholder: `/path/to/model.safetensors`,
    validate: (v) => (!v?.trim() ? 'Path required' : undefined),
  });
  if (handleCancel(raw)) return null;
  const filePath = normalizeDraggedPath(String(raw));
  if (!fs.existsSync(filePath)) {
    p.log.error(`Not found: ${filePath}`);
    return null;
  }
  const mode = await p.select({
    message: 'Install method',
    options: [
      { value: 'link', label: 'Link (symlink / hard link)' },
      { value: 'copy', label: 'Copy' },
      { value: 'move', label: 'Move' },
    ],
    initialValue: 'link',
  });
  if (handleCancel(mode)) return null;
  return { path: filePath, mode: /** @type {'copy'|'move'|'link'} */ (mode), type };
}

export { formatBytes };

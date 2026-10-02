/**
 * @typedef {'missing' | 'installed' | 'update_available' | 'broken'} ComponentState
 * @typedef {'darwin' | 'win32' | 'linux' | '*'} PlatformId
 * @typedef {'apple_silicon' | 'intel_mac' | 'nvidia' | 'cpu' | '*'} GpuProfile
 *
 * @typedef {{
 *   state: ComponentState,
 *   version?: string | null,
 *   testedVersion?: string | null,
 *   latestVersion?: string | null,
 *   detail?: string,
 *   problems?: string[],
 * }} ComponentStatus
 *
 * @typedef {{
 *   channel?: 'tested' | 'latest',
 *   log?: { info: (m: string) => void, warn: (m: string) => void, error: (m: string) => void },
 *   confirm?: (message: string, initialValue?: boolean) => Promise<boolean>,
 *   installDir?: string,
 *   dryRun?: boolean,
 * }} ComponentContext
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   optional?: boolean,
 *   platforms?: PlatformId[],
 *   gpus?: GpuProfile[],
 *   status: () => Promise<ComponentStatus>,
 *   install: (ctx?: ComponentContext) => Promise<void>,
 *   update: (ctx?: ComponentContext) => Promise<void>,
 *   repair: (ctx?: ComponentContext) => Promise<void>,
 *   reinstall: (ctx?: ComponentContext) => Promise<void>,
 *   uninstall: (ctx?: ComponentContext) => Promise<void>,
 * }} Component
 */

/** @type {PlatformId[]} */
export const ALL_PLATFORMS = ['*'];
/** @type {GpuProfile[]} */
export const ALL_GPUS = ['*'];

/**
 * @param {ComponentStatus} s
 */
export function formatStatusLine(s) {
  const ver = s.version ? ` ${s.version}` : '';
  const bits = [`${s.state}${ver}`];
  if (s.state === 'update_available' && s.testedVersion) {
    bits.push(`tested ${s.testedVersion}`);
  }
  if (s.detail) bits.push(s.detail);
  if (s.problems?.length) bits.push(`${s.problems.length} problem(s)`);
  return bits.join(' · ');
}

/**
 * Default confirm using clack.
 * @param {string} message
 * @param {boolean} [initialValue]
 */
export async function defaultConfirm(message, initialValue = true) {
  const prompts = await import('@clack/prompts');
  const { handleCancel } = await import('../lib/prompt.js');
  const ok = await prompts.confirm({ message, initialValue });
  if (handleCancel(ok)) return false;
  return Boolean(ok);
}

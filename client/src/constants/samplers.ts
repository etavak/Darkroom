export const SAMPLERS = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpm_fast',
  'dpm_adaptive',
  'dpmpp_2s_ancestral',
  'dpmpp_sde',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'ddim',
  'uni_pc',
] as const;

export const SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
] as const;

export type SamplerName = (typeof SAMPLERS)[number];
export type SchedulerName = (typeof SCHEDULERS)[number];

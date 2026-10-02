import type { LoraSettings, ModelLoadMode } from '@/types/generation';

export type ModelProfile = {
  id: string;
  name: string;
  mode: ModelLoadMode;
  checkpoint: string;
  unet: string;
  clipName: string;
  clipName2: string;
  clipType: string;
  clipTypeOverride: boolean;
  vaeName: string;
  loras: LoraSettings[];
  updatedAt: number;
};

const STORAGE_KEY = 'darkroom.modelProfiles';

export function loadModelProfiles(): ModelProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveModelProfiles(profiles: ModelProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // ignore
  }
}

export function upsertModelProfile(
  profiles: ModelProfile[],
  profile: Omit<ModelProfile, 'id' | 'updatedAt'> & { id?: string },
): ModelProfile[] {
  const now = Date.now();
  if (profile.id) {
    return profiles.map((p) =>
      p.id === profile.id ? { ...p, ...profile, id: p.id, updatedAt: now } : p,
    );
  }
  const next: ModelProfile = {
    ...profile,
    id: crypto.randomUUID(),
    updatedAt: now,
  };
  return [...profiles, next];
}

export function deleteModelProfile(profiles: ModelProfile[], id: string): ModelProfile[] {
  return profiles.filter((p) => p.id !== id);
}

export function shortModelName(name: string): string {
  if (!name) return '—';
  const base = name.split(/[/\\]/).pop() || name;
  return base.length > 28 ? `${base.slice(0, 26)}…` : base;
}

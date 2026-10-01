/** Layer chip labels shown in the UI */
export type TagSource = 'FAMILY' | 'STYLE' | 'CKPT';

export type LayerSettings = {
  cfg?: number;
  clipSkip?: number;
  sampler?: string;
  scheduler?: string;
  guidance?: number;
  baseRes?: number;
};

export type TagLayer = {
  positive?: string[];
  negative?: string[];
  removePositive?: string[];
  removeNegative?: string[];
  settings?: LayerSettings;
};

export type StyleDef = TagLayer & {
  name: string;
};

export type FamilyDef = TagLayer & {
  id: string;
  name: string;
  defaultStyle: string;
  /** When true, negatives are unused (e.g. Flux) */
  disableNegative?: boolean;
  /** Tag dictionary sources under server/tags/ (empty = autocomplete disabled) */
  tagSources?: string[];
  /** How autocomplete inserts tags */
  tagFormat?: 'spaces' | 'underscores';
  styles: Record<string, StyleDef>;
};

export type CheckpointMapping = TagLayer & {
  family: string;
};

export type CheckpointsFile = {
  mappings: Record<string, CheckpointMapping>;
};

export type InjectedTag = {
  tag: string;
  from: TagSource;
};

export type ResolvedPresets = {
  familyId: string | null;
  familyName: string | null;
  styleId: string | null;
  mapped: boolean;
  disableNegative: boolean;
  positiveTags: InjectedTag[];
  negativeTags: InjectedTag[];
  finalPositive: string;
  finalNegative: string;
  settings: LayerSettings;
  aspectPresets: Array<{ id: string; label: string; width: number; height: number }>;
  tagSources: string[];
  tagFormat: 'spaces' | 'underscores';
  tagsEnabled: boolean;
};

export type ResolveInput = {
  checkpoint: string;
  styleId: string | null;
  dismissedPositive: string[];
  dismissedNegative: string[];
  userPositive: string;
  userNegative: string;
};

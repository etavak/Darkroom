export type TagSource = 'FAMILY' | 'STYLE' | 'CKPT';

export type LayerSettings = {
  cfg?: number;
  clipSkip?: number;
  sampler?: string;
  scheduler?: string;
  guidance?: number;
  baseRes?: number;
};

export type FamilyStyleSummary = {
  id: string;
  name: string;
};

export type FamilyRequiredComponents = {
  text_encoders?: string[];
  vae?: string[];
};

export type FamilyDependency = {
  role: string;
  required: boolean;
  options: string[];
  recommend?: { vramUnderGB?: number; pick: string };
};

export type FamilySummary = {
  id: string;
  name: string;
  defaultStyle: string;
  disableNegative: boolean;
  tagSources?: string[];
  tagFormat?: 'spaces' | 'underscores';
  tagsEnabled?: boolean;
  styles: FamilyStyleSummary[];
  settings: LayerSettings;
  supportsGguf?: boolean;
  loaderKind?: 'checkpoint' | 'transformer';
  requiredComponents?: FamilyRequiredComponents;
  filenameHints?: Record<string, string[]>;
  dependencies?: FamilyDependency[];
  defaultClipType?: string;
};

export type InjectedTag = {
  tag: string;
  from: TagSource;
};

export type AspectPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
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
  aspectPresets: AspectPreset[];
  tagSources: string[];
  tagFormat: 'spaces' | 'underscores';
  tagsEnabled: boolean;
};

export type TagCategory = 'general' | 'artist' | 'character' | 'copyright' | 'meta';

export type TagSuggestion = {
  name: string;
  displayName: string;
  category: TagCategory;
  postCount: number;
  matchedAlias?: string;
};

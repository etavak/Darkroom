import type {
  FamilyDef,
  InjectedTag,
  LayerSettings,
  ResolveInput,
  ResolvedPresets,
  TagLayer,
  TagSource,
} from './types.js';
import { scaleAspectPresets } from './aspect.js';
import { getCheckpointMapping, getFamily, listFamilies } from './catalog.js';
import { escapeParens } from '../tags/dictionary.js';

function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}

function tagKey(tag: string): string {
  return normalizeTag(tag).toLowerCase();
}

/** Preset-injected tags: escape parentheses so they aren't treated as weights. */
function formatPresetTag(tag: string): string {
  return escapeParens(normalizeTag(tag));
}

function applyLayer(
  positive: InjectedTag[],
  negative: InjectedTag[],
  layer: TagLayer,
  from: TagSource,
  settings: LayerSettings,
): { positive: InjectedTag[]; negative: InjectedTag[]; settings: LayerSettings } {
  const removePos = new Set((layer.removePositive ?? []).map(tagKey));
  const removeNeg = new Set((layer.removeNegative ?? []).map(tagKey));

  let nextPos = positive.filter((t) => !removePos.has(tagKey(t.tag)));
  let nextNeg = negative.filter((t) => !removeNeg.has(tagKey(t.tag)));

  const posKeys = new Set(nextPos.map((t) => tagKey(t.tag)));
  const negKeys = new Set(nextNeg.map((t) => tagKey(t.tag)));

  for (const raw of layer.positive ?? []) {
    const tag = formatPresetTag(raw);
    if (!tag) continue;
    const key = tagKey(tag);
    if (posKeys.has(key)) {
      nextPos = nextPos.map((t) => (tagKey(t.tag) === key ? { tag, from } : t));
    } else {
      nextPos.push({ tag, from });
      posKeys.add(key);
    }
  }

  for (const raw of layer.negative ?? []) {
    const tag = formatPresetTag(raw);
    if (!tag) continue;
    const key = tagKey(tag);
    if (negKeys.has(key)) {
      nextNeg = nextNeg.map((t) => (tagKey(t.tag) === key ? { tag, from } : t));
    } else {
      nextNeg.push({ tag, from });
      negKeys.add(key);
    }
  }

  const nextSettings: LayerSettings = {
    ...settings,
    ...(layer.settings ?? {}),
  };

  return { positive: nextPos, negative: nextNeg, settings: nextSettings };
}

function joinPrompt(tags: string[], userText: string): string {
  const parts = [...tags.map(normalizeTag).filter(Boolean)];
  const user = userText.trim();
  if (user) parts.push(user);
  return parts.join(', ');
}

function pickStyleId(family: FamilyDef, requested: string | null): string {
  if (requested && family.styles[requested]) return requested;
  if (family.styles[family.defaultStyle]) return family.defaultStyle;
  return Object.keys(family.styles)[0] ?? family.defaultStyle;
}

/**
 * Resolve order: family → style → checkpoint override → user text.
 */
export function resolvePresets(input: ResolveInput): ResolvedPresets {
  const mapping = getCheckpointMapping(input.checkpoint);
  const familyId = mapping?.family ?? null;
  const family = familyId ? getFamily(familyId) : null;

  if (!family) {
    return {
      familyId: null,
      familyName: null,
      styleId: null,
      mapped: false,
      disableNegative: false,
      positiveTags: [],
      negativeTags: [],
      finalPositive: input.userPositive.trim(),
      finalNegative: input.userNegative.trim(),
      settings: { baseRes: 1024 },
      aspectPresets: scaleAspectPresets(1024),
      tagSources: [],
      tagFormat: 'underscores',
      tagsEnabled: false,
    };
  }

  let positive: InjectedTag[] = [];
  let negative: InjectedTag[] = [];
  let settings: LayerSettings = { ...(family.settings ?? {}) };

  ({ positive, negative, settings } = applyLayer(positive, negative, family, 'FAMILY', settings));

  const styleId = pickStyleId(family, input.styleId);
  const style = family.styles[styleId];
  if (style) {
    ({ positive, negative, settings } = applyLayer(positive, negative, style, 'STYLE', settings));
  }

  if (mapping) {
    ({ positive, negative, settings } = applyLayer(positive, negative, mapping, 'CKPT', settings));
  }

  const dismissedPos = new Set(input.dismissedPositive.map(tagKey));
  const dismissedNeg = new Set(input.dismissedNegative.map(tagKey));
  const positiveTags = positive.filter((t) => !dismissedPos.has(tagKey(t.tag)));
  let negativeTags = negative.filter((t) => !dismissedNeg.has(tagKey(t.tag)));

  const disableNegative = Boolean(family.disableNegative);
  if (disableNegative) {
    negativeTags = [];
  }

  const baseRes = settings.baseRes ?? 1024;
  const tagSources = family.tagSources ?? [];
  const tagFormat = family.tagFormat ?? 'underscores';

  return {
    familyId: family.id,
    familyName: family.name,
    styleId,
    mapped: true,
    disableNegative,
    positiveTags,
    negativeTags,
    finalPositive: joinPrompt(
      positiveTags.map((t) => t.tag),
      input.userPositive,
    ),
    finalNegative: disableNegative
      ? ''
      : joinPrompt(
          negativeTags.map((t) => t.tag),
          input.userNegative,
        ),
    settings,
    aspectPresets: scaleAspectPresets(baseRes),
    tagSources,
    tagFormat,
    tagsEnabled: tagSources.length > 0,
  };
}

export function listFamilySummaries() {
  return listFamilies().map((f) => ({
    id: f.id,
    name: f.name,
    defaultStyle: f.defaultStyle,
    disableNegative: Boolean(f.disableNegative),
    tagSources: f.tagSources ?? [],
    tagFormat: f.tagFormat ?? 'underscores',
    tagsEnabled: (f.tagSources ?? []).length > 0,
    styles: Object.entries(f.styles).map(([id, s]) => ({ id, name: s.name })),
    settings: f.settings ?? {},
  }));
}

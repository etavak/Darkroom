import { useCallback, useEffect, useState } from 'react';

/** Prompt editor preferences (studio prompt panel → Settings). Stored per device. */
export type PromptPrefs = {
  /** Suggest tags while typing */
  autocomplete: boolean;
  /** How suggested tags are written into the prompt */
  insertFormat: 'spaces' | 'underscores';
  /** Master switch for all prompt highlighting */
  highlight: boolean;
  /** Colour (tag:1.2) weights */
  hlWeights: boolean;
  /** Colour {a|b} random choices */
  hlChoices: boolean;
  /** Colour __wildcards__ */
  hlWildcards: boolean;
  /** Colour character / copyright / artist / meta tags (tag models) */
  hlCategory: boolean;
  /** Wavy underline under tags the dictionary doesn't know */
  underlineUnknown: boolean;
  /** Tint tags AI enhance added until they're kept */
  hlNew: boolean;
  hlColors: { weights: string; choices: string; wildcards: string };
  /** Token count + bar under the prompt */
  tokenCounter: boolean;
};

const KEY = 'darkroom.promptPrefs';

export const DEFAULT_PROMPT_PREFS: PromptPrefs = {
  autocomplete: true,
  insertFormat: 'spaces',
  highlight: true,
  hlWeights: true,
  hlChoices: true,
  hlWildcards: true,
  hlCategory: true,
  underlineUnknown: true,
  hlNew: true,
  hlColors: { weights: '#f2b544', choices: '#5fbcbf', wildcards: '#c08cf0' },
  tokenCounter: true,
};

export function loadPromptPrefs(): PromptPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PROMPT_PREFS };
    const parsed = JSON.parse(raw) as Partial<PromptPrefs>;
    return {
      ...DEFAULT_PROMPT_PREFS,
      ...parsed,
      hlColors: { ...DEFAULT_PROMPT_PREFS.hlColors, ...(parsed.hlColors ?? {}) },
      insertFormat: parsed.insertFormat === 'underscores' ? 'underscores' : 'spaces',
    };
  } catch {
    return { ...DEFAULT_PROMPT_PREFS };
  }
}

export function usePromptPrefs() {
  const [prefs, setPrefs] = useState<PromptPrefs>(loadPromptPrefs);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setPrefs(loadPromptPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((partial: Partial<PromptPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...partial };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private mode / quota
      }
      return next;
    });
  }, []);

  return [prefs, update] as const;
}

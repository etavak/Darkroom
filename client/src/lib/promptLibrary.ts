/** Device-local recent prompts + saved snippets. */

const RECENT_KEY = 'darkroom.recentPrompts';
const SNIPPETS_KEY = 'darkroom.promptSnippets';
const MAX_RECENT = 50;

export type PromptSnippet = {
  id: string;
  name: string;
  text: string;
  createdAt: number;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadRecentPrompts(): string[] {
  const list = readJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, MAX_RECENT);
}

export function pushRecentPrompt(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return loadRecentPrompts();
  const next = [trimmed, ...loadRecentPrompts().filter((p) => p !== trimmed)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function loadSnippets(): PromptSnippet[] {
  const list = readJson<unknown>(SNIPPETS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (x): x is PromptSnippet =>
        Boolean(x) &&
        typeof x === 'object' &&
        typeof (x as PromptSnippet).id === 'string' &&
        typeof (x as PromptSnippet).text === 'string',
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function saveSnippet(name: string, text: string): PromptSnippet[] {
  const trimmed = text.trim();
  if (!trimmed) return loadSnippets();
  const snippet: PromptSnippet = {
    id: crypto.randomUUID(),
    name: name.trim() || trimmed.slice(0, 32),
    text: trimmed,
    createdAt: Date.now(),
  };
  const next = [snippet, ...loadSnippets()];
  try {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function deleteSnippet(id: string): PromptSnippet[] {
  const next = loadSnippets().filter((s) => s.id !== id);
  try {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

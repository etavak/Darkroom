import type { CSSProperties, ReactNode } from 'react';
import type { PromptPrefs } from '@/lib/promptPrefs';

/**
 * Split text into weights (tag:1.2), random choices {a|b} and __wildcards__. Each run gets a
 * class (hl-w / hl-alt / hl-wc) that the overlay colours from CSS variables, so the colours
 * and per-type switches live in one place (see highlightStyle).
 */
export function highlightPromptSyntax(text: string): ReactNode[] {
  if (!text) return [];
  const nodes: ReactNode[] = [];
  const re = /(\([^)]*:\s*[\d.]+\))|(\{[^{}]*\|[^{}]*\})|(__[\w\-./ ]+?__)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={`t-${i++}`}>{text.slice(last, m.index)}</span>);
    const cls = m[1] ? 'hl-w' : m[2] ? 'hl-alt' : 'hl-wc';
    nodes.push(
      <span key={`h-${i++}`} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<span key={`t-${i++}`}>{text.slice(last)}</span>);
  return nodes;
}

/** Which highlight kinds are on, and their colours */
export type HighlightOptions = Pick<
  PromptPrefs,
  'highlight' | 'hlWeights' | 'hlChoices' | 'hlWildcards' | 'hlCategory' | 'underlineUnknown' | 'hlNew' | 'hlColors'
>;

/** Class + CSS variables for a highlight overlay (switched-off kinds render as plain text). */
export function highlightStyle(o: HighlightOptions): { className: string; style: CSSProperties } {
  const off = [
    !o.hlWeights && 'hl-no-w',
    !o.hlChoices && 'hl-no-alt',
    !o.hlWildcards && 'hl-no-wc',
    !o.hlCategory && 'hl-no-cat',
    !o.underlineUnknown && 'hl-no-unk',
    !o.hlNew && 'hl-no-new',
  ].filter(Boolean);
  return {
    className: ['hl-root', ...off].join(' '),
    style: {
      '--hl-weights': o.hlColors.weights,
      '--hl-choices': o.hlColors.choices,
      '--hl-wildcards': o.hlColors.wildcards,
    } as CSSProperties,
  };
}

/** Swatches the colour buttons cycle through */
export const HIGHLIGHT_PALETTE = ['#f2b544', '#5fbcbf', '#c08cf0', '#f07fae', '#7fcf7a', '#6ea8f0', '#f0857f'];

/** Danbooru-style category colours (dots in suggestions, tag colouring in the prompt) */
export const CATEGORY_COLORS: Record<string, string> = {
  general: '#6ea8f0',
  artist: '#f0857f',
  character: '#7fcf7a',
  copyright: '#d27bd6',
  meta: '#e2b44f',
};

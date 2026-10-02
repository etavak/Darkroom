import type { ReactNode } from 'react';

/** Highlight (tag:1.2) weights and {a|b} wildcards for the prompt overlay. */
export function highlightPromptSyntax(text: string): ReactNode[] {
  if (!text) return [];
  const nodes: ReactNode[] = [];
  // Weights: (foo:1.2) or ((foo)) — emphasize colon-weight form; also bare (...) groups lightly
  const re = /(\([^)]*:\s*[\d.]+\))|(\{[^{}]*\|[^{}]*\})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<span key={`t-${i++}`}>{text.slice(last, m.index)}</span>);
    }
    if (m[1]) {
      nodes.push(
        <span key={`w-${i++}`} className="rounded-sm bg-amber-400/15 text-amber-200">
          {m[1]}
        </span>,
      );
    } else if (m[2]) {
      nodes.push(
        <span key={`c-${i++}`} className="rounded-sm bg-sky-400/15 text-sky-200">
          {m[2]}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={`t-${i++}`}>{text.slice(last)}</span>);
  }
  return nodes;
}

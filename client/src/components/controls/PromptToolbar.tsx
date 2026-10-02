import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bookmark, Clock, Dices, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { enhancePromptApi, fetchWildcardContent, fetchWildcards } from '@/lib/api';
import {
  deleteSnippet,
  loadRecentPrompts,
  loadSnippets,
  saveSnippet,
  type PromptSnippet,
} from '@/lib/promptLibrary';
import { cn } from '@/lib/utils';

type Menu = 'recent' | 'snippets' | 'wildcard' | null;

type Props = {
  prompt: string;
  onInsert: (text: string, mode?: 'replace' | 'append') => void;
  enhanceConfigured: boolean;
  disabled?: boolean;
};

export function PromptToolbar({ prompt, onInsert, enhanceConfigured, disabled }: Props) {
  const [menu, setMenu] = useState<Menu>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [wildcards, setWildcards] = useState<Array<{ name: string; relative: string }>>([]);
  const [enhancing, setEnhancing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const openRecent = () => {
    setRecent(loadRecentPrompts());
    setMenu((m) => (m === 'recent' ? null : 'recent'));
  };

  const openSnippets = () => {
    setSnippets(loadSnippets());
    setMenu((m) => (m === 'snippets' ? null : 'snippets'));
  };

  const openWildcards = () => {
    setMenu((m) => (m === 'wildcard' ? null : 'wildcard'));
    void fetchWildcards()
      .then((res) => setWildcards(res.items))
      .catch(() => setWildcards([]));
  };

  const insertWildcardFile = async (relative: string) => {
    try {
      const { options } = await fetchWildcardContent(relative);
      if (options.length === 0) {
        onInsert('{option1|option2}', 'append');
      } else {
        onInsert(`{${options.slice(0, 24).join('|')}}`, 'append');
      }
    } catch {
      onInsert('{option1|option2}', 'append');
    }
    setMenu(null);
  };

  const onEnhance = async () => {
    if (!enhanceConfigured || !prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await enhancePromptApi(prompt);
      if (res.prompt) onInsert(res.prompt, 'replace');
    } catch {
      // leave prompt unchanged
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-0.5">
      <Tooltip content="Recent prompts">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={disabled}
          onClick={openRecent}
          aria-label="Recent prompts"
        >
          <Clock className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content="Saved snippets">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={disabled}
          onClick={openSnippets}
          aria-label="Saved snippets"
        >
          <Bookmark className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content="Insert wildcard">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={disabled}
          onClick={openWildcards}
          aria-label="Insert wildcard"
        >
          <Dices className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      {enhanceConfigured ? (
        <Tooltip content={enhancing ? 'Enhancing…' : 'Enhance prompt'}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={disabled || enhancing || !prompt.trim()}
            onClick={() => void onEnhance()}
            aria-label="Enhance prompt"
          >
            <Sparkles className={cn('h-3.5 w-3.5', enhancing && 'animate-pulse')} />
          </Button>
        </Tooltip>
      ) : null}

      {menu === 'recent' && (
        <MenuPanel>
          {recent.length === 0 ? (
            <Empty>No recent prompts yet</Empty>
          ) : (
            recent.map((p) => (
              <MenuButton
                key={p}
                onClick={() => {
                  onInsert(p, 'replace');
                  setMenu(null);
                }}
              >
                {p}
              </MenuButton>
            ))
          )}
        </MenuPanel>
      )}

      {menu === 'snippets' && (
        <MenuPanel>
          <button
            type="button"
            className="w-full border-b border-border/60 px-2.5 py-1.5 text-left text-[11px] text-primary hover:bg-accent"
            disabled={disabled || !prompt.trim()}
            onClick={() => {
              const name = window.prompt('Snippet name', prompt.trim().slice(0, 32) || 'Snippet');
              if (name == null) return;
              setSnippets(saveSnippet(name, prompt));
            }}
          >
            Save current prompt…
          </button>
          {snippets.length === 0 ? (
            <Empty>No saved snippets</Empty>
          ) : (
            snippets.map((s) => (
              <div key={s.id} className="flex items-stretch gap-0.5">
                <MenuButton
                  className="flex-1"
                  onClick={() => {
                    onInsert(s.text, 'append');
                    setMenu(null);
                  }}
                >
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {s.text}
                  </span>
                </MenuButton>
                <button
                  type="button"
                  className="px-2 text-[10px] text-muted-foreground hover:text-destructive"
                  onClick={() => setSnippets(deleteSnippet(s.id))}
                  aria-label="Delete snippet"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </MenuPanel>
      )}

      {menu === 'wildcard' && (
        <MenuPanel>
          <MenuButton
            onClick={() => {
              onInsert('{option1|option2}', 'append');
              setMenu(null);
            }}
          >
            Insert {'{a|b}'} template
          </MenuButton>
          {wildcards.length === 0 ? (
            <Empty>Set a wildcards folder in Settings to pick files</Empty>
          ) : (
            wildcards.map((w) => (
              <MenuButton key={w.relative} onClick={() => void insertWildcardFile(w.relative)}>
                {w.relative}
              </MenuButton>
            ))
          )}
        </MenuPanel>
      )}
    </div>
  );
}

function MenuPanel({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-56 w-[min(100%,18rem)] overflow-auto rounded-[10px] border border-border bg-popover py-1 text-sm shadow-md">
      {children}
    </div>
  );
}

function MenuButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        'block w-full truncate px-2.5 py-1.5 text-left text-[11px] leading-snug hover:bg-accent',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2.5 py-2 text-[11px] text-muted-foreground">{children}</p>;
}

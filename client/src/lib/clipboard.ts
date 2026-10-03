/**
 * Copy text. navigator.clipboard only exists on secure pages (https or localhost); over the
 * local network (phones) fall back to a hidden textarea + execCommand.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Copy failed');
}

/** Copying images needs the async clipboard API, which plain-http pages don't have. */
export function canCopyImages(): boolean {
  return typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write);
}

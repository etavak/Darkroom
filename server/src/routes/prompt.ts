import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { loadServerSettings } from '../services/appSettings.js';
import { randomPromptFor } from '../services/randomPrompt.js';
import { getFamily } from '../presets/catalog.js';
import { tagExistsInFamily } from '../tags/dictionary.js';
import type { FamilyDef } from '../presets/types.js';

/** How enhance should write for this family: tags for tag-trained models, prose otherwise. */
function enhanceSystemPrompt(fam: FamilyDef | null): string {
  const sources = fam?.tagSources ?? [];
  if (fam && sources.length) {
    const boorus = sources.includes('e621') && sources.includes('danbooru') ? 'Danbooru and e621' : sources.includes('e621') ? 'e621' : 'Danbooru';
    return [
      `You expand prompts for ${fam.name}, an image model trained on ${boorus} tags.`,
      `Rewrite the user's prompt as ONE comma-separated list of ${boorus} tags: lowercase, spaces instead of underscores, no sentences, no numbering, no explanations.`,
      'Keep every tag or idea the user gave (turn phrases into the matching tags).',
      'Add 10–20 fitting tags: subject details (hair, eyes, clothing, expression, pose), framing or camera angle, background and setting, lighting and atmosphere.',
      'Do not add quality, score or rating tags (masterpiece, best quality, score_9, rating_safe…) — they are added automatically.',
      'Reply with only the tag list.',
    ].join(' ');
  }
  const words = fam?.promptTokenMode === 'encoder' ? 120 : 60;
  return [
    `You enhance prompts for ${fam?.name ?? 'an image model'}, which reads natural language.`,
    `Rewrite the user's prompt as one vivid, concrete description in a single paragraph of at most ${words} words: subject and details, setting, lighting, mood and composition.`,
    'Keep everything the user asked for. Reply with only the prompt — no quotes, labels or commentary.',
  ].join(' ');
}

/** Tidy a model's tag reply: one list, known tags only (the user's own tags always stay). */
export function cleanTagReply(reply: string, userPrompt: string, fam: FamilyDef): string {
  const norm = (t: string) => t.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const userTags = new Set(userPrompt.split(',').map(norm).filter(Boolean));
  const presetTags = new Set(
    [...(fam.qualityPresets ?? []).flatMap((l) => l.tags), ...(fam.negativePresets ?? []).flatMap((l) => l.tags), ...(fam.positive ?? [])].map(norm),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of reply.replace(/^(tags?|prompt)\s*:\s*/i, '').split(/[,\n]+/)) {
    const cleaned = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["'`]+|["'`.]+$/g, '');
    const t = norm(cleaned);
    if (!t || seen.has(t)) continue;
    const mine = userTags.has(t);
    if (!mine) {
      if (presetTags.has(t) || /^(score \d|score_\d|rating[ :_])/.test(t)) continue;
      // Sentences slip through sometimes; tags are short
      if (t.split(' ').length > 5) continue;
      if (!/[()]/.test(t) && !tagExistsInFamily(fam.id, t)) continue;
    }
    seen.add(t);
    out.push(mine ? cleaned.trim() : t);
  }
  return out.join(', ');
}

export const promptRouter = Router();

function listWildcardFiles(dir: string): Array<{ name: string; relative: string }> {
  if (!dir || !fs.existsSync(dir)) return [];
  const out: Array<{ name: string; relative: string }> = [];
  const walk = (current: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (/\.(txt|wildcards?)$/i.test(ent.name)) {
        out.push({ name: ent.name.replace(/\.(txt|wildcards?)$/i, ''), relative: rel });
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => a.relative.localeCompare(b.relative)).slice(0, 200);
}

promptRouter.get('/wildcards', (_req, res) => {
  const settings = loadServerSettings();
  const folder = settings.wildcardsFolder?.trim() ?? '';
  res.json({ folder, items: listWildcardFiles(folder) });
});

/** A random starting prompt that suits the family (tags its dictionary knows, or a sentence). */
promptRouter.get('/random', (req, res) => {
  const family = typeof req.query.family === 'string' && req.query.family ? req.query.family : null;
  res.json({ prompt: randomPromptFor(family) });
});

promptRouter.post('/enhance', async (req, res) => {
  const settings = loadServerSettings();
  const endpoint = settings.enhanceApiUrl?.trim() ?? '';
  const model = settings.enhanceModel?.trim() ?? '';
  if (!endpoint || !model) {
    res.status(400).json({ error: 'Enhance is not configured. Set endpoint + model in Settings.' });
    return;
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const url = endpoint.replace(/\/$/, '') + '/chat/completions';
  const fam = typeof req.body?.family === 'string' && req.body.family ? getFamily(req.body.family) ?? null : null;
  const tagMode = Boolean(fam && (fam.tagSources ?? []).length);
  const system =
    typeof req.body?.system === 'string' && req.body.system.trim() ? req.body.system.trim() : enhanceSystemPrompt(fam);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (settings.enhanceApiKey?.trim()) {
      headers.Authorization = `Bearer ${settings.enhanceApiKey.trim()}`;
    }
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      res.status(502).json({
        error: `Enhance failed (${r.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      });
      return;
    }
    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      res.status(502).json({ error: 'Empty response from enhance endpoint' });
      return;
    }
    const text = content.replace(/^["']|["']$/g, '');
    if (tagMode && fam) {
      const tags = cleanTagReply(text, prompt, fam);
      res.json({ prompt: tags || prompt });
      return;
    }
    res.json({ prompt: text });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Enhance request failed' });
  }
});

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { loadServerSettings } from '../services/appSettings.js';

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
  const system =
    typeof req.body?.system === 'string' && req.body.system.trim()
      ? req.body.system.trim()
      : 'You enhance image-generation prompts. Reply with only the improved prompt text, no quotes or commentary.';

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
    res.json({ prompt: content.replace(/^["']|["']$/g, '') });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Enhance request failed' });
  }
});

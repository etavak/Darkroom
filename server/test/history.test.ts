import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { db } from '../src/db/index.js';
import * as history from '../src/services/history.js';

/** A completed generation with real (tiny) image files in the temp data folder. */
function add(id: string, at: number, images: string[]) {
  db.prepare(`INSERT INTO generations (id, created_at, prompt_id, client_id, settings_json, image_paths_json, status, completed_at) VALUES (?, ?, 'p', 'c', '{"prompt":"x"}', ?, 'completed', ?)`).run(id, at, JSON.stringify(images), at);
  for (const f of images) fs.writeFileSync(path.join(config.imagesDir, f), 'img');
}

beforeEach(() => {
  db.prepare('DELETE FROM generations').run();
  fs.mkdirSync(config.imagesDir, { recursive: true });
});

describe('history paging', () => {
  it('is not capped at 100 any more, and pages with a stable cursor', () => {
    for (let i = 0; i < 250; i++) add(`g${String(i).padStart(3, '0')}`, 1_000_000 + Math.floor(i / 5), [`g${i}.png`]); // 5 per millisecond
    const first = history.listGenerations(100);
    expect(first.items).toHaveLength(100);
    expect(first.total).toBe(250);
    expect(first.hasMore).toBe(true);
    const seen = new Set(first.items.map((i) => i.id));
    let page = first;
    while (page.hasMore) {
      const last = page.items[page.items.length - 1];
      page = history.listGenerations(100, { at: last.createdAt, id: last.id });
      for (const it of page.items) {
        expect(seen.has(it.id)).toBe(false); // no repeats across pages
        seen.add(it.id);
      }
    }
    expect(seen.size).toBe(250); // nothing skipped, even with equal timestamps
  });
});

describe('delete images you haven\'t downloaded', () => {
  it('keeps downloaded and pinned images, deletes the rest for good', () => {
    add('a', 3, ['a1.png', 'a2.png']);
    add('b', 2, ['b1.png']);
    add('c', 1, ['c1.png']);
    expect(history.markDownloaded(['a1.png'])).toBe(1);
    expect(history.unsavedSummary(new Set(['b']))).toMatchObject({ images: 2, generations: 2 });
    history.purgeUnsaved(new Set(['b']));
    expect(fs.existsSync(path.join(config.imagesDir, 'a1.png'))).toBe(true);
    expect(fs.existsSync(path.join(config.imagesDir, 'a2.png'))).toBe(false);
    expect(fs.existsSync(path.join(config.imagesDir, 'b1.png'))).toBe(true);
    expect(fs.existsSync(path.join(config.imagesDir, 'c1.png'))).toBe(false);
    const left = history.listGenerations(10).items.map((g) => [g.id, g.images, g.downloaded]);
    expect(left).toEqual([
      ['a', ['a1.png'], ['a1.png']],
      ['b', ['b1.png'], []],
    ]);
  });
});

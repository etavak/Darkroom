import { Router } from 'express';
import * as history from '../services/history.js';

export const historyRouter = Router();

historyRouter.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 200;
  const at = Number(req.query.before);
  const id = typeof req.query.beforeId === 'string' ? req.query.beforeId : '';
  res.json(history.listGenerations(limit, at ? { at, id } : undefined));
});

/** The client downloaded these images (single download, ZIP or phone Save). */
historyRouter.post('/downloaded', (req, res) => {
  const images = Array.isArray(req.body?.images) ? req.body.images.filter((x: unknown): x is string => typeof x === 'string').slice(0, 5000) : [];
  res.json({ marked: history.markDownloaded(images) });
});

const keepSet = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? v.split(',') : []);

/** How much "Delete images you haven't downloaded" would remove (pinned generations kept). */
historyRouter.post('/unsaved/summary', (req, res) => {
  res.json(history.unsavedSummary(keepSet(req.body?.keep)));
});

/** Permanently deletes every image never downloaded, except pinned generations. */
historyRouter.post('/unsaved/purge', (req, res) => {
  if (req.body?.confirm !== 'delete-undownloaded') {
    res.status(400).json({ error: 'Missing confirmation' });
    return;
  }
  res.json(history.purgeUnsaved(keepSet(req.body?.keep)));
});

historyRouter.get('/:id', (req, res) => {
  const item = history.getGeneration(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(item);
});

historyRouter.delete('/:id', (req, res) => {
  const ok = history.deleteGeneration(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

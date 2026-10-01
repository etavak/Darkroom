import { Router } from 'express';
import * as history from '../services/history.js';

export const historyRouter = Router();

historyRouter.get('/', (_req, res) => {
  const items = history.listGenerations();
  res.json({ items });
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

import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';

export const imagesRouter = Router();

imagesRouter.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(config.imagesDir, filename);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Image not found' });
    }
  });
});

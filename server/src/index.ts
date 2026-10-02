import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import './db/index.js';
import { pingComfy } from './services/comfyClient.js';
import { resumePendingJobs } from './services/generation.js';
import { isAllowedHost, isAuthorized, isSameOrigin } from './services/lanAuth.js';
import { authRouter } from './routes/auth.js';
import { generateRouter } from './routes/generate.js';
import { historyRouter } from './routes/history.js';
import { imagesRouter } from './routes/images.js';
import { modelsRouter } from './routes/models.js';
import { presetsRouter } from './routes/presets.js';
import { promptRouter } from './routes/prompt.js';
import { sourceRouter } from './routes/source.js';
import { settingsRouter } from './routes/settings.js';
import { tagsRouter } from './routes/tags.js';
import { comfyRouter } from './routes/comfy.js';
import { loadAllTagDictionaries } from './tags/dictionary.js';
import { attachComfyWsProxy } from './ws/comfyProxy.js';

const app = express();

// Only answer to this machine's names/IPs (blocks DNS-rebinding pages)
app.use((req, res, next) => {
  if (!isAllowedHost(req.headers.host)) {
    res.status(403).send('Forbidden host');
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// Same-origin writes only; other devices need the LAN PIN (see services/lanAuth.ts)
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req)) {
    res.status(403).json({ error: 'Cross-site request blocked' });
    return;
  }
  if (req.path === '/health' || req.path.startsWith('/auth/')) {
    next();
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'auth_required' });
    return;
  }
  next();
});

app.get('/api/health', async (_req, res) => {
  const comfyOk = await pingComfy();
  res.json({
    ok: true,
    comfy: comfyOk,
    comfyUrl: config.comfyUrl,
    mock: process.env.MOCK === 'true',
    mode: (process.env.COMFY_MODE || 'local').toLowerCase() === 'remote' ? 'remote' : 'local',
  });
});

app.use('/api/auth', authRouter);
app.use('/api/models', modelsRouter);
app.use('/api/generate', generateRouter);
app.use('/api/history', historyRouter);
app.use('/api/images', imagesRouter);
app.use('/api/presets', presetsRouter);
app.use('/api/prompt', promptRouter);
app.use('/api/source', sourceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/comfy', comfyRouter);

const clientDist = config.clientDist;
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = http.createServer(app);
attachComfyWsProxy(server);

loadAllTagDictionaries();
resumePendingJobs();

server.listen(config.port, () => {
  console.log(`Darkroom server listening on http://127.0.0.1:${config.port}`);
  console.log(`Proxying ComfyUI at ${config.comfyUrl}`);
});

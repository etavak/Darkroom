import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { resumePendingJobs } from './services/generation.js';
import { loadAllTagDictionaries } from './tags/dictionary.js';
import { attachComfyWsProxy } from './ws/comfyProxy.js';

const server = http.createServer(createApp());
attachComfyWsProxy(server);

loadAllTagDictionaries();
resumePendingJobs();

server.listen(config.port, () => {
  console.log(`Darkroom server listening on http://127.0.0.1:${config.port}`);
  console.log(`Proxying ComfyUI at ${config.comfyUrl}`);
});

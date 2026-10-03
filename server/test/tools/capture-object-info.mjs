#!/usr/bin/env node
/**
 * Refresh test/fixtures/object_info.json from a running ComfyUI:
 *   node server/test/tools/capture-object-info.mjs [http://127.0.0.1:8188]
 *
 * Keeps only the node classes Darkroom's server code names, and replaces model file lists
 * with placeholders (so nobody's model names end up in the repo). Both the classic
 * `[[options]]` and the newer `["COMBO", {options}]` input shapes are kept as ComfyUI sends them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../../src');
const out = path.resolve(here, '../fixtures/object_info.json');
const url = (process.argv[2] || process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

const source = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (f.endsWith('.ts')) source.push(fs.readFileSync(f, 'utf8'));
  }
};
walk(srcDir);
const code = source.join('\n');

const info = await (await fetch(`${url}/object_info`)).json();
// Model files and the images in ComfyUI's input folder are the user's own — replaced with placeholders
const FILE = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft|png|jpe?g|webp|gif|bmp)$/i;
const placeholder = (opts) => {
  const ext = (opts.find((o) => typeof o === 'string' && FILE.test(o)) ?? 'model.safetensors').split('.').pop();
  const sub = opts.find((o) => typeof o === 'string' && o.includes('/'))?.split('/')[0];
  return [`${sub ? sub + '/' : ''}model-a.${ext}`, `${sub ? sub + '/' : ''}model-b.${ext}`];
};
const scrub = (spec) => {
  if (!Array.isArray(spec)) return spec;
  if (Array.isArray(spec[0]) && spec[0].some((o) => typeof o === 'string' && FILE.test(o))) return [placeholder(spec[0]), ...spec.slice(1)];
  if (spec[0] === 'COMBO' && Array.isArray(spec[1]?.options) && spec[1].options.some((o) => typeof o === 'string' && FILE.test(o))) {
    return ['COMBO', { ...spec[1], options: placeholder(spec[1].options) }, ...spec.slice(2)];
  }
  return spec;
};

const kept = {};
for (const [name, node] of Object.entries(info)) {
  if (!code.includes(`'${name}'`) && !code.includes(`"${name}"`)) continue;
  const input = {};
  for (const group of ['required', 'optional']) {
    if (!node.input?.[group]) continue;
    input[group] = Object.fromEntries(Object.entries(node.input[group]).map(([k, v]) => [k, scrub(v)]));
  }
  kept[name] = { input, output: node.output, output_name: node.output_name, name: node.name };
}
fs.writeFileSync(out, JSON.stringify(kept, null, 1) + '\n');
console.log(`Saved ${Object.keys(kept).length} node classes to ${path.relative(process.cwd(), out)}`);

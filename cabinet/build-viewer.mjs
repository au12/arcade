#!/usr/bin/env node
// Bundles the 3D viewer into one self-contained HTML file, with the model
// generate.mjs wrote: cut/<monitor>/viewer.html (open it straight from disk).
//   node build-viewer.mjs [cut/21.5]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] || path.join(here, 'cut', '21.5'));
const modelPath = path.join(dir, 'cabinet.json');
if (!fs.existsSync(modelPath)) {
  console.error(`No ${path.relative(process.cwd(), modelPath)}: run generate.mjs first.`);
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(here, 'viewer', 'main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const model = fs.readFileSync(modelPath, 'utf8').replace(/</g, '\\u003c');
const html = fs
  .readFileSync(path.join(here, 'viewer', 'index.html'), 'utf8')
  .replace('/*MODEL*/', () => model)
  .replace('/*SCRIPT*/', () => script);
const out = path.join(dir, 'viewer.html');
fs.writeFileSync(out, html);
console.log(`viewer → ${path.relative(process.cwd(), out)} (${Math.round(html.length / 1024)} KB)`);

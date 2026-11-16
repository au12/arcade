// Builds the arcade app and the admin page into dist/:
//   dist/index.html, dist/admin.html     pages with hashed asset links
//   dist/assets/*                        bundles, styles, fonts (content-hashed)
//   dist/sdk/v1/arcade.js                the SDK, for games that load it from the arcade
//   dist/sw.js                           the service worker, with the asset list baked in
// Every text asset gets precompressed .br and .gz siblings.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
const watch = process.argv.includes('--watch');
const versionFile = path.join(here, '..', 'VERSION');
const version = process.env.VERSION || (fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version);

const entries = {
  app: path.join(here, 'src', 'main.jsx'),
  admin: path.join(here, 'src', 'admin', 'main.jsx'),
};

const options = {
  entryPoints: entries,
  bundle: true,
  format: 'esm',
  splitting: false,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['chrome100', 'safari15', 'firefox100'],
  outdir: path.join(out, 'assets'),
  entryNames: '[name].[hash]',
  assetNames: '[name].[hash]',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.svg': 'text' },
  metafile: true,
  logLevel: 'info',
  define: { __VERSION__: JSON.stringify(version) },
};

function hashOf(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

function compress(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      compress(p);
      continue;
    }
    if (!/\.(js|css|html|svg|json|webmanifest|txt|map)$/.test(name.name)) continue;
    const buf = fs.readFileSync(p);
    if (buf.length < 512) continue;
    fs.writeFileSync(`${p}.br`, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
    fs.writeFileSync(`${p}.gz`, zlib.gzipSync(buf, { level: 9 }));
  }
}

function page(template, js, css) {
  return fs
    .readFileSync(path.join(here, 'src', template), 'utf8')
    .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/assets/${css}">` : '')
    .replace('<!--JS-->', `<script type="module" src="/assets/${js}"></script>`)
    .replaceAll('__VERSION__', version);
}

function finish(meta) {
  const outputs = Object.entries(meta.outputs);
  const bundle = (entry) => {
    const [file, o] = outputs.find(([f, x]) => f.endsWith('.js') && x.entryPoint && path.resolve(x.entryPoint) === entries[entry]);
    return { js: path.basename(file), css: o.cssBundle ? path.basename(o.cssBundle) : null };
  };
  const { js: appJs, css: appCss } = bundle('app');
  const { js: adminJs, css: adminCss } = bundle('admin');
  fs.writeFileSync(path.join(out, 'index.html'), page('index.html', appJs, appCss));
  fs.writeFileSync(path.join(out, 'admin.html'), page('admin.html', adminJs, adminCss));

  // static files
  const pub = path.join(here, 'public');
  fs.cpSync(pub, out, { recursive: true });

  // the SDK
  fs.mkdirSync(path.join(out, 'sdk', 'v1'), { recursive: true });
  fs.copyFileSync(path.join(here, '..', 'sdk', 'arcade.js'), path.join(out, 'sdk', 'v1', 'arcade.js'));
  fs.copyFileSync(path.join(here, '..', 'sdk', 'arcade.d.ts'), path.join(out, 'sdk', 'v1', 'arcade.d.ts'));

  // the service worker: the app shell, precached
  // Precache what this app needs: not the admin page, not the old .woff fallbacks, not scripts we never show.
  const assets = fs
    .readdirSync(path.join(out, 'assets'))
    .filter((f) => !/\.(br|gz|woff)$/.test(f) && !f.startsWith('admin.') && !/(arabic|cyrillic|hebrew|greek|vietnamese)/.test(f));
  const shell = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...assets.map((a) => `/assets/${a}`)];
  const swSrc = fs.readFileSync(path.join(here, 'src', 'sw.js'), 'utf8');
  const swVersion = hashOf(Buffer.from(JSON.stringify(shell) + fs.readFileSync(path.join(out, 'index.html'))));
  fs.writeFileSync(path.join(out, 'sw.js'), swSrc.replace('__SHELL__', JSON.stringify(shell)).replace('__CACHE__', `arcade-${swVersion}`));

  compress(out);
  const size = (f) => (fs.statSync(path.join(out, 'assets', f)).size / 1024).toFixed(1);
  console.log(`built ${version}: ${appJs} (${size(appJs)} KB), ${appCss} (${size(appCss)} KB), admin ${adminJs}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'finish',
        setup(build) {
          build.onEnd((r) => {
            if (!r.errors.length && r.metafile) finish(r.metafile);
          });
        },
      },
    ],
  });
  await ctx.watch();
} else {
  const r = await esbuild.build(options);
  finish(r.metafile);
}

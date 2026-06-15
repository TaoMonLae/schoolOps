#!/usr/bin/env node
//
// Precompile the browser-Babel SPA in public/ into a fully self-contained
// bundle in mobile-dist/ for the Capacitor app:
//   - vendors React + ReactDOM locally (no unpkg CDN)
//   - transpiles every JSX component to plain JS (no @babel/standalone at runtime)
// The result boots with zero external network dependencies, so the app shell
// works offline. The website (served from public/) is left untouched.
//
// Run:  npm run build:mobile     then  npx cap sync
//
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'mobile-dist');

// 1. Clean and copy public/ -> mobile-dist/
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

// 2. Vendor React + ReactDOM UMD builds locally
const vendorDir = path.join(OUT, 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });
const reactUmd = path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.production.min.js');
const reactDomUmd = path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js');
fs.copyFileSync(reactUmd, path.join(vendorDir, 'react.production.min.js'));
fs.copyFileSync(reactDomUmd, path.join(vendorDir, 'react-dom.production.min.js'));

// 3. Collect the text/babel script srcs from index.html, in load order
const htmlPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const scriptRe = /<script\s+type="text\/babel"\s+src="([^"]+)"[^>]*><\/script>/g;
const srcs = [...html.matchAll(scriptRe)].map((m) => m[1]);
if (!srcs.length) throw new Error('No text/babel scripts found in index.html — has the markup changed?');

// 4. Transpile each script in place (JSX -> plain JS, kept as a classic script
//    so top-level declarations stay global, exactly like the in-browser version)
for (const src of srcs) {
  const file = path.join(OUT, src);
  const code = fs.readFileSync(file, 'utf8');
  const result = babel.transformSync(code, {
    filename: file,
    presets: [['@babel/preset-react']],
    sourceType: 'script',
    compact: false,
    babelrc: false,
    configFile: false,
  });
  fs.writeFileSync(file, result.code);
}

// 5. Rewrite index.html: local React, drop Babel, plain <script> types
html = html
  .replace(/<script[^>]*unpkg\.com\/react@18[^>]*><\/script>/, '<script src="vendor/react.production.min.js"></script>')
  .replace(/<script[^>]*unpkg\.com\/react-dom@18[^>]*><\/script>/, '<script src="vendor/react-dom.production.min.js"></script>')
  .replace(/\s*<script[^>]*unpkg\.com\/@babel\/standalone[^>]*><\/script>/, '')
  .replace(/<script\s+type="text\/babel"\s+src="([^"]+)"[^>]*><\/script>/g, '<script src="$1"></script>');

fs.writeFileSync(htmlPath, html);
console.log(`Built mobile-dist/ — transpiled ${srcs.length} scripts, vendored React locally.`);

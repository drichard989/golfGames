#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const swPath = path.join(root, 'sw.js');
const htmlPath = path.join(root, 'index.html');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function bumpPatch(version) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]) + 1;
  return `v${major}.${minor}.${patch}`;
}

function main() {
  const sw = read(swPath);
  const swMatch = sw.match(/const\s+CACHE_VERSION\s*=\s*'([^']+)'\s*;/);
  if (!swMatch) {
    throw new Error('Could not locate CACHE_VERSION in sw.js');
  }

  const current = swMatch[1];
  const next = bumpPatch(current);

  const nextSw = sw.replace(
    /const\s+CACHE_VERSION\s*=\s*'[^']+'\s*;/,
    `const CACHE_VERSION = '${next}';`
  );

  const html = read(htmlPath);
  const nextHtml = html.replace(/\?v=v\d+\.\d+\.\d+/g, `?v=${next}`);

  if (nextSw !== sw) write(swPath, nextSw);
  if (nextHtml !== html) write(htmlPath, nextHtml);

  process.stdout.write(`[cache-bump] ${current} -> ${next}\n`);
}

try {
  main();
} catch (error) {
  console.error('[cache-bump] failed:', error.message);
  process.exit(1);
}

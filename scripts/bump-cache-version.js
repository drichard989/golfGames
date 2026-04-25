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

function getSwVersion(swSource) {
  const swMatch = swSource.match(/const\s+CACHE_VERSION\s*=\s*'([^']+)'\s*;/);
  if (!swMatch) {
    throw new Error('Could not locate CACHE_VERSION in sw.js');
  }
  return swMatch[1];
}

function getHtmlVersions(htmlSource) {
  return Array.from(htmlSource.matchAll(/\?v=(v\d+\.\d+\.\d+)/g), (m) => m[1]);
}

function assertVersionSync(swVersion, htmlVersions) {
  if (!htmlVersions.length) {
    throw new Error('No ?v= version tokens found in index.html');
  }

  const unique = [...new Set(htmlVersions)];
  if (unique.length !== 1) {
    throw new Error(`index.html has mixed asset versions: ${unique.join(', ')}`);
  }

  if (unique[0] !== swVersion) {
    throw new Error(`Version mismatch: sw.js=${swVersion}, index.html=${unique[0]}`);
  }
}

function main() {
  const mode = process.argv.includes('--check') ? 'check' : 'bump';
  const sw = read(swPath);
  const html = read(htmlPath);

  if (mode === 'check') {
    const swVersion = getSwVersion(sw);
    const htmlVersions = getHtmlVersions(html);
    assertVersionSync(swVersion, htmlVersions);
    process.stdout.write(`[cache-bump] OK ${swVersion}\n`);
    return;
  }

  const current = getSwVersion(sw);
  const next = bumpPatch(current);

  const nextSw = sw.replace(
    /const\s+CACHE_VERSION\s*=\s*'[^']+'\s*;/,
    `const CACHE_VERSION = '${next}';`
  );
  const nextHtml = html.replace(/\?v=v\d+\.\d+\.\d+/g, `?v=${next}`);

  if (nextSw !== sw) write(swPath, nextSw);
  if (nextHtml !== html) write(htmlPath, nextHtml);

  assertVersionSync(next, getHtmlVersions(nextHtml));
  process.stdout.write(`[cache-bump] ${current} -> ${next}\n`);
}

try {
  main();
} catch (error) {
  console.error('[cache-bump] failed:', error.message);
  process.exit(1);
}

// Spec support for Forge grouping: a temp project rebuilt from the P1 ground-truth fixtures
// (cli/patterns/fixtures/gt, verbatim excerpts with file:line provenance and content hashes). Every
// excerpt is written back to its labeled file at its labeled lines, the rest of the file left blank, so
// labels.json spans address the sandbox directly and the scorer needs no remapping. A .vue file gets
// `<template>` on its first line and `</template>` after its last excerpt (every labeled .vue excerpt
// starts below line 1), so each excerpt element is a template root. Overlapping excerpts of one file come
// from the same source text, so writing them line by line is consistent. The sandbox is then
// fingerprinted into its own index db.
// Script excerpts cut from inside a function get a scaffold function on the free lines around them
// (gt-scaffold.js), so they are statement units as in the real file; excerpt lines never move.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFixture } from '../patterns/gt-text.js';
import { syncFingerprints } from './fingerprint-sync.js';
import { openIndexDb } from '../search-schema.js';
import { scaffoldScript } from './gt-scaffold.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GT_DIR = path.join(KIT_ROOT, 'cli', 'patterns', 'fixtures', 'gt');

const VUE_OPEN = ['<template>'];
const VUE_CLOSE = ['</template>'];

export const readGtLabels = () => JSON.parse(fs.readFileSync(path.join(GT_DIR, 'labels.json'), 'utf-8'));

/** Label items with the spans the scorer expects (labels.json lines, none stale). */
export const gtItems = (labels = readGtLabels()) => labels.items.map((item) => ({
  ...item,
  anchors: item.anchors.map((anchor) => ({ ...anchor, isStale: false, span: { startLine: anchor.startLine, endLine: anchor.endLine } }))
}));

const excerptsByFile = (labels) => {
  const byFile = new Map();
  for (const item of labels.items) {
    const entries = parseFixture(fs.readFileSync(path.join(GT_DIR, `${item.id}.txt`), 'utf-8'));
    for (const anchor of item.anchors) {
      const entry = entries.find((candidate) => candidate.id === anchor.id);
      const list = byFile.get(anchor.file) ?? [];
      list.push({ startLine: anchor.startLine, lines: entry.lines });
      byFile.set(anchor.file, list);
    }
  }
  return byFile;
};

const fileTextOf = (file, excerpts) => {
  const lines = [];
  for (const excerpt of excerpts) excerpt.lines.forEach((line, index) => { lines[excerpt.startLine - 1 + index] = line; });
  const isVue = file.endsWith('.vue');
  if (!isVue) scaffoldScript(lines, excerpts);
  const filled = Array.from(lines, (line) => line ?? '');
  const text = isVue ? [...VUE_OPEN, ...filled.slice(VUE_OPEN.length), ...VUE_CLOSE] : filled;
  return `${text.join('\n')}\n`;
};

/** Writes the sandbox files under dir; returns their relative paths in code-point order. */
export const writeGtSandbox = (dir, labels = readGtLabels()) => {
  const byFile = excerptsByFile(labels);
  for (const [file, excerpts] of byFile) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fileTextOf(file, excerpts));
  }
  return [...byFile.keys()].sort((a, b) => Number(a > b) - Number(a < b));
};

/**
 * A fingerprinted sandbox in a new temp dir (removed after the test t). Returns { dir, files, sync,
 * openDb, readFile }: openDb() opens the sandbox's own index db (never the project's), readFile(rel)
 * reads a sandbox file.
 */
export const createGtSandbox = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-gt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  const files = writeGtSandbox(dir);
  const sync = syncFingerprints(dir, { targetDir: dir, log: () => {} });
  const openDb = () => openIndexDb(dir);
  const readFile = (relativePath) => fs.readFileSync(path.join(dir, relativePath), 'utf-8');
  return { dir, files, sync, openDb, readFile };
};

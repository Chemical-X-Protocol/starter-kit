/**
 * Resolves template component tags (`<x-btn>`, `<XBtn>`) to component files so the
 * index can record template usage as a dependency edge, including globally
 * registered components that have no local import (finding blast-radius-recall-vue).
 * Tags are stored as `#component:<Name>` import specifiers and resolved by file name;
 * when several files share the name, the one nearest the consumer wins (same
 * directory prefix, then the consumer's own extension).
 */
import fs from 'node:fs';
import path from 'node:path';
import { isIgnoredScanDir } from '../scan-ignore.js';

export const COMPONENT_SPECIFIER_PREFIX = '#component:';
const COMPONENT_EXTENSIONS = new Set(['.vue', '.tsx', '.jsx', '.svelte']);
const cache = new Map();

/** kebab-case key used for matching: XBtn, x-btn and xBtn all become "x-btn". */
export const toComponentKey = (name) => String(name)
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
  .replace(/_/g, '-')
  .toLowerCase();

export const toComponentSpecifier = (tag) => `${COMPONENT_SPECIFIER_PREFIX}${tag}`;

export const isComponentSpecifier = (sourceModule) => typeof sourceModule === 'string' && sourceModule.startsWith(COMPONENT_SPECIFIER_PREFIX);

const scanComponents = (dir, cwd, index) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const isScannableDir = entry.isDirectory() && !isIgnoredScanDir(entry.name, path.relative(cwd, full));
    if (isScannableDir) scanComponents(full, cwd, index);
    const ext = path.extname(entry.name);
    const isComponentFile = entry.isFile() && COMPONENT_EXTENSIONS.has(ext);
    if (isComponentFile) {
      const key = toComponentKey(path.basename(entry.name, ext));
      const list = index.get(key) || [];
      list.push(path.relative(cwd, full));
      index.set(key, list);
    }
  }
  return index;
};

const loadComponentIndex = (cwd) => {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const index = scanComponents(cwd, cwd, new Map());
  cache.set(cwd, index);
  return index;
};

const candidatesFor = (sourceModule, cwd) => {
  const tag = sourceModule.slice(COMPONENT_SPECIFIER_PREFIX.length);
  return loadComponentIndex(cwd).get(toComponentKey(tag)) || [];
};

const sharedSegments = (a, b) => {
  const left = path.dirname(a).split(/[\\/]/);
  const right = path.dirname(b).split(/[\\/]/);
  let count = 0;
  while (count < left.length && left[count] === right[count]) count += 1;
  return count;
};

const proximityScore = (candidate, importerPath) => {
  const isSameExtension = path.extname(candidate) === path.extname(importerPath);
  return sharedSegments(candidate, importerPath) * 2 + (isSameExtension ? 1 : 0);
};

const pickNearest = (candidates, importerPath) => {
  const scored = candidates.map((candidate) => ({ candidate, score: proximityScore(candidate, importerPath) }));
  const best = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === best);
  return winners.length === 1 ? winners[0].candidate : '';
};

/** True when some project file carries the tag's name (otherwise it is a third-party tag). */
export const hasLocalComponent = (sourceModule, cwd) => candidatesFor(sourceModule, cwd).length > 0;

/** Relative path of the component a tag refers to, or '' when unknown or ambiguous. */
export const resolveComponentSpecifier = (sourceModule, cwd, importerPath = '') => {
  const candidates = candidatesFor(sourceModule, cwd);
  const isUnique = candidates.length === 1;
  if (isUnique) return candidates[0];
  const canDisambiguate = candidates.length > 1 && Boolean(importerPath);
  return canDisambiguate ? pickNearest(candidates, importerPath) : '';
};

export const clearComponentCache = () => cache.clear();

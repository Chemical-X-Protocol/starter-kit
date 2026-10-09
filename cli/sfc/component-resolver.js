/**
 * Resolves template component tags (`<x-btn>`, `<XBtn>`) to component files so the
 * index can record template usage as a dependency edge, including globally
 * registered components that have no local import (finding blast-radius-recall-vue).
 * Tags are stored as `#component:<Name>` import specifiers and resolved by file name.
 */
import fs from 'node:fs';
import path from 'node:path';

export const COMPONENT_SPECIFIER_PREFIX = '#component:';
const COMPONENT_EXTENSIONS = new Set(['.vue', '.tsx', '.jsx', '.svelte']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'vendor', '.git', '.chemx', '.claude', 'coverage', '.nuxt', '.output', '.next']);
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
    const isScannableDir = entry.isDirectory() && !IGNORED_DIRS.has(entry.name);
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

/** Relative path of the component a tag refers to, or '' when unknown or ambiguous. */
export const resolveComponentSpecifier = (sourceModule, cwd) => {
  const tag = sourceModule.slice(COMPONENT_SPECIFIER_PREFIX.length);
  const candidates = loadComponentIndex(cwd).get(toComponentKey(tag)) || [];
  return candidates.length === 1 ? candidates[0] : '';
};

export const clearComponentCache = () => cache.clear();

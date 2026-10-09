// x-atoms helper hints for audit rules, read from the x-atoms catalog.json (helpers[].fixes).
// Resolution order: the project's own @chemx/x-atoms, then the kit's. No catalog means no hints.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { KIT_ROOT } from './launcher.js';

const FLAVOR_BY_EXTENSION = { '.vue': 'vue', '.svelte': 'svelte', '.tsx': 'react', '.jsx': 'react' };

const catalogFrom = (baseDir) => {
  try {
    const packageJson = createRequire(path.join(baseDir, 'noop.js')).resolve('@chemx/x-atoms/package.json');
    const file = path.join(path.dirname(packageJson), 'catalog.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null;
  } catch {
    return null; // x-atoms not installed or no exports entry: hints are optional
  }
};

export const loadXatomsCatalog = (projectRoot, env = process.env) => {
  const explicit = env.CHEMX_XATOMS_CATALOG;
  const hasExplicit = Boolean(explicit) && fs.existsSync(explicit);
  if (hasExplicit) return JSON.parse(fs.readFileSync(explicit, 'utf-8'));
  return catalogFrom(projectRoot) ?? catalogFrom(KIT_ROOT);
};

export const helperHintsFor = (catalog, rule, filePath) => {
  const helpers = Array.isArray(catalog?.helpers) ? catalog.helpers : [];
  const flavor = FLAVOR_BY_EXTENSION[path.extname(filePath)] ?? 'core';
  return helpers
    .filter((helper) => Array.isArray(helper.fixes) && helper.fixes.includes(rule))
    .map((helper) => {
      const entry = helper.imports?.[flavor] ?? helper.imports?.core;
      const from = entry ? ` from ${entry.from}` : '';
      return `${helper.name}${from}: ${helper.summary ?? ''}`.trim();
    });
};

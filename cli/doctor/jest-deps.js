// Which bare module names a project's jest config asks jest to resolve from its rootDir, and where each
// one is installed. Read-only and static: JSON configs are parsed, JS/TS configs and presets are
// scanned as text (never required), so doctor does not execute project code.

import fs from 'node:fs';
import path from 'node:path';
import { readJsonOr } from '../fs-json.js';

const TEXT_CONFIGS = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts'];
const SERIALIZER_LIST = /snapshotSerializers\s*:\s*\[([^\]]*)\]/;
const PRESET_VALUE = /\bpreset\s*:\s*['"]([^'"]+)['"]/;
const QUOTED = /['"]([^'"]+)['"]/g;
const RELATIVE_REQUIRE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const NOT_BARE = /^(?:\.|\/|<rootDir>|[A-Za-z]:[\\/])/;
const PRESET_FILES = ['jest-preset.js', 'jest-preset.cjs', 'jest-preset.json', 'index.js'];
const PRESET_CHAIN_DEPTH = 4;

const quotedList = (text) => [...(text ?? '').matchAll(QUOTED)].map((match) => match[1]);

const configFromText = (text) => ({
  preset: text.match(PRESET_VALUE)?.[1],
  snapshotSerializers: quotedList(text.match(SERIALIZER_LIST)?.[1]),
});

export const readJestConfig = (projectRoot) => {
  const json = readJsonOr(path.join(projectRoot, 'jest.config.json'), null);
  if (json) return json;
  const inPackage = readJsonOr(path.join(projectRoot, 'package.json'), {}).jest;
  if (inPackage) return inPackage;
  const textFile = TEXT_CONFIGS.map((name) => path.join(projectRoot, name)).find((file) => fs.existsSync(file));
  return textFile ? configFromText(fs.readFileSync(textFile, 'utf-8')) : null;
};

export const packageNameOf = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

const transformSpecifiers = (config) => Object.values(config.transform ?? {})
  .map((value) => (Array.isArray(value) ? value[0] : value))
  .filter((value) => typeof value === 'string');

// node's lookup: <dir>/node_modules/<name> for the project dir and every parent
export const findHoisted = (projectRoot, name) => {
  let dir = projectRoot;
  let parent = path.dirname(dir);
  while (!fs.existsSync(path.join(dir, 'node_modules', name))) {
    const isFilesystemRoot = parent === dir;
    if (isFilesystemRoot) return null;
    dir = parent;
    parent = path.dirname(dir);
  }
  return path.join(dir, 'node_modules', name);
};

const presetFileCandidates = (base) => [base, `${base}.js`, ...PRESET_FILES.map((name) => path.join(base, name))];

const firstExistingFile = (candidates) => candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;

// A preset file names its serializers as text and extends a parent preset with a relative require:
// follow the chain a few levels and collect every serializer jest will then resolve from the rootDir.
const presetSerializers = (file, depth = 0) => {
  const isUnreadable = !file || depth >= PRESET_CHAIN_DEPTH;
  if (isUnreadable) return [];
  const text = fs.readFileSync(file, 'utf-8');
  const own = quotedList(text.match(SERIALIZER_LIST)?.[1]);
  const parents = [...text.matchAll(RELATIVE_REQUIRE)].map((match) => firstExistingFile(presetFileCandidates(path.resolve(path.dirname(file), match[1]))));
  return [...own, ...parents.flatMap((parent) => presetSerializers(parent, depth + 1))];
};

const presetFileOf = (projectRoot, preset) => {
  const isPath = NOT_BARE.test(preset);
  if (isPath) return firstExistingFile(presetFileCandidates(path.resolve(projectRoot, preset.replace('<rootDir>', '.'))));
  const installed = findHoisted(projectRoot, preset) ?? findHoisted(projectRoot, `${preset}.js`);
  return installed ? firstExistingFile(presetFileCandidates(installed)) : null;
};

export const collectJestDeps = (projectRoot) => {
  const config = readJestConfig(projectRoot);
  if (!config) return [];
  const preset = typeof config.preset === 'string' ? config.preset : null;
  const found = [
    ...(preset ? [{ specifier: preset, from: 'preset' }] : []),
    ...(config.snapshotSerializers ?? []).map((specifier) => ({ specifier, from: 'snapshotSerializers' })),
    ...transformSpecifiers(config).map((specifier) => ({ specifier, from: 'transform' })),
    ...(preset ? presetSerializers(presetFileOf(projectRoot, preset)).map((specifier) => ({ specifier, from: 'snapshotSerializers of the preset' })) : []),
  ];
  const byName = new Map();
  for (const { specifier, from } of found.filter((entry) => typeof entry.specifier === 'string' && !NOT_BARE.test(entry.specifier))) {
    const name = packageNameOf(specifier);
    if (!byName.has(name)) byName.set(name, { name, from });
  }
  return [...byName.values()];
};

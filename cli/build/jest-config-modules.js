// Which module names does this project's jest config make jest resolve from the project root, and
// which of them resolve only inside pnpm's virtual store (node_modules/.pnpm/node_modules)? Jest
// resolves snapshotSerializers, transform and setup files by name from rootDir; a strict pnpm layout
// does not link transitive packages there, so the run dies with "Module X was not found" unless that
// store is on NODE_PATH (task #6754). Run as a child (`node jest-config-modules.js <root>`) so the
// project's own config executes outside the chemx process; it prints { names, error? } as JSON.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CONFIG_FILES = ['jest.config.json', 'jest.config.js', 'jest.config.cjs'];
const PRESET_FILES = ['jest-preset.json', 'jest-preset.js', 'jest-preset.cjs'];
const MAX_PRESET_DEPTH = 3;
const PATH_LIKE = /^[./<]/;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const tryResolve = (requireFrom, spec) => {
  try {
    return requireFrom.resolve(spec);
  } catch { // chemx-allow: best-effort an unresolvable name is the answer this probe looks for
    return null;
  }
};

// A config file's object: JSON is parsed, JS is required (a function or non-object export is skipped).
const loadConfigFile = (file, requireFrom) => {
  const exported = file.endsWith('.json') ? readJson(file) : requireFrom(file);
  const config = exported?.default ?? exported;
  return config !== null && typeof config === 'object' ? config : null;
};

const readProjectConfig = (root, requireFrom) => {
  const file = CONFIG_FILES.map((name) => path.join(root, name)).find((candidate) => fs.existsSync(candidate));
  if (file) return loadConfigFile(file, requireFrom);
  const pkgFile = path.join(root, 'package.json');
  return fs.existsSync(pkgFile) ? readJson(pkgFile).jest ?? null : null;
};

// jest's preset lookup: <preset>/jest-preset.{json,js,cjs}, else the preset as a file; paths are read from rootDir.
const readPreset = (name, root, requireFrom) => {
  const base = PATH_LIKE.test(name) ? path.resolve(root, name.replace('<rootDir>', root)) : name;
  const found = [...PRESET_FILES.map((file) => `${base}/${file}`), base].map((spec) => tryResolve(requireFrom, spec)).find(Boolean);
  return found ? loadConfigFile(found, requireFrom) : null;
};

const isBareName = (name) => typeof name === 'string' && name.length > 0 && !PATH_LIKE.test(name) && !path.isAbsolute(name);

const namesOf = (config) => {
  const transforms = Object.values(config.transform ?? {}).map((entry) => (Array.isArray(entry) ? entry[0] : entry));
  const listed = [config.snapshotSerializers, config.setupFiles, config.setupFilesAfterEnv].flatMap((list) => list ?? []);
  return [...listed, ...transforms].filter(isBareName);
};

export const collectStoreOnlyModules = (root) => {
  const requireFrom = createRequire(path.join(root, 'package.json'));
  const store = path.join(root, 'node_modules', '.pnpm', 'node_modules');
  const names = new Set();
  let config = readProjectConfig(root, requireFrom);
  for (let depth = 0; config && depth <= MAX_PRESET_DEPTH; depth += 1) {
    namesOf(config).forEach((name) => names.add(name));
    config = typeof config.preset === 'string' ? readPreset(config.preset, root, requireFrom) : null;
  }
  const isStoreOnly = (name) => tryResolve(requireFrom, name) === null && fs.existsSync(path.join(store, name));
  return [...names].filter(isStoreOnly).sort();
};

const isEntryPoint = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  try {
    process.stdout.write(`\n${JSON.stringify({ names: collectStoreOnlyModules(path.resolve(process.argv[2])) })}\n`);
  } catch (error) {
    process.stdout.write(`\n${JSON.stringify({ names: [], error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}

// NODE_PATH for pnpm layouts (task #6754). When the project's jest config names a snapshot serializer,
// transform or setup file that resolves only inside node_modules/.pnpm/node_modules, a run that does
// not go through a pnpm shim (npx jest, node jest.js) dies with "Module X was not found". chemx puts
// that store on NODE_PATH for test runs. The names come from jest-config-modules.js, run as a child.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalPackageJson } from './detector.js';

const PROBE_FILE = fileURLToPath(new URL('./jest-config-modules.js', import.meta.url));
const PROBE_TIMEOUT_MS = 8000;
const JEST_CONFIG_FILES = ['jest.config.json', 'jest.config.js', 'jest.config.cjs'];
const NO_MODULES = Object.freeze({ names: [], error: null });

export const pnpmStoreDir = (root) => path.join(root, 'node_modules', '.pnpm', 'node_modules');

const hasJestConfig = (root) => {
  const hasFile = JEST_CONFIG_FILES.some((name) => fs.existsSync(path.join(root, name)));
  return hasFile || Boolean(loadLocalPackageJson(root)?.jest);
};

const readProbeAnswer = (stdout) => {
  const line = String(stdout).trim().split('\n').at(-1) ?? '';
  try {
    const answer = JSON.parse(line);
    return { names: Array.isArray(answer.names) ? answer.names : [], error: answer.error ?? null };
  } catch { // chemx-allow: best-effort an unreadable answer is reported as the probe's error
    return { names: [], error: `unreadable answer from ${path.basename(PROBE_FILE)}: ${line.slice(0, 120)}` };
  }
};

// { names, error }: the module names the jest config makes jest resolve from `root` that only the pnpm
// store holds. error is set when the config could not be read; names is then empty.
export const storeOnlyModules = (root) => {
  const isCandidate = fs.existsSync(pnpmStoreDir(root)) && hasJestConfig(root);
  if (!isCandidate) return NO_MODULES;
  const probe = spawnSync(process.execPath, [PROBE_FILE, root], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  const didNotFinish = probe.error !== undefined || probe.status !== 0;
  if (didNotFinish) return { names: [], error: probe.error?.message ?? `jest config probe exited ${probe.status}` };
  return readProbeAnswer(probe.stdout);
};

// { NODE_PATH, names, store } to add for a run in `root`, or null when nothing needs it (no store-only
// names, or the store is already on NODE_PATH).
export const storeNodePath = (root, env = process.env) => {
  const store = pnpmStoreDir(root);
  const current = String(env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean);
  const isOnPath = current.includes(store);
  if (isOnPath) return null;
  const { names } = storeOnlyModules(root);
  const hasNames = names.length > 0;
  if (!hasNames) return null;
  return { NODE_PATH: [store, ...current].join(path.delimiter), names, store };
};

export const withPnpmStorePath = (env, root) => {
  const found = storeNodePath(root, env);
  return found ? { ...env, NODE_PATH: found.NODE_PATH } : env;
};

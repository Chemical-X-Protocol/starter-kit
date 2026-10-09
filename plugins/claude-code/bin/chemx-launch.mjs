#!/usr/bin/env node
// Plugin launcher: find the chemx kit for this project and run it in-process.
//   chemx-launch.mjs hook <name>   Claude Code hook (fails open: no kit means allow, no output)
//   chemx-launch.mjs mcp           MCP server with CHEMX_PROJECT_ROOT and NO_COLOR set
// Kit lookup: CHEMX_KIT, the project's node_modules, chemx on PATH, then the checkout that holds
// this plugin. Self-contained on purpose: a marketplace install copies only the plugin directory.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = [['node_modules', '@chemx', 'starter-kit'], ['node_modules', 'chemx'], ['node_modules', 'create-chemx']];

const hasCli = (dir) => Boolean(dir) && fs.existsSync(path.join(dir, 'cli', 'index.js'));

const kitFromBin = (envPath) => {
  for (const dir of String(envPath ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'chemx');
    const isPresent = fs.existsSync(candidate);
    if (!isPresent) continue;
    const kit = path.resolve(path.dirname(fs.realpathSync(candidate)), '..');
    if (hasCli(kit)) return kit;
  }
  return null;
};

export const resolveKit = (env = process.env, cwd = process.cwd()) => {
  const projectRoot = env.CLAUDE_PROJECT_DIR || cwd;
  const candidates = [env.CHEMX_KIT, ...PACKAGES.map((parts) => path.join(projectRoot, ...parts))];
  const found = candidates.find(hasCli);
  if (found) return found;
  const onPath = kitFromBin(env.PATH);
  if (onPath) return onPath;
  const enclosingCheckout = path.resolve(PLUGIN_ROOT, '..', '..');
  return hasCli(enclosingCheckout) ? enclosingCheckout : null;
};

const runInProcess = async (script, args) => {
  process.argv = [process.argv[0], script, ...args];
  await import(pathToFileURL(script).href);
};

// Hooks fail open (allow, no output); the MCP server cannot start without a kit, so it says why.
const reportMissingKit = (isHook) => {
  if (!isHook) process.stderr.write('chemx plugin: no chemx kit found (set CHEMX_KIT, add chemx to the project, or put chemx on PATH)\n');
  process.exitCode = isHook ? 0 : 1;
  return process.exitCode;
};

const main = async () => {
  const [mode, ...rest] = process.argv.slice(2);
  const kit = resolveKit();
  const isHook = mode === 'hook';
  const isMissingKit = kit === null;
  if (isMissingKit) return reportMissingKit(isHook);
  if (isHook) return runInProcess(path.join(kit, 'cli', 'hooks', 'entry.js'), rest);
  process.env.CHEMX_PROJECT_ROOT ||= process.env.CLAUDE_PROJECT_DIR || process.cwd();
  process.env.NO_COLOR ||= '1';
  return runInProcess(path.join(kit, 'cli', 'index.js'), [mode, ...rest]);
};

const isDirectRun = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) await main();

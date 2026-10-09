#!/usr/bin/env node
/**
 * npm postinstall: prints a one-line hint and writes nothing.
 * MCP and hook config changes happen only through explicit `chemx install-mcp`
 * or `chemx install`, never as a side effect of installing the package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const starterKitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const buildPostinstallHint = (env = process.env) => {
  const targetDir = env.INIT_CWD ? path.resolve(env.INIT_CWD) : process.cwd();
  const isSelf = targetDir === starterKitDir;
  const isCi = Boolean(env.CI) && env.CI !== 'false';
  const isOptedOut = env.CHEMX_SKIP_POSTINSTALL === '1';
  const isQuiet = isSelf || isCi || isOptedOut;
  if (isQuiet) return null;
  return 'chemx installed. Register the MCP server with `npx chemx install-mcp` (add --global for ~/.gemini).';
};

const resolveArgvScript = () => {
  try { return fs.realpathSync(process.argv[1] || ''); } catch { return ''; }
};
const isDirectRun = resolveArgvScript() === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const hint = buildPostinstallHint();
  if (hint) process.stderr.write(`${hint}\n`);
}

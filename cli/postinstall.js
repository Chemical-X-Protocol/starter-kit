#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAllMcpConfigs } from './mcp/installer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const starterKitDir = path.resolve(__dirname, '..');

const runPostinstall = () => {
  const targetDir = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();

  // If installing inside the starter-kit itself for dev, skip consumer installation
  const isSelf = targetDir === starterKitDir;
  if (isSelf) return;

  try {
    installAllMcpConfigs(targetDir, { silent: false });
  } catch (err) {
    // Non-blocking: never fail npm install
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\x1b[33m[Chemical X] MCP auto-installer skipped: ${msg}\x1b[0m\n`);
  }
};

runPostinstall();

#!/usr/bin/env node

import fs from 'node:fs';
import { runScaffold } from './scaffold.js';
import { runAudit } from './index.js';
import { sanitizeOutputStreams } from './terminal.js';
import { installGlobalErrorCatcher } from './errors/index.js';

sanitizeOutputStreams();
installGlobalErrorCatcher();

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  process.stdout.write(`
Chemical X Protocol: Project Scaffolder

USAGE
  npm create chemx [directory] [options]
  npx create-chemx [directory] [options]

OPTIONS
  --yes, -y       Skip interactive prompts and scaffold Community Edition immediately
  --headless      Run in headless mode for CI/CD and AI agent automation
  -h, --help      Show this help message
  -v, --version   Show version number

EXAMPLES
  npm create chemx my-molecular-app
  npx create-chemx my-molecular-app --yes
  pnpm create chemx my-app

DOCUMENTATION
  https://chemicalx.xophz.com
\n`);
  process.exit(0);
}

if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    process.stdout.write(`create-chemx v${pkg.version || 'unknown'}\n`);
  } catch {
    process.stdout.write('create-chemx\n');
  }
  process.exit(0);
}

const KNOWN_FLAGS = new Set([
  '--yes', '-y',
  '--headless',
  '-h', '--help',
  '-v', '--version',
  '--ci',
  '--non-interactive',
  '--no-interactive'
]);

for (const arg of rawArgs) {
  if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) {
    process.stderr.write(`Unknown option "${arg}". Run --help for usage.\n`);
    process.exit(1);
  }
}

const nonFlagArgs = rawArgs.filter((arg) => !arg.startsWith('-'));
const dirArg = (nonFlagArgs[0] === 'create' || nonFlagArgs[0] === 'init' || nonFlagArgs[0] === 'scaffold')
  ? nonFlagArgs[1]
  : nonFlagArgs[0];

await runScaffold(dirArg, rawArgs, runAudit);

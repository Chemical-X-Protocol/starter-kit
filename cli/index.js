#!/usr/bin/env node

import './silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeOutputStreams } from './terminal.js';
import {
  handleError,
  installGlobalErrorCatcher,
  withErrorCatcher,
  publishIssue
} from './errors/index.js';
import { printHelp } from './help.js';

sanitizeOutputStreams();
installGlobalErrorCatcher();

// ---------------------------------------------------------------------------
// Shared lightweight utilities (no heavy module load at boot)
// ---------------------------------------------------------------------------

const getPackageVersion = () => {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    return JSON.parse(pkgContent).version || 'unknown';
  } catch {
    return 'unknown';
  }
};

const rawArgs = process.argv.slice(2);
const CAPSULE_PREFIXES = ['m-', 'a-', 'o-', 't-', 'use-', 'v-'];
const isCapsulePrefix = (arg) => CAPSULE_PREFIXES.some((p) => arg.startsWith(p));

const loadProjectConfig = () => {
  const cfgPath = path.resolve(process.cwd(), '.chemx', 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Public API — lazy proxy exports (zero startup cost for consumers)
// ---------------------------------------------------------------------------

export const runAudit = async (customDir = null, isCli = false) => {
  const { runAudit: run } = await import('./commands/cmd-audit.js');
  return run(customDir, isCli, rawArgs, loadProjectConfig);
};

export const auditFile       = async (...a) => (await import('./audit.js')).auditFile(...a);
export const runBuildAudit   = async (...a) => (await import('./build.js')).runBuildAudit(...a);
export const runSearch       = async (...a) => (await import('./search.js')).runSearch(...a);
export const syncSearchIndex = async (...a) => (await import('./search.js')).syncSearchIndex(...a);
export const runMcpServer    = async (...a) => (await import('./mcp/index.js')).runMcpServer(...a);
export const startMcpServer  = runMcpServer;
export const runMcpInstaller = async (...a) => (await import('./mcp/index.js')).runMcpInstaller(...a);
export const runReaderCli    = async (...a) => (await import('./reader.js')).runReaderCli(...a);
export const readTokenOptimized = async (...a) => (await import('./reader.js')).readTokenOptimized(...a);
export const runPatcherCli   = async (...a) => (await import('./patcher.js')).runPatcherCli(...a);
export const patchFile       = async (...a) => (await import('./patcher.js')).patchFile(...a);
export const runWriterCli    = async (...a) => (await import('./patcher.js')).runWriterCli(...a);
export const writeFile       = async (...a) => (await import('./patcher.js')).writeFile(...a);
export const runTeamCli      = async (...a) => (await import('./team/index.js')).runTeamCli(...a);
export const runTrend        = async (...a) => (await import('./trend.js')).runTrend(...a);
export const runPillarsWizard = async (...a) => (await import('./pillars-wizard.js')).runPillarsWizard(...a);
export { handleError, withErrorCatcher, publishIssue };

// ---------------------------------------------------------------------------
// Allowed commands guard (exits early before any heavy import)
// ---------------------------------------------------------------------------

export const ALLOWED_COMMANDS = new Set([
  'search', 'q', 'query', 'find',
  'read', 'view',
  'patch', 'edit',
  'write',
  'generate', 'g', 'gen', 'capsule', 'add',
  'explode', 'unpack',
  'audit',
  'trend', 'trends',
  'verify', 'check:all',
  'team', 'swarm', 'feed',
  'pillars', 'rules', 'config:pillars',
  'mcp', 'mcp-server', 'server', 'install-mcp', 'setup-mcp',
  'build', 'run', 'wrap',
  'typecheck', 'check:types', 'tsc',
  'test', 'tests', 'check:test',
  'check',
  'badge', 'badges',
  'ui', 'preview', 'dashboard',
  'create', 'scaffold',
  'init',
  'hook', 'hooks', 'install-hooks', 'setup-ci',
  'add:prop', 'add:state', 'add:action', 'fix',
  'help', '--help', '-h',
  'version', '--version', '-v'
]);

// ---------------------------------------------------------------------------
// main: thin orchestrator; real dispatch lives in cmd-router.js
// ---------------------------------------------------------------------------

const main = async () => {
  const firstArg = rawArgs[0];

  if (!firstArg || firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
    printHelp();
    return;
  }

  if (firstArg === 'version' || firstArg === '--version' || firstArg === '-v') {
    process.stdout.write(`create-chemx v${getPackageVersion()}\n`);
    return;
  }

  if (!ALLOWED_COMMANDS.has(firstArg) && !isCapsulePrefix(firstArg)) {
    process.stderr.write(`Unknown command "${firstArg}". Run --help for usage.\n`);
    process.exit(1);
  }

  const { dispatchCommand } = await import('./commands/cmd-router.js');
  await dispatchCommand(firstArg, rawArgs, runAudit, getPackageVersion, isCapsulePrefix);
};

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const invokedFile = fs.realpathSync(process.argv[1]);
    return currentFile === invokedFile;
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  main().catch(async (err) => {
    await handleError(err, {
      command: process.argv.slice(2).join(' '),
      cwd: process.cwd(),
      exitCode: 1
    });
    process.exit(1);
  });
}

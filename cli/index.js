#!/usr/bin/env node
/**
 * Boot shim for the chemx CLI and package entry. Its static imports are node: built-ins and the
 * dependency-free conflicts-cli.js only: one unparseable module anywhere in a static graph stops
 * every command, which is what happened whenever chemx's own sources were mid-merge. So:
 *   - `chemx conflicts` and `chemx d --conflicts` run here, before the CLI proper loads;
 *   - main.js (the CLI proper and the public API) loads dynamically, and a load failure caused
 *     by chemx's own conflict markers is reported as path:line instead of a stack trace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wantsEarlyConflictCommand, runConflictsCli, runConflictDiff, explainLoadFailure } from './conflicts-cli.js';

const CLI_FILE = fileURLToPath(import.meta.url);

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    return CLI_FILE === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
};

const IS_DIRECT = isDirectExecution();
const ARGS = process.argv.slice(2);
const EARLY = IS_DIRECT ? wantsEarlyConflictCommand(ARGS) : null;

const loadMain = async () => {
  try {
    return await import('./main.js');
  } catch (err) {
    const message = IS_DIRECT ? explainLoadFailure(path.dirname(CLI_FILE)) : null;
    if (!message) throw err;
    process.stderr.write(`✕ ${message}\n`);
    process.exit(1);
  }
};

if (EARLY) {
  const run = EARLY === 'conflicts' ? runConflictsCli : runConflictDiff;
  process.exitCode = run(ARGS, process.cwd());
}

const main = EARLY ? {} : await loadMain();

export const {
  runAudit, auditFile, runBuildAudit, runSearch, syncSearchIndex, runMcpServer, startMcpServer,
  runMcpInstaller, runReaderCli, readTokenOptimized, runPatcherCli, patchFile, runWriterCli,
  writeFile, runTeamCli, runTrend, runLintAudit, runPillarsWizard, runTesseract,
  handleError, withErrorCatcher, publishIssue, ALLOWED_COMMANDS
} = main;

if (IS_DIRECT && !EARLY) main.runMain();

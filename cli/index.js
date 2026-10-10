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
  const hasEntryPath = Boolean(process.argv[1]);
  if (!hasEntryPath) return false;
  try {
    return CLI_FILE === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
};

const IS_DIRECT = isDirectExecution();
const ARGS = process.argv.slice(2);
const EARLY = IS_DIRECT ? wantsEarlyConflictCommand(ARGS) : null;

// When the CLI proper cannot load, patch/edit/write still run from patcher-cli.js (it never imports
// the command-schema modules), so chemx can repair the file that broke it. Nothing else is rescued.
const runRepairPath = async (loadError) => {
  try {
    const { REPAIR_COMMANDS, runRepairCommand } = await import('./patcher-cli.js');
    const isRepairable = REPAIR_COMMANDS.includes(ARGS[0]);
    // Hooks are repairable too, but stay quiet: the host reads a hook's stderr as its verdict.
    // The runner exits the process when it finishes, so the note goes out first.
    if (isRepairable) process.stderr.write(`! chemx could not load fully (${String(loadError.message).split('\n')[0]}); running '${ARGS[0]}' from the minimal repair path.\n`);
    return runRepairCommand(ARGS[0], ARGS.slice(1));
  } catch {
    return false;
  }
};

const loadMain = async () => {
  try {
    return await import('./main.js');
  } catch (err) {
    const isRepaired = IS_DIRECT && await runRepairPath(err);
    if (isRepaired) return {};
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

const shouldRunMain = IS_DIRECT && !EARLY && typeof main.runMain === 'function';
if (shouldRunMain) main.runMain();

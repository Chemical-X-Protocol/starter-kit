/**
 * cmd-router.js: CLI command dispatch table.
 * Single responsibility: map first-arg tokens to their lazy-loaded command handlers.
 * Extracted from cli/index.js per Directive 1.A (Monolith Decomposition).
 */

import { printHelp, printCommandHelp, resolveCommandHelpTopic } from '../help.js';

// Wrappers return { code }; a non-zero code must reach the process exit status.
const setExitCodeFrom = (result) => {
  const isFailureCode = typeof result?.code === 'number' && result.code !== 0;
  if (isFailureCode) process.exitCode = result.code;
};

/** `install-mcp`, `setup-mcp` and `mcp --install` share one path, so they share one exit code. */
const runInstallMcpCommand = async (args) => {
  const { runMcpInstaller } = await import('../mcp/index.js');
  const { toExitCode } = await import('../result-status.js');
  const installResult = await runMcpInstaller(args);
  process.exitCode = toExitCode(installResult.status);
};

/**
 * Dispatch the resolved CLI command to its handler module.
 * @param {string} firstArg
 * @param {string[]} rawArgs
 * @param {(dir: string|null, isCli: boolean) => Promise<object>} runAudit
 * @param {() => string} getPackageVersion
 * @param {(arg: string) => boolean} isCapsulePrefix
 */
export const dispatchCommand = async (firstArg, rawArgs, runAudit, getPackageVersion, isCapsulePrefix) => {
  // `<command> --help` never reaches the handler: some handlers act on unknown flags.
  const helpTopic = resolveCommandHelpTopic(firstArg, rawArgs);
  if (helpTopic) {
    const isCapsuleTopic = isCapsulePrefix(helpTopic);
    return printCommandHelp(isCapsuleTopic ? 'generate' : helpTopic);
  }
  switch (firstArg) {
    case 'team':
    case 'swarm':
    case 'feed': {
      const { runTeamCli } = await import('../team/index.js');
      runTeamCli(rawArgs.slice(1), true);
      break;
    }
    case 'project':
    case 'coordinator': {
      const { runProjectCli } = await import('./cmd-project.js');
      await runProjectCli(rawArgs.slice(1), true);
      break;
    }
    case 'tokens':
    case 'telemetry': {
      const { runTeamCli } = await import('../team/index.js');
      runTeamCli(['tokens', ...rawArgs.slice(1)], true);
      break;
    }
    case 'benchmark':
    case 'ablation':
    case 'memory': {
      const { runTeamCli } = await import('../team/index.js');
      runTeamCli(['benchmark', ...rawArgs.slice(1)], true);
      break;
    }
    case 'mcp':
    case 'mcp-server':
    case 'server': {
      const isInstallRun = rawArgs.includes('--install');
      if (isInstallRun) { await runInstallMcpCommand(rawArgs.slice(1)); break; }
      const { runMcpServer } = await import('../mcp/index.js');
      await runMcpServer(rawArgs.slice(1));
      break;
    }
    case 'read':
    case 'view':
    case 'r': {
      const readerCards = await import('../reader-cards-gate.js');
      const wantsCards = readerCards.argsWantReadCards(rawArgs.slice(1));
      if (wantsCards) await readerCards.loadReadCards();
      const { runReaderCli } = await import('../reader.js');
      runReaderCli(rawArgs.slice(1), true);
      break;
    }
    case 'commit': {
      const { runCommitCli } = await import('../commit/commit-cli.js');
      await runCommitCli(rawArgs.slice(1));
      break;
    }
    case 'conflicts': {
      // Normally answered by the boot shim in cli/index.js before this router loads.
      const { runConflictsCli } = await import('../conflicts-cli.js');
      process.exitCode = runConflictsCli(rawArgs, process.cwd());
      break;
    }
    case 'patch':
    case 'edit': {
      const { runPatcherCli } = await import('../patcher.js');
      runPatcherCli(rawArgs.slice(1), true);
      break;
    }
    case 'write': {
      const { runWriterCli } = await import('../patcher.js');
      runWriterCli(rawArgs.slice(1), true);
      break;
    }
    case 'search':
    case 'q':
    case 'query':
    case 'find': {
      const { runSearch } = await import('../search.js');
      await runSearch(rawArgs.slice(1), true);
      break;
    }
    case 'd':
    case 'diff': {
      const { runDiff } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runDiff(rawArgs, true));
      break;
    }
    case 'log': {
      const { runLog } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runLog(rawArgs, true));
      break;
    }
    case 'show': {
      const { runShow } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runShow(rawArgs, true));
      break;
    }
    case 'p':
    case 'pkg': {
      const { runPkg } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runPkg(rawArgs, true));
      break;
    }
    case 'f':
    case 'ls': {
      const { runFiles } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runFiles(rawArgs, true));
      break;
    }
    case 'j':
    case 'json': {
      const { runJsonShape } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runJsonShape(rawArgs, true));
      break;
    }
    case 'do':
    case 'batch': {
      const { runBatch } = await import('./cmd-wrappers.js');
      setExitCodeFrom(await runBatch(rawArgs, true, (cmd, args) => dispatchCommand(cmd, args, runAudit, getPackageVersion, isCapsulePrefix)));
      break;
    }
    case 'trace': {
      const { runTraceCli } = await import('../search-commands-graph.js');
      await runTraceCli(rawArgs.slice(1), true);
      break;
    }
    case 'backtrace': {
      const { runBacktraceCli } = await import('../search-commands-graph.js');
      await runBacktraceCli(rawArgs.slice(1), true);
      break;
    }
    case 'build':
    case 'run':
    case 'wrap': {
      const { runBuildAudit } = await import('../build.js');
      await runBuildAudit(rawArgs.slice(1), true);
      break;
    }
    case 'audit': {
      const isStagedDelta = rawArgs.includes('--staged-delta');
      if (isStagedDelta) {
        const { runStagedDeltaCommand } = await import('./cmd-staged-delta.js');
        runStagedDeltaCommand(rawArgs.slice(1));
        break;
      }
      const isFeed = rawArgs.some((arg) => arg === '--feed' || arg.startsWith('--feed='));
      if (isFeed) {
        const { runAuditFeedCommand } = await import('./cmd-audit-feed.js');
        setExitCodeFrom(runAuditFeedCommand(rawArgs.slice(1)));
        break;
      }
      const isEach = rawArgs.some((arg) => arg === '--each' || arg.startsWith('--each='));
      if (isEach) {
        const { runAuditEachCommand } = await import('./cmd-audit-each.js');
        setExitCodeFrom(await runAuditEachCommand(rawArgs.slice(1)));
        break;
      }
      const posDir = (rawArgs[1] && !rawArgs[1].startsWith('-')) ? rawArgs[1] : null;
      const { refuseMonorepoRootAudit } = await import('../workspace-run.js');
      const isMonorepoRootRefused = Boolean(refuseMonorepoRootAudit(posDir, rawArgs));
      if (isMonorepoRootRefused) break;
      await runAudit(posDir, true);
      break;
    }
    case 'trend':
    case 'trends': {
      const { runTrend } = await import('../trend.js');
      runTrend(rawArgs.slice(1), process.cwd());
      break;
    }
    case 'init': {
      const nonFlagArgs = rawArgs.slice(1).filter((arg) => !arg.startsWith('-'));
      const targetSubDir = nonFlagArgs[0] || 'src/chemical-x';
      const { runInit, scaffoldExitCode } = await import('../scaffold.js');
      process.exitCode = scaffoldExitCode(await runInit(targetSubDir, rawArgs, runAudit));
      break;
    }
    case 'create':
    case 'scaffold': {
      const { runScaffold, scaffoldExitCode } = await import('../scaffold.js');
      const nonFlagArgs = rawArgs.slice(1).filter((arg) => !arg.startsWith('-'));
      process.exitCode = scaffoldExitCode(await runScaffold(nonFlagArgs[0], rawArgs, runAudit));
      break;
    }
    case 'hook':
    case 'hooks':
    case 'install-hooks':
    case 'setup-ci': {
      const { routeHookCommand } = await import('../hooks/hook-commands.js');
      const isHandled = await routeHookCommand(firstArg, rawArgs.slice(1));
      if (isHandled) break;
      const { runInstallWizard } = await import('../installer.js');
      await runInstallWizard(rawArgs[1] || process.cwd());
      break;
    }
    case 'doctor': {
      const { runDoctorCli } = await import('../doctor/doctor-cli.js');
      process.exitCode = await runDoctorCli(rawArgs.slice(1));
      break;
    }
    case 'friction': {
      const { runFrictionCli } = await import('../friction/friction-cli.js');
      process.exitCode = await runFrictionCli(rawArgs.slice(1));
      break;
    }
    case 'pillars':
    case 'rules':
    case 'config:pillars': {
      const { runPillarsWizard } = await import('../pillars-wizard.js');
      const pillarsResult = await runPillarsWizard(rawArgs.slice(1), process.cwd());
      const isPillarsRefused = pillarsResult?.success === false;
      if (isPillarsRefused) process.exitCode = 1;
      break;
    }
    case 'check': {
      const { runCheckCommand } = await import('./cmd-check.js');
      runCheckCommand(rawArgs.slice(1));
      break;
    }
    case 'add:prop':
    case 'add:state':
    case 'add:action':
    case 'fix': {
      const { runMutatorCli } = await import('../mutators.js');
      await runMutatorCli(rawArgs, true);
      break;
    }
    case 'explode':
    case 'unpack': {
      const { runExplodeCli } = await import('../exploder.js');
      await runExplodeCli(rawArgs.slice(1), true);
      break;
    }
    case 'add': {
      const isMutatorSubcommand = ['prop', 'state', 'action'].includes(rawArgs[1]);
      if (isMutatorSubcommand) {
        const { runMutatorCli } = await import('../mutators.js');
        await runMutatorCli(rawArgs, true);
      } else {
        const { runGenerateWizard } = await import('../scaffold.js');
        await runGenerateWizard(rawArgs.slice(1));
      }
      break;
    }
    case 'g':
    case 'gen':
    case 'generate':
    case 'capsule':
    case 'jig': {
      const { runGenerateWizard } = await import('../scaffold.js');
      await runGenerateWizard(rawArgs);
      break;
    }
    case 'badge':
    case 'badges': {
      const { runBadgeCommand } = await import('../badge.js');
      await runBadgeCommand(rawArgs.slice(1));
      break;
    }
    case 'install-mcp':
    case 'setup-mcp': {
      await runInstallMcpCommand(rawArgs.slice(1));
      break;
    }
    case '-v':
    case '--version':
    case 'version':
      process.stdout.write(`chemx v${getPackageVersion()}\n`);
      break;
    case 'verify':
    case 'check:all': {
      const { runProjectVerify } = await import('../verify.js');
      await runProjectVerify(rawArgs.slice(1), true);
      break;
    }
    case 'typecheck':
    case 'check:types':
    case 'tsc': {
      const { runTypecheckAudit } = await import('../verify.js');
      await runTypecheckAudit(rawArgs.slice(1), true);
      break;
    }
    case 'lint':
    case 'check:lint':
    case 'eslint': {
      const { runLintAudit } = await import('../verify-lint.js');
      await runLintAudit(rawArgs.slice(1), true);
      break;
    }
    case 'test':
    case 'tests':
    case 'check:test': {
      const { runTestAudit } = await import('../verify.js');
      await runTestAudit(rawArgs.slice(1), true);
      break;
    }
    case 'ui':
    case 'preview':
    case 'dashboard': {
      const { startUiServer } = await import('../ui-server.js');
      const portArg = rawArgs.find((a) => a.startsWith('--port='));
      const port = portArg ? parseInt(portArg.split('=')[1], 10) : 4173;
      const hostArg = rawArgs.find((a) => a.startsWith('--host='));
      const host = hostArg ? hostArg.split('=')[1] : undefined;
      const isDev = rawArgs.includes('--dev') || rawArgs.includes('-d') || process.env.CHEMX_UI_DEV === '1';
      const allowHosts = rawArgs.filter((a) => a.startsWith('--allow-host=')).flatMap((a) => a.slice('--allow-host='.length).split(',')).filter(Boolean);
      const { server } = await startUiServer({ port, host, allowHosts, dev: isDev, isCli: true, cwd: process.cwd() });
      await new Promise((resolve) => {
        const shutdown = () => {
          server.close(() => resolve());
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        server.on('close', resolve);
      });
      break;
    }
    case 'tesseract':
    case 'cube':
    case 'matrix': {
      const isJsonPayload = rawArgs.includes('--json');
      if (isJsonPayload) {
        const { runLatticeJson } = await import('../lattice-payload.js');
        runLatticeJson(true);
        break;
      }
      const { runTesseract } = await import('../tesseract.js');
      await runTesseract(rawArgs.slice(1), true);
      break;
    }
    case 'docs': {
      const { runDocsCli } = await import('../docs-check/run.js');
      setExitCodeFrom(runDocsCli(rawArgs.slice(1), process.cwd()));
      break;
    }
    case 'patterns': {
      const { runPatternsCli } = await import('../mcp/patterns-cli.js');
      runPatternsCli(rawArgs.slice(1));
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      await printHelp(rawArgs.slice(1));
      break;
    default: {
      if (isCapsulePrefix(firstArg)) {
        const { runGenerateWizard } = await import('../scaffold.js');
        await runGenerateWizard(rawArgs);
      } else {
        process.stderr.write(`Unknown command "${firstArg}". Run --help for usage.\n`);
        process.exit(1);
      }
      break;
    }
  }
};

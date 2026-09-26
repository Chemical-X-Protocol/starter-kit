/**
 * cmd-router.js: CLI command dispatch table.
 * Single responsibility: map first-arg tokens to their lazy-loaded command handlers.
 * Extracted from cli/index.js per Directive 1.A (Monolith Decomposition).
 */

import { printHelp } from '../help.js';

/**
 * Dispatch the resolved CLI command to its handler module.
 * @param {string} firstArg
 * @param {string[]} rawArgs
 * @param {(dir: string|null, isCli: boolean) => Promise<object>} runAudit
 * @param {() => string} getPackageVersion
 * @param {(arg: string) => boolean} isCapsulePrefix
 */
export const dispatchCommand = async (firstArg, rawArgs, runAudit, getPackageVersion, isCapsulePrefix) => {
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
      const { runMcpServer } = await import('../mcp/index.js');
      await runMcpServer(rawArgs.slice(1));
      break;
    }
    case 'read':
    case 'view':
    case 'r': {
      const { runReaderCli } = await import('../reader.js');
      runReaderCli(rawArgs.slice(1), true);
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
      const posDir = (rawArgs[1] && !rawArgs[1].startsWith('-')) ? rawArgs[1] : null;
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
      const isHelpRequested = rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs[1] === 'help';
      if (isHelpRequested) {
        const { printInitHelp } = await import('../help.js');
        printInitHelp();
        break;
      }
      const nonFlagArgs = rawArgs.slice(1).filter((arg) => !arg.startsWith('-'));
      const targetSubDir = nonFlagArgs[0] || 'src/chemical-x';
      const { runInit } = await import('../scaffold.js');
      await runInit(targetSubDir, rawArgs, runAudit);
      break;
    }
    case 'create':
    case 'scaffold': {
      const isHelpRequested = rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs[1] === 'help';
      if (isHelpRequested) {
        const { printScaffoldHelp } = await import('../help.js');
        printScaffoldHelp();
        break;
      }
      const { runScaffold } = await import('../scaffold.js');
      const nonFlagArgs = rawArgs.slice(1).filter((arg) => !arg.startsWith('-'));
      await runScaffold(nonFlagArgs[0], rawArgs, runAudit);
      break;
    }
    case 'hook':
    case 'hooks':
    case 'install-hooks':
    case 'setup-ci': {
      const { runInstallWizard } = await import('../installer.js');
      await runInstallWizard(rawArgs[1] || process.cwd());
      break;
    }
    case 'pillars':
    case 'rules':
    case 'config:pillars': {
      const { runPillarsWizard } = await import('../pillars-wizard.js');
      await runPillarsWizard(rawArgs.slice(1), process.cwd());
      break;
    }
    case 'check': {
      const { handleCheckCommand } = await import('../search.js');
      handleCheckCommand(rawArgs[1], { isJson: rawArgs.includes('--json'), isCli: true });
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
      if (['prop', 'state', 'action'].includes(rawArgs[1])) {
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
      const { runMcpInstaller } = await import('../mcp/index.js');
      await runMcpInstaller(rawArgs.slice(1));
      break;
    }
    case '-v':
    case '--version':
    case 'version':
      process.stdout.write(`create-chemx v${getPackageVersion()}\n`);
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
      const host = hostArg ? hostArg.split('=')[1] : '0.0.0.0';
      const isDev = rawArgs.includes('--dev') || rawArgs.includes('-d') || process.env.CHEMX_UI_DEV === '1';
      const { server } = await startUiServer({ port, host, dev: isDev, isCli: true, cwd: process.cwd() });
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
      const { runTesseract } = await import('../tesseract.js');
      await runTesseract(rawArgs.slice(1), true);
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
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

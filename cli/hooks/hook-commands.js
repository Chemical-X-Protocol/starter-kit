// Routing for `chemx hook <name>` and `chemx install-hooks --host=claude`. Returns false when the
// arguments belong to the legacy guardrail wizard (pre-commit + CI), which the router then runs.

import { HOOKS, runHookCli } from './run-hook.js';

export const routeHookCommand = async (command, args) => {
  const hookName = args[0];
  const isHookRun = (command === 'hook' || command === 'hooks') && Object.hasOwn(HOOKS, hookName ?? '');
  if (isHookRun) {
    process.exitCode = await runHookCli(args);
    return true;
  }
  const hasHostFlag = args.some((arg) => arg.startsWith('--host'));
  const isHostInstall = command === 'install-hooks' && hasHostFlag;
  if (isHostInstall) {
    const { runInstallHooksCli } = await import('./install-hooks-cli.js');
    process.exitCode = await runInstallHooksCli(args);
    return true;
  }
  return false;
};

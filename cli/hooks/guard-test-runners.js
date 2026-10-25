// `node tests/run-tests.mjs` in a repo whose runner chemx test understands (cli/test-project-runner.js)
// is nudged toward `chemx test`: one file at a time, failures only, one run at a time on the job line.
// .chemxrc can list runners the guard leaves alone: { "test": { "runners": ["node tests/run-tests.mjs"] } },
// each entry a `node <script>` call whose script is read relative to the .chemxrc that lists it.
// `guard.allow` (guard-allow.js) is the same list under its general name: either key works here, and
// an entry there also matches the call as typed, whatever it runs (K11 #6756).
import fs from 'node:fs';
import path from 'node:path';
import { isHarnessRunnerSource } from '../build/detector.js';
import { isRepoPath } from './guard-paths.js';
import { directoriesUpTo, guardSettingsAt } from './guard-allow.js';

export const PROJECT_RUNNER_ADVICE = 'chemx test [tests/<name>.test.mjs] (runs this repo\'s own tests/run-tests.mjs on the job line, one file at a time, failures only); '
  + 'to keep calling the runner yourself, list it in .chemxrc: { "test": { "runners": ["node tests/run-tests.mjs"] } }';

const RUNNER_SCRIPT = /^run-tests\.[cm]?js$/;

const nodeScriptOf = ({ tool, via, args }) => {
  const isNodeScript = tool === 'node' && via === 'node';
  return isNodeScript ? args.find((arg) => !arg.startsWith('-')) ?? null : null;
};

// Absolute path of a run-tests script inside the project, else null.
const runnerPathOf = (invocation, context) => {
  const script = nodeScriptOf(invocation);
  const isRunnerName = script !== null && RUNNER_SCRIPT.test(path.basename(script));
  const isRunnerInProject = isRunnerName && isRepoPath(script, context);
  return isRunnerInProject ? path.resolve(context.cwd, script) : null;
};

const isEntryForScript = (entry, configDir, scriptAbs) => {
  const [tool, ...rest] = entry.trim().split(/\s+/);
  const entryScript = rest.find((word) => !word.startsWith('-'));
  return tool === 'node' && entryScript !== undefined && path.resolve(configDir, entryScript) === scriptAbs;
};

// The script's directory and every directory above it up to the project root.
const isListed = (scriptAbs, root) => directoriesUpTo(path.dirname(scriptAbs), root)
  .some((dir) => guardSettingsAt(dir).allow.some((entry) => isEntryForScript(entry, dir, scriptAbs)));

export const isUnlistedProjectRunner = (invocation, command, context) => {
  const scriptAbs = runnerPathOf(invocation, context);
  const isReadable = scriptAbs !== null && fs.existsSync(scriptAbs);
  if (!isReadable) return false;
  const isHarnessRunner = isHarnessRunnerSource(fs.readFileSync(scriptAbs, 'utf-8'));
  return isHarnessRunner && !isListed(scriptAbs, context.root);
};

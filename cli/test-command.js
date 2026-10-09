// Resolves which test runner a project uses and the exact command for a scoped run.
// The project's own `test` script decides the runner (node --test, vitest, jest); deps and
// config files are only a fallback. A target inside a sub-package runs from that package.
import fs from 'node:fs';
import path from 'node:path';
import { resolvePackageManager, loadLocalPackageJson } from './build/detector.js';
import { shellQuote, quoteFilter, findOwningPackageDir } from './test-paths.js';

const RUNNER_SCRIPTS = ['test', 'test:run', 'test:ci', 'test:unit'];
const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs'];
const JEST_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'];
const WORKTREE_DIR = path.join('.claude', 'worktrees');

const NODE_TEST_SEGMENT = /\bnode\s+[^&|;]*--test\b[^&|;]*/;

export const detectRunnerFromScript = (script = '') => {
  const text = String(script || '');
  const isNodeTest = NODE_TEST_SEGMENT.test(text) || text.includes('node:test');
  const runners = [['node', isNodeTest], ['vitest', /\bvitest\b/.test(text)], ['jest', /\bjest\b/.test(text)]];
  const match = runners.find(([, isUsed]) => isUsed);
  return match ? match[0] : null;
};

export const detectTestRunner = (cwd, pkg = loadLocalPackageJson(cwd)) => {
  const scripts = pkg?.scripts || {};
  const fromScript = RUNNER_SCRIPTS.map((name) => detectRunnerFromScript(scripts[name])).find(Boolean);
  if (fromScript) return fromScript;
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const hasAnyFile = (names) => names.some((name) => fs.existsSync(path.join(cwd, name)));
  const usesVitest = Boolean(deps.vitest) || hasAnyFile(VITEST_CONFIGS);
  if (usesVitest) return 'vitest';
  const usesJest = Boolean(deps.jest) || hasAnyFile(JEST_CONFIGS);
  return usesJest ? 'jest' : null;
};

// npm init writes `echo "Error: no test specified" && exit 1`, which is a placeholder, not a runner.
const isPlaceholderScript = (script) => /no test specified/.test(script);

// A directory owns a scoped run only when it declares a runner of its own: a runner config,
// a runner dependency, or a real `test` script (any runner, mocha and ava included).
const declaresTestRunner = (dir) => {
  const pkg = loadLocalPackageJson(dir);
  const script = pkg?.scripts?.test || '';
  const hasRealScript = script.length > 0 && !isPlaceholderScript(script);
  return hasRealScript || detectTestRunner(dir, pkg) !== null;
};

// Node options that take their value as the next word (`--import tsx`), so that word is part of
// the flag, never a file glob to be replaced by the targets.
const NODE_VALUE_FLAGS = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions',
  '--env-file', '--env-file-if-exists', '--input-type', '--disable-warning', '--watch-path',
  '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern',
  '--test-concurrency', '--test-timeout', '--test-shard', '--test-isolation', '--test-global-setup',
  '--test-coverage-include', '--test-coverage-exclude', '--test-coverage-branches',
  '--test-coverage-functions', '--test-coverage-lines', '--experimental-default-type'
]);

// Splits the script's `node ... --test ...` segment into flag groups (a flag plus its value)
// and file globs. An existing name pattern is dropped, since the caller supplies its own.
const readNodeSegment = (script = '') => {
  const segment = (String(script).match(NODE_TEST_SEGMENT) || ['node --test'])[0].trim();
  const tokens = segment.split(/\s+/).slice(1);
  const flags = [];
  const files = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const isFlag = token.startsWith('-');
    if (!isFlag) {
      files.push(token);
      continue;
    }
    const takesNextWord = NODE_VALUE_FLAGS.has(token) && index + 1 < tokens.length;
    const group = takesNextWord ? [token, tokens[++index]] : [token];
    const isNamePattern = token.startsWith('--test-name-pattern');
    if (!isNamePattern) flags.push(...group);
  }
  return { flags, files };
};

// node --test does not walk a directory argument (it tries to load it as a module), so a
// directory target becomes a glob of the spec files inside it.
const NODE_DIR_GLOB = '**/*.{test,spec}.{js,mjs,cjs}';
const toNodeTarget = (runCwd, target) => {
  const isDirectory = fs.statSync(path.resolve(runCwd, target), { throwIfNoEntry: false })?.isDirectory();
  return isDirectory ? `${target.replace(/\/+$/, '')}/${NODE_DIR_GLOB}` : target;
};

const buildNodeCommand = (script, runCwd, targets, filter) => {
  const { flags, files } = readNodeSegment(script);
  const pattern = filter ? [`--test-name-pattern=${quoteFilter(filter)}`] : [];
  const fileArgs = targets.length > 0 ? targets.map((t) => shellQuote(toNodeTarget(runCwd, t))) : files;
  return ['node', ...flags, ...pattern, ...fileArgs].join(' ');
};

const buildVitestCommand = (runCwd, targets, filter) => {
  const parts = ['npx vitest run', ...targets.map(shellQuote)];
  if (filter) parts.push(`-t ${quoteFilter(filter)}`);
  const hasWorktrees = fs.existsSync(path.join(runCwd, WORKTREE_DIR));
  if (hasWorktrees) parts.push(`--exclude ${shellQuote('**/.claude/worktrees/**')}`);
  return parts.join(' ');
};

const SCOPED_BUILDERS = {
  node: ({ script, runCwd, targets, filter }) => buildNodeCommand(script, runCwd, targets, filter),
  vitest: ({ runCwd, targets, filter }) => buildVitestCommand(runCwd, targets, filter)
};

const buildScopedCommand = ({ runner, script, runCwd, targets, filter, pm }) => {
  const runnerBuilder = SCOPED_BUILDERS[runner];
  if (runnerBuilder) return runnerBuilder({ script, runCwd, targets, filter });
  const filterArg = filter ? ` -t ${quoteFilter(filter)}` : '';
  const targetArgs = targets.map((t) => ` ${shellQuote(t)}`).join('');
  const isJest = runner === 'jest';
  if (isJest) return `npx jest${targetArgs}${filterArg}`;
  const baseTest = pm === 'yarn' ? 'yarn test' : `${pm} test`;
  return `${baseTest} --${targetArgs}${filterArg}`;
};

// A bare `vitest` script is watch mode; prefer the project's own one-shot script when it has one.
const pickUnscopedScript = (scripts) => {
  const isWatchVitest = /\bvitest\b/.test(scripts.test || '') && !/\bvitest\s+(?:run|--run)\b|--watch=false/.test(scripts.test);
  const oneShot = ['test:run', 'test:ci'].find((name) => scripts[name]);
  return isWatchVitest && oneShot ? oneShot : 'test';
};

// Whole shell words with surrounding quotes removed, so `vitest run` never "contains" a filter `a`.
const commandWords = (command) => command.split(/\s+/).filter(Boolean).map((word) => word.replace(/^(['"])(.*)\1$/, '$2'));
const NAME_FILTER_FLAG = /^(?:-t|--filter|--test-name-pattern|--testNamePattern)(?:=|$)/;
const NODE_TEST_FLAG = /(^|\s)--test(?=\s|$)/;

const appendScopeToCustom = (customCmd, targets, filter) => {
  let command = customCmd.trim();
  const runner = detectRunnerFromScript(command);
  const words = commandWords(command);
  const missingTargets = targets.filter((t) => !words.includes(t));
  const hasMissingTargets = missingTargets.length > 0;
  if (hasMissingTargets) command += ` ${missingTargets.map(shellQuote).join(' ')}`;
  const hasNameFilter = words.some((word) => NAME_FILTER_FLAG.test(word));
  const needsFilter = Boolean(filter) && !hasNameFilter;
  if (!needsFilter) return command;
  const canInsertAfterTestFlag = runner === 'node' && NODE_TEST_FLAG.test(command);
  if (canInsertAfterTestFlag) return command.replace(NODE_TEST_FLAG, (match, lead) => `${lead}--test --test-name-pattern=${quoteFilter(filter)}`);
  const flag = runner === 'node' ? '--test-name-pattern=' : '-t ';
  return `${command} ${flag}${quoteFilter(filter)}`;
};

// Returns { command, cwd, runner, missingTargets, targets, forwardsArgs }. missingTargets lists node --test targets
// that do not exist on disk; the caller reports those as inconclusive instead of running.
export const planTestCommand = (customCmd, cwd = process.cwd(), options = {}) => {
  const targets = (options.targets || []).map(String).filter(Boolean);
  const filter = options.filter ? String(options.filter).trim() : null;
  const hasCustom = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustom) {
    return { command: appendScopeToCustom(customCmd, targets, filter), cwd, runner: detectRunnerFromScript(customCmd), missingTargets: [] };
  }

  const owner = findOwningPackageDir(cwd, targets, declaresTestRunner);
  const runCwd = owner.dir;
  const pkg = loadLocalPackageJson(runCwd);
  const scripts = pkg?.scripts || {};
  const runner = detectTestRunner(runCwd, pkg);
  const pm = resolvePackageManager(runCwd);
  const isScoped = owner.targets.length > 0 || Boolean(filter);

  if (isScoped) {
    const script = scripts.test || '';
    const missingTargets = runner === 'node' ? owner.targets.filter((t) => !/[*?[]/.test(t) && !fs.existsSync(path.resolve(runCwd, t))) : [];
    const command = buildScopedCommand({ runner, script, runCwd, targets: owner.targets, filter, pm });
    return { command, cwd: runCwd, runner, missingTargets, targets: owner.targets };
  }

  const isLegitTest = Boolean(scripts.test) && !isPlaceholderScript(scripts.test);
  const shouldRunVitestDirectly = !isLegitTest && runner === 'vitest';
  if (shouldRunVitestDirectly) return { command: buildVitestCommand(runCwd, [], null), cwd: runCwd, runner, missingTargets: [], targets: [] };
  const scriptName = pickUnscopedScript(scripts);
  const script = String(scripts[scriptName] || '').trim();
  // A script that is exactly one `node --test ...` runs directly, so the worker budget
  // (--test-concurrency) reaches node; `npm run` would swallow the flag.
  const isPureNodeScript = runner === 'node' && (script.match(NODE_TEST_SEGMENT)?.[0] || '').trim() === script && script.length > 0;
  if (isPureNodeScript) return { command: buildNodeCommand(script, runCwd, [], null), cwd: runCwd, runner, missingTargets: [], targets: [] };
  const command = pm === 'yarn' ? `yarn ${scriptName}` : `${pm} run ${scriptName}`;
  const forwardsArgs = script.length > 0 && !/[&|;<>`$()]/.test(script);
  return { command, cwd: runCwd, runner, missingTargets: [], targets: [], forwardsArgs };
};

export const detectTestCommand = (customCmd, cwd = process.cwd(), options = {}) => {
  const targets = options.targets || (options.target ? [String(options.target).trim()] : []);
  return planTestCommand(customCmd, cwd, { targets, filter: options.filter }).command;
};

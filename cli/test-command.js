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
  if (NODE_TEST_SEGMENT.test(text) || text.includes('node:test')) return 'node';
  if (/\bvitest\b/.test(text)) return 'vitest';
  if (/\bjest\b/.test(text)) return 'jest';
  return null;
};

export const detectTestRunner = (cwd, pkg = loadLocalPackageJson(cwd)) => {
  const scripts = pkg?.scripts || {};
  const fromScript = RUNNER_SCRIPTS.map((name) => detectRunnerFromScript(scripts[name])).find(Boolean);
  if (fromScript) return fromScript;
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const hasAnyFile = (names) => names.some((name) => fs.existsSync(path.join(cwd, name)));
  if (deps.vitest || hasAnyFile(VITEST_CONFIGS)) return 'vitest';
  if (deps.jest || hasAnyFile(JEST_CONFIGS)) return 'jest';
  return null;
};

// Splits the script's `node ... --test ...` segment into its flags and its file globs.
const readNodeSegment = (script = '') => {
  const segment = (String(script).match(NODE_TEST_SEGMENT) || ['node --test'])[0].trim();
  const tokens = segment.split(/\s+/).slice(1);
  const isNamePattern = (token) => token.startsWith('--test-name-pattern');
  return {
    flags: tokens.filter((t) => t.startsWith('-') && !isNamePattern(t)),
    files: tokens.filter((t) => !t.startsWith('-'))
  };
};

const buildNodeCommand = (script, targets, filter) => {
  const { flags, files } = readNodeSegment(script);
  const pattern = filter ? [`--test-name-pattern=${quoteFilter(filter)}`] : [];
  const fileArgs = targets.length > 0 ? targets.map(shellQuote) : files;
  return ['node', ...flags, ...pattern, ...fileArgs].join(' ');
};

const buildVitestCommand = (runCwd, targets, filter) => {
  const parts = ['npx vitest run', ...targets.map(shellQuote)];
  if (filter) parts.push(`-t ${quoteFilter(filter)}`);
  const hasWorktrees = fs.existsSync(path.join(runCwd, WORKTREE_DIR));
  if (hasWorktrees) parts.push(`--exclude ${shellQuote('**/.claude/worktrees/**')}`);
  return parts.join(' ');
};

const buildScopedCommand = ({ runner, script, runCwd, targets, filter, pm }) => {
  if (runner === 'node') return buildNodeCommand(script, targets, filter);
  if (runner === 'vitest') return buildVitestCommand(runCwd, targets, filter);
  const filterArg = filter ? ` -t ${quoteFilter(filter)}` : '';
  const targetArgs = targets.map((t) => ` ${shellQuote(t)}`).join('');
  if (runner === 'jest') return `npx jest${targetArgs}${filterArg}`;
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
  if (missingTargets.length > 0) command += ` ${missingTargets.map(shellQuote).join(' ')}`;
  const hasNameFilter = words.some((word) => NAME_FILTER_FLAG.test(word));
  const needsFilter = Boolean(filter) && !hasNameFilter;
  if (!needsFilter) return command;
  const canInsertAfterTestFlag = runner === 'node' && NODE_TEST_FLAG.test(command);
  if (canInsertAfterTestFlag) return command.replace(NODE_TEST_FLAG, `$1--test --test-name-pattern=${quoteFilter(filter)}`);
  const flag = runner === 'node' ? '--test-name-pattern=' : '-t ';
  return `${command} ${flag}${quoteFilter(filter)}`;
};

// Returns { command, cwd, runner, missingTargets }. missingTargets lists node --test targets
// that do not exist on disk; the caller reports those as inconclusive instead of running.
export const planTestCommand = (customCmd, cwd = process.cwd(), options = {}) => {
  const targets = (options.targets || []).map(String).filter(Boolean);
  const filter = options.filter ? String(options.filter).trim() : null;
  const hasCustom = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustom) {
    return { command: appendScopeToCustom(customCmd, targets, filter), cwd, runner: detectRunnerFromScript(customCmd), missingTargets: [] };
  }

  const owner = findOwningPackageDir(cwd, targets);
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
    return { command, cwd: runCwd, runner, missingTargets };
  }

  const isLegitTest = scripts.test && !scripts.test.includes('no test specified');
  if (!isLegitTest && runner === 'vitest') return { command: buildVitestCommand(runCwd, [], null), cwd: runCwd, runner, missingTargets: [] };
  const scriptName = pickUnscopedScript(scripts);
  const command = pm === 'yarn' ? `yarn ${scriptName}` : `${pm} run ${scriptName}`;
  return { command, cwd: runCwd, runner, missingTargets: [] };
};

export const detectTestCommand = (customCmd, cwd = process.cwd(), options = {}) => {
  const targets = options.targets || (options.target ? [String(options.target).trim()] : []);
  return planTestCommand(customCmd, cwd, { targets, filter: options.filter }).command;
};

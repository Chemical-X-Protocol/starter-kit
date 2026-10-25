// A repo with its own tests/run-tests.mjs harness runner (the WordPress plugins; task #6754).
// `chemx test` with no target runs that runner as it is. With targets or a name filter it writes a
// copy of the runner into tests/ (same relative imports) with the test-file imports swapped for the
// targets and a name filter added, runs that, and deletes it. Failures-only output and the one-line
// summary are the runner's own. The run always takes a ticket in the job line (plan.exclusive):
// those suites share one database, so two runs must never overlap.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TEST_FILE_IMPORT } from './build/detector.js';
import { shellQuote } from './test-paths.js';

export const GENERATED_PREFIX = '.chemx-run-';
// node loads the entry module once at start, so a generated runner older than this belongs to a
// chemx that died before it could clean up.
const STALE_MS = 10 * 60 * 1000;
const TEST_FILE_NAME = /\.test\.[cm]?js$/;

const toPosix = (value) => value.split(path.sep).join('/');
const isDirectory = (abs) => fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory() === true;
const isFile = (abs) => fs.statSync(abs, { throwIfNoEntry: false })?.isFile() === true;

const testFilesIn = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const abs = path.join(dir, entry.name);
  if (entry.isDirectory()) return testFilesIn(abs);
  return TEST_FILE_NAME.test(entry.name) ? [abs] : [];
}).sort();

// A target is read from where the caller stands first, then from the repo root.
const absoluteOf = (target, root, fromDir) => [path.resolve(fromDir, target), path.resolve(root, target)].find((abs) => fs.existsSync(abs)) ?? null;

const expandTarget = (target, root, fromDir) => {
  const abs = absoluteOf(target, root, fromDir);
  const isMissing = abs === null;
  if (isMissing) return { target, files: [] };
  return { target, files: isDirectory(abs) ? testFilesIn(abs) : [abs] };
};

const importOf = (runnerDir, abs) => {
  const relative = toPosix(path.relative(runnerDir, abs));
  return relative.startsWith('.') ? relative : `./${relative}`;
};

// The filter is a regular expression like the other runners' -t; text that is not one matches literally.
const isRegexSource = (text) => {
  try {
    return Boolean(new RegExp(text));
  } catch { // chemx-allow: best-effort a filter that is not a regular expression is matched as plain text
    return false;
  }
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Runs after every test file registered its suites (imports are evaluated before the module body).
const filterStatement = (filter) => {
  const pattern = isRegexSource(filter) ? filter : escapeRegex(filter);
  return [
    "if (!Array.isArray(harness.suites)) throw new Error('chemx: this harness exposes no suites to filter by name');",
    `const chemxNamePattern = new RegExp(${JSON.stringify(pattern)});`,
    'for (const suite of harness.suites) suite.tests = suite.tests.filter((test) => chemxNamePattern.test(`${suite.name} ${test.name}`));'
  ];
};

// The repo runner's source with its side-effect test imports replaced by `imports` (null keeps them)
// and, with a filter, a statement narrowing the registered tests by name.
export const buildRunnerSource = (source, { imports = null, filter = null } = {}) => {
  const lines = String(source).split('\n');
  const importIndexes = lines.flatMap((line, index) => (TEST_FILE_IMPORT.test(line) ? [index] : []));
  const first = importIndexes[0];
  const last = importIndexes.at(-1);
  const keepsImports = imports === null;
  const replacement = keepsImports ? [] : imports.map((spec) => `import '${spec}';`);
  const narrowing = filter ? filterStatement(filter) : [];
  const out = [];
  lines.forEach((line, index) => {
    const isSwappedImport = importIndexes.includes(index) && !keepsImports;
    const isFirstImport = index === first;
    const isLastImport = index === last;
    const isReplacementPoint = isSwappedImport && isFirstImport;
    if (!isSwappedImport) out.push(line);
    if (isReplacementPoint) out.push(...replacement);
    if (isLastImport) out.push(...narrowing);
  });
  return out.join('\n');
};

export const sweepGeneratedRunners = (dir, now = Date.now()) => {
  for (const name of fs.readdirSync(dir).filter((entry) => entry.startsWith(GENERATED_PREFIX))) {
    const file = path.join(dir, name);
    const isStale = now - fs.statSync(file).mtimeMs > STALE_MS;
    if (isStale) fs.rmSync(file, { force: true });
  }
};

const generatedName = (files, filter) => `${GENERATED_PREFIX}${crypto.createHash('sha1').update(JSON.stringify([files, filter])).digest('hex').slice(0, 8)}.mjs`;

// Plans a run of the project's runner. `fromDir` is where the caller stands (targets are read there
// first). Returns the shape planTestCommand returns, plus exclusive: true (always the line) and,
// when a runner has to be generated, prepare() -> cleanup().
export const planProjectRunner = (project, { targets = [], filter = null, fromDir = project.root } = {}) => {
  const runnerDir = path.dirname(project.abs);
  const expanded = targets.map((target) => expandTarget(target, project.root, fromDir));
  const missingTargets = expanded.filter((entry) => entry.files.length === 0).map((entry) => entry.target);
  const files = [...new Set(expanded.flatMap((entry) => entry.files))];
  const shown = files.map((abs) => toPosix(path.relative(project.root, abs)));
  const base = { cwd: project.root, runner: 'harness', missingTargets, targets: shown, exclusive: true };
  const isWholeRunner = targets.length === 0 && !filter;
  if (isWholeRunner) return { ...base, command: `node ${toPosix(project.file)}` };

  const name = generatedName(shown, filter);
  const source = buildRunnerSource(project.source, { imports: targets.length > 0 ? files.map((abs) => importOf(runnerDir, abs)) : null, filter });
  const prepare = () => {
    sweepGeneratedRunners(runnerDir);
    const file = path.join(runnerDir, name);
    fs.writeFileSync(file, source);
    return () => fs.rmSync(file, { force: true });
  };
  return { ...base, command: `node ${shellQuote(toPosix(path.relative(project.root, path.join(runnerDir, name))))}`, prepare };
};

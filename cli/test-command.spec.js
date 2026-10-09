import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTestCommand, detectTestRunner, detectRunnerFromScript } from './test-command.js';
import { parseCliArgs } from './cli-args.js';

const makeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-cmd-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
};

const withProject = (files, fn) => {
  const root = makeProject(files);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const KIT_LIKE = {
  'package.json': { scripts: { test: 'node --test --test-concurrency=1 cli/*.spec.js' }, devDependencies: { vitest: '^5.0.3' } },
  'cli/verify.spec.js': ''
};

test('test-command: the project test script decides the runner even when vitest is a dependency', () => {
  withProject(KIT_LIKE, (root) => {
    assert.equal(detectTestRunner(root), 'node');
    const plan = planTestCommand(null, root, { targets: ['cli/verify.spec.js'] });
    assert.equal(plan.command, 'node --test --test-concurrency=1 cli/verify.spec.js', 'keeps the script flags, swaps in the target');
  });
});

test('test-command: a node --test name filter goes before the files, where node honors it', () => {
  withProject(KIT_LIKE, (root) => {
    const plan = planTestCommand(null, root, { filter: 'presets' });
    assert.equal(plan.command, 'node --test --test-concurrency=1 --test-name-pattern="presets" cli/*.spec.js');
  });
});

test('test-command: a missing node --test target is reported, not silently widened to the full suite', () => {
  withProject(KIT_LIKE, (root) => {
    const plan = planTestCommand(null, root, { targets: ['cli/nope.spec.js'] });
    assert.deepEqual(plan.missingTargets, ['cli/nope.spec.js']);
  });
});

test('test-command: vitest scoped runs use `vitest run` (never watch) and pass the -t filter quoted', () => {
  withProject({ 'package.json': { scripts: { test: 'vitest' }, devDependencies: { vitest: '^5' } } }, (root) => {
    const plan = planTestCommand(null, root, { targets: ['b.spec'], filter: "it's $HOME" });
    assert.equal(plan.command, `npx vitest run b.spec -t 'it'\\''s $HOME'`);
  });
});

test('test-command: an unscoped bare `vitest` script prefers the project one-shot test:run script', () => {
  withProject({ 'package.json': { scripts: { test: 'vitest', 'test:run': 'vitest run' } } }, (root) => {
    assert.equal(planTestCommand(null, root).command, 'npm run test:run');
  });
});

test('test-command: vitest scoped runs exclude .claude/worktrees copies from collection', () => {
  withProject({ 'package.json': { devDependencies: { vitest: '^5' } }, '.claude/worktrees/g1/x.spec.ts': '' }, (root) => {
    const plan = planTestCommand(null, root, { targets: ['x.spec'] });
    assert.match(plan.command, /--exclude "\*\*\/\.claude\/worktrees\/\*\*"/);
  });
});

test('test-command: a target inside a sub-package runs from that package with its own runner', () => {
  const files = {
    'package.json': { scripts: { test: 'vitest' }, devDependencies: { vitest: '^5' } },
    'apps/kitchen/package.json': { scripts: { test: 'node --test src/*.test.js' } },
    'apps/kitchen/src/a.test.js': ''
  };
  withProject(files, (root) => {
    const plan = planTestCommand(null, root, { targets: ['apps/kitchen/src/a.test.js'] });
    assert.equal(plan.cwd, path.join(root, 'apps/kitchen'));
    assert.equal(plan.runner, 'node');
    assert.equal(plan.command, 'node --test src/a.test.js');
  });
});

test('test-command: script runner detection covers node --test, vitest and jest', () => {
  assert.equal(detectRunnerFromScript('node --test cli/*.spec.js'), 'node');
  assert.equal(detectRunnerFromScript('cross-env X=1 vitest run'), 'vitest');
  assert.equal(detectRunnerFromScript('jest --ci'), 'jest');
  assert.equal(detectRunnerFromScript('echo "Error: no test specified" && exit 1'), null);
});

test('cli-args: -t <name>, -t=<name> and --filter=<name> all reach the filter; positionals are targets', () => {
  const schema = { booleans: { '--json': 'json' }, values: { '-t': 'filter', '--filter': 'filter' } };
  assert.equal(parseCliArgs(['tests/a.spec.ts', '-t', 'guest'], schema).values.filter, 'guest');
  assert.equal(parseCliArgs(['-t=guest'], schema).values.filter, 'guest');
  assert.equal(parseCliArgs(['--filter=guest'], schema).values.filter, 'guest');
  const parsed = parseCliArgs(['lockscreen', 'b.spec', '--json'], schema);
  assert.deepEqual(parsed.positionals, ['lockscreen', 'b.spec']);
  assert.equal(parsed.flags.json, true);
});

test('cli-args: unknown flags and missing values are reported, and -- ends option parsing', () => {
  const schema = { booleans: {}, values: { '--command': 'command' } };
  const parsed = parseCliArgs(['--bogus', '--command'], schema);
  assert.deepEqual(parsed.unknown, ['--bogus']);
  assert.deepEqual(parsed.missingValues, ['--command']);
  assert.equal(parseCliArgs(['--', 'vite', 'build', '--mode=x'], schema).command, 'vite build --mode=x');
  assert.equal(parseCliArgs(['--command=exit 3'], schema).values.command, 'exit 3');
});

test('test-command: a custom command keeps the filter even when its text appears elsewhere in the command', () => {
  const vitest = planTestCommand('vitest run', process.cwd(), { targets: ['cli/a.spec.js'], filter: 'a' });
  assert.equal(vitest.command, 'vitest run cli/a.spec.js -t "a"');
  const npx = planTestCommand('npx vitest run tests/math.spec.ts', process.cwd(), { filter: 'math' });
  assert.equal(npx.command, 'npx vitest run tests/math.spec.ts -t "math"');
});

test('test-command: a custom command that already carries a name filter or the target is not doubled', () => {
  const withFilter = planTestCommand('npx vitest run -t "x"', process.cwd(), { filter: 'y' });
  assert.equal(withFilter.command, 'npx vitest run -t "x"');
  const withPattern = planTestCommand('node --test --test-name-pattern=foo cli/a.spec.js', process.cwd(), { filter: 'bar', targets: ['cli/a.spec.js'] });
  assert.equal(withPattern.command, 'node --test --test-name-pattern=foo cli/a.spec.js');
});

test('test-command: the node --test filter is inserted after the --test token, not inside --test-reporter', () => {
  const plan = planTestCommand('node --test-reporter=tap --test cli/a.spec.js', process.cwd(), { filter: 'foo' });
  assert.equal(plan.command, 'node --test-reporter=tap --test --test-name-pattern="foo" cli/a.spec.js');
});

test('test-command: a sub-package without its own runner does not take the run away from the root runner', () => {
  const files = {
    'package.json': { scripts: { test: 'vitest run' }, devDependencies: { vitest: '^5' } },
    'packages/foo/package.json': { name: 'foo', version: '1.0.0' },
    'packages/bar/package.json': { name: 'bar', scripts: { test: 'echo "Error: no test specified" && exit 1' } },
    'packages/foo/x.spec.ts': '',
    'packages/bar/y.spec.ts': ''
  };
  withProject(files, (root) => {
    const foo = planTestCommand(null, root, { targets: ['packages/foo/x.spec.ts'] });
    assert.equal(foo.cwd, path.resolve(root));
    assert.equal(foo.command, 'npx vitest run packages/foo/x.spec.ts');
    const bar = planTestCommand(null, root, { targets: ['packages/bar/y.spec.ts'] });
    assert.equal(bar.cwd, path.resolve(root), 'the npm placeholder script is not a runner');
  });
});

test('test-command: a sub-package with a runner config or a real test script owns the run', () => {
  const files = {
    'package.json': { scripts: { test: 'vitest run' } },
    'packages/cfg/vitest.config.ts': 'export default {}',
    'packages/cfg/a.spec.ts': '',
    'packages/mocha/package.json': { scripts: { test: 'mocha' } },
    'packages/mocha/b.spec.js': ''
  };
  withProject(files, (root) => {
    assert.equal(planTestCommand(null, root, { targets: ['packages/cfg/a.spec.ts'] }).cwd, path.join(root, 'packages/cfg'));
    assert.equal(planTestCommand(null, root, { targets: ['packages/mocha/b.spec.js'] }).cwd, path.join(root, 'packages/mocha'));
  });
});

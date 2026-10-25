// `chemx test --changed`: the base it compares with, the meta specs it always runs, what a changed
// fixture selects, and --all adding the slow lane (task #6772).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS } from './result-status.js';
import { formatTestReport } from './test-report.js';
import { SPEC, git, withProject, touch, run, selectedPaths } from './test-kit-fixture.js';

const LANES = JSON.stringify({
  slow: [{ glob: 'cli/slowmod.spec.js', why: 'spawns the CLI' }],
  meta: [{ glob: 'cli/meta-docs.spec.js', why: 'scans the docs of the whole repo' }]
});

const FILES = {
  'package.json': JSON.stringify({ name: 'kit', type: 'module', scripts: { test: 'node --test cli/*.spec.js' } }),
  'test-lanes.json': LANES,
  'cli/a.js': 'export const a = () => 1;\n',
  'cli/a.spec.js': SPEC("import { a } from './a.js';"),
  'cli/b.js': 'export const b = () => 2;\n',
  'cli/b.spec.js': SPEC("import { b } from './b.js';"),
  'cli/slowmod.js': 'export const slow = () => 3;\n',
  'cli/slowmod.spec.js': SPEC("import { slow } from './slowmod.js';"),
  'cli/meta-docs.spec.js': SPEC("import fs from 'node:fs';", "const docs = () => fs.readdirSync('docs');"),
  'cli/marked.spec.js': `// chemx: meta\n${SPEC()}`,
  'docs/guide.md': '# guide\n'
};

const FIXTURES = {
  ...FILES,
  'cli/fixtures/data.json': '{"n":1}\n',
  'cli/reads-data.spec.js': SPEC("import fs from 'node:fs';", "const data = () => fs.readFileSync(new URL('./fixtures/data.json', import.meta.url), 'utf8');"),
  'cli/fixtures/shared.json': '{"n":2}\n',
  'cli/spec-helper.js': "import fs from 'node:fs';\nexport const shared = () => fs.readFileSync(new URL('./fixtures/shared.json', import.meta.url), 'utf8');\n",
  'cli/uses-helper.spec.js': SPEC("import { shared } from './spec-helper.js';"),
  'cli/fixtures/lonely.json': '{"n":3}\n'
};

const commitChange = (root, rel) => {
  touch(root, rel);
  git(root, 'commit', '-q', '-am', `change ${rel}`);
};

test('test --changed: a clean tree compares with the merge base of origin/main and says so', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    commitChange(root, 'cli/b.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report));
    assert.equal(report.selection.base, 'origin/main');
    assert.equal(report.selection.baseDefaulted, true);
    assert.match(report.selection.mergeBase, /^[0-9a-f]{7}$/);
    assert.deepEqual(report.selection.changed, ['cli/b.js']);
    assert.ok(selectedPaths(report).includes('cli/b.spec.js'));
    const text = formatTestReport(report);
    assert.match(text, /Base: origin\/main \(merge base [0-9a-f]{7}\)/, 'one line names the base it chose');
  }, { upstream: 'origin/main' });
});

test('test --changed: origin/master is the default base when there is no origin/main', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    commitChange(root, 'cli/b.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.selection.base, 'origin/master');
    assert.deepEqual(selectedPaths(report).filter((p) => p === 'cli/b.spec.js'), ['cli/b.spec.js']);
  }, { upstream: 'origin/master' });
});

test('test --changed: a clean tree at the upstream tip has nothing to compare and names the base', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.match(report.detail, /no changed files vs origin\/main/);
    assert.doesNotMatch(report.detail, /pass --base/, 'the base was already widened, so the hint is moot');
  }, { upstream: 'origin/main' });
});

test('test --changed: a dirty tree still compares with HEAD, and an explicit --base wins', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    commitChange(root, 'cli/b.js');
    touch(root, 'cli/a.js');
    const dirty = await run(root, ['--changed']);
    assert.equal(dirty.selection.base, 'HEAD');
    assert.equal(dirty.selection.baseDefaulted, undefined);
    assert.deepEqual(dirty.selection.changed, ['cli/a.js']);
    git(root, 'commit', '-q', '-am', 'change a');
    const explicit = await run(root, ['--changed', '--base=HEAD~1']);
    assert.equal(explicit.selection.base, 'HEAD~1');
    assert.deepEqual(explicit.selection.changed, ['cli/a.js']);
  }, { upstream: 'origin/main' });
});

test('test --changed: with no upstream ref a clean tree is still "no changed files vs HEAD"', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.match(report.detail, /no changed files vs HEAD; pass --base=<rev>/);
  });
});

test('test --changed: meta specs (a manifest glob or a "chemx: meta" marker) run with every change', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    touch(root, 'cli/a.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report));
    assert.deepEqual(selectedPaths(report), ['cli/a.spec.js', 'cli/marked.spec.js', 'cli/meta-docs.spec.js']);
    assert.deepEqual(report.selection.meta, ['cli/marked.spec.js', 'cli/meta-docs.spec.js']);
    const reasons = Object.fromEntries(report.selection.specs.map((spec) => [spec.path, spec.reasons.join('; ')]));
    assert.match(reasons['cli/meta-docs.spec.js'], /meta spec/);
    assert.match(formatTestReport(report), /2 meta spec\(s\) always run/);
  });
});

test('test --changed: a change no spec depends on still runs the meta specs', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    touch(root, 'docs/guide.md');
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report));
    assert.deepEqual(selectedPaths(report), ['cli/marked.spec.js', 'cli/meta-docs.spec.js']);
  });
});

test('test --changed: a clean tree with nothing to compare runs no meta spec either', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.equal(report.selection.meta, undefined);
  });
});

test('test --changed leaves the slow lane out; --changed --all runs both lanes for the affected set', { timeout: 120000 }, async () => {
  await withProject(FILES, async (root) => {
    touch(root, 'cli/slowmod.js');
    touch(root, 'cli/a.js');
    const fast = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(fast), ['cli/a.spec.js', 'cli/marked.spec.js', 'cli/meta-docs.spec.js', 'cli/slowmod.spec.js']);
    assert.deepEqual(fast.selection.deferred, ['cli/slowmod.spec.js'], 'the slow spec is listed, not run');
    assert.equal(fast.passed, 3);
    const both = await run(root, ['--changed', '--all']);
    assert.equal(both.status, STATUS.PASS, JSON.stringify(both));
    assert.equal(both.passed, 4, 'the slow-lane spec ran');
    assert.equal(both.selection.deferred, undefined);
    assert.match(both.command, /slowmod\.spec\.js/);
    const slow = await run(root, ['--changed', '--slow']);
    assert.match(slow.command, /slowmod\.spec\.js/);
    assert.doesNotMatch(slow.command, /a\.spec\.js/, 'only the slow lane');
  });
});

test('test --changed: a changed fixture selects only the specs that read it', { timeout: 60000 }, async () => {
  await withProject(FIXTURES, async (root) => {
    touch(root, 'cli/fixtures/data.json', '\n');
    const report = await run(root, ['--changed']);
    assert.equal(report.selection.mode, 'affected', report.selection.reason);
    assert.deepEqual(selectedPaths(report), ['cli/marked.spec.js', 'cli/meta-docs.spec.js', 'cli/reads-data.spec.js']);
    const reasons = Object.fromEntries(report.selection.specs.map((spec) => [spec.path, spec.reasons.join('; ')]));
    assert.match(reasons['cli/reads-data.spec.js'], /data\.json/);
  });
});

test('test --changed: a fixture a shared helper reads, or nobody names, still runs the whole lane', { timeout: 60000 }, async () => {
  await withProject(FIXTURES, async (root) => {
    touch(root, 'cli/fixtures/shared.json', '\n');
    const viaHelper = await run(root, ['--changed']);
    assert.equal(viaHelper.selection.mode, 'full');
    assert.match(viaHelper.selection.reason, /fixtures\/shared\.json.*spec-helper\.js/);
  });
  await withProject(FIXTURES, async (root) => {
    touch(root, 'cli/fixtures/lonely.json', '\n');
    const unread = await run(root, ['--changed']);
    assert.equal(unread.selection.mode, 'full');
    assert.match(unread.selection.reason, /fixtures\/lonely\.json.*no spec names it/);
  });
});

test('test --changed: a spec that lists the fixture directory is selected with the fixture\'s readers', { timeout: 60000 }, async () => {
  const files = {
    ...FIXTURES,
    'cli/sweeps.spec.js': SPEC("import fs from 'node:fs';", "const all = () => fs.readdirSync(new URL('./fixtures', import.meta.url));")
  };
  await withProject(files, async (root) => {
    touch(root, 'cli/fixtures/data.json', '\n');
    const report = await run(root, ['--changed']);
    assert.equal(report.selection.mode, 'affected', report.selection.reason);
    assert.deepEqual(selectedPaths(report), ['cli/marked.spec.js', 'cli/meta-docs.spec.js', 'cli/reads-data.spec.js', 'cli/sweeps.spec.js']);
  });
});

test('test --changed: a new fixture only a new spec reads does not widen the run', { timeout: 60000 }, async () => {
  await withProject(FIXTURES, async (root) => {
    touch(root, 'cli/fixtures/fresh.json', '{}\n');
    touch(root, 'cli/fresh.spec.js', SPEC("import fs from 'node:fs';", "const data = () => fs.readFileSync(new URL('./fixtures/fresh.json', import.meta.url), 'utf8');"));
    const report = await run(root, ['--changed']);
    assert.equal(report.selection.mode, 'affected', report.selection.reason);
    assert.ok(selectedPaths(report).includes('cli/fresh.spec.js'));
  });
});

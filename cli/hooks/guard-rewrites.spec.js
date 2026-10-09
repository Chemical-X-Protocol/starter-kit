// Payload fixtures for the shell rewrite rules (deny with the exact chemx call), the nudges
// (allow with advice), their exemptions and the .chemxrc promotion. Pure: no repo, no db.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePreTool, toPreToolOutput } from './claude-pre-tool.js';

const CONTEXT = { cwd: '/repo', root: '/repo', enforceSearch: true, hasChemxCommand: () => true, nudgePromotion: { all: false, ids: [] } };
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const decide = (command, context = CONTEXT) => decidePreTool(bash(command), context);

const DENY_CASES = [
  ["sed -i 's/foo/bar/' src/a.ts", /chemx patch src\/a\.ts <<'EOF'.*SEARCH "foo" ======= "bar"/],
  ["sed -i.bak -e 's/a.b/c/' src/a.ts", /chemx patch src\/a\.ts.*literal text, not regexes/],
  ["sed -ni 's/foo/bar/p' docs/x.md", /chemx patch docs\/x\.md/],
  ["perl -pi -e 's/x/y/' src/a.vue", /chemx patch src\/a\.vue.*SEARCH "x" ======= "y"/],
  ['perl -i.orig -pe "s/[a-z]+/z/" package.json', /chemx patch package\.json/],
  ['echo hi > docs/notes.md', /chemx write docs\/notes\.md - <<'EOF'.*--overwrite/],
  ['echo hi >> docs/notes.md', /chemx write docs\/notes\.md --append/],
  ["cat > src/a.ts <<'EOF'\nexport const a = 1;\nEOF", /chemx write src\/a\.ts - <<'EOF'/],
  ["cat <<EOF >> src/a.ts\nmore\nEOF", /chemx write src\/a\.ts --append/],
  ['printf x | tee src/b.js', /chemx write src\/b\.js - <<'EOF'/],
  ['printf x | tee -a src/b.js', /chemx write src\/b\.js --append/],
  ['node --test cli/a.spec.js cli/b.spec.js', /Use: chemx test cli\/a\.spec\.js cli\/b\.spec\.js\./],
  ['node --test --test-name-pattern="my case" cli/a.spec.js', /chemx test cli\/a\.spec\.js -t "my case"/],
  ['node --test', /chemx test <file>/],
  ['git show HEAD~1', /chemx show HEAD~1\./],
  ['git show -p abc123 -- src/a.ts', /chemx show abc123 --patch -- src\/a\.ts/],
  ['git show abc123:src/a.ts', /chemx read abc123:src\/a\.ts/],
  ['find . -name "*.spec.js"', /chemx f "\.spec\.js"/],
  ['find src -type f', /chemx f "src"/],
  ['grep -n foo src/a.js', /chemx q -g "foo" --dir=src\/a\.js/],
  ['grep -e foo -e bar src/a.js', /chemx q -g "foo" --dir=src\/a\.js/],
  ["awk '{print $1}' src/a.js", /chemx read src\/a\.js --start=N --end=M/],
  ['cat src/a.ts', /chemx read src\/a\.ts --outline/],
  ['head -20 src/b.vue', /chemx read src\/b\.vue --outline/],
  ['sed -n 1,5p src/a.ts', /chemx read src\/a\.ts --start=N --end=M/],
  ['git diff', /chemx d/],
  ['pnpm vitest run', /chemx test/],
  // #2490: reads and searches that skipped the cat/grep rules.
  ['cat < src/a.js', /chemx read src\/a\.js --outline/],
  ['wc -l < src/a.js', /chemx read src\/a\.js --outline/],
  ['sed s/a/b/ src/a.js', /chemx read src\/a\.js --start=N --end=M/],
  ['sed -n 1,3p < src/a.js', /chemx read src\/a\.js --start=N --end=M/],
  ['grep foo < src/a.js', /chemx q -g "foo" --dir=src\/a\.js/],
  ['git grep foo', /chemx q -g "foo"/],
  ['git grep -n -e foo -- src', /chemx q -g "foo"/],
  ['git cat-file -p HEAD:src/a.js', /chemx read HEAD:src\/a\.js/],
  ["awk -i inplace '{ sub(/a/, \"b\") } 1' src/a.js", /chemx patch src\/a\.js/],
  ['xargs cat < list', /chemx do "read <file>/],
  ['git ls-files | xargs -n1 cat < list.txt', /chemx do/],
];

for (const [command, expectedUse] of DENY_CASES) {
  test(`deny names the exact chemx call: ${command.slice(0, 70).replace(/\n/g, ' ')}`, () => {
    const result = decide(command);
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, expectedUse);
    assert.match(result.reason, /# chemx-bypass: <reason>/);
  });
}

const ALLOW_CASES = [
  'echo hi > /tmp/x.md', 'echo hi >> $UNKNOWN_DIR/x.md', 'echo hi > build.log', 'echo hi > .chemx/state.json',
  'echo hi > node_modules/pkg/index.js', 'echo hi > tmp/x.md', 'echo hi > scratch/x.ts', 'echo hi > /dev/null',
  "sed -i 's/a/b/' /tmp/x.ts", "sed -i 's/a/b/' build.log", "sed 's/a/b/' /tmp/x.ts", "sed 's/a/b/' build.log", 'wc -l < build.log', 'wc -l < /tmp/a.js', 'wc -l src/a.js', 'git -C /tmp/rv/other grep foo', 'cd /tmp/rv/other && git grep foo', 'git -C /tmp/rv/other cat-file -p HEAD:src/a.js', 'git cat-file -e HEAD:src/a.js', 'git cat-file -t HEAD', 'xargs cat < /tmp/list', 'echo a | xargs cat', 'cat < /tmp/a.js', "awk -i inplace '1' /tmp/a.js", "sed -n '1,5p' /tmp/x.ts",
  'perl -e "print 1"', 'perl -Mstrict -e 1 src/a.js',
  'printf x | tee /tmp/x.ts', 'printf x | tee',
  'node scripts/run.mjs', 'node -e "console.log(1)"',
  'git show -s --format=%H HEAD', 'git show --name-only HEAD',
  'find /tmp -name x', 'find . -name x -delete', 'find . -type f -exec wc -l {} +', 'find node_modules -name x',
  'chemx q foo > docs/out.md', 'chemx read src/a.ts | tee /tmp/out.md', 'node cli/index.js test --json > report.json',
  'chemx q foo | grep bar', 'cat /tmp/x | awk \'{print $1}\'', 'git diff --name-only | grep src', 'echo a b | head -1',
  'grep -n foo /tmp/x.js', 'grep foo build.log', 'awk \'{print $1}\' build.log',
  'echo "git status; sleep 5; find . -name x"',
];

for (const command of ALLOW_CASES) {
  test(`allow without advice: ${command.slice(0, 70)}`, () => {
    const result = decide(command);
    assert.equal(result.decision, 'allow');
    assert.equal(toPreToolOutput(result), null);
  });
}

test('a scratch dir named in the payload is free; the same path elsewhere is not', () => {
  const scratch = { ...CONTEXT, scratchDir: '/repo/.pad' };
  assert.equal(decide('echo hi > .pad/a.ts', scratch).decision, 'allow');
  assert.equal(decide('echo hi > .pad2/a.ts', scratch).decision, 'deny');
  assert.equal(decide('echo hi > /repo/.pad/a.ts', scratch).decision, 'allow');
});

const NUDGE_CASES = [
  ['git status', /chemx status/],
  ['git -C apps/x status --short', /chemx status/],
  ['git add src/a.ts', /chemx commit/],
  ['git commit -m "msg"', /chemx commit/],
  ['sleep 5', /chemx wait/],
  ['node -e "setTimeout(() => process.exit(0), 1000)"', /chemx wait/],
  ["timeout 60 bash -c 'until test -f x; do sleep 1; done'", /chemx wait/],
  ['ls src', /chemx f "src"/],
  ['ls -la', /chemx f "\."/],
];

for (const [command, advice] of NUDGE_CASES) {
  test(`nudge allows and advises: ${command.slice(0, 70)}`, () => {
    const result = decide(command);
    assert.equal(result.decision, 'allow');
    const output = toPreToolOutput(result);
    assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'], 'no permissionDecision, so the normal permission flow still runs');
    assert.match(output.hookSpecificOutput.additionalContext, advice);
    assert.match(output.hookSpecificOutput.additionalContext, /advice only, the call was not blocked/);
  });
}

test('nothing to nudge for ls outside the repo, in vendored dirs, or for chemx itself', () => {
  for (const command of ['ls /tmp', 'ls node_modules', 'chemx status', 'chemx wait --for=x', 'chemx commit src/a.ts']) {
    assert.equal(toPreToolOutput(decide(command)), null, command);
  }
});

test('a nudge is only active while the running chemx has the replacement command', () => {
  const onlyStatus = { ...CONTEXT, hasChemxCommand: (name) => name === 'status' };
  assert.match(toPreToolOutput(decide('git status', onlyStatus)).hookSpecificOutput.additionalContext, /chemx status/);
  assert.equal(toPreToolOutput(decide('git commit -m x', onlyStatus)), null);
  assert.equal(toPreToolOutput(decide('sleep 3', onlyStatus)), null);
});

test('several nudges in one command are listed together; a deny in the same command wins', () => {
  const result = decide('git status && git add src/a.ts && git commit -m x');
  assert.deepEqual(result.nudged, ['nudge-git-status', 'nudge-git-add', 'nudge-git-commit']);
  const mixed = decide('git status && git diff');
  assert.equal(mixed.decision, 'deny');
  assert.equal(mixed.rule, 'raw-git-diff');
});

test('a promoted nudge blocks with the same replacement, all at once or by rule id', () => {
  const all = decide('git status', { ...CONTEXT, nudgePromotion: { all: true, ids: [] } });
  assert.equal(all.decision, 'deny');
  assert.match(all.reason, /nudge promoted to a block by guardNudges.*chemx status/);
  const listed = { ...CONTEXT, nudgePromotion: { all: false, ids: ['nudge-git-status'] } };
  assert.equal(decide('git status', listed).decision, 'deny');
  assert.equal(decide('sleep 1', listed).decision, 'allow');
});

test('chemx-bypass allows a deny and a nudge and reports the rule it overrode', () => {
  const denied = decide('sed -i s/a/b/ src/a.ts # chemx-bypass: patch cannot match this');
  assert.deepEqual([denied.decision, denied.bypassReason, denied.rule, denied.overrode], ['allow', 'patch cannot match this', 'shell-sed-in-place', true]);
  const nudged = decide('git status # chemx-bypass: need raw porcelain');
  assert.deepEqual([nudged.decision, nudged.rule, nudged.overrode, nudged.additionalContext], ['allow', 'nudge-git-status', true, undefined]);
  const idle = decide('ls /tmp # chemx-bypass: nothing to bypass');
  assert.equal(idle.overrode, false);
});

test('every printed chemx call is itself allowed', () => {
  const SUGGESTED = [
    'chemx patch src/a.ts', 'chemx write docs/n.md --append - <<\'EOF\'', 'chemx test cli/a.spec.js -t "x"', 'chemx show HEAD --patch',
    'chemx read abc:src/a.ts', 'chemx f ".spec.js"', 'chemx q -g "foo" --dir=src/a.js', 'chemx status', 'chemx commit', 'chemx wait',
  ];
  for (const command of SUGGESTED) assert.equal(toPreToolOutput(decide(command)), null, command);
});

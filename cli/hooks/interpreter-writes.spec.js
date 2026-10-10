// #4585: inline interpreter scripts that write repo files. Pure: payload fixtures, no repo, no db.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePreTool } from './claude-pre-tool.js';
import { interpreterWrites } from './interpreter-writes.js';
import { invocationsOf } from '../team/audit-run-invocations.js';
import { shellWritesOf } from '../team/audit-run-bypass.js';

const CONTEXT = { cwd: '/repo', root: '/repo', enforceSearch: true, hasChemxCommand: () => true, nudgePromotion: { all: false, ids: [] } };
const decide = (command) => decidePreTool({ tool_name: 'Bash', tool_input: { command } }, CONTEXT);

// The real bypass of validation-3 build:#4514 (wf_64cdde6b-057).
const BYPASS_4514 = [
  'export CHEMX_AGENT_ID=@validation-3-4514 && python3 - <<\'E\'',
  'p="cli/hooks/guard-route.js"; s=open(p).read(); s=s.replace("a","b"); open(p,"w").write(s)',
  't=open("cli/hooks/guard-route.spec.js").read(); t+="x"',
  'E',
].join('\n');

test('the #4514 python heredoc is denied and names chemx patch and chemx write for the file', () => {
  const result = decide(BYPASS_4514);
  assert.equal(result.decision, 'deny');
  assert.equal(result.rule, 'shell-interpreter-write');
  assert.match(result.reason, /chemx patch cli\/hooks\/guard-route\.js/);
  assert.match(result.reason, /chemx write cli\/hooks\/guard-route\.js/);
});

test('write APIs of node, ruby and perl with a literal repo target are denied', () => {
  const denied = [
    ['node -e "require(\'fs\').writeFileSync(\'src/a.js\', \'x\')"', /src\/a\.js/],
    ['node --eval "const f = \'src/b.js\'; fs.appendFileSync(f, \'x\')"', /src\/b\.js/],
    ['ruby -e "File.write(\'src/c.rb\', \'x\')"', /src\/c\.rb/],
    ['perl -e \'open(F, ">>", "src/d.pl"); print F 1\'', /src\/d\.pl/],
    ['python3 -c "import shutil; shutil.copy(\'/tmp/x\', \'src/e.py\')"', /src\/e\.py/],
    ['python3 - <<E\nfrom pathlib import Path\nq = Path(\'docs/f.md\')\nq.write_text(\'a\')\nE', /docs\/f\.md/],
  ];
  for (const [command, pattern] of denied) {
    const result = decide(command);
    assert.equal(result.decision, 'deny', command);
    assert.match(result.reason, pattern, command);
  }
});

test('scratch targets and read-only scripts are allowed', () => {
  const allowed = [
    'node -e "require(\'fs\').writeFileSync(\'/tmp/x\', \'a\')"',
    'python3 - <<E\nprint(open("cli/hooks/guard-route.js").read())\nE',
    'python3 -c "open(\'/tmp/out.txt\', \'w\').write(\'a\')"',
    'node -e "console.log(require(\'fs\').readFileSync(\'src/a.js\', \'utf8\'))"',
  ];
  for (const command of allowed) assert.equal(decide(command).decision, 'allow', command);
});

test('a computed target in a script that names a repo path is advice, not a deny', () => {
  const result = decide('python3 - <<E\nimport sys\nopen(sys.argv[1], "w").write(open("cli/a.js").read())\nE');
  assert.equal(result.decision, 'allow');
  assert.deepEqual(result.nudged, ['shell-interpreter-write-unverified']);
});

test('the detector resolves same-script variables and reports computed targets as unresolved', () => {
  const found = interpreterWrites(['node', '-e', 'const p = "a/b.js"; fs.writeFileSync(p, 1); fs.writeFileSync(x + "y", 2)']);
  assert.deepEqual(found.targets, ['a/b.js']);
  assert.equal(found.unresolved, 1);
  assert.equal(interpreterWrites(['git', 'status']).isInterpreter, false);
});

test('a script file created on the same line is read when the caller passes it', () => {
  const found = interpreterWrites(['python3', 'run.py'], [], { 'run.py': 'open("src/g.py", "a").write("x")' });
  assert.deepEqual(found.targets, ['src/g.py']);
});

test('timeout/nice wrappers, open(file=, mode=), deno eval and Bun.write are detected (#4585 review)', () => {
  const denied = [
    `timeout 5 python3 -c "open('cli/a.js','w').write('x')"`,
    `nice -n 5 python3 -c "open('cli/a.js','w').write('x')"`,
    `python3 -c "open(file='cli/a.js', mode='w').write('x')"`,
    `deno eval "Deno.writeTextFileSync('cli/a.js','x')"`,
    `bun -e "Bun.write('cli/a.js','x')"`,
  ];
  for (const command of denied) assert.equal(decide(command).decision, 'deny', command);
  assert.notEqual(decide(`timeout 5 node -e "fs.writeFileSync('/tmp/x',1)"`).decision, 'deny');
});

test('audit-run counts the #4514 call as a shell write into a repo file', () => {
  const root = '/work/repo';
  const invs = invocationsOf({ name: 'Bash', at: 1, cwd: root, input: { command: BYPASS_4514 } });
  const writes = invs.flatMap((inv) => shellWritesOf(inv, [root], '/home/nobody'));
  assert.deepEqual(writes.map((w) => [w.how, w.target]), [['interpreter script', `${root}/cli/hooks/guard-route.js`]]);
  const scratch = invocationsOf({ name: 'Bash', at: 1, cwd: root, input: { command: 'node -e "fs.writeFileSync(\'/tmp/x\', 1)"' } });
  assert.equal(scratch.flatMap((inv) => shellWritesOf(inv, [root], '/home/nobody')).length, 0);
});

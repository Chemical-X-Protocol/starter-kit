import test from 'node:test';
import assert from 'node:assert';
import { extractInvocations, tokenize } from './extract.js';

const wordsOf = (markdown) => extractInvocations(markdown).map((inv) => inv.words ?? inv.action);

test('extract: an inline code span that starts with chemx is an invocation with its line', () => {
  const found = extractInvocations('intro\nRun `chemx team task claim 5 --as=@spec-a` now.');
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].line, 2);
  assert.deepStrictEqual(found[0].words, ['team', 'task', 'claim', '5']);
});

test('extract: positional words stop at the first flag, quoted argument or placeholder boundary', () => {
  assert.deepStrictEqual(wordsOf('`chemx q -g needle -l`'), [['q']]);
  assert.deepStrictEqual(wordsOf('`chemx read "a b.js" --outline`'), [['read']]);
  assert.deepStrictEqual(wordsOf('`chemx build -- vite build`'), [['build']]);
});

test('extract: prose that only mentions chemx is not a command', () => {
  assert.deepStrictEqual(extractInvocations('Use `the chemx tool` or `chemx` alone, see `.chemx/index.db`.'), []);
  assert.deepStrictEqual(extractInvocations('`chemx root: <dir> (source)` is printed output'), []);
});

test('extract: shell fences read command segments, env prefixes, pnpm and chained commands', () => {
  const md = ['```bash', '$ CHEMX_AGENT_ID=@spec-a chemx verify', 'pnpm chemx test && chemx lint --fix', 'export X=1   # chemx honors it', '```'].join('\n');
  const found = extractInvocations(md);
  assert.deepStrictEqual(found.map((f) => f.words), [['verify'], ['test'], ['lint']]);
  assert.deepStrictEqual(found.map((f) => f.line), [2, 3, 3]);
});

test('extract: non-shell fences are scanned for MCP calls only', () => {
  const md = ['```js', 'chemx({ action: "read", params: { path: "a" } })', 'const x = "chemx nonsense";', '```'].join('\n');
  const found = extractInvocations(md);
  assert.deepStrictEqual(found.map((f) => f.kind), ['mcp']);
  assert.strictEqual(found[0].action, 'read');
});

test('extract: an MCP call spread over lines takes the action that follows the opening', () => {
  const md = ['```js', 'chemx({', '  action: "patch",', '})', '```'].join('\n');
  assert.deepStrictEqual(extractInvocations(md).map((f) => f.action), ['patch']);
});

test('extract: command and commands strings inside an MCP call are CLI invocations', () => {
  const md = '`chemx({ command: "test -t x" })` and `chemx({ commands: ["q -g foo", "p -s"] })`';
  assert.deepStrictEqual(extractInvocations(md).map((f) => f.words), [['test'], ['q'], ['p']]);
});

test('extract: chemx do runs each quoted argument as a chemx command', () => {
  const found = extractInvocations('`chemx do "d" "team status"`');
  assert.deepStrictEqual(found.map((f) => f.words), [['do'], ['d'], ['team', 'status']]);
});

test('extract: tokenize keeps quoted words whole and stops at a comment', () => {
  const words = tokenize('read "a b" -s # why');
  assert.deepStrictEqual(words.map((w) => w.text), ['read', 'a b', '-s']);
  assert.deepStrictEqual(words.map((w) => w.quoted), [false, true, false]);
});

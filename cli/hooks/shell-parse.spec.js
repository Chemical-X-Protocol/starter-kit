import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShell } from './shell-parse.js';

const argvs = (source) => parseShell(source).commands.map((command) => command.argv);

test('splits on pipes, &&, ||, ; and newlines', () => {
  assert.deepEqual(argvs('a 1 | b && c || d; e\nf'), [['a', '1'], ['b'], ['c'], ['d'], ['e'], ['f']]);
});

test('removes quotes and keeps quoted operators inside one word', () => {
  assert.deepEqual(argvs(`echo 'a | b' "c && d" e\\ f`), [['echo', 'a | b', 'c && d', 'e f']]);
  assert.deepEqual(argvs("printf '' x"), [['printf', '', 'x']]);
});

test('heredoc bodies are data, and commands after the delimiter still parse', () => {
  const { commands } = parseShell("cat <<'EOF' > out.txt\npnpm vitest\nEOF\ngit log");
  assert.deepEqual(commands.map((command) => command.argv), [['cat'], ['git', 'log']]);
  const heredoc = commands[0].redirects.find((redirect) => redirect.op === '<<');
  assert.deepEqual([heredoc.target, heredoc.body], ['EOF', 'pnpm vitest']);
  assert.deepEqual(argvs('cat <<-END\n\tvitest\n\tEND\nls'), [['cat'], ['ls']]);
});

test('subshells, $(...), backticks and process substitution are recursed', () => {
  assert.deepEqual(argvs('(cd x && npm test)'), [['cd', 'x'], ['npm', 'test']]);
  assert.deepEqual(argvs('echo "$(git log -1)" `date`').slice(1), [['git', 'log', '-1'], ['date']]);
  assert.deepEqual(argvs('diff <(sort a) b').slice(1), [['sort', 'a']]);
  assert.deepEqual(argvs('echo $((1 + 2))'), [['echo', '$((1 + 2))']]);
});

test('bash -c and eval scripts are parsed as commands', () => {
  assert.deepEqual(argvs("bash -lc 'tsc -p .'").slice(1), [['tsc', '-p', '.']]);
  assert.deepEqual(argvs('eval "npm run lint"').slice(1), [['npm', 'run', 'lint']]);
});

test('env prefixes become assignments; redirections keep fd, op and target', () => {
  const [command] = parseShell('NODE_ENV=test FOO="a b" node x.js 2>&1 >> log.txt < in.txt').commands;
  assert.deepEqual(command.assigns, ['NODE_ENV=test', 'FOO=a b']);
  assert.deepEqual(command.argv, ['node', 'x.js']);
  assert.deepEqual(command.redirects.map(({ fd, op, target }) => [fd, op, target]), [['2', '>&', '1'], [null, '>>', 'log.txt'], [null, '<', 'in.txt']]);
});

test('for, case and control keywords never put list words in command position', () => {
  assert.deepEqual(argvs('for x in vitest jest; do echo $x; done'), [['echo', '$x']]);
  assert.deepEqual(argvs('if [ -f a ]; then tsc; fi'), [['[', '-f', 'a', ']'], ['tsc']]);
  assert.deepEqual(argvs('while read f; do wc -l "$f"; done'), [['read', 'f'], ['wc', '-l', '$f']]);
});

test('comments are collected separately and # inside a word is not a comment', () => {
  const parsed = parseShell('echo a#b # chemx-bypass: reason\nls');
  assert.deepEqual(parsed.commands.map((command) => command.argv), [['echo', 'a#b'], ['ls']]);
  assert.deepEqual(parsed.comments, [' chemx-bypass: reason']);
});

test('unterminated quotes and substitutions do not throw', () => {
  assert.doesNotThrow(() => parseShell('echo "abc $(ls'));
  assert.doesNotThrow(() => parseShell("echo 'abc"));
  assert.doesNotThrow(() => parseShell('cat <<EOF\nno end'));
});

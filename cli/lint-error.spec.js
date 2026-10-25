import test from 'node:test';
import assert from 'node:assert/strict';
import { lintFailureLine } from './lint-error.js';

const ESLINT_6_NO_CONFIG = `
Oops! Something went wrong! :(

ESLint: 6.4.0.

ESLint couldn't find a configuration file. To set up a configuration file for this project, please run:

    eslint --init

ESLint looked for configuration files in /repo and its ancestors. If it found none, it then looked in your home directory.
`;

test('lint-error: the "Oops" banner and the version line give way to the underlying error', () => {
  assert.equal(lintFailureLine(ESLINT_6_NO_CONFIG, ''), "ESLint couldn't find a configuration file.");
});

test('lint-error: a stack-less module error keeps its own first line', () => {
  const stderr = "\nOops! Something went wrong! :(\n\nESLint: 9.1.0\n\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'globals' imported from /r/eslint.config.js\n    at foo\n";
  assert.equal(lintFailureLine('', stderr), "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'globals' imported from /r/eslint.config.js");
});

test('lint-error: a flat config met by an ESLint older than 9 names the version and the fix', () => {
  const line = lintFailureLine(ESLINT_6_NO_CONFIG, '', { flatConfig: '/repo/eslint.config.js' });
  assert.match(line, /eslint\.config\.js needs ESLint 9 or newer/);
  assert.match(line, /resolved ESLint 6\.4\.0/);
  assert.match(line, /install eslint@9/);
});

test('lint-error: a flat config and a new enough ESLint keep the real message', () => {
  const line = lintFailureLine('', 'Oops! Something went wrong! :(\n\nESLint: 9.39.5\n\nTypeError: bad rule option\n', { flatConfig: '/repo/eslint.config.js' });
  assert.equal(line, 'TypeError: bad rule option');
});

test('lint-error: output that is only noise falls back to the exit code', () => {
  assert.equal(lintFailureLine('', '', { exitCode: 2 }), 'Command exited with code 2');
  assert.equal(lintFailureLine('Oops! Something went wrong! :(\n', '', { exitCode: 2 }), 'Command exited with code 2');
});

test('lint-error: a short line stays whole; a long one is cut at its first sentence, then at 200 characters', () => {
  assert.equal(lintFailureLine('Error: one. two three', ''), 'Error: one. two three');
  const sentence = `Error: ${'x'.repeat(80)}.`;
  assert.equal(lintFailureLine(`${sentence} And advice that follows.`, ''), sentence);
  assert.equal(lintFailureLine(`Error: ${'x'.repeat(400)}`, '').length, 200);
});

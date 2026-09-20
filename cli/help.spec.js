import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { COMMANDS_SCHEMA } from './commands-schema.js';
import { printHelp } from './help.js';

test('commands-schema: contains all 9 core chemical-x CLI commands', () => {
  const expected = ['search', 'read', 'patch', 'mcp', 'build', 'audit', 'generate', 'team', 'verify'];
  const actual = COMMANDS_SCHEMA.map((c) => c.name);

  for (const exp of expected) {
    assert.ok(actual.includes(exp), `Command schema must include ${exp}`);
  }

  for (const cmd of COMMANDS_SCHEMA) {
    assert.ok(cmd.name, 'Command must have a name');
    assert.ok(cmd.usage, `Command ${cmd.name} must have usage`);
    assert.ok(cmd.summary, `Command ${cmd.name} must have summary`);
    assert.ok(Array.isArray(cmd.flags), `Command ${cmd.name} must have flags array`);
    assert.ok(Array.isArray(cmd.examples), `Command ${cmd.name} must have examples array`);
  }
});

test('help: printHelp renders without throwing', () => {
  assert.doesNotThrow(() => {
    printHelp();
  });
});

test('cli: unknown command exits immediately with code 1 and error message', () => {
  const cliPath = path.resolve('cli/index.js');
  const bogusInputs = ['config', 'foo', '--bogus'];

  for (const input of bogusInputs) {
    const startTime = Date.now();
    const res = spawnSync(process.execPath, [cliPath, input], {
      encoding: 'utf8',
      timeout: 2000
    });
    const elapsed = Date.now() - startTime;

    assert.ok(elapsed < 2000, `Command chemx ${input} took ${elapsed}ms, expected < 2000ms`);
    assert.strictEqual(res.status, 1, `chemx ${input} should exit with code 1`);
    assert.ok(
      res.stderr.includes(`Unknown command "${input}"`),
      `chemx ${input} stderr should include Unknown command "${input}"`
    );
  }
});

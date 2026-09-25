import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS_SCHEMA } from './commands-schema.js';
import { printHelp, printInitHelp, printScaffoldHelp } from './help.js';

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
    assert.strictEqual(
      fs.existsSync(path.resolve(input)),
      false,
      `chemx ${input} must not create file or directory on disk`
    );
  }
});

test('help: printInitHelp and printScaffoldHelp render without throwing', () => {
  assert.doesNotThrow(() => {
    printInitHelp();
  });
  assert.doesNotThrow(() => {
    printScaffoldHelp();
  });
});

test('cli: chemx init --help and -h display usage and do not scaffold /--help/ on disk', () => {
  const cliPath = path.resolve('cli/index.js');
  const helpFlags = ['--help', '-h', 'help'];

  for (const flag of helpFlags) {
    const res = spawnSync(process.execPath, [cliPath, 'init', flag], {
      encoding: 'utf8',
      timeout: 5000
    });

    assert.strictEqual(res.status, 0, `chemx init ${flag} should exit with code 0`);
    assert.ok(
      res.stdout.includes('chemx init') && res.stdout.includes('USAGE'),
      `chemx init ${flag} output should include usage instructions`
    );
    assert.strictEqual(
      fs.existsSync(path.resolve(flag)),
      false,
      `chemx init ${flag} must not create directory "${flag}" on disk`
    );
  }
});

test('cli: chemx create --help and scaffold -h display usage', () => {
  const cliPath = path.resolve('cli/index.js');
  const commands = [
    ['create', '--help'],
    ['scaffold', '-h']
  ];

  for (const [cmd, flag] of commands) {
    const res = spawnSync(process.execPath, [cliPath, cmd, flag], {
      encoding: 'utf8',
      timeout: 5000
    });

    assert.strictEqual(res.status, 0, `chemx ${cmd} ${flag} should exit with code 0`);
    assert.ok(
      res.stdout.includes('USAGE') && (res.stdout.includes('create chemx') || res.stdout.includes('chemx create')),
      `chemx ${cmd} ${flag} output should include scaffolder usage instructions`
    );
  }
});

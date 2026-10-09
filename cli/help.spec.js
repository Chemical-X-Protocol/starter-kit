import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { COMMANDS_SCHEMA, ROUTABLE_COMMAND_TOKENS, findCommandSchema } from './commands-schema.js';
import { printHelp, printInitHelp, printScaffoldHelp, formatTopLevelHelp, resolveCommandHelpTopic } from './help.js';

const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'index.js');

const runPiped = (args, cwd) => new Promise((resolve) => {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  const child = spawn(process.execPath, [CLI, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status, signal) => { clearTimeout(timer); resolve({ args, status, signal, stdout, stderr }); });
});

const runAllPiped = async (argLists, cwd, parallel = 8) => {
  const results = [];
  const queue = [...argLists];
  const worker = async () => {
    while (queue.length > 0) results.push(await runPiped(queue.shift(), cwd));
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return results;
};

test('help: top-level help is generated from the schema and stays under 1,500 bytes', () => {
  const text = formatTopLevelHelp();
  assert.ok(Buffer.byteLength(text) < 1500, `top-level help is ${Buffer.byteLength(text)} bytes`);
  for (const entry of COMMANDS_SCHEMA) {
    assert.ok(text.includes(entry.brief), `top-level help must list ${entry.name}`);
  }
  assert.doesNotMatch(text, /\x1b\[/);
});

test('help: every routable token resolves to a schema entry and to its own --help', () => {
  for (const token of ROUTABLE_COMMAND_TOKENS) {
    assert.ok(findCommandSchema(token), `${token} has a schema entry`);
    assert.strictEqual(resolveCommandHelpTopic(token, [token, '--help']), token);
  }
  assert.strictEqual(resolveCommandHelpTopic('q', ['q', 'needle']), null);
  assert.strictEqual(resolveCommandHelpTopic('build', ['build', '--', 'tool', '--help']), null);
  assert.strictEqual(resolveCommandHelpTopic('team', ['team', 'task', '--help']), null, 'team owns subcommand help');
});

test('help: a lone "help" is data for pattern lookups, a help request everywhere else', () => {
  for (const token of ['f', 'ls', 'p', 'q', 'trace', 'backtrace']) {
    assert.strictEqual(resolveCommandHelpTopic(token, [token, 'help']), null, `chemx ${token} help looks up "help"`);
  }
  for (const token of ['read', 'j', 'check', 'd', 'log', 'do', 'test', 'lint', 'audit', 'init', 'create', 'generate', 'write', 'patch', 'explode', 'hook', 'verify', 'typecheck', 'build', 'team']) {
    assert.strictEqual(resolveCommandHelpTopic(token, [token, 'help']), token, `chemx ${token} help prints usage`);
  }
});

// End to end: the router is the only help authority, so a handler never re-reads
// `help` or `-h` from argv after the router decided they are data.
test('help: lookup data and help requests behave the same end to end', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-help-data-'));
  fs.mkdirSync(path.join(sandbox, 'src'));
  fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(sandbox, 'src', 'help.js'), "export const help = () => '-h';\n");
  const dataRuns = [['q', 'help'], ['q', '-g', '-h'], ['q', '--literal', '-h'], ['q', '-s', '-h'], ['f', 'help'], ['read', 'src/help.js', '-s', '-h']];
  const helpRuns = [['read', 'help'], ['j', 'help'], ['d', 'help'], ['log', 'help'], ['test', 'help'], ['lint', 'help'], ['audit', 'help']];
  const results = await runAllPiped([...dataRuns, ...helpRuns], sandbox, 4);
  const hasIssueDir = fs.existsSync(path.join(sandbox, '.chemx', 'issues'));
  fs.rmSync(sandbox, { recursive: true, force: true });

  for (const r of results) {
    const label = `chemx ${r.args.join(' ')}`;
    const isDataRun = dataRuns.includes(r.args);
    assert.strictEqual(r.signal, null, `${label} was killed`);
    assert.doesNotMatch(r.stderr, /Command Failed|is not defined/, `${label} crashed: ${r.stderr.slice(0, 200)}`);
    if (isDataRun) assert.doesNotMatch(r.stdout, /^USAGE/, `${label} must treat help/-h as data`);
    if (!isDataRun) assert.match(r.stdout, /^USAGE\n/, `${label} must print usage`);
    if (!isDataRun) assert.strictEqual(r.status, 0, `${label} exited ${r.status}`);
  }
  assert.strictEqual(hasIssueDir, false, 'no run may file a crash issue into the project');
});

test('help: -h that is the value of a pattern or count flag is data, not a help request', () => {
  assert.strictEqual(resolveCommandHelpTopic('q', ['q', '-g', '-h']), null);
  assert.strictEqual(resolveCommandHelpTopic('q', ['q', '--literal', '-h']), null);
  assert.strictEqual(resolveCommandHelpTopic('read', ['read', 'a.js', '-s', '-h']), null);
  assert.strictEqual(resolveCommandHelpTopic('q', ['q', 'needle', '-h']), 'q');
  assert.strictEqual(resolveCommandHelpTopic('write', ['write', 'a.js', '--content=x', '--help']), 'write');
});

test('help: command matrix: every `<command> --help` prints usage, exits 0, runs nothing', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-help-matrix-'));
  fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fx', scripts: { build: 'node -e "require(\'fs\').writeFileSync(\'BUILD_RAN\',\'1\')"' } }));
  const argLists = [...ROUTABLE_COMMAND_TOKENS.map((token) => [token, '--help']), ['m-card', '-h'], ['help', 'read'], ['init', 'help'], ['generate', 'help']];
  const results = await runAllPiped(argLists, sandbox);
  const entries = fs.readdirSync(sandbox);
  fs.rmSync(sandbox, { recursive: true, force: true });

  for (const r of results) {
    const label = `chemx ${r.args.join(' ')}`;
    assert.strictEqual(r.status, 0, `${label} exited ${r.status} (${r.signal ?? ''}): ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /^USAGE\n {2}\S/, `${label} prints usage first`);
    assert.doesNotMatch(r.stdout + r.stderr, /\x1b\[/, `${label} is ANSI-free when piped`);
  }
  assert.deepStrictEqual(entries, ['package.json'], 'no command may act or write files when asked for --help');
});

test('help: `chemx help <unknown>` fails with a pointer to the command list', async () => {
  const [r] = await runAllPiped([['help', 'definitely-not-a-command']], os.tmpdir(), 1);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Unknown command "definitely-not-a-command"/);
});

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

test('commands-schema: each schema data module stays under the 150-line lexicon guideline', () => {
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const modules = fs.readdirSync(cliDir).filter((name) => /^commands-schema.*\.js$/.test(name) && !name.endsWith('.spec.js'));
  assert.ok(modules.length >= 5, `found ${modules.join(', ')}`);
  const oversized = modules
    .map((name) => [name, fs.readFileSync(path.join(cliDir, name), 'utf8').split('\n').length - 1])
    .filter(([, lines]) => lines > 150);
  assert.deepStrictEqual(oversized, []);
});

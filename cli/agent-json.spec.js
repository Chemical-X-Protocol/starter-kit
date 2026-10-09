import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatAgentJson, formatDiagnosticRow } from './agent-json.js';
import { runCli } from './spec-support/run-cli.js';

const ESC = '\x1b';

const TSC_ERRORS = [
  "src/stores/cart.store.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/stores/cart.store.ts(40,15): error TS2339: Property 'total' does not exist on type 'CartState'.",
  "src/components/m-cart/m-cart.vue(8,3): error TS2304: Cannot find name 'useCart'.",
  "src/components/m-cart/m-cart.vue(21,9): error TS7006: Parameter 'item' implicitly has an 'any' type.",
  "src/routes/router.ts(5,1): error TS1005: ';' expected.",
  "src/routes/router.ts(77,30): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  "src/app.ts(3,10): error TS2305: Module './api' has no exported member 'fetchUser'."
];

// success, exitCode, command, durationMs and errorCount: the fixed cost of any --json report.
const ENVELOPE_BUDGET_BYTES = 120;

const makeProject = (errorLines = TSC_ERRORS) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-json-ratio-'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'spec'));
  // Colored like a forced-color child would print it, to prove ANSI never reaches the payload.
  const colored = errorLines.map((line) => `${ESC}[96m${line.split('(')[0]}${ESC}[0m(${line.split('(').slice(1).join('(')}`);
  fs.writeFileSync(path.join(dir, 'tc.cjs'), `process.stdout.write(${JSON.stringify(`${colored.join('\n')}\n\nFound ${errorLines.length} errors.\n`)}); process.exit(2);\n`);
  fs.writeFileSync(path.join(dir, 'spec', 'math.spec.cjs'), [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "test('adds', () => assert.strictEqual(1 + 1, 2));",
    "test('subtracts', () => assert.strictEqual(5 - 3, 1));",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'ratio', version: '1.0.0',
    scripts: { typecheck: 'node tc.cjs', test: 'node --test spec/' }
  }));
  return dir;
};

// Raw output as a user sees it: outside this spec's node:test harness (NODE_TEST_CONTEXT would
// make a nested `node --test` report to the parent and print almost nothing), like chemx's child.
const rawBytes = (dir, command) => {
  const { NODE_TEST_CONTEXT, ...userEnv } = process.env;
  const res = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', env: { ...userEnv, FORCE_COLOR: '0' } });
  return Buffer.byteLength(`${res.stdout}${res.stderr}`);
};

test('agent json: diagnostics become compact "file:line:col CODE message" rows, ANSI stripped', () => {
  const rows = [
    { category: 'TYPE_ERROR', severity: 'ERROR', file: `${ESC}[96msrc/a.ts${ESC}[0m`, line: 1, column: 5, code: 'TS2322', message: 'bad', suggestion: 'Review TypeScript compiler diagnostic.' },
    { severity: 'WARNING', file: 'src/a.ts', line: 9, column: 1, code: 'TS6133', message: 'unused' }
  ];
  assert.strictEqual(formatDiagnosticRow(rows[0]), 'src/a.ts:1:5 TS2322 bad');
  const json = formatAgentJson({ success: false, executionError: null, errors: rows, note: `${ESC}[31mred${ESC}[0m` });
  assert.strictEqual(json, '{"success":false,"errors":["src/a.ts:1:5 TS2322 bad","src/a.ts:9:1 warning TS6133 unused"],"note":"red"}');
});

test('agent json: errors is always an array, one entry per diagnostic, empty or not', () => {
  const none = JSON.parse(formatAgentJson({ success: true, errors: [] }));
  const one = JSON.parse(formatAgentJson({ success: false, errors: [{ file: 'a.ts', line: 1, message: 'x' }] }));
  assert.ok(Array.isArray(none.errors) && Array.isArray(one.errors), 'same type with and without diagnostics');
  assert.strictEqual(none.errors.length, 0);
  assert.strictEqual(one.errors.length, 1);
  assert.strictEqual(one.errors[0], 'a.ts:1 x');
});

test('agent json: typecheck and test --json are never larger than the raw tool output', () => {
  const dir = makeProject();
  const cases = [
    { args: ['typecheck', '--json'], raw: 'node tc.cjs' },
    { args: ['test', '--json'], raw: 'node --test spec/' }
  ];
  for (const { args, raw } of cases) {
    const run = runCli(args, { cwd: dir, timeout: 60000 });
    const jsonBytes = Buffer.byteLength(run.stdout);
    const rawSize = rawBytes(dir, raw);
    assert.doesNotThrow(() => JSON.parse(run.stdout), `chemx ${args.join(' ')} emits one JSON document`);
    assert.ok(!run.stdout.includes('\\u001b') && !run.stdout.includes(ESC), `chemx ${args.join(' ')} JSON carries ANSI`);
    assert.ok(jsonBytes <= rawSize, `chemx ${args.join(' ')}: ${jsonBytes} JSON bytes > ${rawSize} raw bytes`);
  }
  const typecheck = JSON.parse(runCli(['typecheck', '--json'], { cwd: dir }).stdout);
  assert.strictEqual(typecheck.errorCount, 7);
  assert.strictEqual(typecheck.errors.length, 7);
  assert.deepStrictEqual(typecheck.errors.slice(4, 6), ["src/routes/router.ts:5:1 TS1005 ';' expected.", "src/routes/router.ts:77:30 TS2345 Argument of type 'number' is not assignable to parameter of type 'string'."]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test(`agent json: with one error the report is at most the raw output plus a ${ENVELOPE_BUDGET_BYTES}-byte envelope`, () => {
  const dir = makeProject(TSC_ERRORS.slice(0, 1));
  const run = runCli(['typecheck', '--json'], { cwd: dir, timeout: 60000 });
  const report = JSON.parse(run.stdout);
  assert.strictEqual(report.errorCount, 1);
  const rowBytes = Buffer.byteLength(report.errors[0]);
  assert.ok(rowBytes < Buffer.byteLength(TSC_ERRORS[0]), `a diagnostic row (${rowBytes} bytes) is shorter than its raw tsc line`);
  const jsonBytes = Buffer.byteLength(run.stdout);
  const rawSize = rawBytes(dir, 'node tc.cjs');
  assert.ok(jsonBytes <= rawSize + ENVELOPE_BUDGET_BYTES, `${jsonBytes} JSON bytes > ${rawSize} raw + ${ENVELOPE_BUDGET_BYTES} envelope`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agent json: colored "pretty" tsc output still parses into diagnostics', async () => {
  const { parseTypecheckOutput } = await import('./verify-helpers.js');
  const pretty = `${ESC}[96msrc/a.ts${ESC}[0m:${ESC}[93m1${ESC}[0m:${ESC}[93m5${ESC}[0m - ${ESC}[91merror${ESC}[0m${ESC}[90m TS2322: ${ESC}[0mType 'string' is not assignable to type 'number'.\n`;
  const [diagnostic] = parseTypecheckOutput(pretty, '');
  assert.ok(diagnostic, 'the colored diagnostic is recognized');
  assert.strictEqual(diagnostic.file, 'src/a.ts');
  assert.strictEqual(diagnostic.code, 'TS2322');
});

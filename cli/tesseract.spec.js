import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runTesseract } from './tesseract.js';
import { handleChemxTesseract } from './mcp/tools.js';

test('tesseract: programmatic execution returns cognitive payload and HUD text', async () => {
  const result = await runTesseract([], false);
  assert.ok(result.text, 'Result must contain rendered text HUD');
  assert.ok(result.text.includes('TESSERACT'), 'Text must mention TESSERACT');
  assert.ok(result.payload, 'Result must include structured payload');
  assert.strictEqual(result.payload.protocol, 'Chemical X Tesseract');
  assert.ok(result.payload.directives.length >= 7, 'Must have at least 7 directives');
  assert.ok(result.payload.jarvisOperations.length >= 5, 'Must have at least 5 Jarvis operations');
});

test('tesseract: json mode returns structured cognitive state', async () => {
  const payload = await runTesseract(['--json'], false);
  assert.strictEqual(payload.protocol, 'Chemical X Tesseract');
  assert.ok(payload.state, 'Payload must contain state');
  assert.strictEqual(typeof payload.state.connected, 'boolean');
  assert.ok(payload.state.stats, 'State must contain stats');
});

test('tesseract: cli command execution succeeds with exit code 0', () => {
  const cliPath = path.resolve('cli/index.js');
  const res = spawnSync(process.execPath, [cliPath, 'tesseract'], {
    encoding: 'utf8',
    timeout: 15000
  });

  assert.strictEqual(res.status, 0, 'CLI tesseract should exit with 0');
  assert.ok(res.stdout.includes('TESSERACT'), 'CLI stdout should render Tesseract header');
  assert.ok(res.stdout.includes('JARVIS PROTOCOL ACTIVE'), 'CLI stdout should include Jarvis protocol');
});

test('tesseract: cli aliases cube and matrix work identically', () => {
  const cliPath = path.resolve('cli/index.js');
  for (const alias of ['cube', 'matrix']) {
    const res = spawnSync(process.execPath, [cliPath, alias], {
      encoding: 'utf8',
      timeout: 15000
    });
    assert.strictEqual(res.status, 0, `CLI ${alias} should exit with 0`);
    assert.ok(res.stdout.includes('TESSERACT'), `CLI ${alias} should render Tesseract`);
  }
});

test('tesseract: MCP handler returns formatted text content', async () => {
  const res = await handleChemxTesseract();
  assert.ok(Array.isArray(res.content), 'MCP result must have content array');
  assert.strictEqual(res.content[0].type, 'text');
  assert.ok(res.content[0].text.includes('TESSERACT'));
});

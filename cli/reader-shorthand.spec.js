import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readTokenOptimized, runReaderCli } from './reader.js';
import { ALLOWED_COMMANDS } from './index.js';
import { handleChemx } from './mcp/tools.js';

describe('Reader Shorthand Syntax', () => {
  it('includes r in ALLOWED_COMMANDS', () => {
    assert.ok(ALLOWED_COMMANDS.has('r'), 'ALLOWED_COMMANDS should include "r"');
  });

  it('supports path:start-end line range in readTokenOptimized', () => {
    const res = readTokenOptimized('package.json:1-5');
    assert.equal(res.file, 'package.json');
    assert.equal(res.startLine, 1);
    assert.equal(res.endLine, 5);
    assert.equal(res.lineCount, 5);
  });

  it('supports path:start:end line range in readTokenOptimized', () => {
    const res = readTokenOptimized('package.json:2:6');
    assert.equal(res.file, 'package.json');
    assert.equal(res.startLine, 2);
    assert.equal(res.endLine, 6);
  });

  it('supports runReaderCli with -o outline flag', () => {
    const res = runReaderCli(['cli/commands/cmd-router.js', '-o'], false);
    assert.ok(res);
    assert.equal(res.mode, 'outline');
    assert.ok(res.content.includes('export function dispatchCommand'));
  });

  it('supports runReaderCli with -s symbol flag', () => {
    const res = runReaderCli(['cli/commands/cmd-router.js', '-s', 'dispatchCommand'], false);
    assert.ok(res);
    assert.equal(res.mode, 'symbol');
    assert.equal(res.symbol, 'dispatchCommand');
  });

  it('supports runReaderCli with path:start-end colon range', () => {
    const res = runReaderCli(['package.json:1-4'], false);
    assert.ok(res);
    assert.equal(res.startLine, 1);
    assert.equal(res.endLine, 4);
    assert.equal(res.lineCount, 4);
  });

  it('supports MCP chemx({ action: "r" })', async () => {
    const output = await handleChemx({ action: 'r', params: { path: 'package.json:1-3' } });
    assert.ok(output.includes('package.json'));
    assert.ok(output.includes('"name": "@chemx/starter-kit"'));
  });

  it('supports MCP chemx({ command: "r path:1-3" })', async () => {
    const output = await handleChemx({ command: 'r package.json:1-3' });
    assert.ok(output.includes('package.json'));
    assert.ok(output.includes('"name": "@chemx/starter-kit"'));
  });
});

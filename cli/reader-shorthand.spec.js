import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readTokenOptimized, runReaderCli } from './reader.js';
import { ALLOWED_COMMANDS } from './index.js';
import { handleChemx } from './mcp/tools.js';

describe('Reader Shorthand Syntax', () => {
  it('includes r in ALLOWED_COMMANDS', () => {
    assert.ok(ALLOWED_COMMANDS.has('r'), 'ALLOWED_COMMANDS should include "r"');
  });

  it('caps a slice at the configured read window, the same one the auto-outline uses', () => {
    const res = readTokenOptimized('AGENTS.md', { startLine: 1, endLine: 60, autoOutlineThreshold: 20 });
    assert.equal(res.endLine, 20);
    assert.match(res.trailer, /Truncated at the 20-line chemx read window/);
    assert.equal(res.lineCount, 20, "the truncation notice is not counted as a content line");
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
    assert.ok(output.includes('"name":'));
  });

  it('supports MCP chemx({ command: "r path:1-3" })', async () => {
    const output = await handleChemx({ command: 'r package.json:1-3' });
    assert.ok(output.includes('package.json'));
    assert.ok(output.includes('"name":'));
  });

  describe('K7 read improvements (#6752)', () => {
    it('supports --lines a-b and --lines=a-b in runReaderCli and readTokenOptimized', () => {
      const resSpaced = runReaderCli(['package.json', '--lines', '2-5'], false);
      assert.ok(resSpaced);
      assert.equal(resSpaced.startLine, 2);
      assert.equal(resSpaced.endLine, 5);
      assert.equal(resSpaced.lineCount, 4);

      const resEquals = runReaderCli(['package.json', '--lines=3-6'], false);
      assert.ok(resEquals);
      assert.equal(resEquals.startLine, 3);
      assert.equal(resEquals.endLine, 6);
      assert.equal(resEquals.lineCount, 4);

      const resLeadingFlag = runReaderCli(['--lines', '2-5', 'package.json'], false);
      assert.ok(resLeadingFlag);
      assert.equal(resLeadingFlag.startLine, 2);
      assert.equal(resLeadingFlag.endLine, 5);

      const resDirect = readTokenOptimized('package.json', { lines: '2-5' });
      assert.equal(resDirect.startLine, 2);
      assert.equal(resDirect.endLine, 5);
    });

    it('--full returns the whole file without truncation and without cap', () => {
      const res = readTokenOptimized('AGENTS.md', { full: true, autoOutlineThreshold: 20 });
      assert.equal(res.startLine, 1);
      assert.equal(res.endLine, res.totalLines);
      assert.equal(res.lineCount, res.totalLines);
      assert.equal(res.trailer, undefined);
      assert.ok(res.totalLines > 20, 'AGENTS.md has more than 20 lines');
    });

    it('--bare never substitutes an outline on long files, prints remaining lines and next range', () => {
      const res = readTokenOptimized('AGENTS.md', { bare: true, autoOutlineThreshold: 20, hintSyntax: 'cli' });
      assert.notEqual(res.mode, 'auto-outline');
      assert.equal(res.mode, 'range');
      assert.equal(res.startLine, 1);
      assert.equal(res.endLine, 20);
      assert.match(res.trailer, /Truncated at the 20-line chemx read window/);
      assert.match(res.trailer, /remain/i);
      assert.match(res.trailer, /AGENTS\.md:21-/);
    });

    it('names the three range forms in unknown flag error text for read', async () => {
      const { findUnknownFlag } = await import('./commands/unknown-flags.js');
      const msg = findUnknownFlag('read', ['read', 'package.json', '--unknown-opt']);
      assert.ok(msg);
      assert.match(msg, /Range forms: <file>:N-M, --lines a-b, or --start=N --end=M\./);
    });
  });
});

/**
 * Inconclusive coverage (design spec 3.5): a file whose language has an AST parser but whose AST
 * rules did not run is not reported clean by check, not verified by the edit guardrails.
 * PHP is registered for the run in LANGUAGE_DEFINITIONS (the flip task adds it for good).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LANGUAGE_DEFINITIONS } from '../languages.js';
import { isInconclusive, inconclusiveReason } from './inconclusive.js';
import { evaluateGuardrails } from '../edit-guardrails.js';
import { handleCheckCommand } from '../search-commands.js';
import { runCheckCommand } from '../commands/cmd-check.js';
import { setPhpParserLoader, clearPhpParseCache } from '../php/php-parse.js';
import { PASSES } from '../php/php-analyzer.js';

const CLEAN_PHP = '<?php\nfunction f() { return 1; }\n';
const ORIGINAL_CWD = process.cwd();
let dir;

beforeEach(() => {
  LANGUAGE_DEFINITIONS.php = { id: 'php', name: 'PHP', extensions: new Set(['.php']), parser: 'php' };
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-inconclusive-')));
  fs.writeFileSync(path.join(dir, 'a.php'), CLEAN_PHP);
  process.chdir(dir);
  setPhpParserLoader(null);
  clearPhpParseCache();
  PASSES.length = 0;
});
afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete LANGUAGE_DEFINITIONS.php;
  setPhpParserLoader(null);
  clearPhpParseCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const stubParserUnavailable = () => {
  setPhpParserLoader(() => { throw new Error('php-parser is not installed'); });
  clearPhpParseCache();
};

const captureStdout = (fn) => {
  const original = process.stdout.write;
  let text = '';
  process.stdout.write = (chunk) => { text += String(chunk); return true; };
  try { fn(); } finally { process.stdout.write = original; }
  return text;
};

test('isInconclusive: an AST language that is not ast is inconclusive; text-only languages and empty files are not', () => {
  assert.equal(isInconclusive({ kind: 'text-only', language: 'php', reason: 'fast' }), true);
  assert.equal(isInconclusive({ kind: 'parse-error', language: 'php', reason: 'x' }), true);
  assert.equal(isInconclusive({ kind: 'ast', language: 'php', reason: null }), false);
  assert.equal(isInconclusive({ kind: 'text-only', language: 'typescript', reason: 'fast mode: AST rules skipped' }), true);
  assert.equal(isInconclusive({ kind: 'text-only', language: 'python', reason: 'no AST parser for this language' }), false);
  assert.equal(isInconclusive({ kind: 'empty', language: 'typescript', reason: null }), false);
  assert.equal(isInconclusive(null), false);
  assert.equal(isInconclusive({ kind: 'text-only', language: null }), false);
  assert.equal(inconclusiveReason({ kind: 'text-only', language: 'php', reason: 'parser-unavailable' }), 'parser-unavailable');
  assert.equal(inconclusiveReason({ kind: 'ast', language: 'php', reason: null }), null);
});

test('check: a PHP file is clean when the parser ran', () => {
  const payload = handleCheckCommand('a.php', { isJson: true, isCli: false });
  assert.equal(payload.isClean, true, JSON.stringify(payload));
  assert.equal(payload.inconclusive, undefined);
});

test('check: parser unavailable is not clean, prints inconclusive and never Crystalline', () => {
  stubParserUnavailable();
  const payload = handleCheckCommand('a.php', { isJson: true, isCli: false });
  assert.equal(payload.isClean, false);
  assert.equal(payload.inconclusive, 'parser-unavailable');
  const text = captureStdout(() => handleCheckCommand('a.php', { isCli: false }));
  assert.match(text, /inconclusive: parser-unavailable/);
  assert.doesNotMatch(text, /Crystalline/);
});

test('check --fast reports the file as inconclusive with reason fast', () => {
  const previous = process.exitCode;
  let result = null;
  captureStdout(() => { result = runCheckCommand(['a.php', '--fast', '--json', '--compact'], dir); });
  process.exitCode = previous;
  assert.equal(result.isClean, false);
  assert.equal(result.files[0].inconclusive, 'fast');
  const direct = handleCheckCommand('a.php', { isJson: true, isCli: false, isFast: true });
  assert.equal(direct.inconclusive, 'fast');
});

test('guardrails: parser unavailable reports the edit as not verified and not clean', () => {
  stubParserUnavailable();
  const result = evaluateGuardrails({ absPath: path.join(dir, 'a.php'), relPath: 'a.php', content: CLEAN_PHP, cwd: dir });
  assert.equal(result.isVerified, false);
  assert.equal(result.inconclusive, 'parser-unavailable');
  assert.equal(result.isClean, false);
});

test('guardrails: a parsed PHP edit carries no inconclusive marker', () => {
  const result = evaluateGuardrails({ absPath: path.join(dir, 'a.php'), relPath: 'a.php', content: CLEAN_PHP, cwd: dir });
  assert.equal(result.isClean, true, JSON.stringify(result));
  assert.equal('isVerified' in result, false);
});

test('guardrails audit PHP with crossFile false', () => {
  let seen = null;
  PASSES.push({ name: 'spy', rules: [], run: (ctx) => { seen = ctx.crossFile; } });
  evaluateGuardrails({ absPath: path.join(dir, 'a.php'), relPath: 'a.php', content: CLEAN_PHP, cwd: dir });
  assert.equal(seen, false);
});

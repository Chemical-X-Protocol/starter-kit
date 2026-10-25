/**
 * task done refuses a hazard its target file gained over HEAD at any severity, the same
 * rule the pre-commit hook and the ratchet apply (#2546). A hazard already at HEAD is not new.
 */
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { completeTaskWithAudit } from './team-triage.js';
import { hazardsAddedSinceHead } from '../audit/staged-delta.js';
import { auditCode } from '../audit/rules.js';
import { LANGUAGE_DEFINITIONS } from '../languages.js';
import { PASSES } from '../php/php-analyzer.js';
import { setPhpParserLoader, clearPhpParseCache } from '../php/php-parse.js';
import { resetProjectIndexCache } from '../php/wp-project-index.js';
import { resetWordPressCache } from '../php/wp-detect.js';

const TARGET = 'src/a.js';
const CLEAN = 'export const a = 1;\n';
const LOW_HAZARD = `// note ${String.fromCharCode(0x2014)} here\n${CLEAN}`;
const HANDLE = ['spec-a', 'spec.invalid'].join('@');

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, tier TEXT NOT NULL DEFAULT \'\', lines INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0);');
  db.exec('CREATE TABLE violations (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, rule TEXT NOT NULL, severity TEXT NOT NULL, pillar TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 1, hazard TEXT NOT NULL, directive TEXT NOT NULL);');
  initTeamSchema(db);
  return db;
};

const withCommittedFile = (committed, working, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-done-delta-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', HANDLE);
    git(root, 'config', 'user.name', 'spec-a');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, TARGET), committed);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(root, TARGET), working);
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const completeIn = (root) => {
  const db = setupDb();
  const task = createTask(db, { title: 'Edit a.js', target_path: TARGET, tier: 'util', origin_type: 'manual' });
  claimTask(db, task.id, '@spec-a');
  return completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root });
};

test('a LOW hazard added over HEAD refuses task done', () => {
  withCommittedFile(CLEAN, LOW_HAZARD, (root) => {
    const refusal = completeIn(root);
    assert.ok(refusal, 'expected a refusal');
    assert.equal(refusal.refused, true);
    assert.equal(refusal.violations[0].rule, 'TYPOGRAPHY_EM_DASH');
  });
});

test('a hazard already at HEAD is not added when the project root is a git subdirectory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-done-subdir-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', HANDLE);
    git(root, 'config', 'user.name', 'spec-a');
    const pkg = path.join(root, 'pkg');
    fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkg, TARGET), LOW_HAZARD);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    const current = auditCode(LOW_HAZARD, path.join(pkg, TARGET), TARGET, { config: {} });
    assert.ok(current.length > 0, 'fixture must hold a hazard');
    assert.deepEqual(hazardsAddedSinceHead(pkg, TARGET, current, {}), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a LOW hazard already at HEAD does not refuse task done', () => {
  withCommittedFile(LOW_HAZARD, `${LOW_HAZARD}export const b = 2;\n`, (root) => {
    git(root, 'commit', '-q', '-am', 'edit'); // task done also refuses uncommitted targets (#4519)
    const outcome = completeIn(root);
    assert.notEqual(outcome?.refused, true, JSON.stringify(outcome));
  });
});

// PHP targets (design spec 5.3). PHP is registered for the run and the passes are stubs: the real
// WordPress passes are wired later, so these specs pin only what the gate does with their findings.
const PLUGIN_A = (extra = '') => `<?php\n/* Plugin Name: Demo */\nadd_action('init', array('Demo_B', 'run'));\n${extra}`;
const CLASS_B = (extra = '') => `<?php\nclass Demo_B {\n  public static function run() { return 1; }\n}\n${extra}`;
const PHP_BASE = { 'demo.php': PLUGIN_A(), 'b.php': CLASS_B() };

const stubLocalPass = {
  name: 'stub-local',
  rules: [],
  run: (ctx) => {
    const at = ctx.content.indexOf('LOCALBAD');
    const hasMarker = at >= 0;
    if (hasMarker) ctx.report('STUB_LOCAL', ctx.content.slice(0, at).split('\n').length, 'stub local hazard', { severity: 'MEDIUM' });
  }
};

// demo.php reports a cross-file HIGH when b.php (the overlay, else the disk) contains DANGER.
const stubCrossFilePass = {
  name: 'stub-cross-file',
  rules: [],
  run: (ctx) => {
    const isPluginFile = ctx.relativePath.endsWith('demo.php');
    const isSkipped = !isPluginFile || !ctx.crossFile;
    if (isSkipped) return;
    const hasOverlay = ctx.overlay && path.basename(ctx.overlay.relativePath) === 'b.php';
    const bText = hasOverlay ? ctx.overlay.content : fs.readFileSync(path.join(path.dirname(ctx.filePath), 'b.php'), 'utf-8');
    const isDanger = bText.includes('DANGER');
    if (isDanger) ctx.report('STUB_XFILE', 3, 'stub cross-file hazard', { severity: 'HIGH', crossFile: true, evidence: 'b.php:1' });
  }
};

before(() => {
  LANGUAGE_DEFINITIONS.php = { id: 'php', name: 'PHP', extensions: new Set(['.php']), parser: 'php' };
});
after(() => {
  delete LANGUAGE_DEFINITIONS.php;
});
beforeEach(() => {
  PASSES.length = 0;
  PASSES.push(stubLocalPass, stubCrossFilePass);
  setPhpParserLoader(null);
  clearPhpParseCache();
  resetProjectIndexCache();
  resetWordPressCache();
});
afterEach(() => {
  PASSES.length = 0;
  setPhpParserLoader(null);
  clearPhpParseCache();
});

const writeFiles = (root, files) => {
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body);
};

/** A temp git plugin: `base` committed, then `working` written (and committed when commitWorking). */
const withPhpRepo = ({ base = PHP_BASE, working = {}, commitWorking = false }, fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-done-php-')));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', HANDLE);
    git(root, 'config', 'user.name', 'spec-a');
    writeFiles(root, base);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    writeFiles(root, working);
    if (commitWorking) git(root, 'commit', '-q', '-am', 'edit');
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const completePhp = (root, target) => {
  const db = setupDb();
  const task = createTask(db, { title: `Edit ${target}`, target_path: target, tier: 'util', origin_type: 'manual' });
  claimTask(db, task.id, '@spec-a');
  return completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root });
};

test('php: an unchanged target is neutral', () => {
  withPhpRepo({}, (root) => {
    const outcome = completePhp(root, 'b.php');
    assert.notEqual(outcome?.refused, true, JSON.stringify(outcome));
  });
});

test('php: a hazard added over HEAD refuses task done', () => {
  withPhpRepo({ working: { 'b.php': CLASS_B('// LOCALBAD\n') } }, (root) => {
    const refusal = completePhp(root, 'b.php');
    assert.equal(refusal?.refused, true, JSON.stringify(refusal));
    assert.equal(refusal.violations[0].rule, 'STUB_LOCAL');
  });
});

test('php: an inconclusive target (parser unavailable) is refused with inconclusive-coverage', () => {
  withPhpRepo({}, (root) => {
    setPhpParserLoader(() => { throw new Error('php-parser is not installed'); });
    clearPhpParseCache();
    const refusal = completePhp(root, 'b.php');
    assert.equal(refusal?.refused, true, JSON.stringify(refusal));
    assert.equal(refusal.reason, 'inconclusive-coverage');
    assert.match(refusal.message, /parser-unavailable/);
  });
});

test('php: editing B raises a cross-file finding in A, so B task done is refused naming A', () => {
  withPhpRepo({ working: { 'b.php': CLASS_B('// DANGER\n') } }, (root) => {
    const refusal = completePhp(root, 'b.php');
    assert.equal(refusal?.refused, true, JSON.stringify(refusal));
    assert.equal(refusal.reason, 'cross-file-regression');
    assert.deepEqual(refusal.files, [{ file: 'demo.php', rules: ['STUB_XFILE'] }]);
    assert.match(refusal.message, /demo\.php/);
  });
});

test('php: a cross-file HIGH already present when A is edited neutrally does not refuse A', () => {
  const base = { 'demo.php': PLUGIN_A(), 'b.php': CLASS_B('// DANGER\n') };
  withPhpRepo({ base, working: { 'demo.php': PLUGIN_A('// unrelated edit\n') }, commitWorking: true }, (root) => {
    const outcome = completePhp(root, 'demo.php');
    assert.notEqual(outcome?.refused, true, JSON.stringify(outcome));
  });
});

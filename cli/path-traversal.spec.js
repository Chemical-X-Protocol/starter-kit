import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { resolveSafePath, isPathTraversal } from './path-scope.js';
import { readTokenOptimized } from './reader.js';
import { handleChemxRead } from './mcp/tools-read.js';
import { patchFile, writeFile } from './patcher.js';
import { handleChemxPatch } from './mcp/tools-patch.js';
import { handleChemxWrite } from './mcp/tools-write.js';
import { requestFileLock, releaseFileLock, getFileLockStatus } from './team/team-db-locks.js';
import { handleChemxTeamLock } from './mcp/tools-team-locks.js';
import { handleLockCommand, handleUnlockCommand } from './team/team-commands-lock.js';
import { initTeamSchema } from './team/team-schema.js';

test('path-scope: resolveSafePath allows legitimate workspace paths', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scope-test-'));
  const testFile = path.join(tmpDir, 'src', 'index.js');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, 'export const x = 1;', 'utf-8');

  try {
    const relResolved = resolveSafePath('src/index.js', tmpDir);
    assert.strictEqual(relResolved, testFile);

    const absResolved = resolveSafePath(testFile, tmpDir);
    assert.strictEqual(absResolved, testFile);

    assert.strictEqual(isPathTraversal('src/index.js', tmpDir), false);
    assert.strictEqual(isPathTraversal(testFile, tmpDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('path-scope: resolveSafePath and isPathTraversal reject traversal attacks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scope-attack-'));

  try {
    assert.throws(
      () => resolveSafePath('../../../etc/passwd', tmpDir),
      /Path traversal rejected/
    );
    assert.throws(
      () => resolveSafePath('/etc/passwd', tmpDir),
      /Path traversal rejected/
    );
    assert.throws(
      () => resolveSafePath('foo\0bar.js', tmpDir),
      /Null byte detected/
    );

    assert.strictEqual(isPathTraversal('../../../etc/passwd', tmpDir), true);
    assert.strictEqual(isPathTraversal('/etc/passwd', tmpDir), true);
    assert.strictEqual(isPathTraversal('.', tmpDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('path-scope: rejects symlink escapes targeting outside workspace', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-symlink-root-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-symlink-outside-'));
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsideFile, 'secret-data', 'utf-8');

  const symlinkPath = path.join(tmpDir, 'symlink-secret.txt');
  try {
    fs.symlinkSync(outsideFile, symlinkPath);
    assert.throws(
      () => resolveSafePath('symlink-secret.txt', tmpDir),
      /Path traversal rejected/
    );
    assert.strictEqual(isPathTraversal('symlink-secret.txt', tmpDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('reader: readTokenOptimized and handleChemxRead block path traversal', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-reader-sec-'));
  const legitimateFile = path.join(tmpDir, 'legit.ts');
  fs.writeFileSync(legitimateFile, 'export const safe = true;\n', 'utf-8');

  try {
    const safeRes = readTokenOptimized('legit.ts', { cwd: tmpDir });
    assert.ok(safeRes.content.includes('export const safe = true;'));

    assert.throws(
      () => readTokenOptimized('../../../etc/passwd', { cwd: tmpDir }),
      /Path traversal rejected/
    );
    assert.throws(
      () => readTokenOptimized('/etc/passwd', { cwd: tmpDir }),
      /Path traversal rejected/
    );

    assert.throws(
      () => handleChemxRead({ path: '../../../etc/passwd', cwd: tmpDir }, tmpDir),
      /Path traversal rejected/
    );
    assert.throws(
      () => handleChemxRead({ path: '/etc/passwd', cwd: tmpDir }, tmpDir),
      /Path traversal rejected/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patcher: patchFile, writeFile, and MCP tools block path traversal', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patcher-sec-'));
  const legitimateFile = path.join(tmpDir, 'legit.ts');
  fs.writeFileSync(legitimateFile, 'export const val = 1;\n', 'utf-8');

  try {
    const patchRes = patchFile('legit.ts', {
      targetContent: 'val = 1;',
      replacementContent: 'val = 2;',
      cwd: tmpDir,
      skipIndex: true
    });
    assert.strictEqual(patchRes.status, 'ok');

    assert.throws(
      () => patchFile('../../../etc/passwd', {
        targetContent: 'root',
        replacementContent: 'hacked',
        cwd: tmpDir,
        skipIndex: true
      }),
      /Path traversal rejected/
    );
    assert.throws(
      () => patchFile('/etc/passwd', {
        targetContent: 'root',
        replacementContent: 'hacked',
        cwd: tmpDir,
        skipIndex: true
      }),
      /Path traversal rejected/
    );

    assert.throws(
      () => writeFile('../../../etc/evil.txt', {
        content: 'exploit',
        cwd: tmpDir,
        skipIndex: true
      }),
      /Path traversal rejected/
    );
    assert.throws(
      () => writeFile('/tmp/evil-outside.txt', {
        content: 'exploit',
        cwd: tmpDir,
        skipIndex: true
      }),
      /Path traversal rejected/
    );

    assert.throws(
      () => handleChemxPatch({
        path: '../../../etc/passwd',
        targetContent: 'a',
        replacementContent: 'b'
      }, tmpDir),
      /Path traversal rejected/
    );

    assert.throws(
      () => handleChemxWrite({
        path: '../../../etc/passwd',
        content: 'malicious'
      }, tmpDir),
      /Path traversal rejected/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('team lock: requestFileLock, releaseFileLock, and getFileLockStatus block path traversal', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initTeamSchema(db);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-team-sec-'));

  try {
    const safeLock = requestFileLock(db, 'src/button.vue', '@agent-1', { cwd: tmpDir });
    assert.strictEqual(safeLock.granted, true);
    assert.strictEqual(safeLock.lease.file_path, 'src/button.vue');

    const safeStatus = getFileLockStatus(db, 'src/button.vue', { cwd: tmpDir });
    assert.strictEqual(safeStatus.lease.locked_by, '@agent-1');

    const safeUnlock = releaseFileLock(db, 'src/button.vue', '@agent-1', { cwd: tmpDir });
    assert.strictEqual(safeUnlock.success, true);

    const badLock1 = requestFileLock(db, '../../../etc/passwd', '@attacker', { cwd: tmpDir });
    assert.strictEqual(badLock1.granted, false);
    assert.strictEqual(badLock1.reason, 'path_traversal');

    const badLock2 = requestFileLock(db, '/etc/passwd', '@attacker', { cwd: tmpDir });
    assert.strictEqual(badLock2.granted, false);
    assert.strictEqual(badLock2.reason, 'path_traversal');

    const badUnlock = releaseFileLock(db, '../../../etc/passwd', '@attacker', { cwd: tmpDir });
    assert.strictEqual(badUnlock.success, false);
    assert.strictEqual(badUnlock.reason, 'path_traversal');

    const badStatus = getFileLockStatus(db, '../../../etc/passwd', { cwd: tmpDir });
    assert.strictEqual(badStatus.error, 'path_traversal');

    const cliLockRes = handleLockCommand(db, ['acquire', '../../../etc/passwd'], {}, false, tmpDir);
    assert.strictEqual(cliLockRes.error, 'path_traversal');

    const cliUnlockRes = handleUnlockCommand(db, ['../../../etc/passwd'], {}, false, tmpDir);
    assert.strictEqual(cliUnlockRes.error, 'path_traversal');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('team lock: handleChemxTeamLock MCP handler rejects path traversal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-lock-sec-'));
  try {
    const res = await handleChemxTeamLock({
      action: 'acquire',
      filePath: '../../../etc/passwd',
      agentId: '@attacker'
    }, tmpDir);

    assert.strictEqual(res.error, 'path_traversal');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

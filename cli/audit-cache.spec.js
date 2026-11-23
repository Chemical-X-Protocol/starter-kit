import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { openAuditCache, getCachedAudit, setCachedAudit, computeContentHash } from './audit-cache.js';
import { RULESET_VERSION } from './audit/rule-revisions.js';

describe('audit-cache', () => {
  it('computes consistent sha1 content hash', () => {
    const hash1 = computeContentHash('hello world');
    const hash2 = computeContentHash('hello world');
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(typeof hash1, 'string');
    assert.strictEqual(hash1.length, 40);
  });

  it('records and retrieves cached audit findings', () => {
    const memoryDb = new DatabaseSync(':memory:');
    const cache = openAuditCache(process.cwd(), { db: memoryDb });
    assert.ok(cache);

    const relPath = 'src/test-file.ts';
    const mtimeMs = 1700000000000;
    const size = 1024;
    const configStamp = '123|456';
    const contentHash = computeContentHash('const a = 1;');

    const miss = getCachedAudit(cache, relPath, mtimeMs, size, configStamp);
    assert.strictEqual(miss, null);

    const mockResult = {
      fileStat: { relativePath: relPath, lineCount: 20, isMolecule: false },
      hookCount: 2,
      fileViolations: [{ rule: 'CONTROL_FLOW_INLINE_BOOLEAN', line: 10, severity: 'LOW' }]
    };

    setCachedAudit(cache, relPath, mtimeMs, size, contentHash, configStamp, mockResult);

    const hit = getCachedAudit(cache, relPath, mtimeMs, size, configStamp);
    assert.ok(hit);
    assert.strictEqual(hit.fileStat.lineCount, 20);
    assert.strictEqual(hit.hookCount, 2);
    assert.strictEqual(hit.fileViolations.length, 1);
    assert.strictEqual(hit.fileViolations[0].rule, 'CONTROL_FLOW_INLINE_BOOLEAN');
  });

  it('invalidates cache when mtime, size, or configStamp changes', () => {
    const memoryDb = new DatabaseSync(':memory:');
    const cache = openAuditCache(process.cwd(), { db: memoryDb });
    assert.ok(cache);

    const relPath = 'src/test-file.ts';
    const mtimeMs = 1700000000000;
    const size = 1024;
    const configStamp = '123|456';

    setCachedAudit(cache, relPath, mtimeMs, size, 'hash1', configStamp, {
      fileStat: { relativePath: relPath, lineCount: 15 },
      hookCount: 0,
      fileViolations: []
    });

    const mtimeChanged = getCachedAudit(cache, relPath, mtimeMs + 1000, size, configStamp);
    assert.strictEqual(mtimeChanged, null);

    const sizeChanged = getCachedAudit(cache, relPath, mtimeMs, size + 10, configStamp);
    assert.strictEqual(sizeChanged, null);

    const configChanged = getCachedAudit(cache, relPath, mtimeMs, size, 'different-stamp');
    assert.strictEqual(configChanged, null);
  });
});

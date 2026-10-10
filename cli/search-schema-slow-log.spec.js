import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const schemaUrl = new URL('./search-schema.js', import.meta.url).href;
const openInChild = (threshold) => {
  const dir = mkdtempSync(join(tmpdir(), 'chemx-slowlog-'));
  try {
    const code = 'const m = await import(' + JSON.stringify(schemaUrl) + '); m.openIndexDb(' + JSON.stringify(dir) + ');';
    return spawnSync(process.execPath, ['--input-type=module', '-e', code],
      { env: { ...process.env, CHEMX_DB_SLOW_TX_MS: threshold }, encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

describe('openIndexDb slow log (#5906)', () => {
  it('writes a [chemx-db] openIndexDb line to stderr when a fresh open exceeds the threshold', () => {
    assert.match(openInChild('0.5').stderr, /\[chemx-db\] openIndexDb elapsed \d+ ms/);
  });
  it('stays silent when the threshold is unset', () => {
    assert.doesNotMatch(openInChild('').stderr, /\[chemx-db\] openIndexDb/);
  });
});

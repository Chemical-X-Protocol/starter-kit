import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CHEMX_TEST = '1';

import { scanTree } from './audit-scan.js';

const writeSource = (root, relPath) => {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'export const answer = 42;\n');
};

test('scanTree: skips package stores and agent worktree copies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-scan-'));
  try {
    writeSource(root, 'src/app.ts');
    writeSource(root, '.pnpm-store/v11/files/00/pkg.js');
    writeSource(root, '.claude/worktrees/feature/src/app.ts');
    writeSource(root, '.chemx/cache/stale.js');
    writeSource(root, 'packages/ui/node_modules/dep/index.js');

    const { fileStats } = scanTree(root, root);
    const scanned = fileStats.map((stat) => stat.relativePath.split(path.sep).join('/'));

    assert.deepStrictEqual(scanned, ['src/app.ts']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

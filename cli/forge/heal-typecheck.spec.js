// The heal typecheck modes on a tiny temp TS project, with the kit's own tsc: which files the project's
// tsconfig covers, and the scoped before/after diagnostic delta (lines ignored, multiset by code+message).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typecheckCoverage, scopedDiagnostics, introducedDiagnostics } from './heal-typecheck.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const project = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-heal-tc-'));
  for (const [relative, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), text);
  }
  return dir;
};

test('coverage follows include prefixes, the extension and allowJs/checkJs', () => {
  const dir = project({ 'tsconfig.json': '{ "compilerOptions": { "strict": true } /* no js */, "include": ["src"] }' });
  try {
    assert.deepEqual(typecheckCoverage(dir, ['src/a.ts', 'src/b.js', 'cli/c.ts']), { tsconfig: 'tsconfig.json', covered: ['src/a.ts'], uncovered: ['src/b.js', 'cli/c.ts'] });
    assert.deepEqual(typecheckCoverage(path.join(dir, 'missing'), ['src/a.ts']).covered, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the scoped delta counts only diagnostics the edit introduced', async () => {
  const dir = project({
    'tsconfig.json': '{ "compilerOptions": { "strict": true, "noEmit": true, "skipLibCheck": true, "types": [] }, "include": ["src"] }',
    'src/a.ts': 'export const a: number = "old";\n'
  });
  try {
    const before = await scopedDiagnostics(dir, ['src/a.ts'], { checkerRoot: KIT_ROOT });
    assert.equal(before.error, undefined, before.error);
    assert.equal(before.diagnostics.length, 1);
    fs.writeFileSync(path.join(dir, 'src/a.ts'), '\n\nexport const a: number = "old";\nexport const b: string = 1;\n');
    const after = await scopedDiagnostics(dir, ['src/a.ts'], { checkerRoot: KIT_ROOT });
    const introduced = introducedDiagnostics(before.diagnostics, after.diagnostics);
    assert.equal(introduced.length, 1, JSON.stringify(after.diagnostics));
    assert.match(introduced[0].message, /number/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

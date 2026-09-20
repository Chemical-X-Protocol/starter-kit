import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { patchFile } from './patcher.js';
import { syncSingleFileIndex, openIndexDb, findSymbolDefinition } from './search.js';

test('patchFile: surgically replaces unique target chunk and updates line counts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-test-'));
  const testFile = path.join(tmpDir, 'sample.ts');
  fs.writeFileSync(testFile, 'export const a = 1;\nexport const b = 2;\n', 'utf-8');

  try {
    const result = patchFile(testFile, {
      targetContent: 'export const b = 2;',
      replacementContent: 'export const b = 42;\nexport const c = 3;',
      cwd: tmpDir,
      skipIndex: true
    });

    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.originalLines, 3);
    assert.strictEqual(result.newLines, 4);
    assert.strictEqual(result.lineDelta, 1);
    assert.strictEqual(result.replaced, 1);

    const updated = fs.readFileSync(testFile, 'utf-8');
    assert.ok(updated.includes('export const b = 42;'));
    assert.ok(updated.includes('export const c = 3;'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patchFile: fails closed when target content is not found', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-fail-'));
  const testFile = path.join(tmpDir, 'sample.ts');
  fs.writeFileSync(testFile, 'const x = 10;\n', 'utf-8');

  try {
    assert.throws(
      () => {
        patchFile(testFile, {
          targetContent: 'const nonExistent = 99;',
          replacementContent: 'const fixed = 1;',
          cwd: tmpDir,
          skipIndex: true
        });
      },
      /Target content not found/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patchFile: fails closed when target content appears multiple times without allowMultiple', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-multi-'));
  const testFile = path.join(tmpDir, 'sample.ts');
  fs.writeFileSync(testFile, 'const foo = 1;\nconst foo = 1;\n', 'utf-8');

  try {
    assert.throws(
      () => {
        patchFile(testFile, {
          targetContent: 'const foo = 1;',
          replacementContent: 'const bar = 2;',
          cwd: tmpDir,
          skipIndex: true
        });
      },
      /Target content found multiple times/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patchFile: micro-indexes file into SQLite immediately upon write', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-sqlite-'));
  const testFile = path.join(tmpDir, 'test-module.ts');
  fs.writeFileSync(testFile, 'export const initialSymbol = () => true;\n', 'utf-8');

  try {
    const patchResult = patchFile(testFile, {
      targetContent: 'export const initialSymbol = () => true;',
      replacementContent: 'export const liveIndexedSymbol = () => 42;',
      cwd: tmpDir
    });

    assert.strictEqual(patchResult.status, 'ok');
    assert.strictEqual(patchResult.indexed, true);

    const db = openIndexDb(tmpDir);
    assert.ok(db, 'SQLite index.db was initialized');

    const def = findSymbolDefinition(db, 'liveIndexedSymbol');
    assert.ok(def, 'Symbol liveIndexedSymbol was immediately indexed into SQLite');
    assert.strictEqual(def.name, 'liveIndexedSymbol');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patchFile: evaluates Directive 1.A line limits and warns when molecule exceeds 100 lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-budget-'));
  const moleculeFile = path.join(tmpDir, 'm-trade-slip.ts');
  fs.writeFileSync(moleculeFile, 'export const isSample = true;\n', 'utf-8');

  try {
    // Generate 105 lines
    const bigContent = Array.from({ length: 105 }, (_, i) => `export const line${i} = ${i};`).join('\n');
    const result = patchFile(moleculeFile, {
      targetContent: 'export const isSample = true;',
      replacementContent: bigContent,
      cwd: tmpDir
    });

    assert.strictEqual(result.lineBudget.passed, false);
    assert.strictEqual(result.lineBudget.limit, 100);
    assert.ok(result.lineBudget.lines >= 105);
    assert.ok(result.lineBudget.warning.includes('Directive 1.A'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('patchFile: detects Directive 1.G raw DOM violations in molecule files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-rawdom-'));
  const moleculeFile = path.join(tmpDir, 'm-bad-button.vue');
  const templateWithRawButton = '<template>\n  <button class="raw-btn">Click me</button>\n</template>\n<script setup>\nconst isReady = true;\n</script>\n';
  fs.writeFileSync(moleculeFile, '<template>\n  <AtomButton />\n</template>\n<script setup>\nconst isReady = true;\n</script>\n', 'utf-8');

  try {
    const result = patchFile(moleculeFile, {
      targetContent: '<AtomButton />',
      replacementContent: '<button class="raw-btn">Click me</button>',
      cwd: tmpDir
    });

    assert.strictEqual(result.status, 'ok');
    const hasRawDomViolation = result.violations.some((v) => v.rule.includes('RAW_DOM') || v.hazard.toLowerCase().includes('raw'));
    assert.ok(hasRawDomViolation, 'Discovered raw DOM violation in patched molecule');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runPatcherCli: --help displays usage and returns success without error', () => {
  import('./patcher.js').then(({ runPatcherCli, runWriterCli }) => {
    const patchRes = runPatcherCli(['--help'], false);
    assert.strictEqual(patchRes.success, true);
    assert.strictEqual(patchRes.help, true);

    const writeRes = runWriterCli(['--help'], false);
    assert.strictEqual(writeRes.success, true);
    assert.strictEqual(writeRes.help, true);
  });
});

test('ANSI.GREEN: exists and is defined in theme.js', async () => {
  const { ANSI } = await import('./theme.js');
  assert.notStrictEqual(ANSI.GREEN, undefined);
  assert.ok(typeof ANSI.GREEN === 'string');
});

test('patchFile: dryRun previews changes without writing to disk', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-dry-'));
  const testFile = path.join(tmpDir, 'sample.ts');
  const original = 'export const initial = 1;\n';
  fs.writeFileSync(testFile, original, 'utf-8');

  try {
    const result = patchFile(testFile, {
      targetContent: 'export const initial = 1;',
      replacementContent: 'export const updated = 2;',
      cwd: tmpDir,
      dryRun: true
    });

    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.status, 'ok');
    const diskContent = fs.readFileSync(testFile, 'utf-8');
    assert.strictEqual(diskContent, original, 'File on disk should remain unchanged in dry-run mode');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explodeCapsule } from './exploder.js';

const CARD = `import clsx from 'clsx';
import { useState } from 'react';

const formatPrice = (n: number) => \`$\${n.toFixed(2)}\`;

export interface CardProps {
  readonly price: number;
  readonly className?: string;
}

export function Card({ price, className = '' }: CardProps) {
  const [open, setOpen] = useState(false);
  return <div className={clsx('card', className)} onClick={() => setOpen(!open)}>{formatPrice(price)}</div>;
}

export function CardBadge() {
  return <span>badge</span>;
}
`;

const readTree = (dir) => fs.readdirSync(dir, { recursive: true })
  .filter((f) => fs.statSync(path.join(dir, f)).isFile())
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf-8'))
  .join('\n');

const withDir = (fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-explode-')));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('explode: every top-level declaration and import of the source lands in the capsule', () => {
  withDir((dir) => {
    const file = path.join(dir, 'card.tsx');
    fs.writeFileSync(file, CARD);
    const result = explodeCapsule(file, { cwd: dir });
    assert.equal(result.success, true);
    const capsule = readTree(path.join(dir, 'card'));
    for (const text of [
      "import clsx from 'clsx';",
      'const formatPrice = (n: number) => `$${n.toFixed(2)}`;',
      'export function Card({ price, className = \'\' }: CardProps) {',
      "return <div className={clsx('card', className)} onClick={() => setOpen(!open)}>{formatPrice(price)}</div>;",
      'export function CardBadge() {',
      'readonly price: number;'
    ]) {
      assert.ok(capsule.includes(text), `capsule lost: ${text}`);
    }
    assert.equal(fs.existsSync(file), false, 'original is removed only after the capsule verified');
    assert.ok(result.backup, 'the original is kept as a backup');
    assert.equal(fs.readFileSync(path.join(dir, result.backup), 'utf-8'), CARD);
  });
});

test('explode: dry run reports where each declaration lands and writes nothing', () => {
  withDir((dir) => {
    const file = path.join(dir, 'card.tsx');
    fs.writeFileSync(file, CARD);
    const result = explodeCapsule(file, { cwd: dir, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.placement.formatPrice, 'card.tsx');
    assert.equal(result.placement.CardProps, 'types/props.d.ts');
    assert.match(result.diff, /\+\+\+ b\/card\/card\.tsx/);
    assert.equal(fs.readFileSync(file, 'utf-8'), CARD);
    assert.equal(fs.existsSync(path.join(dir, 'card')), false);
  });
});

test('explode: refuses .vue files until SFC support lands', () => {
  withDir((dir) => {
    const file = path.join(dir, 'm-card.vue');
    const vue = '<template><div /></template>\n<script setup lang="ts">\nconst a = 1\n</script>\n';
    fs.writeFileSync(file, vue);
    assert.throws(() => explodeCapsule(file, { cwd: dir }), /\.vue/);
    assert.equal(fs.readFileSync(file, 'utf-8'), vue);
    assert.equal(fs.existsSync(path.join(dir, 'm-card')), false);
  });
});

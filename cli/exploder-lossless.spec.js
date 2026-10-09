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

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '.js', '/index.ts'];
const SPECIFIER_REGEX = /(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}(?:\/[^']*)?)'/g;

const unresolvedImports = (root) => fs.readdirSync(root, { recursive: true })
  .filter((f) => /\.(tsx?|jsx?)$/.test(f) && fs.statSync(path.join(root, f)).isFile())
  .flatMap((f) => [...fs.readFileSync(path.join(root, f), 'utf-8').matchAll(SPECIFIER_REGEX)]
    .map((m) => ({ file: f, spec: m[1], target: path.resolve(root, path.dirname(f), m[1]) }))
    .filter(({ target }) => !RESOLVE_SUFFIXES.some((s) => fs.existsSync(`${target}${s}`) && fs.statSync(`${target}${s}`).isFile()))
    .map(({ file, spec }) => `${file}: ${spec}`));

const NESTED = `import { fmt } from './format';
import type { Theme } from '../theme';
import './card.css';

export interface CardProps {
  readonly theme: Theme;
}

const Lazy = () => import('./lazy');

export function Card({ theme }: CardProps) {
  return <div title={fmt(theme.name)} onClick={() => Lazy()} />;
}

export default Card;
`;

test('explode: relative imports are rewritten for the new depth and the default export stays importable', () => {
  withDir((dir) => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'theme.ts'), 'export interface Theme { name: string }\n');
    fs.writeFileSync(path.join(dir, 'src', 'format.ts'), 'export const fmt = (s: string) => s;\n');
    fs.writeFileSync(path.join(dir, 'src', 'lazy.ts'), 'export default 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'card.css'), '.card {}\n');
    fs.writeFileSync(path.join(dir, 'src', 'use.tsx'), "import Card, { Card as Named } from './card';\nexport const a = [Card, Named];\n");
    fs.writeFileSync(path.join(dir, 'src', 'card.tsx'), NESTED);
    explodeCapsule(path.join(dir, 'src', 'card.tsx'), { cwd: dir });
    assert.deepEqual(unresolvedImports(dir), [], 'every relative import still resolves');
    const index = fs.readFileSync(path.join(dir, 'src', 'card', 'index.ts'), 'utf-8');
    assert.match(index, /export \{ default \} from '\.\/card';/);
    assert.match(index, /export \* from '\.\/card';/);
    const props = fs.readFileSync(path.join(dir, 'src', 'card', 'types', 'props.d.ts'), 'utf-8');
    assert.match(props, /from '\.\.\/\.\.\/\.\.\/theme'/);
  });
});

test('explode verification: a specifier left at the old depth is reported as broken', async () => {
  const { brokenSpecifiers } = await import('./explode-relocate.js');
  const { parseSource } = await import('./source-parse.js');
  const programs = parseSource("import { fmt } from './format';\nexport const a = fmt;\n", 'card.ts').programs;
  assert.deepEqual(brokenSpecifiers({ 'card/card.ts': programs }, ['./format']), ["card/card.ts: './format'"]);
  const fixed = parseSource("import { fmt } from '../format';\nexport const a = fmt;\n", 'card.ts').programs;
  assert.deepEqual(brokenSpecifiers({ 'card/card.ts': fixed }, ['./format']), []);
});

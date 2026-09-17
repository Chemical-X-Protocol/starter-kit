import test from 'node:test';
import assert from 'node:assert';
import { toColumnar, fromColumnar } from './columnar.js';

test('toColumnar: converts array of objects into cols and rows', () => {
  const items = [
    { file: 'src/a.ts', tier: 'atom', lines: 40 },
    { file: 'src/b.ts', tier: 'molecule', lines: 75 }
  ];

  const result = toColumnar(items, ['file', 'tier', 'lines']);

  assert.deepStrictEqual(result.cols, ['file', 'tier', 'lines']);
  assert.strictEqual(result.rows.length, 2);
  assert.deepStrictEqual(result.rows[0], ['src/a.ts', 'atom', 40]);
  assert.deepStrictEqual(result.rows[1], ['src/b.ts', 'molecule', 75]);
});

test('toColumnar: handles empty or missing arrays cleanly', () => {
  assert.deepStrictEqual(toColumnar([], ['file', 'tier']), { cols: ['file', 'tier'], rows: [] });
  assert.deepStrictEqual(toColumnar(null, ['file']), { cols: ['file'], rows: [] });
});

test('toColumnar: supports custom accessor functions for nested fields', () => {
  const items = [
    { file: 'src/card.vue', symbols: [{ name: 'UserCard' }, { name: 'CardBadge' }] }
  ];

  const result = toColumnar(items, ['file', 'symbols'], {
    symbols: (item) => item.symbols.map((s) => s.name)
  });

  assert.deepStrictEqual(result.rows[0], ['src/card.vue', ['UserCard', 'CardBadge']]);
});

test('fromColumnar: reconstructs array of objects from columnar data', () => {
  const columnar = {
    cols: ['file', 'tier', 'lines'],
    rows: [
      ['src/a.ts', 'atom', 40],
      ['src/b.ts', 'molecule', 75]
    ]
  };

  const items = fromColumnar(columnar);
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items[0], { file: 'src/a.ts', tier: 'atom', lines: 40 });
  assert.deepStrictEqual(items[1], { file: 'src/b.ts', tier: 'molecule', lines: 75 });
});

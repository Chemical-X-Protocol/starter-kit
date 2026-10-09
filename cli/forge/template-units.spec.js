// Forge tmpl units (engine doc section 3, Templates): ROLE tokens, STR text, BIND/EVENT holes, the L3
// ATTR merge and passthrough attributes. Excerpts are verbatim repo templates with file:line provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFileUnits } from './file-units.js';
import { canonicalizeSource } from './canonicalize.js';
import { collectJsxTemplateUnits } from './template-units.js';
import { normalizeJsxElement, pascalTag } from './template-normalize.js';
import { traverse } from '../babel-lazy.js';

const findJsxElement = (ast, name) => {
  const found = [];
  traverse(ast, {
    JSXElement(path) {
      const isNamed = path.node.openingElement.name.name === name;
      if (isNamed) found.push(path.node);
    }
  });
  return found[0];
};

// src/ui/molecules/m-savings-modal/m-savings-modal.vue:26-41 (four stat tiles, the A24 shape)
const SAVINGS_TILES = [
  '        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">',
  '          <AText variant="caption" tone="muted" text="Baseline Monolithic Burn" />',
  '          <AText variant="title" tone="warning" :text="`${(props.savings?.baselineTokens || 0).toLocaleString()} tokens`" />',
  '        </ACard>',
  '        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">',
  '          <AText variant="caption" tone="muted" text="Actual Chemical X Usage" />',
  '          <AText variant="title" tone="primary" :text="`${(props.savings?.actualTokens || 0).toLocaleString()} tokens`" />',
  '        </ACard>',
  '        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">',
  '          <AText variant="caption" tone="muted" text="Tokens Saved" />',
  '          <AText variant="title" tone="success" :text="`${(props.savings?.tokensSaved || 0).toLocaleString()} tokens`" />',
  '        </ACard>',
  '        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">',
  '          <AText variant="caption" tone="muted" text="Estimated Dollar Avoidance" />',
  '          <AText variant="title" tone="success" :text="`$${Number(props.savings?.dollarsSaved || 0).toFixed(2)} USD`" />',
  '        </ACard>'
].join('\n');

// blueprints/molecule-capsule/m-sample-card.tsx:45-70 (inside a host declaring what it reads)
const SAMPLE_CARD_JSX = [
  'const host = (title, subtitle, badge, value, onAction, handleActionClick, AtomButton) => {',
  '  return (',
  '    <div className="m-sample-card">',
  '      <div className="m-sample-card__header">',
  '        <div className="m-sample-card__title-group">',
  '          <h3 className="m-sample-card__title">{title}</h3>',
  '          {subtitle && <p className="m-sample-card__subtitle">{subtitle}</p>}',
  '        </div>',
  '        <span className={badge.className}>',
  '          {badge.text}',
  '        </span>',
  '      </div>',
  '      <div className="m-sample-card__body">',
  '        <div className="m-sample-card__value">',
  '          ${value.toLocaleString()}',
  '        </div>',
  '        {onAction && (',
  '          <AtomButton',
  '            className="m-sample-card__action"',
  '            onClick={handleActionClick}',
  '          >',
  '            Action',
  '          </AtomButton>',
  '        )}',
  '      </div>',
  '    </div>',
  '  );',
  '};'
].join('\n');

const tilesOf = (excerpt) => {
  const result = collectFileUnits('src/ui/molecules/m-savings-modal/m-savings-modal.vue', `<template>\n${excerpt}\n</template>\n`);
  return result.units.filter((unit) => unit.kind === 'tmpl' && unit.tag === 'ACard');
};

test('the four stat tiles are tmpl units with mass counting elements and attributes', () => {
  const tiles = tilesOf(SAVINGS_TILES);
  assert.deepEqual(tiles.map((tile) => tile.start), [2, 6, 10, 14]);
  assert.deepEqual(tiles.map((tile) => tile.mass), [11, 11, 11, 11]);
  assert.deepEqual(tiles.map((tile) => tile.parentId), [null, null, null, null]);
});

test('STR text and BIND holes collide at L2; ROLE tokens do not; all tiles meet at L3', () => {
  const [baseline, actual, saved, dollars] = tilesOf(SAVINGS_TILES);
  assert.equal(saved.fp2, dollars.fp2, 'same tone="success" ROLE, different STR text and :text');
  assert.notEqual(saved.fp1, dollars.fp1);
  assert.notEqual(baseline.fp2, actual.fp2, 'tone="warning" and tone="primary" are ROLE tokens');
  assert.equal(new Set([baseline, actual, saved, dollars].map((tile) => tile.fp3)).size, 1);
});

test('class is passthrough: changing it never changes a fingerprint', () => {
  const [original] = tilesOf(SAVINGS_TILES);
  const [restyled] = tilesOf(SAVINGS_TILES.replace('class="m-savings-modal__stat"', 'class="other"'));
  assert.deepEqual([restyled.fp1, restyled.fp2, restyled.fp3], [original.fp1, original.fp2, original.fp3]);
});

test('static attributes are sorted, so their order never matters', () => {
  const [original] = tilesOf(SAVINGS_TILES);
  const [reordered] = tilesOf(SAVINGS_TILES.replace('variant="subtle" padding="none"', 'padding="none" variant="subtle"'));
  assert.equal(reordered.fp1, original.fp1);
});

test('sorting never moves a static attribute across a v-bind spread (the later one wins)', () => {
  const withSpread = (attrs) => tilesOf(SAVINGS_TILES.replace('variant="subtle" padding="none"', attrs))[0];
  const spreadFirst = withSpread('v-bind="$attrs" variant="subtle" padding="none"');
  const spreadLast = withSpread('variant="subtle" padding="none" v-bind="$attrs"');
  const spreadFirstReordered = withSpread('v-bind="$attrs" padding="none" variant="subtle"');
  assert.notEqual(spreadFirst.fp1, spreadLast.fp1);
  assert.notEqual(spreadFirst.fp3, spreadLast.fp3);
  assert.equal(spreadFirstReordered.fp1, spreadFirst.fp1, 'a run between spreads is still sorted');
});

test('a JSX spread keeps its position relative to static attributes', () => {
  const element = (source) => {
    const { ast } = canonicalizeSource(source);
    return collectJsxTemplateUnits(ast, source, { minMass: 1 })[0];
  };
  const before = element('const host = (p) => <XCard tone="info" {...p}><b>x</b></XCard>;');
  const after = element('const host = (p) => <XCard {...p} tone="info"><b>x</b></XCard>;');
  assert.notEqual(before.fp1, after.fp1);
});

test('JSX elements use the same normalizer: PascalCase tags, events, interpolations', () => {
  const { ast } = canonicalizeSource(SAMPLE_CARD_JSX);
  const units = collectJsxTemplateUnits(ast, SAMPLE_CARD_JSX);
  const root = units.find((unit) => unit.start === 3);
  assert.equal(root.tag, 'Div');
  assert.equal(root.end, 26);
  const normalized = normalizeJsxElement(findJsxElement(ast, 'AtomButton'), SAMPLE_CARD_JSX);
  assert.equal(normalized.tag, 'AtomButton');
  assert.deepEqual(normalized.attrs, [{ kind: 'event', name: 'click', exp: 'handleActionClick' }]);
  assert.deepEqual(normalized.children.map((child) => [child.type, child.text]), [['Text', 'Action']]);
  const header = normalizeJsxElement(findJsxElement(ast, 'span'), SAMPLE_CARD_JSX);
  assert.deepEqual(header.attrs, [], 'className is passthrough');
  assert.deepEqual(header.children.map((child) => [child.type, child.exp]), [['Interp', 'badge.text']]);
});

test('pascalTag turns kebab tags into component names', () => {
  assert.deepEqual(['a-card', 'div', 'ACard', 'o-db-studio'].map(pascalTag), ['ACard', 'Div', 'ACard', 'ODbStudio']);
});

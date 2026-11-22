/**
 * Unit tests for minified/bundled source detection, BUNDLED_MINIFIED_SOURCE audit
 * short-circuit, metadata skip, and compact HTML outline formatting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMinifiedSource } from './minified-detector.js';
import { auditCodeDetailed } from './rules.js';
import { isInconclusive } from './inconclusive.js';
import { generateAstOutline } from '../reader.js';
import { extractAstMetadata } from '../search-ast.js';

test('detectMinifiedSource: flags single mega-line or dominant long lines and ignores clean code', () => {
  const clean = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join('\n');
  assert.equal(detectMinifiedSource(clean).isMinified, false);

  const singleMega = `const x = "${'a'.repeat(8500)}";`;
  const mega = detectMinifiedSource(singleMega);
  assert.equal(mega.isMinified, true);
  assert.equal(mega.firstLongLine, 1);

  const manyLong = Array.from({ length: 5 }, () => `const y = "${'b'.repeat(2200)}";`).join('\n');
  const multi = detectMinifiedSource(manyLong);
  assert.equal(multi.isMinified, true);
  assert.equal(multi.longLineCount, 5);
});

test('auditCodeDetailed: emits BUNDLED_MINIFIED_SOURCE and inconclusive coverage on minified HTML script', () => {
  const html = `<!doctype html>\n<html>\n<head>\n<style>\nbody { margin: 0; }\n</style>\n</head>\n<body>\n<script>\n(()=>{"${'z'.repeat(9000)}"})();\n</script>\n</body>\n</html>\n`;
  const { violations, coverage } = auditCodeDetailed(html, '/p/index.html', 'index.html');
  const bundled = violations.filter((v) => v.rule === 'BUNDLED_MINIFIED_SOURCE');
  assert.equal(bundled.length, 1);
  assert.equal(bundled[0].severity, 'CRITICAL');
  assert.equal(bundled[0].line, 10);
  assert.equal(coverage.kind, 'text-only');
  assert.equal(isInconclusive(coverage), true);
  assert.equal(extractAstMetadata(html, 'index.html').symbols.length, 0);
});

test('generateAstOutline: emits compact HTML block map for minified inline script without regex junk', () => {
  const html = `<!doctype html>\n<html>\n<head>\n<style>\nbody { margin: 0; }\n</style>\n</head>\n<body>\n<script>\nfunction html(){class extends{}}\n(()=>{"${'z'.repeat(9000)}"})();\n</script>\n</body>\n</html>\n`;
  const outline = generateAstOutline(html, 'index.html');
  assert.match(outline, /Minified or bundled script detected/);
  assert.match(outline, /<style> L4-6/);
  assert.match(outline, /<script> L9-12 \(.*, inline\)/);
  assert.ok(!outline.includes('class extends'));
  assert.ok(outline.split('\n').length < 15);
});

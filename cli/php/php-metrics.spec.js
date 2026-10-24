import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { PHP_STRUCTURE_FIXTURES } from '../fixtures/php/structure.fixtures.js';
import { walk } from './php-walk.js';
import { complexityPass, structuralWeightPass, metricsPass, cyclomaticComplexity, controlDepth, RULE_DEFAULTS } from './php-metrics.js';

const run = (code, config) => {
  const ctx = buildPassContext(code, config ? { config } : {});
  metricsPass(ctx);
  return ctx.records;
};
const firstFunction = (code) => {
  const { ast } = buildPassContext(code);
  let found = null;
  walk(ast, (node) => {
    const isFunction = ['function', 'method', 'closure', 'arrowfunc'].includes(node.kind);
    found = found || (isFunction ? node : null);
  });
  return found;
};
const complexityOf = (body) => cyclomaticComplexity(firstFunction(`<?php\nfunction demo($a, $b, $c) {\n${body}\n}\n`));
const depthOf = (body) => controlDepth(firstFunction(`<?php\nfunction demo($a, $b, $c) {\n${body}\n}\n`));
const ids = (records) => records.map((r) => r.rule);

test('complexity: an empty function counts 1', () => {
  assert.equal(complexityOf('return 1;'), 1);
});

test('complexity: if, elseif and else count; else adds none', () => {
  assert.equal(complexityOf('if ($a) { return 1; } elseif ($b) { return 2; } else { return 3; }'), 3);
});

test('complexity: ternary, short ternary and null coalescing each count 1', () => {
  assert.equal(complexityOf('return $a ? 1 : 2;'), 2);
  assert.equal(complexityOf('return $a ?: 2;'), 2);
  assert.equal(complexityOf('return $a ?? 2;'), 2);
  assert.equal(complexityOf('return $a ?? $b ?? 2;'), 3);
});

test('complexity: && || and or each count 1, xor does not', () => {
  assert.equal(complexityOf('return $a && $b || $c;'), 3);
  assert.equal(complexityOf('return $a and $b or $c;'), 3);
  assert.equal(complexityOf('return $a xor $b;'), 1);
});

test('complexity: loops, do-while and catch count 1 each', () => {
  assert.equal(complexityOf('for ($i = 0; $i < 3; $i++) {} foreach ($a as $x) {} while ($b) {} do {} while ($c);'), 5);
  assert.equal(complexityOf('try { run(); } catch (A $e) {} catch (B $e) {}'), 3);
});

test('complexity: case with a test counts, default does not', () => {
  assert.equal(complexityOf('switch ($a) { case 1: break; case 2: break; default: break; }'), 3);
});

test('complexity: match arms count each condition, default does not', () => {
  assert.equal(complexityOf('return match ($a) { 1, 2 => "x", 3 => "y", default => "z" };'), 4);
});

test('complexity: a closure and an arrow fn are their own scope', () => {
  const code = '<?php\nfunction demo($a) {\n  $f = function ($x) { return $x ? 1 : ($x ?? 2); };\n  $g = fn($y) => $y ? 1 : 2;\n  return $a;\n}\n';
  assert.equal(cyclomaticComplexity(firstFunction(code)), 1);
});

test('complexity pass: reports a function over 12 at MEDIUM, with the closure scope separate', () => {
  const records = run(PHP_STRUCTURE_FIXTURES.COMPLEXITY_CYCLOMATIC_HIGH.bad);
  assert.deepEqual(ids(records), ['COMPLEXITY_CYCLOMATIC_HIGH']);
  assert.equal(records[0].severity, 'MEDIUM');
  assert.match(records[0].hazard, /13 > 12/);
});

test('complexity pass: methods, closures and arrow fns are each measured', () => {
  const branches = Array.from({ length: 13 }, (_, i) => `if ($v === ${i}) { $t++; }`).join(' ');
  const code = `<?php\nclass Demo_Box {\n  public function a($v) { $t = 0; ${branches} }\n  public function b($v) { $f = function ($v) { $t = 0; ${branches} }; }\n}\n`;
  assert.equal(run(code).filter((r) => r.rule === 'COMPLEXITY_CYCLOMATIC_HIGH').length, 2);
});

test('complexity pass: ruleConfig maxCyclomaticComplexity moves the threshold', () => {
  const code = '<?php\nfunction demo($a) { if ($a) { return 1; } if ($a > 1) { return 2; } return 3; }\n';
  assert.deepEqual(ids(run(code)), []);
  const strict = { rules: { maxCyclomaticComplexity: 2 }, overrides: [], wordpress: true };
  assert.deepEqual(ids(run(code, strict)), ['COMPLEXITY_CYCLOMATIC_HIGH']);
});

test('weight: elseif adds no depth; else and braces add one', () => {
  assert.equal(depthOf('if ($a) { return 1; } elseif ($b) { if ($c) { return 2; } } else { return 3; }'), 2);
  assert.equal(depthOf('if ($a) { return 1; } elseif ($b) { return 2; } elseif ($c) { return 3; }'), 1);
});

test('weight: loops, switch, try/catch and nesting accumulate', () => {
  assert.equal(depthOf('foreach ($a as $x) { while ($b) { switch ($c) { case 1: if ($x) { return 1; } } } }'), 4);
  assert.equal(depthOf('try { if ($a) { run(); } } catch (E $e) { if ($b) { run(); } }'), 2);
});

test('weight: nested functions are excluded', () => {
  assert.equal(depthOf('if ($a) { $f = function () { if ($b) { if ($c) { if ($a) { return 1; } } } }; }'), 1);
});

test('weight pass: depth 4 reports at MEDIUM, depth 3 is silent', () => {
  const records = run(PHP_STRUCTURE_FIXTURES.STRUCTURAL_WEIGHT_EXCEEDED.bad);
  assert.deepEqual(ids(records), ['STRUCTURAL_WEIGHT_EXCEEDED']);
  assert.equal(records[0].severity, 'MEDIUM');
  const three = '<?php\nfunction demo($a) { if ($a) { if ($a) { if ($a) { return 1; } } } }\n';
  assert.deepEqual(ids(run(three)), []);
});

for (const id of ['COMPLEXITY_CYCLOMATIC_HIGH', 'STRUCTURAL_WEIGHT_EXCEEDED']) {
  test(`${id}: fixture pair, bad fires and good is silent`, () => {
    const fixture = PHP_STRUCTURE_FIXTURES[id];
    const bad = buildPassContext(fixture.bad, { path: fixture.path, config: fixture.config });
    metricsPass(bad);
    assert.deepEqual([...new Set(ids(bad.records))], [id]);
    const good = buildPassContext(fixture.good, { path: fixture.path, config: fixture.config });
    metricsPass(good);
    assert.deepEqual(good.records, []);
  });
}

test('the passes can run alone and RULE_DEFAULTS names both ids', () => {
  const ctx = buildPassContext(PHP_STRUCTURE_FIXTURES.COMPLEXITY_CYCLOMATIC_HIGH.bad);
  structuralWeightPass(ctx);
  assert.deepEqual(ctx.records, []);
  complexityPass(ctx);
  assert.equal(ctx.records.length, 1);
  assert.deepEqual(Object.keys(RULE_DEFAULTS).sort(), ['COMPLEXITY_CYCLOMATIC_HIGH', 'STRUCTURAL_WEIGHT_EXCEEDED']);
});

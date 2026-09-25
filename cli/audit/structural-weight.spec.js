import { describe, it } from 'node:test';
import assert from 'node:assert';
import { auditCode } from './rules.js';

describe('AST Structural Weight & Pragmatic Profile Audit', () => {
  it('does NOT flag a 120-line cohesive molecule in default pragmatic mode', () => {
    // Generate a cohesive 115-line component with low complexity
    const staticRows = Array.from({ length: 100 }, (_, i) => `    { id: ${i}, label: 'Item ${i}' },`).join('\n');
    const code = `
export const SimpleTable = () => {
  const items = [
${staticRows}
  ];
  return items.length;
};
`;
    const violations = auditCode(code, 'src/components/molecules/m-table.js', 'src/components/molecules/m-table.js', {
      config: { profile: 'pragmatic', enforceFileLength: false }
    });

    const moleculeLineViolation = violations.find((v) => v.rule === 'LINE_BUDGET_MOLECULE');
    assert.strictEqual(moleculeLineViolation, undefined, 'Pragmatic mode should not flag a cohesive molecule under 250 lines');
  });

  it('strictly flags a 105-line molecule when profile is atomic-strict', () => {
    const staticRows = Array.from({ length: 102 }, (_, i) => `    { id: ${i} },`).join('\n');
    const code = `
export const StrictCard = () => {
  const rows = [
${staticRows}
  ];
  return rows.length;
};
`;
    const violations = auditCode(code, 'src/components/molecules/m-card.js', 'src/components/molecules/m-card.js', {
      config: { profile: 'atomic-strict', enforceFileLength: true }
    });

    const moleculeLineViolation = violations.find((v) => v.rule === 'LINE_BUDGET_MOLECULE');
    assert.ok(moleculeLineViolation, 'Atomic-strict mode should enforce 100-line molecule cap');
  });

  it('detects high cyclomatic complexity (CC > 12) via COMPLEXITY_CYCLOMATIC_HIGH', () => {
    const code = `
export function ComplexComponent(a, b, c, d, e, f, g) {
  if (a === 1) return 1;
  if (b === 2) return 2;
  if (c === 3) return 3;
  if (d === 4) return 4;
  if (e === 5) return 5;
  if (f === 6) return 6;
  if (g === 7) return 7;
  if (a && b) return 8;
  if (c && d) return 9;
  if (e && f) return 10;
  if (a || g) return 11;
  if (b || c) return 12;
  if (d || e) return 13;
  return 0;
}
`;
    const violations = auditCode(code, 'src/components/ComplexComponent.jsx', 'src/components/ComplexComponent.jsx', {
      config: { maxCyclomaticComplexity: 12 }
    });

    const complexityViolation = violations.find((v) => v.rule === 'COMPLEXITY_CYCLOMATIC_HIGH');
    assert.ok(complexityViolation, 'Should detect cyclomatic complexity exceeding threshold');
    assert.strictEqual(complexityViolation.severity, 'HIGH');
  });

  it('detects hook & state saturation (hooks > 4) via HOOK_STATE_SATURATION', () => {
    const code = `
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

export function MonolithicComponent() {
  const [s1, setS1] = useState(1);
  const [s2, setS2] = useState(2);
  const [s3, setS3] = useState(3);
  useEffect(() => {}, []);
  const m1 = useMemo(() => s1 + s2, [s1, s2]);
  return null;
}
`;
    const violations = auditCode(code, 'src/Component.jsx', 'src/Component.jsx', {
      config: { maxHookDensity: 4 }
    });

    const hookViolation = violations.find((v) => v.rule === 'HOOK_STATE_SATURATION');
    assert.ok(hookViolation, 'Should detect excessive hook density without domain encapsulation');
  });

  it('detects nested ternaries via CONTROL_FLOW_NESTED_TERNARY', () => {
    const code = `
export const BadTernary = (props) => {
  return props.a ? (props.b ? 'X' : 'Y') : 'Z';
};
`;
    const violations = auditCode(code, 'src/Ternary.jsx', 'src/Ternary.jsx');
    const ternaryViolation = violations.find((v) => v.rule === 'CONTROL_FLOW_NESTED_TERNARY');
    assert.ok(ternaryViolation, 'Should detect nested ternary expression');
  });

  it('detects prop surface area bloat (props > 7) via PROP_SURFACE_BLOAT', () => {
    const code = `
export const BloatedProps = ({ p1, p2, p3, p4, p5, p6, p7, p8, p9 }) => {
  return p1;
};
`;
    const violations = auditCode(code, 'src/Props.jsx', 'src/Props.jsx', {
      config: { maxPropCount: 7 }
    });

    const propViolation = violations.find((v) => v.rule === 'PROP_SURFACE_BLOAT');
    assert.ok(propViolation, 'Should detect prop count exceeding threshold');
  });
});

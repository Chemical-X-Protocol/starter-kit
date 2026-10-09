/**
 * PROP_SURFACE_BLOAT counts a React component's own data props, not the React
 * spelling of DOM passthrough, slots and emits (className, children, ReactNode slot
 * props, on* callbacks, ...rest), so React and Vue adapters of one atom grade
 * alike (#1675).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const rulesOf = (code, file = 'src/atoms/x-btn/x-btn.tsx') => auditCode(code, `/p/${file}`, file).map((v) => v.rule);

const REACT_ATOM = `import type { ReactNode } from 'react';
interface XBtnProps {
  label: string; size?: 'sm' | 'md'; variant?: string; disabled?: boolean;
  className?: string; children?: ReactNode; prepend?: ReactNode; append?: React.ReactNode;
  onClick?: () => void; onFocus?: () => void; style?: object;
}
export const XBtn = ({ label, size, variant, disabled, className, children, prepend, append, onClick, onFocus, style, ...rest }: XBtnProps) => (
  <button className={className} style={style} disabled={disabled} onClick={onClick} onFocus={onFocus} data-size={size} data-variant={variant} {...rest}>{prepend}{label}{children}{append}</button>
);
`;

test('React passthrough, slot and callback props do not count toward the prop surface', () => {
  assert.ok(!rulesOf(REACT_ATOM).includes('PROP_SURFACE_BLOAT'));
});

test('a component with more than seven data props is still flagged', () => {
  const code = `export const Card = ({ a, b, c, d, e, f, g, h, className }: { a: string; b: string; c: string; d: string; e: string; f: string; g: string; h: string; className?: string }) => <div className={className}>{a}{b}{c}{d}{e}{f}{g}{h}</div>;\n`;
  assert.ok(rulesOf(code, 'src/molecules/m-card.tsx').includes('PROP_SURFACE_BLOAT'));
});

test('the props type may sit on a React.FC<Props> variable annotation', () => {
  const code = `import React from 'react';
export interface P { a?: string; b?: string; c?: string; d?: string; e?: string; f?: string; g?: string; prepend?: React.ReactNode; append?: React.ReactNode }
export const XA: React.FC<P> = ({ a, b, c, d, e, f, g, prepend, append }) => <i>{prepend}{a}{b}{c}{d}{e}{f}{g}{append}</i>;
`;
  assert.ok(!rulesOf(code, 'src/atoms/x-a/x-a.tsx').includes('PROP_SURFACE_BLOAT'));
});

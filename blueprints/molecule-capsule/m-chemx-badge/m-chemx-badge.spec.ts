import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MChemxBadge, resolveGradeClass } from './m-chemx-badge';

describe('m-chemx-badge: resolveGradeClass', () => {
  it('resolves tier-a grade class for grade A variants', () => {
    expect(resolveGradeClass('A+')).toBe('m-chemx-badge__grade--a');
    expect(resolveGradeClass('a')).toBe('m-chemx-badge__grade--a');
  });

  it('resolves tier-b grade class for grade B variants', () => {
    expect(resolveGradeClass('B+')).toBe('m-chemx-badge__grade--b');
    expect(resolveGradeClass('b')).toBe('m-chemx-badge__grade--b');
  });

  it('resolves tier-c grade class for grade C variants', () => {
    expect(resolveGradeClass('C')).toBe('m-chemx-badge__grade--c');
    expect(resolveGradeClass('c')).toBe('m-chemx-badge__grade--c');
  });

  it('resolves tier-d grade class for grade D variants', () => {
    expect(resolveGradeClass('D')).toBe('m-chemx-badge__grade--d');
    expect(resolveGradeClass('d')).toBe('m-chemx-badge__grade--d');
  });

  it('resolves tier-f grade class for grade F and unclassified inputs', () => {
    expect(resolveGradeClass('F')).toBe('m-chemx-badge__grade--f');
    expect(resolveGradeClass('unknown')).toBe('m-chemx-badge__grade--f');
  });
});

describe('m-chemx-badge: MChemxBadge Component', () => {
  it('renders default badge markup with secure attributes', () => {
    const html = renderToStaticMarkup(React.createElement(MChemxBadge));

    expect(html).toContain('href="https://chemicalx.xophz.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('title="Verified by Chemical X Molecular Architecture Protocol"');
    expect(html).toContain('class="m-chemx-badge"');
    expect(html).toContain('class="m-chemx-badge__dot"');
    expect(html).toContain('AI Slop cleaned with Chemical X');
    expect(html).toContain('class="m-chemx-badge__grade m-chemx-badge__grade--a"');
    expect(html).toContain('[A+]');
  });

  it('prioritizes reportUrl over standard href when provided', () => {
    const customReport = 'https://reports.chemicalx.xophz.com/audit/42';
    const html = renderToStaticMarkup(
      React.createElement(MChemxBadge, {
        reportUrl: customReport,
        href: 'https://fallback.com'
      })
    );

    expect(html).toContain(`href="${customReport}"`);
  });

  it('applies custom label, grade, and className correctly', () => {
    const html = renderToStaticMarkup(
      React.createElement(MChemxBadge, {
        label: 'Custom Verified Audit',
        grade: 'B',
        className: 'custom-anchor-modifier'
      })
    );

    expect(html).toContain('class="m-chemx-badge custom-anchor-modifier"');
    expect(html).toContain('Custom Verified Audit');
    expect(html).toContain('class="m-chemx-badge__grade m-chemx-badge__grade--b"');
    expect(html).toContain('[B]');
  });
});

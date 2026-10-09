import React from 'react';
import type { MChemxBadgeProps } from './types';

export const resolveGradeClass = (grade: string): string => {
  const g = grade.toUpperCase();
  const isGradeA = g.startsWith('A');
  if (isGradeA) return 'm-chemx-badge__grade--a';
  const isGradeB = g.startsWith('B');
  if (isGradeB) return 'm-chemx-badge__grade--b';
  const isGradeC = g.startsWith('C');
  if (isGradeC) return 'm-chemx-badge__grade--c';
  const isGradeD = g.startsWith('D');
  if (isGradeD) return 'm-chemx-badge__grade--d';
  return 'm-chemx-badge__grade--f';
};

export const MChemxBadge: React.FC<MChemxBadgeProps> = ({
  label = 'AI Slop cleaned with Chemical X',
  grade = 'A+',
  href = 'https://chemicalx.xophz.com',
  reportUrl,
  className = ''
}) => {
  const gradeClass = resolveGradeClass(grade);
  const targetHref = reportUrl || href;
  const rootClass = `m-chemx-badge ${className}`.trim();

  return (
    <a
      href={targetHref}
      target="_blank"
      rel="noopener noreferrer"
      className={rootClass}
      title="Verified by Chemical X Molecular Architecture Protocol"
    >
      <span className="m-chemx-badge__dot" />
      <span className="m-chemx-badge__label">{label}</span>
      <span className={`m-chemx-badge__grade ${gradeClass}`}>[{grade}]</span>
    </a>
  );
};

export default MChemxBadge;

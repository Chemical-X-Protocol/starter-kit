import React from 'react';
import type { MChemxBadgeProps } from './types';

const resolveGradeClass = (grade: string) => {
  const g = grade.toUpperCase();
  if (g.startsWith('A')) return 'm-chemx-badge__grade--a';
  if (g.startsWith('B')) return 'm-chemx-badge__grade--b';
  if (g.startsWith('C')) return 'm-chemx-badge__grade--c';
  if (g.startsWith('D')) return 'm-chemx-badge__grade--d';
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

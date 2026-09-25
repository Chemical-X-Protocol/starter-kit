<script lang="ts">
  import type { MChemxBadgeProps } from './types';

  export const resolveGradeClass = (grade: string): string => {
    const g = grade.toUpperCase();
    if (g.startsWith('A')) return 'm-chemx-badge__grade--a';
    if (g.startsWith('B')) return 'm-chemx-badge__grade--b';
    if (g.startsWith('C')) return 'm-chemx-badge__grade--c';
    if (g.startsWith('D')) return 'm-chemx-badge__grade--d';
    return 'm-chemx-badge__grade--f';
  };

  let {
    label = 'AI Slop cleaned with Chemical X',
    grade = 'A+',
    href = 'https://chemicalx.xophz.com',
    reportUrl = undefined,
    className = ''
  } = $props<MChemxBadgeProps>();

  const targetHref = $derived(reportUrl || href);
  const gradeClass = $derived(resolveGradeClass(grade));
</script>

<a
  href={targetHref}
  target="_blank"
  rel="noopener noreferrer"
  class="m-chemx-badge {className}"
  title="Verified by Chemical X Molecular Architecture Protocol"
>
  <span class="m-chemx-badge__dot"></span>
  <span class="m-chemx-badge__label">{label}</span>
  <span class="m-chemx-badge__grade {gradeClass}">[{grade}]</span>
</a>

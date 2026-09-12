import { resolveGradeColor } from './reporter-utils.js';
import { getAsciiGradeLines } from './reporter-ascii.js';
import { getChemicalXGradientColor, ANSI } from '../theme.js';

const BANNER_ART = [
  ' ██████╗██╗  ██╗███████╗███╗   ███╗██╗ ██████╗ █████╗ ██╗         ██╗  ██╗',
  '██╔════╝██║  ██║██╔════╝████╗ ████║██║██╔════╝██╔══██╗██║         ╚██╗██╔╝',
  '██║     ███████║█████╗  ██╔████╔██║██║██║     ███████║██║          ╚███╔╝ ',
  '██║     ██╔══██║██╔══╝  ██║╚██╔╝██║██║██║     ██╔══██║██║          ██╔██╗ ',
  '╚██████╗██║  ██║███████╗██║ ╚═╝ ██║██║╚██████╗██║  ██║███████╗    ██╔╝ ██╗',
  ' ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝    ╚═╝  ╚═╝'
];

const MAX_BANNER_LEN = 74;

export const getChemicalXAsciiBanner = (gradeOrReport = null) => {
  const grade = typeof gradeOrReport === 'object' && gradeOrReport !== null
    ? gradeOrReport.health?.grade
    : gradeOrReport;

  const lines = [];
  lines.push(`                     ${ANSI.BOLD}${ANSI.GOLD}The Secret Sauce to Vibe Coding!${ANSI.RESET}`);

  const gColor = grade ? resolveGradeColor(grade) : '';
  const gradeLines = grade ? getAsciiGradeLines(grade, gColor, true) : [];
  const termWidth = process.stdout.columns || 0;
  const isSideBySide = Boolean(!termWidth || termWidth >= 105);

  for (let lineIdx = 0; lineIdx < BANNER_ART.length; lineIdx++) {
    const line = BANNER_ART[lineIdx];
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === ' ') {
        out += ' ';
        continue;
      }
      const t = i / (MAX_BANNER_LEN - 1);
      const { ansi } = getChemicalXGradientColor(t);
      out += `${ansi}${ANSI.BOLD}${ch}${ANSI.RESET}`;
    }

    if (isSideBySide && gradeLines.length > lineIdx) {
      out += `   ${gradeLines[lineIdx]}`;
    }

    lines.push(out);
  }

  const subtitle = 'Architectural guardrails to eliminate token burn and AI hallucinations.';
  const pad = ' '.repeat(Math.max(0, Math.floor((MAX_BANNER_LEN - subtitle.length) / 2)));
  lines.push(`${pad}\x1b[2m${subtitle}\x1b[0m\n`);

  if (!isSideBySide && gradeLines.length > 0) {
    for (const gl of gradeLines) {
      lines.push(`   ${gl}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

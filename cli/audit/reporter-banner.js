import { resolveGradeColor } from './reporter-utils.js';
import { getAsciiGradeLines } from './reporter-ascii.js';

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
  lines.push('                     \x1b[1m\x1b[37mThe Secret Sauce to \x1b[38;2;98;201;255mVibe Coding\x1b[0m');

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
      let r;
      let g;
      let b;
      if (t < 0.5) {
        const factor = t * 2;
        r = Math.round(244 * (1 - factor) + 192 * factor);
        g = Math.round(114 * (1 - factor) + 132 * factor);
        b = Math.round(182 * (1 - factor) + 252 * factor);
      } else {
        const factor = (t - 0.5) * 2;
        r = Math.round(192 * (1 - factor) + 129 * factor);
        g = Math.round(132 * (1 - factor) + 140 * factor);
        b = Math.round(252 * (1 - factor) + 248 * factor);
      }
      out += `\x1b[38;2;${r};${g};${b}m\x1b[1m${ch}\x1b[0m`;
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

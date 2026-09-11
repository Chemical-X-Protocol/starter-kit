import { BOLD, RESET } from './reporter-utils.js';

const EQUALS_GLYPH = [
  '        ',
  '███████╗',
  '╚══════╝',
  '███████╗',
  '╚══════╝',
  '        '
];

const LETTER_GLYPHS = {
  A: [
    ' █████╗ ',
    '██╔══██╗',
    '███████║',
    '██╔══██║',
    '██║  ██║',
    '╚═╝  ╚═╝'
  ],
  B: [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔══██╗',
    '██████╔╝',
    '╚═════╝ '
  ],
  C: [
    ' ██████╗',
    '██╔════╝',
    '██║     ',
    '██║     ',
    '╚██████╗',
    ' ╚═════╝'
  ],
  D: [
    '██████╗ ',
    '██╔══██╗',
    '██║  ██║',
    '██║  ██║',
    '██████╔╝',
    '╚═════╝ '
  ],
  F: [
    '███████╗',
    '██╔════╝',
    '█████╗  ',
    '██╔══╝  ',
    '██║     ',
    '╚═╝     '
  ],
  PLUS: [
    '       ',
    '  ██╗  ',
    '██████╗',
    '╚═██╔═╝',
    '  ╚═╝  ',
    '       '
  ]
};

export const getAsciiGradeLines = (grade = 'A', color = '', withEquals = false) => {
  const normGrade = String(grade || 'A').trim().toUpperCase();
  const letter = normGrade.replace('+', '');
  const hasPlus = normGrade.includes('+');
  const glyph = LETTER_GLYPHS[letter] || LETTER_GLYPHS.A;

  const lines = [];
  for (let i = 0; i < 6; i++) {
    let letterPart = glyph[i];
    if (hasPlus) {
      letterPart += ` ${LETTER_GLYPHS.PLUS[i]}`;
    }
    const coloredLetter = color ? `${color}${BOLD}${letterPart}${RESET}` : letterPart;

    if (withEquals) {
      const eqPart = `${BOLD}\x1b[37m${EQUALS_GLYPH[i]}${RESET}`;
      lines.push(`${eqPart}  ${coloredLetter}`);
    } else {
      lines.push(coloredLetter);
    }
  }
  return lines;
};

export const formatAsciiGrade = (grade = 'A', color = '', indent = '   ', withEquals = false) =>
  getAsciiGradeLines(grade, color, withEquals).map((l) => `${indent}${l}`).join('\n');

export const REPORT_CARD_ASCII = [
  '▗▄▄▖ ▗▄▄▄▖▗▄▄▖  ▗▄▖ ▗▄▄▖▗▄▄▄▖     ▗▄▄▖ ▗▄▖ ▗▄▄▖ ▗▄▄▄ ',
  '▐▌ ▐▌▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌ █      ▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌  █',
  '▐▛▀▚▖▐▛▀▀▘▐▛▀▘ ▐▌ ▐▌▐▛▀▚▖ █      ▐▌   ▐▛▀▜▌▐▛▀▚▖▐▌  █',
  '▐▌ ▐▌▐▙▄▄▖▐▌   ▝▚▄▞▘▐▌ ▐▌ █      ▝▚▄▄▖▐▌ ▐▌▐▌ ▐▌▐▙▄▄▀'
];

export const getReportCardAsciiLines = (color = '') =>
  REPORT_CARD_ASCII.map((row) => (color ? `${color}${BOLD}${row}${RESET}` : row));


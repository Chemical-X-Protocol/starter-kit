import { BOLD, RESET } from './reporter-utils.js';

const GRADE_BANNER = [
  ' ██████╗ ██████╗  █████╗ ██████╗ ███████╗',
  '██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██╔════╝',
  '██║  ███╗██████╔╝███████║██║  ██║█████╗  ',
  '██║   ██║██╔══██╗██╔══██║██║  ██║██╔══╝  ',
  '╚██████╔╝██║  ██║██║  ██║██████╔╝███████╗',
  ' ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝'
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

export const getAsciiGradeLines = (grade = 'A', color = '') => {
  const normGrade = String(grade || 'A').trim().toUpperCase();
  const letter = normGrade.replace('+', '');
  const hasPlus = normGrade.includes('+');
  const glyph = LETTER_GLYPHS[letter] || LETTER_GLYPHS.A;

  const lines = [];
  for (let i = 0; i < 6; i++) {
    let row = `${GRADE_BANNER[i]}    ${glyph[i]}`;
    if (hasPlus) {
      row += ` ${LETTER_GLYPHS.PLUS[i]}`;
    }
    lines.push(color ? `${color}${BOLD}${row}${RESET}` : row);
  }
  return lines;
};

export const formatAsciiGrade = (grade = 'A', color = '', indent = '   ') => {
  const lines = getAsciiGradeLines(grade, color);
  return lines.map((l) => `${indent}${l}`).join('\n');
};

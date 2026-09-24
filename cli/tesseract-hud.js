/**
 * tesseract-hud.js: Visual holographic HUD and ASCII energy lattice.
 * Single responsibility: Render the Tesseract matrix header and UI cards.
 */

import { ANSI, formatChemicalXGradient } from './theme.js';
import { isColorSupported } from './terminal.js';

const TESSERACT_CUBE = [
  '       +-------------------------+',
  '      /                         /|',
  '     /    <*> TESSERACT <*>    / |',
  '    /    NEURAL CORE LATTICE  /  |',
  '   +-------------------------+   |',
  '   |   * === [ATOM] === *    |   |',
  '   |   |   \\    |    /  |    |   |',
  '   |   |   [MOLECULE]   |    |   +',
  '   |   |   /    |    \\  |    |  /',
  '   |   * === [SYSTEM]== *    | /',
  '   +-------------------------+/',
  '    HUMAN-AI SYMBIOSIS MEDIUM'
];

export const renderTesseractAscii = () => {
  const useColor = isColorSupported();
  if (!useColor) {
    return TESSERACT_CUBE.join('\n');
  }

  return TESSERACT_CUBE.map((line, idx) => {
    const isTop = idx < 5;
    const isBottom = idx >= 10;
    if (isTop) return `${ANSI.CYAN}${line}${ANSI.RESET}`;
    if (isBottom) return `${ANSI.LIME}${ANSI.BOLD}${line}${ANSI.RESET}`;
    return `${ANSI.PINK}${line}${ANSI.RESET}`;
  }).join('\n');
};

export const renderHudHeader = () => {
  const ascii = renderTesseractAscii();
  const banner = formatChemicalXGradient('===============================================================');
  const title = `${ANSI.BOLD}${ANSI.CYAN}CHEMICAL X PROTOCOL : TESSERACT COGNITIVE BRIDGE${ANSI.RESET}`;
  const subtitle = `${ANSI.GOLD}Autonomous Human-AI Interface & Universal Molecular Program${ANSI.RESET}`;

  return [
    '',
    banner,
    ascii,
    banner,
    `  ${title}`,
    `  ${subtitle}`,
    banner,
    ''
  ].join('\n');
};

export const renderMetricPill = (label, value, ansiColor = ANSI.CYAN) => {
  return `[ ${ANSI.DIM}${label}:${ANSI.RESET} ${ansiColor}${ANSI.BOLD}${value}${ANSI.RESET} ]`;
};

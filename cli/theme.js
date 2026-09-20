/**
 * Chemical X Protocol: Official Comic Book Color Palette
 * Codified from Hall of the Gods Chemical X Vol. 1 Comic Book Edition
 *
 * Blossom Pink (#f43f85) -> Bubbles Cyan (#38bdf8) -> Buttercup Lime (#a3e635)
 * Golden Ribbon: (#fbbf24) | Midnight Violet Armor: (#181126)
 */

export const CHEMX_COLORS = Object.freeze({
  blossomPink: '#f43f85',
  powerPurple: '#a855f7',
  bubblesCyan: '#38bdf8',
  chemicalMint: '#2dd4bf',
  buttercupLime: '#a3e635',
  vibeGold: '#fbbf24',
  goldenRibbon: '#f59e0b',
  midnightViolet: '#181126',
  obsidian: '#090d16',
  slateBorder: '#26354a'
});

export const CHEMX_RGB = Object.freeze({
  blossomPink: [244, 63, 133],
  bubblesCyan: [56, 189, 248],
  buttercupLime: [163, 230, 53],
  vibeGold: [251, 191, 36]
});

export const ANSI = Object.freeze({
  PINK: '\x1b[38;2;244;63;133m',
  PURPLE: '\x1b[38;2;168;85;247m',
  CYAN: '\x1b[38;2;56;189;248m',
  MINT: '\x1b[38;2;45;212;191m',
  LIME: '\x1b[38;2;163;230;53m',
  GREEN: '\x1b[32m',
  GOLD: '\x1b[38;2;251;191;36m',
  RED: '\x1b[38;2;239;68;68m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  RESET: '\x1b[0m'
});

export const getChemicalXGradientColor = (t) => {
  const clamped = Math.max(0, Math.min(1, t));
  let r = 0;
  let g = 0;
  let b = 0;

  if (clamped < 0.45) {
    const factor = clamped / 0.45;
    r = Math.round(244 * (1 - factor) + 56 * factor);
    g = Math.round(63 * (1 - factor) + 189 * factor);
    b = Math.round(133 * (1 - factor) + 248 * factor);
  } else {
    const factor = (clamped - 0.45) / 0.55;
    r = Math.round(56 * (1 - factor) + 163 * factor);
    g = Math.round(189 * (1 - factor) + 230 * factor);
    b = Math.round(248 * (1 - factor) + 53 * factor);
  }

  return {
    r,
    g,
    b,
    ansi: `\x1b[38;2;${r};${g};${b}m`
  };
};

export const formatChemicalXGradient = (text) => {
  if (!text) return '';
  const len = text.length;
  if (len === 1) return `${ANSI.PINK}${ANSI.BOLD}${text}${ANSI.RESET}`;

  let out = '';
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    const t = i / (len - 1);
    const { ansi } = getChemicalXGradientColor(t);
    out += `${ansi}${ANSI.BOLD}${ch}${ANSI.RESET}`;
  }
  return out;
};

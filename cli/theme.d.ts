export interface ChemxGradientColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly ansi: string;
}

export declare const CHEMX_COLORS: {
  readonly blossomPink: string;
  readonly powerPurple: string;
  readonly bubblesCyan: string;
  readonly chemicalMint: string;
  readonly buttercupLime: string;
  readonly vibeGold: string;
  readonly goldenRibbon: string;
  readonly midnightViolet: string;
  readonly obsidian: string;
  readonly slateBorder: string;
};

export declare const CHEMX_RGB: {
  readonly blossomPink: readonly [number, number, number];
  readonly bubblesCyan: readonly [number, number, number];
  readonly buttercupLime: readonly [number, number, number];
  readonly vibeGold: readonly [number, number, number];
};

export declare const ANSI: {
  readonly PINK: string;
  readonly PURPLE: string;
  readonly CYAN: string;
  readonly MINT: string;
  readonly LIME: string;
  readonly GOLD: string;
  readonly BOLD: string;
  readonly DIM: string;
  readonly RESET: string;
};

export declare function getChemicalXGradientColor(t: number): ChemxGradientColor;
export declare function formatChemicalXGradient(text: string): string;

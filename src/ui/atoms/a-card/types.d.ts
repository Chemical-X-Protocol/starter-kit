export type CardVariant = 'glass' | 'surface' | 'outlined' | 'subtle';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps {
  readonly variant?: CardVariant;
  readonly padding?: CardPadding;
  readonly interactive?: boolean;
}

export interface CardEmits {
  (e: 'click', event: MouseEvent): void;
}

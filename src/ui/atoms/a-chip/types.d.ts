export type ChipTone = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'sky' | 'lime' | 'pink';

export interface ChipProps {
  readonly label?: string;
  readonly tone?: ChipTone;
  readonly icon?: string;
  readonly removable?: boolean;
  readonly active?: boolean;
  readonly clickable?: boolean;
}

export interface ChipEmits {
  (e: 'click', event: MouseEvent): void;
  (e: 'remove', event: MouseEvent): void;
}

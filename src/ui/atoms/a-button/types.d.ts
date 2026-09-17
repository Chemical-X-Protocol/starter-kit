export type ButtonVariant = 'primary' | 'ghost' | 'glass' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  readonly type?: 'button' | 'submit' | 'reset';
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
}

export interface ButtonEmits {
  (e: 'click', event: MouseEvent): void;
}

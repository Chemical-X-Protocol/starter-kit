export interface DialogProps {
  readonly open?: boolean;
  readonly title?: string;
  readonly maxWidth?: string;
}

export interface DialogEmits {
  (e: 'close'): void;
}

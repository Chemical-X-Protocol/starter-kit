export type BadgeTone =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'slate'
  | 'pink'
  | 'lime'
  | 'sky';

export interface BadgeProps {
  readonly label?: string | number;
  readonly tone?: BadgeTone;
  readonly dot?: boolean;
  readonly max?: number;
}

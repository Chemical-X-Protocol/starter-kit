export interface MSampleCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly value: number;
  readonly status?: 'active' | 'archived';
  readonly onAction?: () => void;
}

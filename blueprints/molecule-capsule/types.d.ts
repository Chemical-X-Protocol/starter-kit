export interface MSampleCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly value: number;
  readonly status?: 'active' | 'archived';
  readonly onAction?: () => void;
}

export interface SampleCardBadgeDescriptor {
  readonly text: string;
  readonly className: string;
}

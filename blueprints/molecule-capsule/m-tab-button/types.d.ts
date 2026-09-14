export type TabTone = 'lime' | 'pink' | 'sky' | 'slate';

export interface TabButtonProps {
  readonly label: string;
  readonly icon?: string;
  readonly isActive?: boolean;
  readonly activeTone?: TabTone;
  readonly isFlexible?: boolean;
}

export type TabButtonEmits = {
  (e: 'click'): void;
  (e: 'select'): void;
};

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly badge?: string | number;
}

export interface NavDrawerProps {
  readonly open?: boolean;
  readonly activePage?: string;
  readonly taskCount?: number;
  readonly lockCount?: number;
  readonly fileCount?: number;
  readonly attentionCount?: number;
}

export interface NavDrawerEmits {
  (e: 'navigate', pageKey: string): void;
  (e: 'close'): void;
}

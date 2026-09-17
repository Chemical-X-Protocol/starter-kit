export interface SettingsPanelProps {
  readonly lastMessage?: string;
  readonly isSuccess?: boolean;
}

export interface SettingsPanelEmits {
  (e: 'action', action: string, payload?: Record<string, any>): void;
}

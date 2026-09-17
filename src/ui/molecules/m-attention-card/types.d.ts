export type AttentionType = 'prompt' | 'command' | 'task' | 'lock';

export interface AttentionItem {
  readonly id: string;
  readonly source: string;
  readonly title: string;
  readonly detail: string;
  readonly type: AttentionType;
  readonly conversationId?: string | null;
  readonly timestamp: string;
}

export interface AttentionCardProps {
  readonly item: AttentionItem;
}

export interface AttentionCardEmits {
  (e: 'confirm', id: string, action: 'approve' | 'reject'): void;
}

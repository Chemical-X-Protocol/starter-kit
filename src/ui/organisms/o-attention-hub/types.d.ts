import type { AttentionItem } from '../../molecules/m-attention-card/types';

export interface AttentionHubProps {
  readonly items?: AttentionItem[];
  readonly antigravityRunning?: boolean;
}

export interface AttentionHubEmits {
  (e: 'confirm', id: string, action: 'approve' | 'reject'): void;
  (e: 'refresh'): void;
}

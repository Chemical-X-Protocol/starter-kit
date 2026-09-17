export interface TaskItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly assignedTo?: string;
  readonly priority?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  readonly conversationId?: string;
  readonly chatLink?: string;
}

export interface TaskCardProps {
  readonly task: TaskItem;
  readonly currentAgentId?: string;
}

export interface TaskCardEmits {
  (e: 'claim', taskId: string): void;
  (e: 'complete', taskId: string): void;
}

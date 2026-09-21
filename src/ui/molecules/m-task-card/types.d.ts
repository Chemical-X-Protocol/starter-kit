export interface ViolationDetail {
  readonly line?: number;
  readonly rule?: string;
  readonly hazard?: string;
}

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
  readonly originType?: 'audit' | 'manual';
  readonly ruleId?: string;
  readonly targetPath?: string;
  readonly violationSnapshot?: {
    readonly lines?: number;
    readonly rules?: string;
    readonly healthBefore?: number;
    readonly hazardCountBefore?: number;
  };
  readonly diffReceipt?: {
    readonly verified?: boolean;
    readonly forced?: boolean;
    readonly healthBefore?: number;
    readonly healthAfter?: number;
    readonly hazardsResolved?: number;
    readonly completedAt?: number;
  };
  readonly refusal?: {
    readonly message?: string;
    readonly hazardCount?: number;
    readonly violations?: ReadonlyArray<ViolationDetail>;
  };
}

export interface TaskCardProps {
  readonly task: TaskItem;
  readonly currentAgentId?: string;
}

export interface TaskCardDisplay {
  readonly statusTone: 'lime' | 'primary' | 'warning';
  readonly provenanceLabel: string;
  readonly provenanceTone: 'success' | 'subtle';
  readonly canClaim: boolean;
  readonly canComplete: boolean;
  readonly hasRefusal: boolean;
  readonly hasReceipt: boolean;
  readonly isForced: boolean;
}

export interface TaskCardEmits {
  (e: 'claim', taskId: string): void;
  (e: 'complete', taskId: string, force?: boolean): void;
}

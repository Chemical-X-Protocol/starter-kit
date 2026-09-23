export interface ProjectSession {
  readonly id: number;
  readonly title: string;
  readonly goal_description: string;
  readonly status: 'active' | 'paused' | 'completed' | 'waiting_for_input' | string;
  readonly mode: 'turn_driven' | 'daemon';
  readonly budget_limit_usd: number;
  readonly budget_spent_usd: number;
  readonly max_turns: number;
  readonly current_turn: number;
}

export interface ProjectMessage {
  readonly id: number;
  readonly project_id: number;
  readonly turn_index: number;
  readonly author_id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly message: string;
  readonly created_at: number;
}

export interface ProjectLearning {
  readonly id: number;
  readonly tier: string;
  readonly pattern: string;
  readonly rule_text: string;
  readonly verified_count: number;
}

export interface ProjectConsoleProps {
  readonly session: ProjectSession | null;
  readonly messages: readonly ProjectMessage[];
  readonly learnings: readonly ProjectLearning[];
}

export interface ProjectConsoleEmits {
  (e: 'step'): void;
  (e: 'chat', message: string): void;
  (e: 'toggle-pause'): void;
}

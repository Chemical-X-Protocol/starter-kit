import type { BadgeTone } from '../../atoms/a-badge/types';

export interface SwarmAgent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: 'idle' | 'busy' | 'offline';
  readonly currentTaskId?: number | null;
  readonly heartbeat: number;
  readonly capabilities?: readonly string[];
}

export interface AgentCardProps {
  readonly agent: SwarmAgent;
  readonly isSelected?: boolean;
}

export interface AgentCardEmits {
  (e: 'select', agent: SwarmAgent): void;
}

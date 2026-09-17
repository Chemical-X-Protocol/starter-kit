import type { SwarmAgent } from '../../molecules/m-agent-card/types';

export type AgentFilter = 'all' | 'active' | 'idle' | 'offline';

export interface AgentRailProps {
  readonly agents?: readonly SwarmAgent[];
  readonly selectedAgentId?: string;
}

export interface AgentRailEmits {
  (e: 'select', agent: SwarmAgent): void;
}

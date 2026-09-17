import { computed } from 'vue';
import type { BadgeTone } from '../../atoms/a-badge/types';
import type { AgentCardProps, AgentCardEmits } from './types';

const ROLE_TONES: Record<string, BadgeTone> = {
  architect: 'secondary',
  specialist: 'sky',
  implementer: 'lime',
  qa: 'warning',
  auditor: 'pink'
};

export const resolveRoleTone = (role: string = ''): BadgeTone => {
  const normalized = role.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, tone] of Object.entries(ROLE_TONES)) {
    if (normalized.includes(key)) return tone;
  }
  return 'primary';
};

export const formatHeartbeat = (timestamp: number): string => {
  if (!timestamp) return 'inactive';
  const deltaSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  return `${Math.floor(deltaMin / 60)}h ago`;
};

export function useAgentCardController(props: AgentCardProps, emit: AgentCardEmits) {
  const isOnline = computed((): boolean => props.agent.status !== 'offline');
  const isBusy = computed((): boolean => props.agent.status === 'busy');
  const hasCurrentTask = computed((): boolean => (
    props.agent.currentTaskId !== null && props.agent.currentTaskId !== undefined
  ));
  const isActivelyWorking = computed((): boolean => isOnline.value && (isBusy.value || hasCurrentTask.value));

  const roleTone = computed((): BadgeTone => resolveRoleTone(props.agent.role));
  const heartbeatLabel = computed((): string => formatHeartbeat(props.agent.heartbeat));

  const statusTone = computed((): BadgeTone => {
    if (!isOnline.value) return 'slate';
    if (isBusy.value) return 'warning';
    return 'lime';
  });

  const handleSelect = () => {
    emit('select', props.agent);
  };

  return {
    isActivelyWorking,
    roleTone,
    statusTone,
    heartbeatLabel,
    handleSelect
  };
}

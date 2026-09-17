import { computed } from 'vue';
import type { FeedPostProps, EventConfig } from './types';

const EVENT_CONFIGS: Record<string, EventConfig> = {
  broadcast: { tone: 'primary', label: 'Broadcast', icon: '⚡' },
  lock_acquired: { tone: 'warning', label: 'Lock Acquired', icon: '🔒' },
  lock_released: { tone: 'success', label: 'Lock Released', icon: '🔓' },
  task_claim: { tone: 'secondary', label: 'Task Claimed', icon: '📌' },
  task_done: { tone: 'lime', label: 'Task Completed', icon: '✔' },
  task_blocked: { tone: 'error', label: 'Task Blocked', icon: '⚠️' }
};

export const resolveEventConfig = (eventType: string = ''): EventConfig => {
  if (Object.hasOwn(EVENT_CONFIGS, eventType)) {
    return EVENT_CONFIGS[eventType];
  }
  return { tone: 'sky', label: eventType || 'Event', icon: '•' };
};

export const formatRelativeTime = (timestamp: number): string => {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

export function useFeedPostController(props: FeedPostProps) {
  const isRecent = computed((): boolean => (Date.now() - props.post.timestamp) < 60000);
  const isBroadcast = computed((): boolean => props.post.eventType === 'broadcast');
  const isHighlight = computed((): boolean => isRecent.value && isBroadcast.value);

  const eventConfig = computed((): EventConfig => resolveEventConfig(props.post.eventType));
  const timeLabel = computed((): string => formatRelativeTime(props.post.timestamp));

  const hasChannel = computed((): boolean => Boolean(
    props.post.channel && props.post.channel !== 'general'
  ));

  return {
    isHighlight,
    eventConfig,
    timeLabel,
    hasChannel
  };
}

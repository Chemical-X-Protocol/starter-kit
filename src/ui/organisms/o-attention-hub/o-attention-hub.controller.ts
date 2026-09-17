import { computed } from 'vue';
import type { AttentionHubProps, AttentionHubEmits } from './types';
import type { BadgeTone } from '../../atoms/a-badge/types';

export function useAttentionHubController(props: AttentionHubProps, emit: AttentionHubEmits) {
  const hasItems = computed(() => Boolean(props.items && props.items.length > 0));
  const isAgConnected = computed(() => Boolean(props.antigravityRunning));

  const statusLabel = computed(() => (
    isAgConnected.value ? 'Antigravity Core Active' : 'Antigravity Standby'
  ));

  const statusTone = computed<BadgeTone>(() => (
    isAgConnected.value ? 'success' : 'slate'
  ));

  const handleRefresh = () => {
    emit('refresh');
  };

  return {
    hasItems,
    statusLabel,
    statusTone,
    handleRefresh
  };
}

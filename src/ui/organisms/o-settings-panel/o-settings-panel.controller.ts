import { ref } from 'vue';
import type { SettingsPanelProps, SettingsPanelEmits } from './types';

export function useSettingsPanelController(props: SettingsPanelProps, emit: SettingsPanelEmits) {
  const busyTimeoutMs = ref('5000');

  const handleAction = (type: 'vacuum' | 'clear_feed' | 'reset_leases' | 'heartbeat' | 'busy_timeout') => {
    if (type === 'busy_timeout') {
      emit('action', 'busy_timeout', { timeoutMs: Number(busyTimeoutMs.value) || 5000 });
      return;
    }
    emit('action', type);
  };

  return {
    busyTimeoutMs,
    handleAction
  };
}

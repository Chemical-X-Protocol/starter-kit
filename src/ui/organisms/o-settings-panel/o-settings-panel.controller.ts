import { ref } from 'vue';
import type { SettingsPanelProps, SettingsPanelEmits } from './types';

export function useSettingsPanelController(props: SettingsPanelProps, emit: SettingsPanelEmits) {
  const busyTimeoutMs = ref('5000');

  const handleVacuum = () => { emit('action', 'vacuum'); };
  const handleClearFeed = () => { emit('action', 'clear_feed'); };
  const handleResetLeases = () => { emit('action', 'reset_leases'); };
  const handleHeartbeat = () => { emit('action', 'heartbeat'); };
  const handleBusyTimeout = () => {
    emit('action', 'busy_timeout', { timeoutMs: Number(busyTimeoutMs.value) || 5000 });
  };

  return {
    busyTimeoutMs,
    actions: {
      vacuum: handleVacuum,
      clearFeed: handleClearFeed,
      resetLeases: handleResetLeases,
      heartbeat: handleHeartbeat,
      busyTimeout: handleBusyTimeout
    }
  };
}

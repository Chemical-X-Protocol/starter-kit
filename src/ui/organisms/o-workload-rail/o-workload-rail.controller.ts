import { computed } from 'vue';
import type { WorkloadRailProps } from './types';

export function useWorkloadRailController(props: WorkloadRailProps) {
  const activeLeases = computed(() => props.leases || []);
  const taskList = computed(() => props.tasks || []);

  const totalLocksCount = computed((): number => activeLeases.value.length);
  const waitingCount = computed((): number => props.waitingLocksCount || 0);

  const inProgressTasks = computed(() => (
    taskList.value.filter((t) => t.status === 'in_progress' || t.status === 'in-progress')
  ));
  const queuedTasks = computed(() => (
    taskList.value.filter((t) => t.status === 'queued')
  ));
  const doneTasks = computed(() => (
    taskList.value.filter((t) => t.status === 'done')
  ));

  const hasActiveLocks = computed((): boolean => totalLocksCount.value > 0);
  const hasQueueWaiters = computed((): boolean => waitingCount.value > 0);
  const isLockSystemBusy = computed((): boolean => hasActiveLocks.value || hasQueueWaiters.value);

  const promptTokens = computed((): number => props.telemetry?.promptTokens || 0);
  const completionTokens = computed((): number => props.telemetry?.completionTokens || 0);
  const totalTokens = computed((): number => props.telemetry?.totalTokens || (promptTokens.value + completionTokens.value));
  const totalCost = computed((): number => props.telemetry?.totalCost || 0);

  return {
    activeLeases,
    tasksByStatus: {
      inProgress: inProgressTasks,
      queued: queuedTasks,
      done: doneTasks
    },
    locksSummary: {
      total: totalLocksCount,
      waiting: waitingCount,
      isBusy: isLockSystemBusy
    },
    tokenStats: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
      cost: totalCost
    }
  };
}

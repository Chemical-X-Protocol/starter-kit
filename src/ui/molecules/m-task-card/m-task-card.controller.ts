import { computed } from 'vue';
import type { TaskCardProps, TaskCardEmits } from './types';

export function useTaskCardController(props: TaskCardProps, emit: TaskCardEmits) {
  const isQueued = computed(() => props.task.status === 'queued');
  const isInProgress = computed(() => props.task.status === 'in_progress');
  const isDone = computed(() => props.task.status === 'completed' || props.task.status === 'done');

  const canClaim = computed(() => isQueued.value);
  const canComplete = computed(() => isInProgress.value);

  const statusTone = computed(() => {
    if (isDone.value) return 'lime';
    if (isInProgress.value) return 'primary';
    return 'warning';
  });

  const handleClaim = () => {
    if (!canClaim.value) return;
    emit('claim', props.task.id);
  };

  const handleComplete = () => {
    if (!canComplete.value) return;
    emit('complete', props.task.id);
  };

  return {
    canClaim,
    canComplete,
    statusTone,
    handleClaim,
    handleComplete
  };
}

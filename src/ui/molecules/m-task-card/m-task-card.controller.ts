import { ref, computed } from 'vue';
import type { TaskCardProps, TaskCardEmits, TaskCardDisplay } from './types';

export function useTaskCardController(props: TaskCardProps, emit: TaskCardEmits) {
  const isDetailsOpen = ref(false);

  const isQueued = computed(() => props.task.status === 'queued');
  const isInProgress = computed(() => props.task.status === 'in_progress');
  const isDone = computed(() => props.task.status === 'completed' || props.task.status === 'done');

  const canClaim = computed(() => isQueued.value);
  const canComplete = computed(() => isInProgress.value);

  const isAuditDerived = computed(() => (
    props.task.originType === 'audit' || Boolean(props.task.targetPath)
  ));
  const hasRefusal = computed(() => Boolean(props.task.refusal));
  const hasReceipt = computed(() => Boolean(props.task.diffReceipt?.verified));
  const isForced = computed(() => Boolean(props.task.diffReceipt?.forced));

  const statusTone = computed(() => {
    if (isDone.value) return 'lime';
    if (isInProgress.value) return 'primary';
    return 'warning';
  });

  const provenanceLabel = computed(() => (
    isAuditDerived.value ? 'Verified against codebase' : 'Self-reported'
  ));

  const provenanceTone = computed(() => (
    isAuditDerived.value ? 'success' : 'subtle'
  ));

  const display = computed<TaskCardDisplay>(() => ({
    statusTone: statusTone.value,
    provenanceLabel: provenanceLabel.value,
    provenanceTone: provenanceTone.value,
    canClaim: canClaim.value,
    canComplete: canComplete.value,
    hasRefusal: hasRefusal.value,
    hasReceipt: hasReceipt.value,
    isForced: isForced.value
  }));

  const toggleDetails = () => {
    isDetailsOpen.value = !isDetailsOpen.value;
  };

  const executeClaim = () => {
    if (!canClaim.value) return;
    emit('claim', props.task.id);
  };

  const executeComplete = (force = false) => {
    if (!canComplete.value) return;
    emit('complete', props.task.id, force);
  };

  return {
    isDetailsOpen,
    display,
    toggleDetails,
    executeClaim,
    executeComplete
  };
}

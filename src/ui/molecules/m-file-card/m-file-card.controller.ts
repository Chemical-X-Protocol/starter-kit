import { computed } from 'vue';
import type { FileCardProps, FileCardEmits } from './types';

export function useFileCardController(props: FileCardProps, emit: FileCardEmits) {
  const isViolation = computed(() => props.file.lines > 100);
  const isWarning = computed(() => props.file.lines >= 85 && props.file.lines <= 100);
  const isHealthy = computed(() => !isViolation.value && !isWarning.value);

  const linesTone = computed(() => {
    if (isViolation.value) return 'pink';
    if (isWarning.value) return 'warning';
    return 'lime';
  });

  const healthScore = computed(() => props.file.healthScore || 100);

  const handleSelect = () => {
    emit('select', props.file.path);
  };

  return {
    linesTone,
    healthScore,
    handleSelect
  };
}

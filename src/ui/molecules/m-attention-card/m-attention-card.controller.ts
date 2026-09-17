import { computed } from 'vue';
import type { AttentionCardProps, AttentionCardEmits, AttentionType } from './types';
import type { ChipTone } from '../../atoms/a-chip/types';

export function useAttentionCardController(props: AttentionCardProps, emit: AttentionCardEmits) {
  const typeTone = computed<ChipTone>(() => {
    const toneMap: Record<AttentionType, ChipTone> = {
      command: 'warning',
      prompt: 'sky',
      task: 'lime',
      lock: 'pink'
    };
    return toneMap[props.item.type] || 'default';
  });

  const formattedTime = computed(() => {
    if (!props.item.timestamp) return '';
    const date = new Date(props.item.timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const handleApprove = () => {
    emit('confirm', props.item.id, 'approve');
  };

  const handleReject = () => {
    emit('confirm', props.item.id, 'reject');
  };

  return {
    typeTone,
    formattedTime,
    handleApprove,
    handleReject
  };
}

import { ref, computed } from 'vue';
import type { ProjectConsoleProps, ProjectConsoleEmits } from './types';

export function useProjectConsoleController(props: ProjectConsoleProps, emit: ProjectConsoleEmits) {
  const chatInput = ref('');

  const isPaused = computed(() => props.session?.status.startsWith('paused') ?? false);
  const statusTone = computed(() => {
    if (!props.session) return 'default';
    if (props.session.status === 'completed') return 'success';
    if (isPaused.value) return 'warning';
    return 'primary';
  });

  const spendLabel = computed(() => {
    if (!props.session) return '$0.00 / $0.00 USD';
    const spent = props.session.budget_spent_usd || 0;
    const limit = props.session.budget_limit_usd || 2.0;
    return `$${spent.toFixed(4)} / $${limit.toFixed(2)} USD`;
  });

  const handleAction = (action: 'step' | 'chat' | 'toggle-pause') => {
    if (action === 'step') {
      emit('step');
      return;
    }
    if (action === 'toggle-pause') {
      emit('toggle-pause');
      return;
    }
    const text = chatInput.value.trim();
    const canSend = Boolean(text);
    if (!canSend) return;
    emit('chat', text);
    chatInput.value = '';
  };

  return {
    chatInput,
    isPaused,
    statusTone,
    spendLabel,
    handleAction
  };
}

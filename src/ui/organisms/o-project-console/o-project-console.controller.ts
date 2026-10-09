import { ref, computed } from 'vue';
import type { ProjectConsoleProps, ProjectConsoleEmits } from './types';
import { ruleTree } from '../../../../hooks/rules';

export function useProjectConsoleController(props: ProjectConsoleProps, emit: ProjectConsoleEmits) {
  const chatInput = ref('');

  const isPaused = computed(() => props.session?.status.startsWith('paused') ?? false);
  const statusTone = computed(() => {
    const hasSession = Boolean(props.session);
    if (!hasSession) return 'default';
    const isCompleted = props.session?.status === 'completed';
    if (isCompleted) return 'success';
    if (isPaused.value) return 'warning';
    return 'primary';
  });

  const spendLabel = computed(() => {
    const hasSession = Boolean(props.session);
    if (!hasSession) return '$0.00 / $0.00 USD';
    const spent = props.session?.budget_spent_usd || 0;
    const limit = props.session?.budget_limit_usd || 2.0;
    return `$${spent.toFixed(4)} / $${limit.toFixed(2)} USD`;
  });

  const handleAction = (action: 'step' | 'chat' | 'toggle-pause') => {
    const text = chatInput.value.trim();
    const gate = ruleTree(
      {
        route: {
          step: action === 'step',
          togglePause: () => action === 'toggle-pause',
          emptyChat: () => !text
        }
      },
      { failFast: true }
    );
    const isRoutedAway = !gate.ok;
    if (isRoutedAway) {
      const isStepAction = gate.first === 'route.step';
      const isTogglePauseAction = gate.first === 'route.togglePause';
      if (isStepAction) emit('step');
      if (isTogglePauseAction) emit('toggle-pause');
      return;
    }
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

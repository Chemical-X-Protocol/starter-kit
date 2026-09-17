import { computed } from 'vue';
import type { SavingsBadgeProps, SavingsBadgeEmits } from './types';

export function useSavingsBadgeController(props: SavingsBadgeProps, emit: SavingsBadgeEmits) {
  const tokensSaved = computed(() => props.savings?.tokensSaved || 0);
  const dollarsSaved = computed(() => props.savings?.dollarsSaved || 0);

  const hasSavings = computed(() => tokensSaved.value > 0);
  const formattedTokens = computed(() => tokensSaved.value.toLocaleString());
  const formattedDollars = computed(() => dollarsSaved.value.toFixed(2));

  const badgeText = computed(() => {
    if (!hasSavings.value) {
      return '⚡ Chemical X Active';
    }
    return `⚡ Chemical X has saved you ${formattedTokens.value} Tokens / $${formattedDollars.value} burn avoided`;
  });

  const handleClick = () => {
    emit('click');
  };

  return {
    badgeText,
    hasSavings,
    handleClick
  };
}

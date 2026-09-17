import { computed } from 'vue';
import type { TokenStatProps } from './types';

export const formatCompactNumber = (val: number = 0): string => {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return String(val);
};

export const formatCurrency = (val?: number): string => {
  if (val === undefined || val === null) return '';
  return `$${val.toFixed(4)}`;
};

export function useTokenStatController(props: TokenStatProps) {
  const hasCost = computed((): boolean => (
    props.costEstimate !== undefined && props.costEstimate !== null
  ));
  const isHighVolume = computed((): boolean => props.count >= 1_000_000);

  const formattedCount = computed((): string => formatCompactNumber(props.count));
  const formattedCost = computed((): string => formatCurrency(props.costEstimate));

  return {
    hasCost,
    isHighVolume,
    formattedCount,
    formattedCost
  };
}

import { computed } from 'vue';
import type { TabButtonProps, TabTone } from './types';

const TONE_CLASSES: Record<TabTone, string> = {
  lime: 'm-tab-button--lime',
  pink: 'm-tab-button--pink',
  slate: 'm-tab-button--slate',
  sky: 'm-tab-button--sky'
};

export function useTabButtonController(props: TabButtonProps, emit: (event: 'click' | 'select') => void) {
  const isSelected = computed((): boolean => Boolean(props.isActive));

  const resolveToneClass = (tone: TabTone = 'sky'): string => {
    return TONE_CLASSES[tone] || TONE_CLASSES.sky;
  };

  const stateClass = computed((): string => {
    return isSelected.value ? resolveToneClass(props.activeTone) : 'm-tab-button--inactive';
  });

  const flexClass = computed((): string => {
    return props.isFlexible ? 'm-tab-button--flexible' : '';
  });

  const modifierClasses = computed((): string[] => {
    return [stateClass.value, flexClass.value].filter(Boolean);
  });

  const handleClick = () => {
    emit('click');
    emit('select');
  };

  return {
    isSelected,
    modifierClasses,
    handleClick
  };
}

import { computed } from 'vue';
import type { TabButtonProps, TabTone } from './types';

export function useTabButtonController(props: TabButtonProps, emit: (event: 'click' | 'select') => void) {
  const isSelected = computed((): boolean => Boolean(props.isActive));

  const resolveToneClass = (tone: TabTone = 'sky'): string => {
    switch (tone) {
      case 'lime':
        return 'm-tab-button--lime';
      case 'pink':
        return 'm-tab-button--pink';
      case 'slate':
        return 'm-tab-button--slate';
      case 'sky':
      default:
        return 'm-tab-button--sky';
    }
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

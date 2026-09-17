import { computed } from 'vue';
import type { AppHeaderProps, AppHeaderEmits } from './types';

export function useAppHeaderController(props: AppHeaderProps, emit: AppHeaderEmits) {
  const pageLabel = computed(() => {
    const map: Record<string, string> = {
      social: 'Live Timeline',
      tasks: 'Tasks & Workload',
      locks: 'File Locks Hub',
      codebase: 'AST Codebase',
      settings: 'Settings & Control'
    };
    return map[props.activePage || 'social'] || 'Live Swarm';
  });

  const handleToggleMenu = () => { emit('toggle-menu'); };
  const handleOpenSavings = () => { emit('open-savings'); };

  return {
    pageLabel,
    handleToggleMenu,
    handleOpenSavings
  };
}

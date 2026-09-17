import { computed } from 'vue';
import type { NavDrawerProps, NavDrawerEmits, NavItem } from './types';

export function useNavDrawerController(props: NavDrawerProps, emit: NavDrawerEmits) {
  const isOpen = computed(() => Boolean(props.open));

  const items = computed<NavItem[]>(() => [
    { id: 'attention', label: 'Attention Inbox', icon: '🔔', badge: props.attentionCount },
    { id: 'social', label: 'Timeline & Feed', icon: '📡' },
    { id: 'tasks', label: 'Tasks & Workload', icon: '📋', badge: props.taskCount },
    { id: 'locks', label: 'File Locks Hub', icon: '🔒', badge: props.lockCount },
    { id: 'codebase', label: 'AST Codebase', icon: '🧬', badge: props.fileCount },
    { id: 'database', label: 'Database Studio', icon: '💾' },
    { id: 'settings', label: 'Swarm Controls', icon: '⚙️' }
  ]);

  const handleSelect = (pageKey: string) => {
    emit('navigate', pageKey);
  };

  const handleClose = () => {
    emit('close');
  };

  return {
    isOpen,
    items,
    handleSelect,
    handleClose
  };
}

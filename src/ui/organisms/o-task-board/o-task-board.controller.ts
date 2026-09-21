import { ref, computed } from 'vue';
import type { TaskBoardProps, TaskBoardEmits } from './types';
import type { TaskItem } from '../../molecules/m-task-card/types';

export function useTaskBoardController(props: TaskBoardProps, emit: TaskBoardEmits) {
  const newTaskTitle = ref('');

  const isQueued = (t: TaskItem) => t.status === 'queued';
  const isInProgress = (t: TaskItem) => t.status === 'in_progress';
  const isDone = (t: TaskItem) => t.status === 'completed' || t.status === 'done';

  const tasksByStatus = computed(() => ({
    queued: props.tasks.filter(isQueued),
    inProgress: props.tasks.filter(isInProgress),
    done: props.tasks.filter(isDone)
  }));

  const handleCreate = () => {
    const text = newTaskTitle.value.trim();
    if (!text) return;
    emit('create', text);
    newTaskTitle.value = '';
  };

  const handleClaim = (taskId: string) => { emit('claim', taskId); };
  const handleComplete = (taskId: string) => { emit('complete', taskId); };

  return {
    newTaskTitle,
    tasksByStatus,
    handleCreate,
    handleClaim,
    handleComplete
  };
}

import { ref } from 'vue';
import type { TaskItem } from '../molecules/m-task-card/types';

export function useSwarmTasks() {
  const tasks = ref<TaskItem[]>([]);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const fetchTasks = async () => {
    if (typeof fetch !== 'function') return;
    try {
      isLoading.value = true;
      const res = await fetch('/api/swarm/status');
      if (res.ok) {
        const data = await res.json();
        if (data.tasks) tasks.value = data.tasks;
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
    }
  };

  const createTask = async (title: string) => {
    if (typeof fetch !== 'function') return;
    try {
      await fetch('/api/swarm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, createdBy: '@ui-specialist' })
      });
      await fetchTasks();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  const claimTask = async (taskId: string, agentId = '@coordinator') => {
    if (typeof fetch !== 'function') return;
    try {
      await fetch('/api/swarm/tasks/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, agentId })
      });
      await fetchTasks();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  const completeTask = async (taskId: string) => {
    if (typeof fetch !== 'function') return;
    try {
      await fetch('/api/swarm/tasks/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      await fetchTasks();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  fetchTasks();

  return {
    tasks,
    isLoading,
    createTask,
    claimTask,
    completeTask
  };
}

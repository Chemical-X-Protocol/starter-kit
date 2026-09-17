import type { TaskItem } from '../../molecules/m-task-card/types';

export interface TaskBoardProps {
  readonly tasks: TaskItem[];
}

export interface TaskBoardEmits {
  (e: 'create', title: string): void;
  (e: 'claim', taskId: string): void;
  (e: 'complete', taskId: string): void;
}

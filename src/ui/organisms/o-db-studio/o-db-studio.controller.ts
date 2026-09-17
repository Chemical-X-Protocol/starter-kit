import { ref, computed, watch } from 'vue';
import type { DbStudioProps, DbStudioEmits } from './types';

export interface SqlPreset {
  readonly id: string;
  readonly label: string;
  readonly sql: string;
}

export const DB_PRESETS: SqlPreset[] = [
  { id: 'near-100l', label: 'Files Near 100L', sql: 'SELECT path, lines, tier FROM file_capsules WHERE lines >= 80 ORDER BY lines DESC LIMIT 10' },
  { id: 'tasks', label: 'Active Tasks', sql: 'SELECT id, title, status, assigned_agent_id, cost_usd FROM agent_tasks ORDER BY id DESC LIMIT 10' },
  { id: 'feed', label: 'Recent Feed', sql: 'SELECT author_id, event_type, message FROM agent_feed ORDER BY id DESC LIMIT 10' },
  { id: 'violations', label: 'Violations', sql: 'SELECT rule, severity, COUNT(*) as c FROM architectural_violations GROUP BY rule ORDER BY c DESC LIMIT 10' },
  { id: 'tables', label: 'Tables', sql: "SELECT name, type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" }
];

export function useDbStudioController(props: DbStudioProps, emit: DbStudioEmits) {
  const queryInput = ref(props.activeQuery || DB_PRESETS[0].sql);

  watch(() => props.activeQuery, (newVal) => {
    if (newVal) queryInput.value = newVal;
  });

  const hasResults = computed(() => Boolean(props.queryResult && props.queryResult.rows.length > 0));

  const handleExecute = () => {
    emit('run', queryInput.value);
  };

  const handleSelectPreset = (sql: string) => {
    queryInput.value = sql;
    emit('select-preset', sql);
  };

  return {
    queryInput,
    presets: DB_PRESETS,
    hasResults,
    handleExecute,
    handleSelectPreset
  };
}

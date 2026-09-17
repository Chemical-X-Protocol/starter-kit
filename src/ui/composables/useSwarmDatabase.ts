import { ref } from 'vue';

export interface DatabaseMetrics {
  readonly dbPath: string;
  readonly fileSizeFormatted: string;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly journalMode: string;
  readonly tableCount: number;
  readonly totalRows: number;
  readonly tables: Array<{ readonly name: string; readonly rowCount: number }>;
}

export interface QueryResult {
  readonly columns: string[];
  readonly rows: Array<Record<string, unknown>>;
  readonly rowCount: number;
  readonly durationMs: number;
  readonly query: string;
}

export function useSwarmDatabase() {
  const metrics = ref<DatabaseMetrics | null>(null);
  const queryResult = ref<QueryResult | null>(null);
  const activeQuery = ref<string>("SELECT name, type FROM sqlite_master WHERE type = 'table'");
  const errorMessage = ref<string | null>(null);

  const fetchMetrics = async () => {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch('/api/swarm/database/metrics');
      if (res.ok) {
        metrics.value = await res.json();
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Metrics fetch failed';
    }
  };

  const runQuery = async (sql?: string) => {
    const targetSql = sql || activeQuery.value;
    if (!targetSql.trim() || typeof fetch !== 'function') return;
    activeQuery.value = targetSql;
    try {
      const res = await fetch('/api/swarm/database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: targetSql })
      });
      const data = await res.json();
      if (data.success) {
        queryResult.value = data;
        errorMessage.value = null;
      } else {
        errorMessage.value = data.error || 'Query failed';
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Query execution error';
    }
  };

  const selectPreset = (sql: string) => {
    activeQuery.value = sql;
    runQuery(sql);
  };

  fetchMetrics();
  runQuery();

  return {
    metrics,
    queryResult,
    activeQuery,
    runQuery,
    selectPreset
  };
}

import { ref } from 'vue';
import type { CodebaseFileRecord } from '../molecules/m-file-card/types';

export function useSwarmCodebase() {
  const files = ref<CodebaseFileRecord[]>([]);
  const violations = ref<any[]>([]);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const fetchCodebase = async () => {
    if (typeof fetch !== 'function') return;
    try {
      isLoading.value = true;
      const res = await fetch('/api/swarm/codebase');
      if (res.ok) {
        const data = await res.json();
        if (data.files) files.value = data.files;
        if (data.violations) violations.value = data.violations;
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
    }
  };

  fetchCodebase();

  return {
    files,
    violations,
    isLoading,
    error,
    refreshCodebase: fetchCodebase
  };
}

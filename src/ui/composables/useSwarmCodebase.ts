import { ref } from 'vue';
import type { CodebaseFileRecord } from '../molecules/m-file-card/types';

export function useSwarmCodebase() {
  const files = ref<CodebaseFileRecord[]>([]);
  const violations = ref<any[]>([]);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const fetchCodebase = async () => {
    const isFetchMissing = typeof fetch !== 'function';
    if (isFetchMissing) return;
    try {
      isLoading.value = true;
      const res = await fetch('/api/swarm/codebase');
      const isResponseOk = Boolean(res.ok);
      if (isResponseOk) {
        const data = await res.json();
        const hasFiles = Boolean(data.files);
        if (hasFiles) files.value = data.files;
        const hasViolations = Boolean(data.violations);
        if (hasViolations) violations.value = data.violations;
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

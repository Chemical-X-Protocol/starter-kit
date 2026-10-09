import { ref } from 'vue';
import type { SwarmAgent } from '../molecules/m-agent-card/types';
import type { FeedPostRecord } from '../molecules/m-feed-post/types';
import type { SavingsSummary } from '../molecules/m-savings-badge/types';
import type { TokenTelemetrySummary } from '../organisms/o-workload-rail/types';
import { useSelfCleaningTimeout } from './useSelfCleaningTimeout';

const DEFAULT_TELEMETRY: TokenTelemetrySummary = { promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 };
const DEFAULT_SAVINGS: SavingsSummary = { baselineTokens: 0, actualTokens: 0, tokensSaved: 0, dollarsSaved: 0, reductionPct: 88, actualCost: 0 };

export function useSwarmState() {
  const agents = ref<SwarmAgent[]>([]);
  const posts = ref<FeedPostRecord[]>([]);
  const telemetry = ref<TokenTelemetrySummary>(DEFAULT_TELEMETRY);
  const savings = ref<SavingsSummary>(DEFAULT_SAVINGS);
  const selectedAgentId = ref<string | undefined>(undefined);
  const isLoading = ref<boolean>(false);

  const error = ref<Error | null>(null);

  const applyData = (data: any = {}) => {
    const hasAgents = Boolean(data.agents);
    if (hasAgents) agents.value = data.agents;
    const hasPosts = Boolean(data.posts);
    if (hasPosts) posts.value = data.posts;
    const hasTelemetry = Boolean(data.telemetry);
    if (hasTelemetry) telemetry.value = data.telemetry;
    const hasSavings = Boolean(data.savings);
    if (hasSavings) savings.value = data.savings;
  };

  const fetchSwarmData = async () => {
    try {
      const isHydrated = typeof window !== 'undefined' && Boolean((window as any).__CHEMX_HYDRATED_STATE__);
      if (isHydrated) {
        applyData((window as any).__CHEMX_HYDRATED_STATE__);
      }
      const isFetchAvailable = typeof fetch === 'function';
      if (isFetchAvailable) {
        const res = await fetch('/api/swarm/status');
        const isResponseOk = Boolean(res.ok);
        if (isResponseOk) applyData(await res.json());
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
      poller.start();
    }
  };

  const poller = useSelfCleaningTimeout(() => {
    const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (isHidden) {
      poller.start();
      return;
    }
    fetchSwarmData();
  }, 2000);

  const sendPost = async (message: string) => {
    const isFetchMissing = typeof fetch !== 'function';
    if (isFetchMissing) return;
    try {
      await fetch('/api/swarm/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, author: selectedAgentId.value || '@ui-specialist' })
      });
      await fetchSwarmData();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  const selectAgent = (agent: SwarmAgent) => { selectedAgentId.value = agent.id; };
  fetchSwarmData();

  return {
    agents,
    telemetry,
    selectedAgentId,
    selectAgent,
    error
  };
}

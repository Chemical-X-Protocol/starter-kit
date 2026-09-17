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
    if (data.agents) agents.value = data.agents;
    if (data.posts) posts.value = data.posts;
    if (data.telemetry) telemetry.value = data.telemetry;
    if (data.savings) savings.value = data.savings;
  };

  const fetchSwarmData = async () => {
    try {
      if (typeof window !== 'undefined' && (window as any).__CHEMX_HYDRATED_STATE__) {
        applyData((window as any).__CHEMX_HYDRATED_STATE__);
      }
      if (typeof fetch === 'function') {
        const res = await fetch('/api/swarm/status');
        if (res.ok) applyData(await res.json());
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
      poller.start();
    }
  };

  const poller = useSelfCleaningTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      poller.start();
      return;
    }
    fetchSwarmData();
  }, 2000);

  const sendPost = async (message: string) => {
    if (typeof fetch !== 'function') return;
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

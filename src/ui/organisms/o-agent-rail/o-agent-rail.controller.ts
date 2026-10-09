import { ref, computed } from 'vue';
import type { SwarmAgent } from '../../molecules/m-agent-card/types';
import type { AgentRailProps, AgentFilter, AgentRailEmits } from './types';

const isMatchingFilter = (agent: SwarmAgent, filter: AgentFilter): boolean => {
  const isAllFilter = filter === 'all';
  if (isAllFilter) return true;
  const isActiveFilter = filter === 'active';
  if (isActiveFilter) return agent.status === 'busy';
  const isIdleFilter = filter === 'idle';
  if (isIdleFilter) return agent.status === 'idle';
  const isOfflineFilter = filter === 'offline';
  if (isOfflineFilter) return agent.status === 'offline';
  return true;
};

export function useAgentRailController(props: AgentRailProps, emit: AgentRailEmits) {
  const currentFilter = ref<AgentFilter>('all');
  const agentList = computed((): readonly SwarmAgent[] => props.agents || []);

  const totalCount = computed((): number => agentList.value.length);
  const activeCount = computed((): number => (
    agentList.value.filter((a) => a.status === 'busy').length
  ));

  const filteredAgents = computed((): readonly SwarmAgent[] => (
    agentList.value.filter((a) => isMatchingFilter(a, currentFilter.value))
  ));

  const hasAgents = computed((): boolean => filteredAgents.value.length > 0);
  const hasMultipleFilters = computed((): boolean => totalCount.value > 0);
  const shouldShowEmpty = computed((): boolean => !hasAgents.value);

  const setFilter = (filter: AgentFilter) => {
    currentFilter.value = filter;
  };

  const handleSelectAgent = (agent: SwarmAgent) => {
    emit('select', agent);
  };

  const activeSummary = computed((): string => `${activeCount.value}/${totalCount.value} active`);

  return {
    currentFilter,
    setFilter,
    filteredAgents,
    activeSummary,
    handleSelectAgent
  };
}

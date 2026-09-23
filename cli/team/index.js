/**
 * Chemical X Protocol: Multi-Agent Swarm Module Entrypoint
 */

export { initTeamSchema } from './team-schema.js';
export {
  getAgent,
  registerAgent,
  updateAgentHeartbeat,
  listAgents,
  getTask,
  createTask,
  claimTask,
  updateTaskStatus,
  listTasks,
  areTaskDependenciesMet,
  postFeedEvent,
  queryFeed,
  requestFileLock,
  releaseFileLock,
  getFileLockStatus,
  cleanExpiredLeases,
  getSwarmStatus
} from './team-db.js';
export {
  queryUnassignedHazards,
  autoGenerateTasksFromAudit,
  reconcileAuditTasks,
  completeTaskWithAudit
} from './team-triage.js';
export {
  recordMemoryInjection,
  recordMemoryUtilization,
  evictExpiredMemories,
  calculateMemoryMetrics,
  runAblationComparison,
  formatAblationCard
} from './team-memory.js';
export { runTeamCli } from './team-commands.js';

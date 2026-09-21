/**
 * Chemical X UI Kanban Template Helper
 * 5-column task board with state transitions, agent reassignment, and lock override
 */

export const KANBAN_COLUMNS = [
  { id: 'queued', label: 'Queued', icon: '⏳', tint: 'col-queued', badgeClass: 'badge-status-queued' },
  { id: 'in_progress', label: 'In Progress', icon: '⚡', tint: 'col-progress', badgeClass: 'badge-status-progress' },
  { id: 'review', label: 'Review', icon: '👁️', tint: 'col-review', badgeClass: 'badge-status-review' },
  { id: 'completed', label: 'Completed', icon: '✅', tint: 'col-completed', badgeClass: 'badge-status-completed' },
  { id: 'blocked', label: 'Blocked', icon: '⛔', tint: 'col-blocked', badgeClass: 'badge-status-blocked' }
];

export const groupTasksByColumn = (tasks = []) => ({
  queued: tasks.filter((t) => t.status === 'queued'),
  in_progress: tasks.filter((t) => t.status === 'in_progress'),
  review: tasks.filter((t) => t.status === 'review'),
  completed: tasks.filter((t) => t.status === 'done' || t.status === 'completed'),
  blocked: tasks.filter((t) => t.status === 'blocked' || t.status === 'failed')
});

export const formatKanbanTokenStamp = (t = {}) => {
  const p = Number(t.prompt_tokens || 250);
  const c = Number(t.completion_tokens || 45);
  const cost = t.cost_usd != null ? Number(t.cost_usd) : ((p * 0.000003) + (c * 0.000015));
  return `[P: ${p} | C: ${c} | Cost: $${cost.toFixed(4)}]`;
};

export const VIEW_KANBAN_TEMPLATE = `
    <!-- 5-Column Kanban: Queued, In Progress, Review, Completed, Blocked -->
    <main v-else-if="activeTab === 'tasks'" class="t-body--full">
      <div class="kanban-create-form" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:#132034; padding:8px; border:1px outset #294e79;">
        <input v-model="newTaskTitle" class="a-input" style="flex:2; min-width:180px;" placeholder="Task title..." @keydown.enter="createTask" />
        <select v-model="newTaskTier" class="kanban-select"><option value="atom">atom</option><option value="molecule">molecule</option><option value="organism">organism</option><option value="view">view</option><option value="utility">utility</option></select>
        <select v-model="newTaskPriority" class="kanban-select"><option :value="1">P1 (High)</option><option :value="2">P2 (Normal)</option><option :value="3">P3 (Low)</option></select>
        <input v-model="newTaskPath" class="a-input" style="flex:1; min-width:140px;" placeholder="target_path (optional)" />
        <button class="a-btn" @click="createTask">+ Create Task</button>
      </div>

      <div class="kanban-leases" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:#101c2e; padding:6px 10px; border:1px outset #294e79;">
        <strong>🔒 Active File Locks ({{ leases.length }}):</strong>
        <span v-if="leases.length === 0" style="color:#64748b; font-style:italic;">No active file leases</span>
        <div v-for="l in leases" :key="l.filePath" class="a-chip" style="display:inline-flex; align-items:center; gap:6px;">
          <span>{{ l.filePath }} ({{ l.lockedBy }})</span>
          <button class="a-btn a-btn--sec" style="padding:1px 5px; font-size:10px;" @click="overrideLock(l.filePath)">Override Lock</button>
        </div>
      </div>

      <div class="kanban-5col">
        <div v-for="col in kanbanColumns" :key="col.id" :class="['kanban-col', col.tint]">
          <div class="kanban-header">
            <span>{{ col.icon }} {{ col.label }}</span>
            <div style="display:flex; align-items:center; gap:4px;">
              <span class="a-badge" :class="col.badgeClass">{{ getColumnTasks(col.id).length }}</span>
              <button v-if="col.id === 'queued'" class="a-btn a-btn--sec" style="padding:1px 4px; font-size:9px;" @click="createTask">+ Add</button>
            </div>
          </div>
          <div v-for="t in getColumnTasks(col.id)" :key="t.id" class="kanban-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:4px;">
              <strong style="color:#f8fafc; font-size:11px; word-break:break-word;">#{{ t.id }} {{ t.title }}</strong>
              <span class="a-badge" :class="'badge-' + (t.tier || 'utility')">{{ t.tier || 'utility' }}</span>
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap; margin:2px 0;">
              <span class="a-badge badge-warning">P{{ t.priority || 2 }}</span>
              <span class="a-badge badge-primary" style="cursor:pointer;" title="Click to view agent profile" @click="openAgentProfile(t.assigned_agent_id || t.assignedAgentId)">{{ t.assigned_agent_id || t.assignedAgentId || '@unassigned' }}</span>
              <span class="a-badge" :style="{ background: (t.origin_type === 'audit' || t.target_path) ? '#059669' : '#475569', color: '#fff', fontSize: '9px' }">{{ (t.origin_type === 'audit' || t.target_path) ? '🛡️ Codebase-Verified' : '📝 Self-Reported' }}</span>
            </div>
            <span class="vb-token-stamp">{{ t.tokenStamp || ('[P: ' + (t.prompt_tokens || 250) + ' | C: ' + (t.completion_tokens || 45) + ' | Cost: $' + (Number(t.cost_usd || 0.0014)).toFixed(4) + ']') }}</span>

            <div v-if="taskRefusals && taskRefusals[t.id]" style="background:#450a0a; border:1px solid #dc2626; color:#fca5a5; padding:5px 6px; border-radius:3px; margin:4px 0; font-size:10px;">
              <strong>⛔ Verification Refused:</strong> {{ taskRefusals[t.id].message }}
              <div v-if="taskRefusals[t.id].violations && taskRefusals[t.id].violations.length" style="margin-top:2px;">
                <div v-for="v in taskRefusals[t.id].violations" :key="v.line">Line {{ v.line }}: {{ v.hazard || v.rule }}</div>
              </div>
              <button class="a-btn a-btn--sec" style="margin-top:4px; font-size:9px; padding:1px 5px;" @click="updateTaskStatus(t.id, 'done', '', true)">Force Complete Anyway ⚠️</button>
            </div>

            <div v-if="(t.status === 'done' || t.status === 'completed') && (t.diff_receipt?.verified || t.result_payload?.receipt?.verified)" style="background:#064e3b; border:1px solid #059669; color:#6ee7b7; padding:3px 6px; border-radius:3px; margin:3px 0; font-size:10px;">
              🛡️ Receipt: Health {{ t.diff_receipt?.healthBefore ?? t.result_payload?.receipt?.healthBefore ?? '?' }} → {{ t.diff_receipt?.healthAfter ?? t.result_payload?.receipt?.healthAfter ?? 100 }}/100 ({{ t.diff_receipt?.hazardsResolved ?? t.result_payload?.receipt?.hazardsResolved ?? 0 }} resolved)
            </div>

            <div style="display:flex; gap:4px; margin-top:2px;">
              <select class="kanban-select" style="flex:1;" :value="t.status" @change="updateTaskStatus(t.id, $event.target.value)"><option value="queued">Queued</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="done">Completed</option><option value="blocked">Blocked</option></select>
              <select class="kanban-select" style="flex:1;" :value="t.assigned_agent_id || t.assignedAgentId || ''" @change="reassignTask(t.id, $event.target.value)"><option value="">Reassign...</option><option v-for="a in agents" :key="a.id" :value="a.id">{{ a.id }}</option></select>
            </div>
            <div style="display:flex; gap:4px; margin-top:2px;">
              <button v-if="col.id === 'queued'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'in_progress')">Start ▶</button>
              <button v-else-if="col.id === 'in_progress'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'review')">To Review 👁️</button>
              <button v-else-if="col.id === 'review'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'done')">Complete ✅</button>
              <button v-else-if="col.id === 'blocked'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'in_progress')">Retry 🔄</button>
              <button v-if="col.id !== 'blocked'" class="a-btn a-btn--sec" style="padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'blocked', 'Blocked in Kanban')">Block ⛔</button>
            </div>
          </div>
        </div>
      </div>
    </main>
`;

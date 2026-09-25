import { TASK_DETAILS_SHEET_TEMPLATE } from './ui-template-task-sheet.js';

export const KANBAN_COLUMNS = [
  { id: 'queued', label: 'Queued', icon: '⏳', tint: 'col-queued', badgeClass: 'badge-status-queued' },
  { id: 'in_progress', label: 'In Progress', icon: '⚡', tint: 'col-progress', badgeClass: 'badge-status-progress' },
  { id: 'review', label: 'Review', icon: '👁️', tint: 'col-review', badgeClass: 'badge-status-review' },
  { id: 'completed', label: 'Completed', icon: '✅', tint: 'col-completed', badgeClass: 'badge-status-completed' },
  { id: 'blocked', label: 'Blocked', icon: '⛔', tint: 'col-blocked', badgeClass: 'badge-status-blocked' }
];

export const groupTasksByColumn = (tasks = []) => ({
  queued: tasks.filter((t) => t.status === 'queued'), in_progress: tasks.filter((t) => t.status === 'in_progress'),
  review: tasks.filter((t) => t.status === 'review'), completed: tasks.filter((t) => t.status === 'done' || t.status === 'completed'),
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
      <div class="kanban-create-form" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; background:#132034; padding:6px 8px; border:1px outset #294e79;">
        <input v-model="newTaskTitle" class="a-input" style="flex:2; min-width:150px;" placeholder="Task title..." @keydown.enter="createTask" />
        <select v-model="newTaskMoscow" class="kanban-select"><option value="must">Must Have</option><option value="should">Should Have</option><option value="could">Could Have</option><option value="wont">Won't Have</option></select>
        <select v-model="newTaskVdsPriority" class="kanban-select"><option value="critical">Critical</option><option value="expedite">Expedite</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select v-model="newTaskTier" class="kanban-select"><option value="atom">atom</option><option value="molecule">molecule</option><option value="organism">organism</option><option value="view">view</option><option value="utility">utility</option></select>
        <input v-model="newTaskPath" class="a-input" style="flex:1; min-width:110px;" placeholder="target_path" />
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
          <div v-for="t in getColumnTasks(col.id)" :key="t.id" :id="'task-' + t.id" class="kanban-card" :class="{ 'kanban-card--highlighted': highlightedTaskId === t.id }">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:4px;">
              <strong style="color:#f8fafc; font-size:11px; word-break:break-word;">
                <a :href="'/tasks/' + t.id" style="color:#38bdf8; text-decoration:none; margin-right:4px; cursor:pointer;" title="Open task details" @click.prevent="openTaskDetail(t.id)">#{{ t.id }}</a><span style="cursor:pointer;" title="Open task details" @click="openTaskDetail(t.id)">{{ t.title }}</span>
              </strong>
              <div style="display:flex; gap:4px; align-items:center;">
                <button class="a-btn a-btn--sec" style="padding:1px 4px; font-size:8px;" title="Open task details sheet" @click="openTaskDetail(t.id)">📋</button>
                <button class="a-btn a-btn--sec" style="padding:1px 4px; font-size:8px;" title="Copy canonical task URL" @click="copyTaskLink(t.id)">🔗</button>
                <span class="a-badge" :class="'badge-' + (t.tier || 'utility')">{{ t.tier || 'utility' }}</span>
              </div>
            </div>
            <div style="display:flex; gap:3px; align-items:center; flex-wrap:wrap; margin:2px 0;">
              <span class="a-badge" :style="{ background: t.moscow === 'must' ? '#ef4444' : (t.moscow === 'should' ? '#3b82f6' : (t.moscow === 'could' ? '#10b981' : '#64748b')), color: '#fff', fontSize: '9px', fontWeight: 'bold' }">{{ (t.moscow || 'must').toUpperCase() }}</span>
              <span class="a-badge badge-warning" style="font-size:9px;">{{ (t.vds_priority || 'medium').toUpperCase() }}</span>
              <span class="a-badge badge-primary" style="cursor:pointer;" title="Click to view agent profile" @click="openAgentProfile(t.assigned_agent_id || t.assignedAgentId)">{{ t.assigned_agent_id || t.assignedAgentId || '@unassigned' }}</span>
            </div>
            <span class="vb-token-stamp">{{ t.tokenStamp || ('[P: ' + (t.prompt_tokens || 250) + ' | C: ' + (t.completion_tokens || 45) + ' | Cost: $' + (Number(t.cost_usd || 0.0014)).toFixed(4) + ']') }}</span>

            <div v-if="taskRefusals && taskRefusals[t.id]" style="background:#450a0a; border:1px solid #dc2626; color:#fca5a5; padding:5px 6px; border-radius:3px; margin:4px 0; font-size:10px;">
              <strong>⛔ Verification Refused:</strong> {{ taskRefusals[t.id].message }}
              <button class="a-btn a-btn--sec" style="margin-top:4px; font-size:9px; padding:1px 5px;" @click="updateTaskStatus(t.id, 'done', '', true)">Force Complete Anyway ⚠️</button>
            </div>

            <div v-if="(t.status === 'done' || t.status === 'completed') && (t.diff_receipt?.verified || t.result_payload?.receipt?.verified)" style="background:#064e3b; border:1px solid #059669; color:#6ee7b7; padding:3px 6px; border-radius:3px; margin:3px 0; font-size:10px;">
              🛡️ Receipt: Health {{ t.diff_receipt?.healthBefore ?? t.result_payload?.receipt?.healthBefore ?? '?' }} → {{ t.diff_receipt?.healthAfter ?? t.result_payload?.receipt?.healthAfter ?? 100 }}/100
            </div>

            <div style="display:flex; gap:4px; margin-top:2px;">
              <select class="kanban-select" style="flex:1;" :value="t.status" @change="updateTaskStatus(t.id, $event.target.value)"><option value="queued">Queued</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="done">Completed</option><option value="blocked">Blocked</option></select>
              <select class="kanban-select" style="flex:1;" :value="t.assigned_agent_id || t.assignedAgentId || ''" @change="reassignTask(t.id, $event.target.value)"><option value="">Reassign...</option><option v-for="a in agents" :key="a.id" :value="a.id">{{ a.id }}</option></select>
            </div>
            <div style="display:flex; gap:4px; margin-top:2px;">
              <button v-if="col.id === 'queued'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'in_progress')">Start ▶</button><button v-else-if="col.id === 'in_progress'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'review')">To Review 👁️</button><button v-else-if="col.id === 'review'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'done')">Complete ✅</button><button v-else-if="col.id === 'blocked'" class="a-btn" style="flex:1; padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'in_progress')">Retry 🔄</button><button v-if="col.id !== 'blocked'" class="a-btn a-btn--sec" style="padding:2px 4px; font-size:9px;" @click="updateTaskStatus(t.id, 'blocked', 'Blocked in Kanban')">Block ⛔</button>
            </div>
          </div>
        </div>
      </div>
${TASK_DETAILS_SHEET_TEMPLATE}
    </main>
`;

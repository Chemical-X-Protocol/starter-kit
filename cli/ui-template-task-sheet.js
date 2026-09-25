/**
 * Chemical X UI Bubblegum-Style Task Details Sheet Template
 * Slide-over drawer with VDS metadata, activity stream, and status update composer
 */
export const TASK_DETAILS_SHEET_TEMPLATE = `
      <!-- Bubblegum-Style Task Details Hover Sheet & Backdrop -->
      <div v-if="selectedTaskDetail" class="task-details-backdrop" @click="closeTaskDetail"></div>
      <aside v-if="selectedTaskDetail" class="task-details-sheet">
        <div class="task-details-header">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
              <span class="a-badge" :style="{ background: selectedTaskDetail.moscow === 'must' ? '#ef4444' : (selectedTaskDetail.moscow === 'should' ? '#3b82f6' : (selectedTaskDetail.moscow === 'could' ? '#10b981' : '#64748b')), color: '#fff', fontWeight: 'bold' }">{{ (selectedTaskDetail.moscow || 'must').toUpperCase() }}</span>
              <span class="a-badge badge-warning">{{ (selectedTaskDetail.vds_priority || 'medium').toUpperCase() }}</span>
              <span class="a-badge" :class="'badge-' + (selectedTaskDetail.tier || 'utility')">{{ selectedTaskDetail.tier || 'utility' }}</span>
              <span style="color:#64748b; font-size:11px;">#{{ selectedTaskDetail.id }}</span>
            </div>
            <h2 style="margin:0; font-size:15px; color:#f8fafc; font-weight:600; line-height:1.3; word-break:break-word;">{{ selectedTaskDetail.title }}</h2>
          </div>
          <button class="a-btn a-btn--sec" style="padding:4px 8px; font-size:12px;" @click="closeTaskDetail">✕</button>
        </div>

        <div class="task-details-body">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:rgba(255,255,255,.02); padding:8px; border-radius:8px; border:1px solid rgba(255,255,255,.05); font-size:12px;">
            <div>
              <div style="color:#64748b; font-size:10px; text-transform:uppercase;">MoSCoW Bucket</div>
              <select class="kanban-select" style="width:100%; margin-top:2px;" :value="selectedTaskDetail.moscow || 'must'" @change="updateTaskVdsSlot(selectedTaskDetail.id, $event.target.value, selectedTaskDetail.vds_priority || 'medium')">
                <option value="must">🧬 Must Have</option><option value="should">✨ Should Have</option><option value="could">🎀 Could Have</option><option value="wont">🦄 Won't Have</option>
              </select>
            </div>
            <div>
              <div style="color:#64748b; font-size:10px; text-transform:uppercase;">VDS Priority Slot</div>
              <select class="kanban-select" style="width:100%; margin-top:2px;" :value="selectedTaskDetail.vds_priority || 'medium'" @change="updateTaskVdsSlot(selectedTaskDetail.id, selectedTaskDetail.moscow || 'must', $event.target.value)">
                <option value="critical">🚑 Critical (1)</option><option value="expedite">🚒 Expedite (2)</option><option value="high">🚓 High (3)</option><option value="medium">🚕 Medium (4)</option><option value="low">🛵 Low (5)</option>
              </select>
            </div>
            <div>
              <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Status</div>
              <select class="kanban-select" style="width:100%; margin-top:2px;" :value="selectedTaskDetail.status" @change="updateTaskStatus(selectedTaskDetail.id, $event.target.value); selectedTaskDetail.status = $event.target.value">
                <option value="queued">Queued</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="done">Completed</option><option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Assignee</div>
              <select class="kanban-select" style="width:100%; margin-top:2px;" :value="selectedTaskDetail.assigned_agent_id || selectedTaskDetail.assignedAgentId || ''" @change="reassignTask(selectedTaskDetail.id, $event.target.value); selectedTaskDetail.assigned_agent_id = $event.target.value">
                <option value="">Unassigned</option><option v-for="a in agents" :key="a.id" :value="a.id">{{ a.id }}</option>
              </select>
            </div>
            <div style="grid-column:1 / -1; display:flex; align-items:center; gap:6px; background:#040914; padding:4px 8px; border-radius:4px; border:1px solid #1e293b;">
              <span style="color:#38bdf8; font-size:11px;">🔗 Task URL:</span>
              <input class="a-input" style="flex:1; padding:2px 6px; font-size:11px;" :value="selectedTaskDetail.task_url || ('http://localhost:3000/tasks/' + selectedTaskDetail.id)" readonly />
              <button class="a-btn a-btn--sec" style="padding:2px 6px; font-size:10px;" @click="copyTaskLink(selectedTaskDetail.id)">Copy</button>
            </div>
            <div v-if="selectedTaskDetail.target_path" style="grid-column:1 / -1;">
              <div style="color:#64748b; font-size:10px; text-transform:uppercase;">Target Path</div>
              <code style="display:block; margin-top:2px; padding:3px 6px; background:#040914; border:1px solid rgba(56,189,248,.2); border-radius:4px; color:#38bdf8; font-size:11px;">{{ selectedTaskDetail.target_path }}</code>
            </div>
            <div v-if="selectedTaskDetail.blocked_reason" style="grid-column:1 / -1; background:#450a0a; border:1px solid #dc2626; color:#fca5a5; padding:6px 8px; border-radius:4px;">
              <strong>⛔ Blocker:</strong> {{ selectedTaskDetail.blocked_reason }}
            </div>
          </div>

          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <strong style="color:#f8fafc; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">📡 Activity Stream & Status Updates ({{ selectedTaskEvents.length }})</strong>
              <button class="a-btn a-btn--sec" style="padding:1px 6px; font-size:10px;" @click="openTaskDetail(selectedTaskDetail.id)">🔄 Refresh</button>
            </div>
            <div v-if="selectedTaskEvents.length === 0" style="color:#64748b; font-size:12px; font-style:italic; padding:12px; text-align:center; background:rgba(255,255,255,.01); border-radius:6px;">No status updates recorded yet.</div>
            <div v-else style="display:flex; flex-direction:column; gap:6px;">
              <div v-for="ev in selectedTaskEvents" :key="ev.id" class="task-event-card">
                <div class="task-event-author">
                  <span>{{ ev.event_type === 'task_created' ? '⏳' : (ev.event_type === 'task_completed' ? '✅' : '💬') }}</span>
                  <span>{{ ev.author_id || ev.author }}</span>
                  <span class="a-badge" style="font-size:9px; padding:0 4px; background:rgba(56,189,248,.12); color:#38bdf8;">{{ ev.event_type }}</span>
                  <span class="task-event-time">{{ new Date(ev.timestamp).toLocaleTimeString() }}</span>
                </div>
                <div class="task-event-msg">{{ ev.message }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="task-details-footer">
          <input v-model="taskUpdateMsg" class="a-input" style="flex:1;" placeholder="Post a status update or note on this task..." @keydown.enter="submitTaskUpdate" />
          <button class="a-btn" @click="submitTaskUpdate">Post Update</button>
        </div>
      </aside>
`;

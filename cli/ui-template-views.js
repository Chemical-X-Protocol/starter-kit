/**
 * Chemical X UI View Templates: Attention Hub & Database Studio
 */
export const VIEW_ATTENTION_TEMPLATE = `
    <main v-else-if="activeTab === 'attention'" class="t-body--full">
      <div class="t-panel" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; gap:10px; align-items:center;">
          <strong>🔔 Action & Attention Hub</strong>
          <span class="a-badge badge-lime">{{ antigravityRunning ? 'Antigravity Core Active' : 'Antigravity Standby' }}</span>
          <span class="a-badge badge-warning">{{ attentionItems.length }} Pending</span>
        </div>
        <button class="a-btn a-btn--sec" @click="fetchAttention">🔄 Rescan Feeds</button>
      </div>
      <div v-if="attentionItems.length > 0" style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
        <div v-for="item in attentionItems" :key="item.id" class="m-card">
          <div style="display:flex; justify-content:space-between;">
            <div><span class="a-badge badge-primary">{{ item.source }}</span> <strong style="margin-left:8px;">{{ item.title }}</strong></div>
            <span class="a-chip">{{ item.type }}</span>
          </div>
          <p style="font-size:12px; color:#94a3b8; margin:6px 0;">{{ item.detail }}</p>
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="a-btn a-btn--sec" @click="confirmAttention(item.id, 'reject')">✕ Dismiss</button>
            <button class="a-btn" @click="confirmAttention(item.id, 'approve')">✔ Confirm & Execute</button>
          </div>
        </div>
      </div>
      <div v-else class="t-panel" style="text-align:center; padding:32px;">
        <strong style="color:#34d399;">✔ Attention Inbox Clear</strong>
        <p style="font-size:12px; color:#94a3b8; margin-top:6px;">Zero pending commands, prompts, or locks requiring attention.</p>
      </div>
    </main>
`;

export const VIEW_DATABASE_TEMPLATE = `
    <main v-else-if="activeTab === 'database'" class="t-body--full">
      <div v-if="dbMetrics" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
        <div class="m-card" style="flex:1; min-width:120px;"><span style="font-size:11px; color:#94a3b8;">DB SIZE</span><strong>{{ dbMetrics.fileSizeFormatted }}</strong></div>
        <div class="m-card" style="flex:1; min-width:120px;"><span style="font-size:11px; color:#94a3b8;">JOURNAL</span><strong style="color:#34d399;">{{ dbMetrics.journalMode?.toUpperCase() }}</strong></div>
        <div class="m-card" style="flex:1; min-width:120px;"><span style="font-size:11px; color:#94a3b8;">TOTAL ROWS</span><strong>{{ dbMetrics.totalRows }}</strong></div>
        <div class="m-card" style="flex:1; min-width:120px;"><span style="font-size:11px; color:#94a3b8;">TABLES</span><strong>{{ dbMetrics.tableCount }}</strong></div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
        <span class="a-chip" style="cursor:pointer;" @click="selectDbPreset('near-100l')">Files Near 100L</span>
        <span class="a-chip" style="cursor:pointer;" @click="selectDbPreset('tasks')">Active Tasks</span>
        <span class="a-chip" style="cursor:pointer;" @click="selectDbPreset('feed')">Recent Feed</span>
        <span class="a-chip" style="cursor:pointer;" @click="selectDbPreset('tables')">Tables</span>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <input v-model="dbQuery" class="a-input" placeholder="Enter SQL statement..." @keydown.enter="runDbQuery()" />
        <button class="a-btn" @click="runDbQuery()">▶ Run SQL</button>
      </div>
      <div v-if="dbError" class="a-chip" style="color:#f87171; border-color:#f87171; margin-bottom:10px;">{{ dbError }}</div>
      <div v-if="dbResults" class="t-panel" style="overflow-x:auto;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span class="a-badge badge-primary">{{ dbResults.rowCount }} rows</span>
          <span class="a-badge badge-warning">{{ dbResults.durationMs }}ms</span>
        </div>
        <div v-for="(row, idx) in (dbResults.rows || []).slice(0, 15)" :key="idx" style="font-family:monospace; font-size:11px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
          {{ JSON.stringify(row) }}
        </div>
      </div>
    </main>
`;

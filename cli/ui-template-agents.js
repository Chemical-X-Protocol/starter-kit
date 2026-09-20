export const VIEW_AGENTS_TEMPLATE = `
    <main v-else-if="activeTab === 'agents'" class="t-body--full">
      <div class="vb-cat-header">Registered Swarm Agents Directory ({{ agents.length }})</div>
      <div class="vb-agent-grid">
        <div v-for="a in agents" :key="a.id" class="vb-agent-card" @click="openAgentProfile(a)">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center;">
              <span class="vb-beacon" :class="'beacon-' + (a.statusBeacon || 'idle')"></span>
              <strong style="color:#62c9ff; font-size:12px;">{{ a.id }}</strong>
            </div>
            <span class="vb-model-badge">{{ a.model || 'Gemini 3.8 Flash' }}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#cbd5e1;">
            <span>Role: {{ a.role }}</span>
            <span class="a-badge" :class="a.status === 'busy' ? 'badge-warning' : 'badge-lime'">{{ a.status }}</span>
          </div>
          <div style="font-size:10px; color:#94a3b8;">
            Task: {{ a.currentTaskId ? ('#' + a.currentTaskId) : 'None' }}
          </div>
          <div style="font-size:10px; color:#94a3b8;">
            Leases: {{ a.heldLeases?.length ? a.heldLeases.join(', ') : 'None' }}
          </div>
          <div style="font-size:10px; color:#94a3b8;">
            Total Posts: {{ a.postsCount || 0 }}
          </div>
          <div class="vb-sig-divider"></div>
          <div class="vb-signature">{{ a.signature }}</div>
        </div>
      </div>
    </main>
`;

export const AGENT_MODAL_TEMPLATE = `
    <div v-if="selectedAgent" class="modal-overlay" @click.self="selectedAgent = null">
      <div class="modal-box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color:#62c9ff; font-size:14px;">Agent Profile: {{ selectedAgent.id }}</strong>
          <button class="a-btn a-btn--sec" @click="selectedAgent = null">✕</button>
        </div>
        <div class="vb-postbit" style="margin:0;">
          <div class="vb-postbit__author">
            <div class="vb-avatar">{{ (selectedAgent.id || '@')[1]?.toUpperCase() || 'A' }}</div>
            <strong style="color:#62c9ff;">{{ selectedAgent.name || selectedAgent.id }}</strong>
            <span class="vb-title-flair">{{ selectedAgent.userTitle || 'Swarm Contributor' }}</span>
            <div class="vb-rank-stars">{{ selectedAgent.rankStars || '★★★★☆' }}</div>
            <span class="vb-model-badge">{{ selectedAgent.model || 'Gemini 3.8 Flash' }}</span>
            <div style="font-size:9px; color:#94a3b8; margin-top:2px;">Status: {{ selectedAgent.status || 'active' }}</div>
          </div>
          <div class="vb-postbit__body">
            <div>
              <div style="font-size:11px; margin-bottom:4px;"><strong>Current Assignment:</strong> Task {{ selectedAgent.currentTaskId || 'None (Idle)' }}</div>
              <div style="font-size:11px; margin-bottom:4px;"><strong>Held Leases:</strong> {{ selectedAgent.heldLeases?.length ? selectedAgent.heldLeases.join(', ') : 'No active leases' }}</div>
              <div style="font-size:11px; margin-bottom:6px;"><strong>Activity:</strong> {{ selectedAgent.postsCount }} total forum posts</div>
            </div>
            <div>
              <label style="font-size:10px; color:#93c5fd; font-weight:bold;">Customizable Signature Block:</label>
              <input v-model="editingSignature" class="a-input" style="margin:4px 0;" placeholder="Enter custom agent signature..." />
              <button class="a-btn" @click="saveSignature">Save Signature</button>
            </div>
          </div>
        </div>
      </div>
    </div>
`;

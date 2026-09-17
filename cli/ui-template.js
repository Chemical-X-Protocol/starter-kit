import { VIEW_ATTENTION_TEMPLATE, VIEW_DATABASE_TEMPLATE } from './ui-template-views.js';

export const UI_TEMPLATE = `
  <div id="app" class="t-social-layout">
    <header class="t-header">
      <div class="t-header__left">
        <button class="a-btn a-btn--sec" @click="drawerOpen = !drawerOpen">☰</button>
        <span class="a-chip" @click="activeTab = 'social'">⚡ Chemical X Swarm Control</span>
        <span class="a-badge badge-primary">{{ activeTab.toUpperCase() }}</span>
      </div>
      <div class="t-header__right">
        <span class="a-chip a-chip--active" @click="openSavingsModal">
          ⚡ Chemical X has saved you {{ Number(savings.tokensSaved || 165000).toLocaleString() }} Tokens / $ {{ Number(savings.dollarsSaved || 1.65).toFixed(2) }} burn avoided
        </span>
        <span class="a-badge badge-lime">M3 Live Swarm</span>
      </div>
    </header>

    <aside v-if="drawerOpen" class="o-drawer">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong>Swarm Navigation</strong>
        <button class="a-btn a-btn--sec" @click="drawerOpen = false">✕</button>
      </div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'attention'}" @click="activeTab = 'attention'; drawerOpen = false"><span>🔔 Attention Inbox</span><span class="a-badge badge-warning">{{ attentionItems.length }}</span></div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'social'}" @click="activeTab = 'social'; drawerOpen = false"><span>📡 Timeline & Feed</span><span class="a-badge badge-primary">{{ posts.length }}</span></div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'tasks'}" @click="activeTab = 'tasks'; drawerOpen = false"><span>📋 Tasks & Kanban</span><span class="a-badge badge-lime">{{ tasks.length }}</span></div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'locks'}" @click="activeTab = 'locks'; drawerOpen = false"><span>🔒 File Locks Hub</span><span class="a-badge badge-warning">{{ leases.length }}</span></div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'codebase'}" @click="activeTab = 'codebase'; drawerOpen = false"><span>🧬 AST Codebase</span><span class="a-badge badge-primary">{{ codebaseFiles.length }}</span></div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'database'}" @click="activeTab = 'database'; drawerOpen = false"><span>💾 Database Studio</span></div>
      <div class="o-drawer__link" :class="{'o-drawer__link--active': activeTab === 'settings'}" @click="activeTab = 'settings'; drawerOpen = false"><span>⚙️ Swarm & DB Settings</span></div>
    </aside>

    <main v-if="activeTab === 'social'" class="t-body">
      <aside class="t-panel">
        <div style="display:flex; justify-content:space-between;"><span class="a-chip">Swarm Agents</span><span class="a-badge badge-lime">{{ agents.length }} Online</span></div>
        <div v-for="a in agents" :key="a.id" class="m-card"><div style="display:flex; justify-content:space-between;"><strong>{{ a.name }}</strong><span class="a-badge badge-primary">{{ a.role }}</span></div><div style="font-size:11px; color:#94a3b8;">Status: {{ a.status }}</div></div>
      </aside>
      <section class="t-panel">
        <div style="display:flex; gap:8px;"><input v-model="newPost" class="a-input" placeholder="Broadcast to swarm feed..." @keydown.enter="sendPost" /><button class="a-btn" @click="sendPost">Broadcast</button></div>
        <div v-for="p in posts" :key="p.id" class="m-card"><div style="display:flex; justify-content:space-between;"><span class="a-chip">{{ p.author }}</span><span class="a-badge badge-warning">{{ p.eventType }}</span></div><p style="font-size:13px; color:#f8fafc; margin-top:4px;">{{ p.message }}</p></div>
      </section>
      <aside class="t-panel">
        <div style="display:flex; justify-content:space-between;"><span class="a-chip">Telemetry & Locks</span><span class="a-badge badge-lime">{{ tasks.length }} Tasks</span></div>
        <div class="m-card"><strong>Token Telemetry</strong><div style="font-size:12px; color:#94a3b8;">Total: {{ Number(telemetry.totalTokens || 0).toLocaleString() }}</div><div style="font-size:12px; color:#34d399;">Cost: $ {{ Number(telemetry.totalCost || 0).toFixed(4) }}</div></div>
        <div class="m-card" v-for="l in leases" :key="l.filePath"><div style="display:flex; justify-content:space-between;"><span>🔒 {{ l.filePath }}</span><span class="a-badge badge-warning">{{ l.lockedBy }}</span></div></div>
      </aside>
    </main>

    <main v-else-if="activeTab === 'tasks'" class="t-body--full">
      <div style="display:flex; gap:12px;"><input v-model="newTask" class="a-input" placeholder="Describe new swarm task..." @keydown.enter="createTask" /><button class="a-btn" @click="createTask">+ Create Task</button></div>
      <div class="kanban-grid">
        <div class="t-panel"><strong>Queued</strong><div v-for="t in tasks.filter(x => x.status === 'queued')" :key="t.id" class="m-card"><div style="display:flex; justify-content:space-between;"><strong>{{ t.title }}</strong><button class="a-btn" @click="claimTask(t.id)">Claim</button></div></div></div>
        <div class="t-panel"><strong>In Progress</strong><div v-for="t in tasks.filter(x => x.status === 'in_progress')" :key="t.id" class="m-card"><div style="display:flex; justify-content:space-between;"><strong>{{ t.title }}</strong><button class="a-btn" @click="completeTask(t.id)">Done</button></div></div></div>
        <div class="t-panel"><strong>Completed</strong><div v-for="t in tasks.filter(x => x.status === 'completed' || x.status === 'done')" :key="t.id" class="m-card"><div style="display:flex; justify-content:space-between; align-items:center;"><strong>{{ t.title }}</strong><div style="display:flex; gap:6px; align-items:center;"><a v-if="t.result_payload && (t.result_payload.chatLink || t.result_payload.conversationId)" :href="t.result_payload.chatLink || ('conversation://' + t.result_payload.conversationId)" style="font-size:11px; color:#38bdf8; text-decoration:none; padding:2px 6px; border:1px solid #0284c7; border-radius:4px;" title="View chat transcript">💬 Chat</a><span class="a-badge badge-lime">Done</span></div></div></div></div>
      </div>
    </main>

    <main v-else-if="activeTab === 'locks'" class="t-body--full">
      <div style="display:flex; gap:8px;"><input v-model="lockPath" class="a-input" placeholder="File to lock" /><input v-model="lockAgent" class="a-input" placeholder="Agent" /><button class="a-btn" @click="acquireLock">Acquire Lock</button></div>
      <div class="t-panel"><strong>Active Lock Leases</strong><div v-for="l in leases" :key="l.filePath" class="m-card" style="display:flex; flex-direction:row; justify-content:space-between; align-items:center;"><div><strong>🔒 {{ l.filePath }}</strong><div style="font-size:11px; color:#94a3b8;">Locked by {{ l.lockedBy }}</div></div><button class="a-btn a-btn--sec" @click="releaseLock(l.filePath, l.lockedBy)">Release</button></div></div>
    </main>

    <main v-else-if="activeTab === 'codebase'" class="t-body--full">
      <div class="t-panel"><strong>Indexed Codebase Files ({{ codebaseFiles.length }})</strong><div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px;"><div v-for="f in codebaseFiles" :key="f.path" class="m-card"><div style="display:flex; justify-content:space-between;"><strong>{{ f.path }}</strong><span class="a-badge" :class="f.lines > 100 ? 'badge-pink' : 'badge-lime'">{{ f.lines }} L</span></div><div style="font-size:11px; color:#94a3b8;">Tier: {{ f.tier }} • Health: {{ f.healthScore }}%</div></div></div></div>
    </main>
` + VIEW_ATTENTION_TEMPLATE + VIEW_DATABASE_TEMPLATE + `
    <main v-else-if="activeTab === 'settings'" class="t-body--full">
      <div v-if="settingsMsg" class="a-chip a-chip--active">{{ settingsMsg }}</div>
      <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:16px;">
        <div class="m-card"><strong>🧹 SQLite VACUUM</strong><p style="font-size:12px; color:#94a3b8;">Reclaim unused disk pages and optimize B-tree indexes.</p><button class="a-btn" @click="executeSetting('vacuum')">Execute VACUUM</button></div>
        <div class="m-card"><strong>📜 Prune Feed Stream</strong><p style="font-size:12px; color:#94a3b8;">Retain latest 50 events; delete historical backlog.</p><button class="a-btn" @click="executeSetting('clear_feed')">Prune Old Feed</button></div>
        <div class="m-card"><strong>🔓 Reset Stale Leases</strong><p style="font-size:12px; color:#94a3b8;">Clear all expired lock records from database.</p><button class="a-btn" @click="executeSetting('reset_leases')">Clear Stale Leases</button></div>
        <div class="m-card"><strong>💓 Broadcast Heartbeat</strong><p style="font-size:12px; color:#94a3b8;">Send autonomous system heartbeat to live swarm feed.</p><button class="a-btn" @click="executeSetting('heartbeat')">Broadcast Heartbeat</button></div>
      </div>
    </main>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-box">
        <div style="display:flex; justify-content:space-between; align-items:center;"><strong>⚡ Molecular Token Economics Breakdown</strong><button class="a-btn a-btn--sec" @click="showModal = false">✕</button></div>
        <div class="modal-stats">
          <div class="m-card"><span style="font-size:11px; color:#94a3b8;">Baseline Monolith Burn</span><strong style="color:#fbbf24;">{{ Number(savings.baselineTokens || 187000).toLocaleString() }} tokens</strong></div>
          <div class="m-card"><span style="font-size:11px; color:#94a3b8;">Actual Chemical X Burn</span><strong style="color:#62c9ff;">{{ Number(savings.actualTokens || 22000).toLocaleString() }} tokens</strong></div>
          <div class="m-card"><span style="font-size:11px; color:#94a3b8;">Tokens Saved</span><strong style="color:#34d399;">{{ Number(savings.tokensSaved || 165000).toLocaleString() }} tokens</strong></div>
          <div class="m-card"><span style="font-size:11px; color:#94a3b8;">Dollar Burn Avoided</span><strong style="color:#34d399;">$ {{ Number(savings.dollarsSaved || 1.65).toFixed(2) }} USD</strong></div>
        </div>
        <div style="display:flex; justify-content:center;"><canvas id="cert-canvas" width="500" height="230" style="border-radius:8px; border:1px solid #62c9ff; max-width:100%;"></canvas></div>
        <div style="display:flex; justify-content:flex-end; gap:10px;"><button class="a-btn a-btn--sec" @click="showModal = false">Close</button><button class="a-btn" @click="downloadPng">📥 Download PNG Badge</button></div>
      </div>
    </div>
  </div>
`;

/**
 * Chemical X UI Client Application Script
 * Client-side Vue 3 setup, reactive poller, and REST API handlers
 */
export const UI_CLIENT_SCRIPT = `
const { createApp, ref, onMounted, onUnmounted, nextTick } = Vue;
createApp({
  setup() {
    const s = window.__CHEMX_HYDRATED_STATE__ || {}, api = window.chemxApi;
    const activeTab = ref('social'), drawerOpen = ref(false), showModal = ref(false);
    const agents = ref(s.agents || []), posts = ref(s.posts || []), leases = ref(s.leases || []);
    const tasks = ref(s.tasks || []), telemetry = ref(s.telemetry || { totalTokens: 0, totalCost: 0 });
    const savings = ref(s.savings || { tokensSaved: 165000, dollarsSaved: 1.65, reductionPct: 88 });
    const codebaseFiles = ref([]), newPost = ref(''), newTask = ref('');
    const lockPath = ref('src/auth/session.ts'), lockAgent = ref('@coordinator'), settingsMsg = ref('');
    const attentionItems = ref([]), antigravityRunning = ref(false);
    const dbMetrics = ref(null), dbQuery = ref("SELECT name, type FROM sqlite_master WHERE type = 'table'"), dbResults = ref(null), dbError = ref('');
    let timer = null;

    const fetchStatus = async () => {
      const d = await api.fetchStatus();
      if (d) {
        if (d.agents) agents.value = d.agents; if (d.posts) posts.value = d.posts;
        if (d.leases) leases.value = d.leases; if (d.tasks) tasks.value = d.tasks;
        if (d.telemetry) telemetry.value = d.telemetry; if (d.savings) savings.value = d.savings;
      }
      timer = setTimeout(fetchStatus, 2000);
    };

    const fetchAttention = async () => {
      const d = await api.fetchAttention();
      attentionItems.value = d.items || [];
      antigravityRunning.value = Boolean(d.antigravityRunning);
    };

    const confirmAttention = async (id, act) => { await api.confirmAttention(id, act); await fetchAttention(); };
    const fetchDbMetrics = async () => { dbMetrics.value = await api.fetchDbMetrics(); };
    const runDbQuery = async (sql) => {
      const q = sql || dbQuery.value; if (!q.trim()) return; dbQuery.value = q;
      const res = await api.runDbQuery(q);
      if (res.success) { dbResults.value = res; dbError.value = ''; } else { dbError.value = res.error || 'Query failed'; }
    };

    const DB_PRESETS = {
      'near-100l': 'SELECT path, lines, tier FROM file_capsules WHERE lines >= 80 ORDER BY lines DESC LIMIT 10',
      'tasks': 'SELECT id, title, status, assigned_agent_id FROM agent_tasks ORDER BY id DESC LIMIT 10',
      'feed': 'SELECT author_id, event_type, message FROM agent_feed ORDER BY id DESC LIMIT 10',
      'tables': "SELECT name, type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    };
    const selectDbPreset = (key) => { const sql = DB_PRESETS[key] || key; dbQuery.value = sql; runDbQuery(sql); };
    const sendPost = async () => { if (!newPost.value.trim()) return; await api.postJson('/api/swarm/feed', { message: newPost.value, author: '@ui-specialist' }); newPost.value = ''; };
    const createTask = async () => { if (!newTask.value.trim()) return; await api.postJson('/api/swarm/tasks', { title: newTask.value, createdBy: '@ui-specialist' }); newTask.value = ''; };
    const claimTask = async (id) => { await api.postJson('/api/swarm/tasks/claim', { taskId: id, agentId: '@coordinator' }); };
    const completeTask = async (id) => { await api.postJson('/api/swarm/tasks/done', { taskId: id }); };
    const acquireLock = async () => { await api.postJson('/api/swarm/locks/acquire', { filePath: lockPath.value, agentId: lockAgent.value, purpose: 'refactor' }); };
    const releaseLock = async (filePath, agentId) => { await api.postJson('/api/swarm/locks/release', { filePath, agentId }); };
    const executeSetting = async (action, payload = {}) => {
      const res = await api.postJson('/api/swarm/settings/action', { action, ...payload });
      const d = await res.json(); settingsMsg.value = d.message || (d.success ? 'Success' : 'Error');
    };

    const openSavingsModal = async () => { showModal.value = true; await nextTick(); window.renderSavingsCanvas?.(document.getElementById('cert-canvas'), savings.value); };
    const downloadPng = () => window.downloadSavingsPng?.(document.getElementById('cert-canvas'));

    onMounted(async () => {
      fetchStatus();
      codebaseFiles.value = await api.fetchCodebase();
      fetchAttention();
      fetchDbMetrics();
      runDbQuery();
    });
    onUnmounted(() => clearTimeout(timer));

    return {
      activeTab, drawerOpen, showModal, agents, posts, leases, tasks, telemetry, savings,
      codebaseFiles, newPost, newTask, lockPath, lockAgent, settingsMsg, attentionItems, antigravityRunning,
      dbMetrics, dbQuery, dbResults, dbError,
      sendPost, createTask, claimTask, completeTask, acquireLock, releaseLock, executeSetting,
      fetchAttention, confirmAttention, runDbQuery, selectDbPreset, openSavingsModal, downloadPng
    };
  }
}).mount('#app');
`;

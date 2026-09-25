export const UI_CLIENT_SCRIPT = `
const { createApp, ref, onMounted, onUnmounted, nextTick } = Vue;
createApp({
  setup() {
    const s = window.__CHEMX_HYDRATED_STATE__ || {}, api = window.chemxApi;
    const activeTab = ref('social'), drawerOpen = ref(false), showModal = ref(false), highlightedTaskId = ref(null);
    const selectedTaskDetail = ref(null), selectedTaskEvents = ref([]), taskUpdateMsg = ref(''), taskUpdateType = ref('status_update');
    const agents = ref(s.agents || []), posts = ref(s.posts || []), leases = ref(s.leases || []);
    const tasks = ref(s.tasks || []), telemetry = ref(s.telemetry || { totalTokens: 0, totalCost: 0 }), savings = ref(s.savings || { tokensSaved: 165000, dollarsSaved: 1.65, reductionPct: 88 });
    const forumCategories = ref(s.forumCategories || s.categories || []), selectedAgent = ref(null), editingSignature = ref(''), codebaseFiles = ref([]);
    const newPost = ref(''), newTask = ref(''), newTaskTitle = ref(''), newTaskTier = ref('organism'), newTaskPriority = ref(2), newTaskPath = ref(''), newTaskMoscow = ref('must'), newTaskVdsPriority = ref('critical');
    const lockPath = ref('src/auth/session.ts'), lockAgent = ref('@coordinator'), settingsMsg = ref(''), attentionItems = ref([]), antigravityRunning = ref(false);
    const dbMetrics = ref(null), dbQuery = ref("SELECT name, type FROM sqlite_master WHERE type = 'table'"), dbResults = ref(null), dbError = ref('');
    const ft = window.createFileTreeState ? window.createFileTreeState(Vue, api, codebaseFiles) : {};
    const studio = window.createStudioState ? window.createStudioState(Vue, api) : {};
    const forum = window.createForumState ? window.createForumState(Vue, api, agents, s) : {};
    let timer = null;
    const kanbanColumns = [{ id: 'queued', label: 'Queued', icon: '⏳', tint: 'col-queued', badgeClass: 'badge-status-queued' }, { id: 'in_progress', label: 'In Progress', icon: '⚡', tint: 'col-progress', badgeClass: 'badge-status-progress' }, { id: 'review', label: 'Review', icon: '👁️', tint: 'col-review', badgeClass: 'badge-status-review' }, { id: 'completed', label: 'Completed', icon: '✅', tint: 'col-completed', badgeClass: 'badge-status-completed' }, { id: 'blocked', label: 'Blocked', icon: '⛔', tint: 'col-blocked', badgeClass: 'badge-status-blocked' }];
    const getColumnTasks = (id) => tasks.value.filter((x) => id === 'completed' ? (x.status === 'done' || x.status === 'completed') : (id === 'blocked' ? (x.status === 'blocked' || x.status === 'failed') : x.status === id));
    const fetchStatus = async () => {
      const d = await api.fetchStatus();
      if (d) {
        if (d.agents) agents.value = d.agents; if (d.posts) posts.value = d.posts;
        if (d.leases) leases.value = d.leases; if (d.tasks) tasks.value = d.tasks;
        if (d.telemetry) telemetry.value = d.telemetry; if (d.savings) savings.value = d.savings;
        if (d.forumCategories) forumCategories.value = d.forumCategories; if (d.topics && forum.topics) forum.topics.value = d.topics;
      }
      timer = setTimeout(fetchStatus, 2000);
    };
    const fetchAttention = async () => { const d = await api.fetchAttention(); attentionItems.value = d.items || []; antigravityRunning.value = Boolean(d.antigravityRunning); };
    const confirmAttention = async (id, act) => { await api.confirmAttention(id, act); await fetchAttention(); };
    const fetchDbMetrics = async () => { dbMetrics.value = await api.fetchDbMetrics(); };
    const runDbQuery = async (sql) => {
      const q = sql || dbQuery.value; if (!q.trim()) return; dbQuery.value = q;
      const res = await api.runDbQuery(q);
      if (res.success) { dbResults.value = res; dbError.value = ''; } else { dbError.value = res.error || 'Query failed'; }
    };
    const selectDbPreset = (k) => {
      const P = { 'near-100l': 'SELECT path, lines, tier FROM file_capsules WHERE lines >= 80 ORDER BY lines DESC LIMIT 10', 'tasks': 'SELECT id, title, status FROM agent_tasks ORDER BY id DESC LIMIT 10', 'feed': 'SELECT author_id, message FROM agent_feed ORDER BY id DESC LIMIT 10', 'tables': "SELECT name, type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" };
      dbQuery.value = P[k] || k; runDbQuery(P[k] || k);
    };
    const sendPost = async () => { if (!newPost.value.trim()) return; await api.postJson('/api/swarm/feed', { message: newPost.value, author: '@ui-specialist' }); newPost.value = ''; };
    const createTask = async () => {
      const title = newTaskTitle.value.trim() || newTask.value.trim(); if (!title) return;
      const res = await api.createTask({ title, tier: newTaskTier.value, priority: newTaskPriority.value, target_path: newTaskPath.value || null, moscow: newTaskMoscow.value, vds_priority: newTaskVdsPriority.value });
      if (res?.task) tasks.value.unshift(res.task);
      newTaskTitle.value = ''; newTask.value = ''; newTaskPath.value = '';
    };
    const claimTask = async (id) => { await api.postJson('/api/tasks/claim', { taskId: id, agentId: '@coordinator' }); }; const completeTask = async (id) => { await api.postJson('/api/tasks/done', { taskId: id }); };
    const taskRefusals = ref({});
    const updateTaskStatus = async (id, status, reason = '', force = false) => {
      const res = await api.updateTaskStatus(id, status, reason, force);
      if (res && res.refused) { taskRefusals.value = { ...taskRefusals.value, [id]: res }; return; }
      const nextRefusals = { ...taskRefusals.value }; delete nextRefusals[id]; taskRefusals.value = nextRefusals;
      const t = tasks.value.find((x) => x.id === id); if (t) { t.status = status; t.blocked_reason = reason; }
      if (res?.task) { const idx = tasks.value.findIndex((x) => x.id === id); if (idx !== -1) tasks.value[idx] = res.task; }
    };
    const reassignTask = async (id, agentId) => { await api.assignTask(id, agentId); const t = tasks.value.find((x) => x.id === id); if (t) { t.assigned_agent_id = agentId; t.assignedAgentId = agentId; } };
    const updateTaskVdsSlot = async (id, moscow, priority) => { await api.postJson('/api/tasks/slot', { taskId: id, moscow, priority }); if (selectedTaskDetail.value && selectedTaskDetail.value.id === id) { selectedTaskDetail.value.moscow = moscow; selectedTaskDetail.value.vds_priority = priority; } };
    const acquireLock = async () => { await api.postJson('/api/swarm/locks/acquire', { filePath: lockPath.value, agentId: lockAgent.value, purpose: 'refactor' }); }; const releaseLock = async (filePath, agentId) => { await api.postJson('/api/swarm/locks/release', { filePath, agentId }); };
    const overrideLock = async (filePath) => { await api.overrideLock(filePath); leases.value = leases.value.filter((l) => l.filePath !== filePath); };
    const executeSetting = async (action, p = {}) => { const res = await api.postJson('/api/swarm/settings/action', { action, ...p }); const d = await res.json(); settingsMsg.value = d.message || (d.success ? 'Success' : 'Error'); };
    const openAgentProfile = (a) => {
      selectedAgent.value = typeof a === 'string' ? (agents.value.find((ag) => ag.id === a || ag.name === a) || { id: a, name: a === '@user' ? 'Project Director' : a, role: a === '@user' ? 'director' : 'specialist', model: a === '@user' ? 'Human Operator' : 'Gemini 3.8 Flash', userTitle: a === '@user' ? 'Project Director' : 'Swarm Specialist', rankStars: '★★★★★', status: 'active', postsCount: 1, signature: 'Chemical X Community Member' }) : a;
      editingSignature.value = selectedAgent.value?.signature || '';
    };
    const saveSignature = async () => {
      if (!selectedAgent.value) return;
      await api.postJson('/api/swarm/agents/signature', { agentId: selectedAgent.value.id, signature: editingSignature.value });
      selectedAgent.value.signature = editingSignature.value;
      const target = agents.value.find((x) => x.id === selectedAgent.value.id); if (target) target.signature = editingSignature.value;
    };
    const openSavingsModal = async () => { showModal.value = true; await nextTick(); window.renderSavingsCanvas?.(document.getElementById('cert-canvas'), savings.value); }; const downloadPng = () => window.downloadSavingsPng?.(document.getElementById('cert-canvas'));
    const resolveCurrentRoute = () => {
      const loc = window.location, p = (loc.pathname || '') + (loc.hash || '') + (loc.search || '');
      const tm = p.match(/(?:tasks\/|task[-/]|taskId=|task=)(\d+)/);
      if (tm) { activeTab.value = 'tasks'; highlightedTaskId.value = parseInt(tm[1], 10); nextTick(() => { const el = document.getElementById('task-' + highlightedTaskId.value); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); return; }
      const routes = ['tasks', 'database', 'codebase', 'agents', 'locks', 'attention', 'workbench', 'settings'];
      for (const r of routes) { if (new RegExp(r, 'i').test(p)) { activeTab.value = r; if (r === 'tasks') highlightedTaskId.value = null; return; } }
    };
    const navigateToTask = (id) => { activeTab.value = 'tasks'; highlightedTaskId.value = id; try { history.pushState(null, '', '/tasks/' + id); } catch { window.location.hash = '#tasks/' + id; } nextTick(() => { const el = document.getElementById('task-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); };
    const copyTaskLink = (id) => { if (navigator.clipboard) navigator.clipboard.writeText(window.location.origin + '/tasks/' + id); navigateToTask(id); };
    const openTaskDetail = async (id) => { const t = tasks.value.find((x) => x.id === id); selectedTaskDetail.value = t || null; selectedTaskEvents.value = t ? await api.fetchTaskFeed(id) : []; }; const closeTaskDetail = () => { selectedTaskDetail.value = null; selectedTaskEvents.value = []; };
    const submitTaskUpdate = async () => {
      if (!selectedTaskDetail.value || !taskUpdateMsg.value.trim()) return;
      await api.postTaskUpdate(selectedTaskDetail.value.id, taskUpdateMsg.value.trim(), '@ui-operator', taskUpdateType.value);
      taskUpdateMsg.value = ''; selectedTaskEvents.value = await api.fetchTaskFeed(selectedTaskDetail.value.id);
    };
    onMounted(async () => {
      resolveCurrentRoute(); window.addEventListener('popstate', resolveCurrentRoute); window.addEventListener('hashchange', resolveCurrentRoute);
      fetchStatus();
      if (ft.refreshCodebase) await ft.refreshCodebase(); else codebaseFiles.value = await api.fetchCodebase();
      fetchAttention(); fetchDbMetrics(); runDbQuery(); if (studio.initStudio) await studio.initStudio();
    });
    onUnmounted(() => { clearTimeout(timer); window.removeEventListener('popstate', resolveCurrentRoute); window.removeEventListener('hashchange', resolveCurrentRoute); });
    return { activeTab, drawerOpen, showModal, highlightedTaskId, selectedTaskDetail, selectedTaskEvents, taskUpdateMsg, taskUpdateType, openTaskDetail, closeTaskDetail, submitTaskUpdate, resolveCurrentRoute, navigateToTask, copyTaskLink, agents, posts, leases, tasks, telemetry, savings, forumCategories, selectedAgent, editingSignature, codebaseFiles, newPost, newTask, newTaskTitle, newTaskTier, newTaskPriority, newTaskPath, newTaskMoscow, newTaskVdsPriority, updateTaskVdsSlot, lockPath, lockAgent, settingsMsg, attentionItems, antigravityRunning, dbMetrics, dbQuery, dbResults, dbError, kanbanColumns, getColumnTasks, updateTaskStatus, reassignTask, overrideLock, taskRefusals, sendPost, createTask, claimTask, completeTask, acquireLock, releaseLock, executeSetting, openAgentProfile, saveSignature, fetchAttention, confirmAttention, runDbQuery, selectDbPreset, openSavingsModal, downloadPng, ...ft, ...studio, ...forum };
  }
}).mount('#app');
`;

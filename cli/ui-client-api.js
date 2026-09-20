/**
 * Chemical X UI Client REST API Bridge
 */
export const UI_CLIENT_API_SCRIPT = `
window.chemxApi = {
  fetchStatus: async () => {
    try { const res = await fetch('/api/swarm/status'); if (res.ok) return await res.json(); } catch (_err) { return null; }
    return null;
  },
  fetchCodebase: async () => {
    try { const res = await fetch('/api/swarm/codebase'); if (res.ok) { const d = await res.json(); return d.files || []; } } catch (_err) { return []; }
    return [];
  },
  fetchFileTree: async () => {
    try { const res = await fetch('/api/codebase/tree'); if (res.ok) return await res.json(); } catch (_err) { return { success: false, tree: [], files: [] }; }
    return { success: false, tree: [], files: [] };
  },
  fetchFileDetails: async (path) => {
    try { const res = await fetch('/api/codebase/file?path=' + encodeURIComponent(path)); if (res.ok) return await res.json(); } catch (_err) { return { success: false, error: 'Network error' }; }
    return { success: false, error: 'Network error' };
  },
  fetchAttention: async () => {
    try { const res = await fetch('/api/swarm/attention'); if (res.ok) return await res.json(); } catch (_err) { return { items: [], antigravityRunning: false }; }
    return { items: [], antigravityRunning: false };
  },
  confirmAttention: async (itemId, action) => {
    await fetch('/api/swarm/attention/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, action }) });
  },
  fetchDbMetrics: async () => {
    try { const res = await fetch('/api/swarm/database/metrics'); if (res.ok) return await res.json(); } catch (_err) { return null; }
    return null;
  },
  fetchDbTables: async () => {
    try { const res = await fetch('/api/db/tables'); if (res.ok) return await res.json(); } catch (_err) { return { success: false, tables: [] }; }
    return { success: false, tables: [] };
  },
  fetchDbBrowse: async (table, page = 1, pageSize = 25) => {
    try { const res = await fetch('/api/db/browse?table=' + encodeURIComponent(table) + '&page=' + page + '&pageSize=' + pageSize); if (res.ok) return await res.json(); } catch (_err) { return { success: false, rows: [], columns: [] }; }
    return { success: false, rows: [], columns: [] };
  },
  fetchDbStructure: async (table) => {
    try { const res = await fetch('/api/db/structure?table=' + encodeURIComponent(table)); if (res.ok) return await res.json(); } catch (_err) { return { success: false, columns: [] }; }
    return { success: false, columns: [] };
  },
  generatePrompt: async (scope = 'master', excludeAiSlop = false) => {
    try { const res = await fetch('/api/prompts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, excludeAiSlop }) }); if (res.ok) return await res.json(); } catch (_err) { return { success: false, error: 'Network error' }; }
    return { success: false, error: 'Failed to generate prompt' };
  },
  runDbQuery: async (query) => {
    try {
      const res = await fetch('/api/db/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
      return await res.json();
    } catch (err) { return { success: false, error: err.message }; }
  },
  postJson: async (url, body) => {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
  updateTaskStatus: async (taskId, status, blockedReason = '') => {
    const res = await fetch('/api/tasks/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, status, blockedReason }) });
    return await res.json();
  },
  assignTask: async (taskId, agentId) => {
    const res = await fetch('/api/tasks/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, agentId }) });
    return await res.json();
  },
  overrideLock: async (filePath, agentId = '@ui-operator') => {
    const res = await fetch('/api/locks/override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath, agentId }) });
    return await res.json();
  },
  createTask: async (payload) => {
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await res.json();
  },
  fetchTopics: async (category = '') => {
    try { const res = await fetch('/api/topics' + (category ? '?category=' + encodeURIComponent(category) : '')); if (res.ok) return await res.json(); } catch (_err) { return { success: false, topics: [] }; }
    return { success: false, topics: [] };
  },
  fetchTopicPosts: async (topicId) => {
    try { const res = await fetch('/api/topics/posts?topicId=' + encodeURIComponent(topicId)); if (res.ok) return await res.json(); } catch (_err) { return { success: false, posts: [] }; }
    return { success: false, posts: [] };
  },
  createTopic: async (payload) => {
    const res = await fetch('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await res.json();
  }
};
`;

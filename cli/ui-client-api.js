/**
 * Chemical X UI Client REST API Bridge
 */
export const UI_CLIENT_API_SCRIPT = `
window.chemxApi = {
  fetchStatus: async () => {
    try {
      const res = await fetch('/api/swarm/status');
      if (res.ok) return await res.json();
    } catch {}
    return null;
  },
  fetchCodebase: async () => {
    try {
      const res = await fetch('/api/swarm/codebase');
      if (res.ok) { const d = await res.json(); return d.files || []; }
    } catch {}
    return [];
  },
  fetchAttention: async () => {
    try {
      const res = await fetch('/api/swarm/attention');
      if (res.ok) return await res.json();
    } catch {}
    return { items: [], antigravityRunning: false };
  },
  confirmAttention: async (itemId, action) => {
    await fetch('/api/swarm/attention/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, action }) });
  },
  fetchDbMetrics: async () => {
    try {
      const res = await fetch('/api/swarm/database/metrics');
      if (res.ok) return await res.json();
    } catch {}
    return null;
  },
  runDbQuery: async (query) => {
    try {
      const res = await fetch('/api/swarm/database/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  postJson: async (url, body) => {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
};
`;

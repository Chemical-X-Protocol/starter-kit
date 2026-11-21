/**
 * Shared core for chemx ui components (social sprint, epic #7614). ui-html.js inlines every file in this
 * directory in name order, so this one loads first. A component file registers itself:
 *   window.ChemxUi.components['xo-name'] = { props, setup, template };
 * and the app registers them all. Components read live state with Vue.inject('chemx'):
 *   { posts, agents, leases, taskCounts, telemetry, me, route, navigate(hash), openTaskDetail(id), agentById(id) }
 *   posts: computed, newest first, live view only (about 50). me: ref, the human's handle.
 *   route: reactive { tab, id }, from the hash #/<tab>[/<id>]. navigate('#/agents/@x') changes it.
 */
(() => {
  const ChemxUi = (window.ChemxUi = window.ChemxUi || { components: {} });
  const PALETTE = ['#62c9ff', '#a3e635', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c', '#38bdf8'];
  const hashOf = (text) => [...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  ChemxUi.avatarColor = (handle) => PALETTE[hashOf(handle || '?') % PALETTE.length];
  ChemxUi.initials = (handle) => {
    const parts = String(handle || '?').replace(/^@/, '').split(/[-_.\s]+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  };

  ChemxUi.relativeTime = (ts) => {
    const ms = Number(ts);
    const hasTime = ms > 0;
    if (!hasTime) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    const isJustNow = s < 45;
    if (isJustNow) return 'just now';
    const steps = [[60, 'm', 60], [24, 'h', 3600], [7, 'd', 86400]];
    for (const [limit, unit, size] of steps) {
      const n = Math.round(s / size);
      const fitsUnit = n < limit;
      if (fitsUnit) return n + unit + ' ago';
    }
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Lock and guard churn is most of the feed; the Story view rolls these up.
  ChemxUi.NOISE_EVENTS = new Set(['lock_acquired', 'lock_released', 'lock_expired', 'guard-bypass']);
  const EVENT_META = {
    commit: { icon: 'mdi-source-commit', color: '#a3e635', label: 'committed' },
    task_created: { icon: 'mdi-plus-box-outline', color: '#62c9ff', label: 'created a task' },
    task_complete: { icon: 'mdi-check-decagram', color: '#34d399', label: 'finished a task' },
    task_handoff: { icon: 'mdi-hand-back-right-outline', color: '#fbbf24', label: 'handed off' },
    task_status_updated: { icon: 'mdi-swap-horizontal', color: '#a78bfa', label: 'moved a task' },
    status_update: { icon: 'mdi-message-text-outline', color: '#38bdf8', label: 'posted an update' },
    decision: { icon: 'mdi-gavel', color: '#f472b6', label: 'decided' },
    dm: { icon: 'mdi-email-outline', color: '#f472b6', label: 'sent a DM' },
    broadcast: { icon: 'mdi-bullhorn-outline', color: '#fb923c', label: 'broadcast' },
    dispatch_planned: { icon: 'mdi-rocket-launch-outline', color: '#a78bfa', label: 'planned a dispatch' },
    lock_acquired: { icon: 'mdi-lock-outline', color: '#94a3b8', label: 'locked a file' },
    lock_released: { icon: 'mdi-lock-open-variant-outline', color: '#94a3b8', label: 'released a file' },
    lock_expired: { icon: 'mdi-timer-sand', color: '#94a3b8', label: 'let a lock lapse' },
    'guard-bypass': { icon: 'mdi-shield-alert-outline', color: '#fbbf24', label: 'bypassed a guard' }
  };
  ChemxUi.eventMeta = (type) => EVENT_META[type] || { icon: 'mdi-message-outline', color: '#94a3b8', label: type || 'posted' };

  // One post shape for both the live view (camelCase) and /api/feed rows (snake_case).
  const pick = (row, camel, snake) => row[camel] ?? row[snake] ?? null;
  ChemxUi.toPost = (f = {}) => {
    const recipient = pick(f, 'recipient', 'recipient_id');
    return {
      id: f.id, author: pick(f, 'author', 'author_id'), message: f.message || '', eventType: pick(f, 'eventType', 'event_type'),
      timestamp: Number(f.timestamp || 0), recipient, isDirectMessage: Boolean(recipient),
      taskId: pick(f, 'taskId', 'task_id'), threadId: pick(f, 'threadId', 'thread_id'), filePath: pick(f, 'filePath', 'file_path')
    };
  };

  // Settings > Appearance density: a class on <html> the token CSS reads. Applied once at load from browser storage.
  ChemxUi.applyDensity = (density) => {
    const hasDocument = typeof document !== 'undefined';
    if (hasDocument) document.documentElement.classList.toggle('x-density-comfortable', density === 'comfortable');
  };
  try { ChemxUi.applyDensity(localStorage.getItem('chemx_density') || 'compact'); } catch { ChemxUi.applyDensity('compact'); } // chemx-allow: storage can be blocked; compact is the default

  ChemxUi.getJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  };
  ChemxUi.postJson = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  };
})();

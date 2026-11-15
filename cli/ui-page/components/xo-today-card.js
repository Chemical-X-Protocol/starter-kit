/**
 * <xo-today-card />: what the swarm did today, from GET /api/digest/today (epic #7614). Compact glass card at
 * the top of the timeline. Each number links to the tasks tab, each agent to #/agents/<handle>. Collapsible;
 * the collapsed state lives in localStorage and the card works without it.
 */
window.ChemxUi.components['xo-today-card'] = {
  setup() {
    const { ref, computed, inject, onMounted, onBeforeUnmount } = Vue;
    const chemx = inject('chemx');
    const STORAGE_KEY = 'chemx-today-card-collapsed';
    const REFRESH_MS = 60000;
    const digest = ref(null);
    const loadError = ref('');
    const isCollapsed = ref(false);
    let timer = null;

    const readCollapsed = () => {
      try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (err) { return false; }
    };
    const writeCollapsed = (value) => {
      try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (err) { /* chemx-allow: best-effort storage may be unavailable; the card still works */ }
    };
    const toggle = () => {
      isCollapsed.value = !isCollapsed.value;
      writeCollapsed(isCollapsed.value);
    };
    const load = async () => {
      try {
        digest.value = await window.ChemxUi.getJson('/api/digest/today');
        loadError.value = '';
      } catch (err) {
        loadError.value = 'Could not load today\'s digest (' + err.message + ').';
      }
    };
    const go = (hash) => chemx.navigate(hash);

    const stats = computed(() => {
      const d = digest.value || {};
      return [
        { key: 'commits', label: 'commits', value: d.commits || 0 },
        { key: 'done', label: 'tasks done', value: d.tasksCompleted || 0 },
        { key: 'created', label: 'tasks created', value: d.tasksCreated || 0 },
        { key: 'handoffs', label: 'handoffs', value: d.handoffs || 0 },
        { key: 'decisions', label: 'decisions', value: d.decisions || 0 },
        { key: 'blockers', label: 'open blockers', value: d.openBlockers || 0 }
      ];
    });
    const agents = computed(() => (digest.value && digest.value.agents) || []);
    const isEmpty = computed(() => Boolean(digest.value) && !digest.value.hasActivity && !digest.value.openBlockers);

    onMounted(() => {
      isCollapsed.value = readCollapsed();
      load();
      timer = setInterval(load, REFRESH_MS);
    });
    onBeforeUnmount(() => clearInterval(timer));

    return { stats, agents, digest, isEmpty, isCollapsed, loadError, toggle, go };
  },
  template: `<section class="xo-glass xo-today" aria-label="Today">
    <header class="xo-today-head">
      <button type="button" class="xo-today-toggle" :aria-expanded="!isCollapsed" @click="toggle">
        <span class="xo-display">Today</span>
        <span class="xo-today-caret">{{ isCollapsed ? 'Show' : 'Hide' }}</span>
      </button>
    </header>
    <div v-if="!isCollapsed" class="xo-today-body">
      <div v-if="loadError" class="xo-today-note" role="alert">{{ loadError }}</div>
      <div v-else-if="!digest" class="xo-today-note">Loading today's digest...</div>
      <div v-else-if="isEmpty" class="xo-today-note">Nothing has happened yet today.</div>
      <template v-else>
        <div class="xo-today-stats">
          <a v-for="s in stats" :key="s.key" class="xo-today-stat" href="#/tasks" @click.prevent="go('#/tasks')">
            <b>{{ s.value }}</b><span>{{ s.label }}</span>
          </a>
        </div>
        <div v-if="agents.length" class="xo-today-agents">
          <span class="xo-today-label">Most active</span>
          <a v-for="a in agents" :key="a.handle" class="xo-today-agent" :href="'#/agents/' + a.handle" @click.prevent="go('#/agents/' + a.handle)">
            <xo-avatar :handle="a.handle" :size="20" :link="false" />{{ a.handle }} <em>{{ a.posts }}</em>
          </a>
        </div>
      </template>
    </div>
  </section>`
};

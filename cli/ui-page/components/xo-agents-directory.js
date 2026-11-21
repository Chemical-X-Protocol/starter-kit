/**
 * <xo-agents-directory />: the Agents page without a handle (#7645). Crew (imported StarNet members) as cards with
 * their role, model, status, current task and record; every other session handle as a searchable, sortable table.
 * Reads GET /api/agents/directory; refreshes when the live feed moves.
 */
(() => {
  const KINDS = [{ id: 'crew', label: 'Crew' }, { id: 'sessions', label: 'Sessions' }, { id: 'all', label: 'All' }];
  const STATUSES = ['all', 'active', 'idle', 'offline'];
  const SORTS = [{ value: 'recent', title: 'Recently active' }, { value: 'done', title: 'Most tasks done' }, { value: 'name', title: 'Name' }];
  const PAGE = 48;
  const modelFamily = (model) => (String(model).match(/(haiku|sonnet|opus|fable)/) || [])[1] || '';

  window.ChemxUi.components['xo-agents-directory'] = {
    setup() {
      const { ref, computed, watch, onMounted, onUnmounted } = Vue;
      const chemx = Vue.inject('chemx');
      const ui = window.ChemxUi;
      const kind = ref('crew');
      const status = ref('all');
      const sort = ref('recent');
      const q = ref('');
      const agents = ref([]);
      const total = ref(0);
      const counts = ref({});
      const isLoading = ref(false);
      const loadError = ref('');
      let seq = 0;
      let debounce = null;

      const url = (offset) => '/api/agents/directory?' + new URLSearchParams({ kind: kind.value, status: status.value, sort: sort.value, q: q.value, limit: PAGE, offset }).toString();
      const load = async (offset = 0) => {
        const mine = ++seq;
        isLoading.value = true;
        loadError.value = '';
        try {
          const d = await ui.getJson(url(offset));
          const isStale = mine !== seq;
          if (isStale) return;
          agents.value = offset ? [...agents.value, ...d.agents] : d.agents;
          total.value = d.total;
          counts.value = d.counts || {};
          const isFirstCrewless = offset === 0 && kind.value === 'crew' && !d.counts?.crew;
          if (isFirstCrewless) kind.value = 'all';
        } catch (err) {
          const isCurrent = mine === seq;
          if (isCurrent) loadError.value = 'Could not load agents (' + err.message + ').';
        } finally {
          const isCurrent = mine === seq;
          if (isCurrent) isLoading.value = false;
        }
      };
      watch([kind, status, sort], () => load(0));
      watch(q, () => { clearTimeout(debounce); debounce = setTimeout(() => load(0), 250); });
      watch(() => chemx.posts.value[0]?.id, () => { clearTimeout(debounce); debounce = setTimeout(() => load(0), 2000); });
      onMounted(() => load(0));
      onUnmounted(() => clearTimeout(debounce));

      const kindCount = (id) => Number(counts.value[id] || 0).toLocaleString();
      const lastSeen = (a) => ui.relativeTime(Math.max(Number(a.heartbeat) || 0, Number(a.lastPostAt) || 0));
      const statusColor = (s) => ({ active: 'var(--x-ok)', idle: 'var(--x-accent)', offline: 'var(--x-text-3)' })[s] || 'var(--x-text-3)';
      const open = (id) => chemx.navigate('#/agents/' + id);
      const openTask = (id) => chemx.navigate('#/tasks/' + id);
      const isCards = computed(() => kind.value === 'crew');
      return {
        kinds: KINDS, statuses: STATUSES, sorts: SORTS, kind, status, sort, q, agents, total, counts, isLoading, loadError, isCards,
        kindCount, lastSeen, statusColor, open, openTask, modelFamily, loadMore: () => load(agents.value.length)
      };
    },
    template: `
      <div class="xo-dir">
        <div class="xo-dir__bar">
          <div class="xo-dir__tabs" role="tablist" aria-label="Which agents">
            <button v-for="k in kinds" :key="k.id" type="button" role="tab" :aria-selected="kind === k.id" :class="{ 'is-on': kind === k.id }" @click="kind = k.id">
              {{ k.label }}<span class="x-num">{{ kindCount(k.id) }}</span>
            </button>
          </div>
          <v-text-field v-model="q" class="xo-dir__search" placeholder="Search handle, name or role" prepend-inner-icon="mdi-magnify" clearable @click:clear="q = ''" />
          <div class="xo-board__seg" role="group" aria-label="Filter by status">
            <button v-for="s in statuses" :key="s" type="button" :class="{ 'is-on': status === s }" :aria-pressed="status === s" @click="status = s">{{ s === 'all' ? 'Any status' : s }}</button>
          </div>
          <v-select v-model="sort" class="xo-dir__sort" :items="sorts" prepend-inner-icon="mdi-sort" aria-label="Sort" />
        </div>
        <v-progress-linear v-if="isLoading" indeterminate color="primary" height="2" />
        <p v-if="loadError" class="x-muted">{{ loadError }}</p>

        <div class="xo-dir__scroll">
          <div v-if="!agents.length && !isLoading" class="x-empty">
            <template v-if="kind === 'crew'">No crew on this board yet. Run <code>chemx team crew import</code> to bring in your StarNet crew.</template>
            <template v-else>No agents match.</template>
          </div>

          <div v-if="isCards" class="xo-dir__grid">
            <article v-for="a in agents" :key="a.id" class="xo-crew" tabindex="0" role="button" :aria-label="'Open ' + a.id" @click="open(a.id)" @keydown.enter="open(a.id)">
              <header class="xo-crew__head">
                <xo-avatar :handle="a.id" :size="44" :link="false" />
                <div class="xo-crew__names">
                  <div class="xo-crew__name">{{ a.name }}</div>
                  <div class="xo-crew__handle">{{ a.id }}</div>
                </div>
                <span class="xo-crew__status" :style="{ '--c': statusColor(a.status) }" :title="'Last seen ' + lastSeen(a)"><span class="x-dot" />{{ a.status }}</span>
              </header>
              <p class="xo-crew__role">{{ a.role }}</p>
              <div class="xo-crew__tags">
                <span v-if="modelFamily(a.model)" class="xo-card__tag">{{ modelFamily(a.model) }}</span>
                <span v-if="a.tier" class="xo-card__tag">{{ a.tier }} work</span>
              </div>
              <button v-if="a.currentTask" type="button" class="xo-crew__task" @click.stop="openTask(a.currentTask.id)">
                <span class="x-eyebrow">Working on</span><span class="xo-crew__task-title">#{{ a.currentTask.id }} {{ a.currentTask.title }}</span>
              </button>
              <div v-else class="xo-crew__task xo-crew__task--idle"><span class="x-eyebrow">Not on a task</span></div>
              <dl class="xo-crew__stats">
                <div><dt>Done</dt><dd class="x-num">{{ a.done.toLocaleString() }}</dd></div>
                <div><dt>In progress</dt><dd class="x-num">{{ a.inProgress }}</dd></div>
                <div><dt>Posts</dt><dd class="x-num">{{ a.posts.toLocaleString() }}</dd></div>
                <div><dt>Last seen</dt><dd>{{ lastSeen(a) || 'never' }}</dd></div>
              </dl>
            </article>
          </div>

          <section v-else-if="agents.length" class="x-panel">
            <table class="xo-table xo-dir__table">
              <thead><tr><th>Agent</th><th>Status</th><th>Working on</th><th class="xo-table__num">Done</th><th class="xo-table__num">Posts</th><th class="xo-table__num">Last seen</th></tr></thead>
              <tbody>
                <tr v-for="a in agents" :key="a.id" tabindex="0" @click="open(a.id)" @keydown.enter="open(a.id)">
                  <td><span class="xo-dir__who"><xo-avatar :handle="a.id" :size="22" :link="false" /><span><b>{{ a.id }}</b><small v-if="a.role">{{ a.role }}</small></span></span></td>
                  <td><span class="xo-crew__status" :style="{ '--c': statusColor(a.status) }"><span class="x-dot" />{{ a.status }}</span></td>
                  <td class="xo-dir__task"><button v-if="a.currentTask" type="button" class="xo-table__who" @click.stop="openTask(a.currentTask.id)">#{{ a.currentTask.id }} {{ a.currentTask.title }}</button></td>
                  <td class="xo-table__num">{{ a.done.toLocaleString() }}</td>
                  <td class="xo-table__num">{{ a.posts.toLocaleString() }}</td>
                  <td class="xo-table__num xo-table__muted">{{ lastSeen(a) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <xo-load-more :shown="agents.length" :total="total" :loading="isLoading" :step="48" noun="agents" @more="loadMore" />
        </div>
      </div>`
  };
})();

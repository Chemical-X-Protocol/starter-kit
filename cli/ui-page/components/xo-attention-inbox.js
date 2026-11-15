/**
 * <xo-attention-inbox :items @action="(id, action) => …" @open="taskId => …" />: the Attention Inbox (#7636).
 * Groups what needs a human (approvals, blocked tasks, lock requests, agent questions), with a filter per group,
 * search, and the facts needed to decide: task id, assignee, repo, the blocked reason, how long ago it changed.
 * Task actions: Approve (pending approval only), Requeue (back to queued, reason cleared), Cancel (asks first).
 */
(() => {
  const GROUPS = [
    { id: 'approval', label: 'Needs approval', icon: 'mdi-account-check-outline', color: '#fbbf24' },
    { id: 'blocked', label: 'Blocked tasks', icon: 'mdi-alert-octagon-outline', color: '#f472b6' },
    { id: 'lock', label: 'Lock requests', icon: 'mdi-lock-clock', color: '#a78bfa' },
    { id: 'agent', label: 'Agent questions', icon: 'mdi-robot-confused-outline', color: '#62c9ff' }
  ];
  const groupOf = (item) => {
    const isTask = item.type === 'task';
    if (isTask) return item.status === 'pending_approval' ? 'approval' : 'blocked';
    return item.type === 'lock' ? 'lock' : 'agent';
  };

  window.ChemxUi.components['xo-attention-inbox'] = {
    props: { items: { type: Array, default: () => [] } },
    emits: ['action', 'open'],
    setup(props, { emit }) {
      const { ref, computed } = Vue;
      const filter = ref('all');
      const query = ref('');
      const confirming = ref('');
      const matches = (item) => {
        const needle = query.value.trim().toLowerCase();
        if (!needle) return true;
        return [item.title, item.reason, item.assignee, item.repo, item.detail, item.taskId && '#' + item.taskId]
          .some((text) => String(text || '').toLowerCase().includes(needle));
      };
      const counts = computed(() => Object.fromEntries(GROUPS.map((g) => [g.id, props.items.filter((i) => groupOf(i) === g.id).length])));
      const groups = computed(() => GROUPS
        .filter((g) => filter.value === 'all' || filter.value === g.id)
        .map((g) => ({ ...g, items: props.items.filter((i) => groupOf(i) === g.id && matches(i)) }))
        .filter((g) => g.items.length));
      const shown = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0));
      const summary = computed(() => {
        const n = props.items.length;
        if (!n) return 'Nothing is waiting on you.';
        return n === 1 ? '1 item waiting on a person' : n + ' items waiting on a person';
      });
      const act = (item, action) => {
        const needsConfirm = action === 'cancel' && confirming.value !== item.id;
        if (needsConfirm) { confirming.value = item.id; return; }
        confirming.value = '';
        emit('action', item.id, action);
      };
      return { groupDefs: GROUPS, filter, query, confirming, counts, groups, shown, summary, act, relativeTime: window.ChemxUi.relativeTime };
    },
    template: `
      <section class="xo-inbox">
        <header class="xo-inbox__head">
          <p class="xo-inbox__sub">{{ summary }}</p>
          <v-text-field v-if="items.length" v-model="query" class="xo-inbox__search" placeholder="Search title, reason, agent, repo, #id"
            prepend-inner-icon="mdi-magnify" density="compact" variant="outlined" hide-details clearable />
        </header>

        <nav v-if="items.length" class="xo-inbox__filters" aria-label="Filter by kind">
          <button type="button" class="xo-inbox__filter" :class="{ 'is-on': filter === 'all' }" @click="filter = 'all'">All <b>{{ items.length }}</b></button>
          <button v-for="g in groupDefs" v-show="counts[g.id]" :key="g.id" type="button" class="xo-inbox__filter"
            :class="{ 'is-on': filter === g.id }" :style="{ '--c': g.color }" @click="filter = g.id">
            <v-icon size="14">{{ g.icon }}</v-icon>{{ g.label }} <b>{{ counts[g.id] }}</b>
          </button>
        </nav>

        <div class="xo-inbox__scroll">
          <div v-if="!items.length" class="xo-inbox__empty">
            <v-icon size="40">mdi-check-circle-outline</v-icon>
            <div>All clear: no approvals, blocked tasks, lock requests or agent questions.</div>
          </div>
          <div v-else-if="!shown" class="xo-inbox__empty">No items match "{{ query }}".</div>

          <section v-for="g in groups" :key="g.id" class="xo-inbox__group">
            <h2 class="xo-inbox__group-title" :style="{ '--c': g.color }"><v-icon size="16">{{ g.icon }}</v-icon>{{ g.label }}<span>{{ g.items.length }}</span></h2>
            <article v-for="item in g.items" :key="item.id" class="xo-inbox__item" :style="{ '--c': g.color }">
              <div class="xo-inbox__main">
                <div class="xo-inbox__meta">
                  <button v-if="item.taskId" type="button" class="xo-inbox__id" @click="$emit('open', item.taskId)">#{{ item.taskId }}</button>
                  <span v-if="item.repo" class="xo-inbox__tag">{{ item.repo }}</span>
                  <span v-if="item.needs" class="xo-inbox__tag">{{ item.needs }}</span>
                  <span v-if="item.priority === 1" class="xo-inbox__tag xo-inbox__tag--hot">P1</span>
                  <span v-if="item.timestamp" class="xo-inbox__muted">{{ relativeTime(item.timestamp) }}</span>
                </div>
                <button v-if="item.taskId" type="button" class="xo-inbox__item-title" @click="$emit('open', item.taskId)">{{ item.title }}</button>
                <div v-else class="xo-inbox__item-title">{{ item.title }}</div>
                <p v-if="item.reason" class="xo-inbox__reason">{{ item.reason }}</p>
                <p v-else-if="!item.taskId && item.detail" class="xo-inbox__reason">{{ item.detail }}</p>
                <div v-if="item.assignee" class="xo-inbox__who"><xo-avatar :handle="item.assignee" :size="18" />{{ item.assignee }}</div>
              </div>
              <div class="xo-inbox__actions">
                <template v-if="item.taskId">
                  <v-btn v-if="g.id === 'approval'" size="small" color="success" variant="tonal" @click="act(item, 'approve')">Approve</v-btn>
                  <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-restore" @click="act(item, 'requeue')">Requeue</v-btn>
                  <v-btn size="small" :variant="confirming === item.id ? 'flat' : 'text'" :color="confirming === item.id ? 'error' : undefined"
                    @click="act(item, 'cancel')">{{ confirming === item.id ? 'Confirm cancel' : 'Cancel task' }}</v-btn>
                </template>
                <template v-else>
                  <v-btn size="small" color="success" variant="tonal" @click="act(item, 'approve')">{{ g.id === 'lock' ? 'Grant' : 'Approve' }}</v-btn>
                  <v-btn size="small" variant="text" @click="act(item, 'dismiss')">{{ g.id === 'lock' ? 'Deny' : 'Dismiss' }}</v-btn>
                </template>
              </div>
            </article>
          </section>
        </div>
      </section>`
  };
})();

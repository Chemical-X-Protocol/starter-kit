/**
 * <xo-overview />: the landing page (#7640). Explains what Chemical X is, then shows the board live: task counts,
 * what needs a person, what is in progress, today's digest, the crew, recent activity, and the commands that drive it.
 * Every number comes from the API (/api/status via inject('chemx'), /api/digest/today, /api/attention, /api/tasks,
 * /api/agents, /api/feed/story); a section with no data says so instead of showing placeholders.
 */
(() => {
  const STATUS_TILES = [
    { id: 'queued', label: 'Queued' }, { id: 'in_progress', label: 'In progress' }, { id: 'review', label: 'In review' },
    { id: 'blocked', label: 'Blocked' }, { id: 'done', label: 'Done' }
  ];
  const STEPS = [
    { title: 'File the work', text: 'Every change starts as a task with a needs tier, so it can be routed to the right model.', cmd: 'chemx team task add "<title>" --needs=standard' },
    { title: 'Claim and lock', text: 'An agent claims the task and leases each file before editing; nobody else edits a leased file.', cmd: 'chemx team task claim <id> --as=@you' },
    { title: 'Build and verify', text: 'Tests, typecheck and the architecture audit run through one gate that prints only what failed.', cmd: 'chemx verify' },
    { title: 'Commit and close', text: 'Commit only your files, release the leases, and close the task; the gate refuses new hazards.', cmd: 'chemx commit <files> --task=<id> --release' }
  ];
  const parseMeta = (raw) => {
    const isParsed = Boolean(raw) && typeof raw === 'object';
    if (isParsed) return raw;
    try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } // chemx-allow: a malformed metadata cell reads as none
  };

  window.ChemxUi.components['xo-overview'] = {
    setup() {
      const { ref, computed, watch, onMounted, onUnmounted } = Vue;
      const chemx = Vue.inject('chemx');
      const ui = window.ChemxUi;
      const digest = ref(null);
      const attention = ref([]);
      const working = ref([]);
      const crew = ref([]);
      const story = ref([]);
      const loadError = ref('');
      const copied = ref('');

      const settle = async (url, apply) => {
        try { apply(await ui.getJson(url)); } catch (err) { loadError.value = 'Some sections could not load (' + err.message + ').'; }
      };
      const load = () => Promise.all([
        settle('/api/digest/today', (d) => { digest.value = d.success ? d : null; }),
        settle('/api/attention', (d) => { attention.value = d.items || []; }),
        settle('/api/tasks?status=in_progress&limit=8&sort=recent', (d) => { working.value = d.tasks || []; }),
        settle('/api/agents?limit=200', (d) => { crew.value = (d.agents || []).filter((a) => parseMeta(a.metadata).source === 'starnet'); }),
        settle('/api/feed/story?limit=8', (d) => { story.value = (d.feed || []).slice().reverse(); })
      ]);
      let timer = null;
      let pending = null;
      let copiedTimer = null;
      onMounted(() => { load(); timer = setInterval(load, 60000); });
      onUnmounted(() => { clearInterval(timer); clearTimeout(pending); clearTimeout(copiedTimer); });
      watch(() => chemx.posts.value[0]?.id, () => { clearTimeout(pending); pending = setTimeout(load, 1500); });

      const counts = computed(() => chemx.taskCounts.value || {});
      const tiles = computed(() => STATUS_TILES.map((tile) => ({ ...tile, value: Number(counts.value[tile.id] || 0) })));
      const total = computed(() => Number(counts.value.total || 0) || tiles.value.reduce((n, t) => n + t.value, 0));
      const activeAgents = computed(() => chemx.agents.value.filter((a) => a.status === 'active' || a.status === 'busy').length);
      const today = computed(() => {
        const d = digest.value;
        if (!d) return [];
        return [['Commits', d.commits], ['Tasks finished', d.tasksCompleted], ['Tasks filed', d.tasksCreated], ['Handoffs', d.handoffs], ['Decisions', d.decisions]];
      });
      const topAgents = computed(() => (digest.value?.agents || []).slice(0, 5));
      const statusColor = (status) => `var(--x-status-${status}, var(--x-text-3))`;
      const storyLine = (row) => {
        const type = row.eventType || row.event_type;
        const isRollup = type === 'rollup';
        if (isRollup) return 'touched ' + row.count + ' file lock' + (row.count === 1 ? '' : 's');
        return row.message || '';
      };
      // The crew row's model, shortened: claude-opus-5-5 -> opus.
      const tierOf = (agent) => {
        const model = String(parseMeta(agent.metadata).model || '');
        const family = model.match(/(haiku|sonnet|opus|fable)/);
        return family ? family[1] : model;
      };
      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          copied.value = text;
          clearTimeout(copiedTimer);
          copiedTimer = setTimeout(() => { copied.value = ''; }, 1500);
        } catch { copied.value = ''; } // chemx-allow: clipboard can be refused; the command stays visible to copy by hand
      };
      const go = (hash) => chemx.navigate(hash);

      return {
        chemx, tiles, total, activeAgents, today, topAgents, attention, working, crew, story, loadError, copied, steps: STEPS,
        statusColor, storyLine, tierOf, copy, go, relativeTime: ui.relativeTime, eventMeta: ui.eventMeta
      };
    },
    template: `
      <div class="xo-ov">
        <section class="xo-ov__intro x-panel">
          <div class="xo-ov__intro-text">
            <div class="x-eyebrow">Welcome</div>
            <h2 class="xo-ov__headline">One board for every agent working on this codebase.</h2>
            <p class="xo-ov__lede">Chemical X keeps tasks, file locks, the activity feed and DMs in a single SQLite board (<code>.chemx/index.db</code>).
              Agents and people claim work, lock the files they touch, verify, commit and close, so nobody overwrites anybody. This page shows that board live.</p>
          </div>
          <div class="xo-ov__tiles" role="list" aria-label="Tasks by status">
            <button v-for="t in tiles" :key="t.id" type="button" role="listitem" class="xo-ov__tile" @click="go('#/tasks')">
              <span class="xo-ov__tile-label"><span class="x-dot" :style="{ background: statusColor(t.id) }" />{{ t.label }}</span>
              <span class="xo-ov__tile-value x-num">{{ t.value.toLocaleString() }}</span>
            </button>
            <div class="xo-ov__tile xo-ov__tile--plain" role="listitem">
              <span class="xo-ov__tile-label">Agents active · locks held</span>
              <span class="xo-ov__tile-value x-num">{{ activeAgents }} · {{ chemx.leases.value.length }}</span>
            </div>
          </div>
        </section>

        <p v-if="loadError" class="x-muted">{{ loadError }}</p>

        <div class="xo-ov__grid">
          <section class="x-panel xo-ov__span2">
            <header class="x-panel__head"><h3 class="x-panel__title">Needs you</h3><span class="x-panel__hint">{{ attention.length }} waiting</span>
              <button type="button" class="x-panel__link" @click="go('#/attention')">Open inbox</button></header>
            <div class="x-panel__body">
              <div v-if="!attention.length" class="x-empty">Nothing is waiting on a person.</div>
              <button v-for="item in attention.slice(0, 6)" :key="item.id" type="button" class="x-row" @click="item.taskId ? go('#/tasks/' + item.taskId) : go('#/attention')">
                <span class="x-dot" :style="{ background: item.status === 'pending_approval' ? 'var(--x-warn)' : 'var(--x-danger)' }" />
                <span v-if="item.taskId" class="x-muted x-num">#{{ item.taskId }}</span>
                <span class="x-row__main">{{ item.title }}</span>
                <span v-if="item.timestamp" class="x-muted">{{ relativeTime(item.timestamp) }}</span>
              </button>
            </div>
          </section>

          <section class="x-panel">
            <header class="x-panel__head"><h3 class="x-panel__title">Today</h3><span class="x-panel__hint">since midnight</span></header>
            <div class="x-panel__body">
              <div v-if="!today.length" class="x-empty">No digest yet.</div>
              <dl v-else class="xo-ov__stats">
                <template v-for="[label, value] in today" :key="label"><dt>{{ label }}</dt><dd class="x-num">{{ Number(value || 0).toLocaleString() }}</dd></template>
              </dl>
              <div v-if="topAgents.length" class="xo-ov__sub">
                <div class="x-eyebrow">Most active</div>
                <button v-for="a in topAgents" :key="a.handle" type="button" class="x-row" @click="go('#/agents/' + a.handle)">
                  <xo-avatar :handle="a.handle" :size="22" :link="false" /><span class="x-row__main">{{ a.handle }}</span>
                  <span class="x-muted x-num">{{ a.posts }} posts</span>
                </button>
              </div>
            </div>
          </section>

          <section class="x-panel xo-ov__span2">
            <header class="x-panel__head"><h3 class="x-panel__title">In progress</h3>
              <button type="button" class="x-panel__link" @click="go('#/tasks')">All tasks</button></header>
            <div class="x-panel__body">
              <div v-if="!working.length" class="x-empty">No task is in progress.</div>
              <button v-for="t in working" :key="t.id" type="button" class="x-row" @click="go('#/tasks/' + t.id)">
                <span class="x-muted x-num">#{{ t.id }}</span>
                <span class="x-row__main">{{ t.title }}</span>
                <span v-if="t.assigned_agent_id" class="xo-ov__who"><xo-avatar :handle="t.assigned_agent_id" :size="20" :link="false" />{{ t.assigned_agent_id }}</span>
              </button>
            </div>
          </section>

          <section class="x-panel">
            <header class="x-panel__head"><h3 class="x-panel__title">Crew</h3><span class="x-panel__hint">{{ crew.length }} members</span>
              <button type="button" class="x-panel__link" @click="go('#/agents')">Agents</button></header>
            <div class="x-panel__body">
              <div v-if="!crew.length" class="x-empty">No crew imported. Run <code>chemx team crew import</code>.</div>
              <button v-for="a in crew.slice(0, 8)" :key="a.id" type="button" class="x-row" @click="go('#/agents/' + a.id)">
                <xo-avatar :handle="a.id" :size="22" :link="false" />
                <span class="x-row__main">{{ a.id }}</span>
                <span class="x-muted">{{ tierOf(a) }}</span>
              </button>
            </div>
          </section>

          <section class="x-panel xo-ov__span2">
            <header class="x-panel__head"><h3 class="x-panel__title">Recent activity</h3>
              <button type="button" class="x-panel__link" @click="go('#/social')">Timeline</button></header>
            <div class="x-panel__body">
              <div v-if="!story.length" class="x-empty">No activity yet.</div>
              <div v-for="row in story" :key="row.id" class="xo-ov__event">
                <v-icon size="16" :color="eventMeta(row.eventType || row.event_type).color">{{ eventMeta(row.eventType || row.event_type).icon }}</v-icon>
                <span class="xo-ov__event-who">{{ row.author || row.author_id }}</span>
                <span class="xo-ov__event-msg">{{ storyLine(row) }}</span>
                <span class="x-muted">{{ relativeTime(row.to || row.timestamp) }}</span>
              </div>
            </div>
          </section>

          <section class="x-panel">
            <header class="x-panel__head"><h3 class="x-panel__title">How work flows</h3></header>
            <ol class="x-panel__body xo-ov__steps">
              <li v-for="(s, i) in steps" :key="s.title">
                <div class="xo-ov__step-title"><span class="xo-ov__step-n">{{ i + 1 }}</span>{{ s.title }}</div>
                <p class="xo-ov__step-text">{{ s.text }}</p>
                <div class="x-code"><code>{{ s.cmd }}</code>
                  <v-btn size="x-small" variant="text" :icon="copied === s.cmd ? 'mdi-check' : 'mdi-content-copy'" :aria-label="'Copy ' + s.cmd" @click="copy(s.cmd)" />
                </div>
              </li>
            </ol>
          </section>
        </div>
      </div>`
  };
})();

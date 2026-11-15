/**
 * <xo-task-sheet :task :events :related :agents :busy @close @status @assign @post @open />: the task details
 * slide-over (#7636). Shows the whole row: description, brief, every tier/priority/sprint field, files, the tasks it
 * links to (parent, subtasks, dependencies, dependents) and the activity feed. Any non-empty column the sections
 * below do not name is listed under "Other fields", so nothing in the row is hidden.
 */
(() => {
  const SHOWN = new Set([
    'id', 'title', 'description', 'brief', 'briefChars', 'status', 'assigned_agent_id', 'assignedTo', 'blocked_reason',
    'needs', 'priority', 'moscow', 'sprint_tag', 'kind', 'origin_type', 'repo', 'tier', 'rule_id', 'vds_status',
    'created_at', 'claimed_at', 'updated_at', 'prompt_tokens', 'completion_tokens', 'cached_tokens', 'total_tokens',
    'cost_usd', 'target_path', 'targetPath', 'target_symbol', 'extra_files', 'parent_id', 'dependencies', 'related'
  ]);
  const EMPTY_TEXT = new Set(['', '{}', '[]', 'null']);
  const STATUSES = ['queued', 'in_progress', 'review', 'blocked', 'done', 'cancelled'];
  const STATUS_COLOR = { queued: '#62c9ff', in_progress: '#fbbf24', review: '#a78bfa', blocked: '#f472b6', done: '#34d399', cancelled: '#94a3b8' };

  const listOf = (raw) => {
    if (Array.isArray(raw)) return raw;
    try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } // chemx-allow: a malformed list cell shows as empty
  };
  const isFilled = (value) => {
    const isMissing = value === null || value === undefined;
    if (isMissing) return false;
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
    return !EMPTY_TEXT.has(text) && text !== '0';
  };
  const stamp = (ms) => {
    const value = Number(ms);
    const hasTime = value > 0;
    if (!hasTime) return '';
    return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · ' + window.ChemxUi.relativeTime(value);
  };

  window.ChemxUi.components['xo-task-sheet'] = {
    props: {
      task: { type: Object, required: true },
      events: { type: Array, default: () => [] },
      agents: { type: Array, default: () => [] },
      busy: { type: Boolean, default: false }
    },
    emits: ['close', 'status', 'assign', 'post', 'open'],
    setup(props, { emit }) {
      const { ref, computed } = Vue;
      const note = ref('');
      const isBriefOpen = ref(false);
      const t = computed(() => props.task || {});
      const related = computed(() => t.value.related || {});
      const assignee = computed(() => t.value.assigned_agent_id || t.value.assignedTo || '');
      const target = computed(() => t.value.target_path || t.value.targetPath || '');
      const extraFiles = computed(() => listOf(t.value.extra_files));
      const brief = computed(() => String(t.value.brief || '').trim());
      const subtasks = computed(() => related.value.children || []);
      const subtasksDone = computed(() => subtasks.value.filter((c) => c.status === 'done').length);
      const statusColor = (status) => STATUS_COLOR[status] || '#94a3b8';
      const assigneeItems = computed(() => {
        const ids = props.agents.map((a) => a.id);
        const hasCurrent = Boolean(assignee.value) && !ids.includes(assignee.value);
        return ['@unassigned', ...(hasCurrent ? [assignee.value] : []), ...ids];
      });
      const facts = computed(() => [
        ['Needs', t.value.needs], ['Priority', t.value.priority ? 'P' + t.value.priority : ''], ['MoSCoW', t.value.moscow],
        ['Sprint', t.value.sprint_tag], ['Kind', t.value.kind], ['Origin', t.value.origin_type], ['Repo', t.value.repo],
        ['Tier', t.value.tier], ['Rule', t.value.rule_id], ['VDS status', t.value.vds_status],
        ['Created', stamp(t.value.created_at)], ['Claimed', stamp(t.value.claimed_at)], ['Updated', stamp(t.value.updated_at)]
      ].filter(([, value]) => isFilled(value)));
      const usage = computed(() => {
        const parts = [['Prompt', t.value.prompt_tokens], ['Completion', t.value.completion_tokens], ['Cached', t.value.cached_tokens], ['Total', t.value.total_tokens]]
          .filter(([, n]) => Number(n) > 0).map(([label, n]) => label + ' ' + Number(n).toLocaleString());
        const hasCost = Number(t.value.cost_usd) > 0;
        return hasCost ? [...parts, '$' + Number(t.value.cost_usd).toFixed(4)] : parts;
      });
      const otherFields = computed(() => Object.entries(t.value)
        .filter(([key, value]) => !SHOWN.has(key) && isFilled(value))
        .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)]));
      const links = computed(() => [
        ['Parent', related.value.parent ? [related.value.parent] : []],
        ['Depends on', related.value.dependencies || []],
        ['Blocks', related.value.dependents || []]
      ].filter(([, rows]) => rows.length));
      const send = () => {
        const text = note.value.trim();
        if (!text) return;
        emit('post', text);
        note.value = '';
      };
      const eventIcon = (type) => window.ChemxUi.eventMeta(type).icon;
      return {
        t, note, isBriefOpen, assignee, target, extraFiles, brief, subtasks, subtasksDone, facts, usage, otherFields, links,
        assigneeItems, statuses: STATUSES, statusColor, send, eventIcon, relativeTime: window.ChemxUi.relativeTime
      };
    },
    template: `
      <aside class="xo-sheet" role="dialog" :aria-label="'Task ' + t.id">
        <header class="xo-sheet__head">
          <div class="xo-sheet__eyebrow">
            <span class="xo-sheet__id">#{{ t.id }}</span>
            <span class="xo-sheet__status" :style="{ '--c': statusColor(t.status) }">{{ (t.status || '').replace('_', ' ') }}</span>
            <span v-if="t.needs" class="xo-sheet__tag">{{ t.needs }}</span>
            <span v-if="t.priority" class="xo-sheet__tag">P{{ t.priority }}</span>
            <span v-if="t.kind && t.kind !== 'task'" class="xo-sheet__tag">{{ t.kind }}</span>
          </div>
          <h2 class="xo-sheet__title">{{ t.title }}</h2>
          <v-btn class="xo-sheet__close" icon="mdi-close" variant="text" size="small" aria-label="Close" @click="$emit('close')" />
        </header>

        <div class="xo-sheet__body">
          <div v-if="t.blocked_reason" class="xo-sheet__blocked"><v-icon size="16">mdi-alert-octagon-outline</v-icon><span>{{ t.blocked_reason }}</span></div>

          <div class="xo-sheet__controls">
            <label class="xo-sheet__control"><span class="xo-sheet__label">Status</span>
              <v-select density="compact" hide-details variant="outlined" :items="statuses" :model-value="t.status" @update:model-value="$emit('status', $event)" />
            </label>
            <label class="xo-sheet__control"><span class="xo-sheet__label">Assignee</span>
              <v-select density="compact" hide-details variant="outlined" :items="assigneeItems" :model-value="assignee || '@unassigned'"
                @update:model-value="$emit('assign', $event === '@unassigned' ? null : $event)" />
            </label>
          </div>

          <section v-if="t.description" class="xo-sheet__section">
            <h3 class="xo-sheet__label">Description</h3>
            <p class="xo-sheet__prose">{{ t.description }}</p>
          </section>

          <section v-if="brief" class="xo-sheet__section">
            <button class="xo-sheet__toggle" type="button" :aria-expanded="isBriefOpen" @click="isBriefOpen = !isBriefOpen">
              <span class="xo-sheet__label">Brief</span><span class="xo-sheet__muted">{{ brief.length.toLocaleString() }} chars</span>
              <v-icon size="16">{{ isBriefOpen ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
            </button>
            <pre v-if="isBriefOpen" class="xo-sheet__brief">{{ brief }}</pre>
          </section>

          <section v-if="facts.length" class="xo-sheet__section">
            <h3 class="xo-sheet__label">Details</h3>
            <dl class="xo-sheet__facts">
              <template v-for="[label, value] in facts" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
            </dl>
          </section>

          <section v-if="target || extraFiles.length" class="xo-sheet__section">
            <h3 class="xo-sheet__label">Files</h3>
            <div v-if="target" class="xo-sheet__file xo-sheet__file--target"><v-icon size="14">mdi-target</v-icon>{{ target }}<span v-if="t.target_symbol" class="xo-sheet__muted"> · {{ t.target_symbol }}</span></div>
            <div v-for="f in extraFiles" :key="f" class="xo-sheet__file"><v-icon size="14">mdi-file-outline</v-icon>{{ f }}</div>
          </section>

          <section v-if="links.length || subtasks.length" class="xo-sheet__section">
            <h3 class="xo-sheet__label">Related</h3>
            <div v-for="[label, rows] in links" :key="label" class="xo-sheet__links">
              <span class="xo-sheet__muted">{{ label }}</span>
              <button v-for="r in rows" :key="r.id" type="button" class="xo-sheet__link" @click="$emit('open', r.id)">
                <span class="xo-sheet__dot" :style="{ background: statusColor(r.status) }" :title="r.status" />#{{ r.id }} {{ r.title }}
              </button>
            </div>
            <div v-if="subtasks.length" class="xo-sheet__links">
              <span class="xo-sheet__muted">Subtasks · {{ subtasksDone }}/{{ subtasks.length }} done</span>
              <div class="xo-sheet__progress"><span :style="{ width: (100 * subtasksDone / subtasks.length) + '%' }" /></div>
              <button v-for="r in subtasks" :key="r.id" type="button" class="xo-sheet__link" @click="$emit('open', r.id)">
                <span class="xo-sheet__dot" :style="{ background: statusColor(r.status) }" :title="r.status" />#{{ r.id }} {{ r.title }}
                <span v-if="r.assignee" class="xo-sheet__muted">{{ r.assignee }}</span>
              </button>
            </div>
          </section>

          <section v-if="usage.length" class="xo-sheet__section">
            <h3 class="xo-sheet__label">Usage</h3>
            <div class="xo-sheet__muted">{{ usage.join(' · ') }}</div>
          </section>

          <section v-if="otherFields.length" class="xo-sheet__section">
            <h3 class="xo-sheet__label">Other fields</h3>
            <dl class="xo-sheet__facts xo-sheet__facts--raw">
              <template v-for="[key, value] in otherFields" :key="key"><dt>{{ key }}</dt><dd><pre>{{ value }}</pre></dd></template>
            </dl>
          </section>

          <section class="xo-sheet__section">
            <h3 class="xo-sheet__label">Activity · {{ events.length }}</h3>
            <div v-if="!events.length" class="xo-sheet__muted">No activity recorded for this task yet.</div>
            <ol class="xo-sheet__events">
              <li v-for="ev in events" :key="ev.id" class="xo-sheet__event">
                <v-icon size="14" class="xo-sheet__event-icon">{{ eventIcon(ev.event_type || ev.eventType) }}</v-icon>
                <div class="xo-sheet__event-main">
                  <div class="xo-sheet__event-head">
                    <xo-avatar :handle="ev.author_id || ev.author" :size="18" />
                    <strong>{{ ev.author_id || ev.author }}</strong>
                    <span class="xo-sheet__muted">{{ relativeTime(ev.timestamp) }}</span>
                  </div>
                  <div class="xo-sheet__event-msg">{{ ev.message }}</div>
                </div>
              </li>
            </ol>
          </section>
        </div>

        <footer class="xo-sheet__foot">
          <v-text-field v-model="note" placeholder="Add a note to this task" density="compact" variant="outlined" hide-details @keydown.enter="send" />
          <v-btn color="primary" variant="flat" :loading="busy" :disabled="!note.trim()" @click="send">Post</v-btn>
        </footer>
      </aside>`
  };
})();

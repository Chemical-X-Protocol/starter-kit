/**
 * <xo-task-board :columns v-model:search v-model:tier v-model:hide-tests @open @move @more />: the Tasks page board (#7640).
 * columns: [{ status, label, items, total, loading }] from the app's server-paged board. Cards show only recorded data:
 * id, title, needs/tier, priority, parent, subtasks, target file, assignee, and tokens when any were recorded.
 */
(() => {
  const TIERS = ['all', 'atom', 'molecule', 'organism', 'utility'];
  const NEXT = {
    queued: { to: 'in_progress', label: 'Start', icon: 'mdi-play' },
    in_progress: { to: 'done', label: 'Done', icon: 'mdi-check' },
    review: { to: 'done', label: 'Done', icon: 'mdi-check' },
    blocked: { to: 'queued', label: 'Requeue', icon: 'mdi-restore' },
    done: { to: 'in_progress', label: 'Reopen', icon: 'mdi-restore' }
  };
  const tokensOf = (t) => Number(t.total_tokens || 0) || Number(t.prompt_tokens || 0) + Number(t.completion_tokens || 0);

  window.ChemxUi.components['xo-task-board'] = {
    props: {
      columns: { type: Array, default: () => [] },
      search: { type: String, default: '' },
      tier: { type: String, default: 'all' },
      hideTests: { type: Boolean, default: true },
      step: { type: Number, default: 25 }
    },
    emits: ['open', 'move', 'more', 'update:search', 'update:tier', 'update:hideTests'],
    setup() {
      const tokenLabel = (t) => {
        const n = tokensOf(t);
        if (!n) return '';
        return n >= 1000 ? Math.round(n / 1000).toLocaleString() + 'k tokens' : n + ' tokens';
      };
      const statusColor = (status) => `var(--x-status-${status}, var(--x-text-3))`;
      return { tiers: TIERS, next: NEXT, tokenLabel, statusColor };
    },
    template: `
      <div class="xo-board">
        <div class="xo-board__bar">
          <v-text-field class="xo-board__search" :model-value="search" placeholder="Search titles, files, #id" prepend-inner-icon="mdi-magnify" clearable
            @update:model-value="$emit('update:search', $event || '')" />
          <div class="xo-board__seg" role="group" aria-label="Filter by tier">
            <button v-for="t in tiers" :key="t" type="button" :class="{ 'is-on': tier === t }" :aria-pressed="tier === t" @click="$emit('update:tier', t)">{{ t }}</button>
          </div>
          <v-spacer />
          <v-switch :model-value="hideTests" color="primary" density="compact" hide-details inset label="Hide test tasks"
            @update:model-value="$emit('update:hideTests', Boolean($event))" />
        </div>

        <div class="xo-board__cols">
          <section v-for="col in columns" :key="col.status" class="xo-board__col kanban-col" :aria-label="col.label">
            <header class="xo-board__col-head">
              <span class="x-dot" :style="{ background: statusColor(col.status) }" />
              <h2>{{ col.label }}</h2>
              <span class="xo-board__count x-num" :title="col.total + ' tasks match the filters'">{{ col.total.toLocaleString() }}</span>
            </header>
            <v-progress-linear v-if="col.loading" indeterminate color="primary" height="2" />
            <div class="xo-board__list">
              <article v-for="t in col.items" :key="t.id" class="xo-card" tabindex="0" role="button" :aria-label="'Open task ' + t.id + ': ' + t.title"
                @click="$emit('open', t.id)" @keydown.enter="$emit('open', t.id)">
                <div class="xo-card__top">
                  <span class="xo-card__id x-num">#{{ t.id }}</span>
                  <span v-if="t.priority === 1" class="xo-card__tag xo-card__tag--hot">P1</span>
                  <span v-if="t.needs" class="xo-card__tag">{{ t.needs }}</span>
                  <span v-else-if="t.tier" class="xo-card__tag">{{ t.tier }}</span>
                  <span v-if="t.subtaskCount > 0" class="xo-card__tag" :title="t.subtaskCount + ' subtasks'"><v-icon size="12">mdi-file-tree-outline</v-icon>{{ t.subtaskCount }}</span>
                  <button v-if="next[col.status]" type="button" class="xo-card__act" :title="next[col.status].label" @click.stop="$emit('move', t.id, next[col.status].to)">
                    <v-icon size="14">{{ next[col.status].icon }}</v-icon>{{ next[col.status].label }}
                  </button>
                </div>
                <div class="xo-card__title">{{ t.title }}</div>
                <div v-if="t.target_path || t.targetPath" class="xo-card__file" :title="t.target_path || t.targetPath">{{ t.target_path || t.targetPath }}</div>
                <div class="xo-card__foot">
                  <span v-if="t.assigned_agent_id || t.assignedTo" class="xo-card__who">
                    <xo-avatar :handle="t.assigned_agent_id || t.assignedTo" :size="18" :link="false" />{{ t.assigned_agent_id || t.assignedTo }}
                  </span>
                  <span v-else class="x-muted">Unassigned</span>
                  <span v-if="t.parentId" class="x-muted x-num" :title="'Subtask of #' + t.parentId">↳ #{{ t.parentId }}</span>
                  <span v-if="tokenLabel(t)" class="x-muted x-num xo-card__tokens">{{ tokenLabel(t) }}</span>
                </div>
              </article>
              <div v-if="!col.items.length && !col.loading" class="x-empty">No tasks</div>
              <xo-load-more :shown="col.items.length" :total="col.total" :loading="col.loading" :step="step" noun="tasks" @more="$emit('more', col.status)" />
            </div>
          </section>
        </div>
      </div>`
  };
})();

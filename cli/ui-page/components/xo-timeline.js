/**
 * <xo-timeline />: the feed column (epic #7614). Live posts come from inject('chemx').posts. The Story view
 * (default) rolls each run of one author's lock churn into one row and pages older rows from
 * /api/feed/story?before_id=; the All view shows every event and pages /api/feed?before_id=.
 * Rollup rows: { eventType: 'rollup', id, author, count, files, from, to }; id is the run's oldest event id.
 */
window.ChemxUi.components['xo-timeline'] = {
  setup() {
    const { ref, computed, inject } = Vue;
    const chemx = inject('chemx');
    const isStory = ref(true);
    const older = ref({ story: [], all: [] });
    const cursor = ref({ story: null, all: null });
    const hasOlder = ref(true);
    const isLoading = ref(false);
    const loadError = ref('');
    const isNoise = (p) => window.ChemxUi.NOISE_EVENTS.has(p.eventType);

    const mergeRun = (run, p) => ({
      ...run,
      count: run.count + 1,
      files: p.filePath && !run.files.includes(p.filePath) ? [...run.files, p.filePath] : run.files,
      from: Math.min(run.from, p.timestamp),
      to: Math.max(run.to, p.timestamp)
    });
    const newRun = (p) => ({ eventType: 'rollup', id: p.id, author: p.author, count: 0, files: [], from: p.timestamp, to: p.timestamp });
    // Oldest-first in and out, the same rule as rollUpRows in cli/ui-social-feed.js.
    const rollUp = (posts) => {
      const out = [];
      let open = null;
      for (const p of posts) {
        const continuesRun = open !== null && isNoise(p) && open.author === p.author;
        const closesRun = !continuesRun && open !== null;
        if (closesRun) out.push(open);
        if (isNoise(p)) {
          open = mergeRun(continuesRun ? open : newRun(p), p);
        } else {
          open = null;
          out.push(p);
        }
      }
      if (open) out.push(open);
      return out;
    };

    const mode = computed(() => (isStory.value ? 'story' : 'all'));
    const rawLive = computed(() => [...chemx.posts.value].sort((a, b) => a.id - b.id));
    const live = computed(() => (isStory.value ? rollUp(rawLive.value) : rawLive.value));
    const list = computed(() => {
      const byKey = new Map();
      for (const p of [...older.value[mode.value], ...live.value]) byKey.set(p.eventType === 'rollup' ? 'r' + p.id : p.id, p);
      return [...byKey.values()].sort((a, b) => b.id - a.id);
    });
    const oldestKnownId = () => {
      const ids = [cursor.value[mode.value], ...rawLive.value.map((p) => p.id)].filter((id) => id !== null);
      return ids.length ? Math.min(...ids) : null;
    };
    const toRow = (row) => (row.eventType === 'rollup' ? row : window.ChemxUi.toPost(row));

    const loadOlder = async () => {
      const beforeId = oldestKnownId();
      const canLoad = beforeId !== null && !isLoading.value;
      if (!canLoad) return;
      const key = mode.value;
      isLoading.value = true;
      loadError.value = '';
      try {
        const base = isStory.value ? '/api/feed/story' : '/api/feed';
        const d = await window.ChemxUi.getJson(base + '?limit=50&before_id=' + beforeId);
        older.value = { ...older.value, [key]: [...older.value[key], ...(d.feed || []).map(toRow)] };
        cursor.value = { ...cursor.value, [key]: d.oldestId ?? cursor.value[key] };
        hasOlder.value = Boolean(d.hasMore);
      } catch (err) {
        loadError.value = 'Could not load older posts (' + err.message + '). Try again.';
      } finally {
        isLoading.value = false;
      }
    };
    const setStory = (value) => {
      isStory.value = value;
      hasOlder.value = true;
      loadError.value = '';
    };
    const rollupText = (r) => r.count + ' lock event' + (r.count === 1 ? '' : 's') + ' on ' + r.files.length + ' file' + (r.files.length === 1 ? '' : 's');
    return { isStory, list, hasOlder, isLoading, loadError, loadOlder, setStory, rollupText, relativeTime: window.ChemxUi.relativeTime };
  },
  template: `
    <div class="xo-timeline">
      <div class="xo-timeline__bar">
        <div class="xo-board__seg" role="group" aria-label="Timeline view">
          <button type="button" :class="{ 'is-on': isStory }" :aria-pressed="isStory" title="Lock and guard churn rolled up" @click="setStory(true)">Story</button>
          <button type="button" :class="{ 'is-on': !isStory }" :aria-pressed="!isStory" title="Every event" @click="setStory(false)">All events</button>
        </div>
        <span class="x-muted x-num">{{ list.length }} shown</span>
      </div>
      <div class="xo-timeline__list">
        <template v-for="p in list" :key="p.eventType === 'rollup' ? 'r' + p.id : p.id">
          <div v-if="p.eventType === 'rollup'" class="xo-rollup">
            <span class="xo-handle">{{ p.author }}</span>
            <span>{{ rollupText(p) }}</span>
            <span class="xo-rollup__files" :title="p.files.join(', ')">{{ p.files.join(', ') }}</span>
            <span class="xo-muted">{{ relativeTime(p.to) }}</span>
          </div>
          <xo-post-card v-else :post="p" />
        </template>
        <div v-if="list.length" class="xo-load-more">
          <v-btn v-if="hasOlder" size="x-small" variant="tonal" color="primary" :loading="isLoading" @click="loadOlder">Load older posts</v-btn>
          <span v-else class="xo-load-more__count">Start of the timeline</span>
          <span v-if="loadError" class="xo-load-more__count">{{ loadError }}</span>
        </div>
        <div v-else class="x-empty">No activity yet. Posts, commits and task events appear here as agents work.</div>
      </div>
    </div>`
};

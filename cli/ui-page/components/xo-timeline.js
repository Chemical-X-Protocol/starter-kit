/**
 * <xo-timeline />: the feed column (epic #7614). Live posts come from inject('chemx').posts; older pages
 * load with /api/feed?before_id=. The Story view (task S1) extends this file.
 */
window.ChemxUi.components['xo-timeline'] = {
  setup() {
    const { ref, computed, inject } = Vue;
    const chemx = inject('chemx');
    const older = ref([]);
    const hasOlder = ref(true);
    const isLoading = ref(false);
    const loadError = ref('');
    const list = computed(() => {
      const byId = new Map();
      for (const p of [...older.value, ...chemx.posts.value]) byId.set(p.id, p);
      return [...byId.values()].sort((a, b) => b.id - a.id);
    });
    const loadOlder = async () => {
      const oldest = list.value[list.value.length - 1];
      const canLoad = Boolean(oldest) && !isLoading.value;
      if (!canLoad) return;
      isLoading.value = true;
      loadError.value = '';
      try {
        const d = await window.ChemxUi.getJson('/api/feed?limit=50&before_id=' + oldest.id);
        older.value = [...older.value, ...(d.feed || []).map(window.ChemxUi.toPost)];
        hasOlder.value = Boolean(d.hasMore);
      } catch (err) {
        loadError.value = 'Could not load older posts (' + err.message + '). Try again.';
      } finally {
        isLoading.value = false;
      }
    };
    return { list, hasOlder, isLoading, loadError, loadOlder };
  },
  template: `
    <div class="d-flex flex-column" style="flex:1;min-height:0;">
      <div class="d-flex justify-space-between align-center mb-3">
        <span class="xo-display" style="font-size:13px;">Live Timeline</span>
        <v-chip size="x-small" color="primary" variant="tonal">{{ list.length }}</v-chip>
      </div>
      <div style="flex:1;overflow-y:auto;" class="d-flex flex-column gap-2">
        <xo-post-card v-for="p in list" :key="p.id" :post="p" />
        <div v-if="list.length" class="xo-load-more">
          <v-btn v-if="hasOlder" size="x-small" variant="tonal" color="primary" :loading="isLoading" @click="loadOlder">Load older posts</v-btn>
          <span v-else class="xo-load-more__count">Start of the timeline</span>
          <span v-if="loadError" class="xo-load-more__count">{{ loadError }}</span>
        </div>
        <div v-else class="xo-stub">Waiting for swarm activity...</div>
      </div>
    </div>`
};

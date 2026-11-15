/**
 * <xo-agent-profile :agent-id="id" />: an agent's profile page at #/agents/@handle (epic #7614, task #7624).
 * Reads GET /api/agents/<handle>/profile: header, stat row, in-progress claims (open the task sheet), live
 * locks and the agent's posts as xo-post-card, paged oldest-first by the API and shown newest first, with
 * Load older. Nothing is shown that the API did not return. With no agentId it lists inject('chemx').agents,
 * each linking to its profile; that list is the live view the app has loaded, not necessarily every agent.
 */
window.ChemxUi.components['xo-agent-profile'] = {
  props: { agentId: { type: String, default: '' } },
  setup(props) {
    const { ref, computed, inject, watch, onMounted } = Vue;
    const chemx = inject('chemx');
    const profile = ref(null);
    const posts = ref([]);
    const hasMore = ref(false);
    const oldestId = ref(null);
    const isLoading = ref(false);
    const isLoadingMore = ref(false);
    const loadError = ref('');
    const moreError = ref('');
    let requestSeq = 0;

    const url = (extra) => '/api/agents/' + encodeURIComponent(props.agentId) + '/profile' + extra;
    const mergePosts = (rows) => {
      const byId = new Map();
      for (const p of [...rows.map(window.ChemxUi.toPost), ...posts.value]) byId.set(p.id, p);
      posts.value = [...byId.values()].sort((a, b) => b.id - a.id);
    };
    const load = async () => {
      const seq = ++requestSeq;
      profile.value = null;
      posts.value = [];
      loadError.value = '';
      moreError.value = '';
      const hasAgent = Boolean(props.agentId);
      if (!hasAgent) return;
      isLoading.value = true;
      try {
        const d = await window.ChemxUi.getJson(url(''));
        const isStale = seq !== requestSeq;
        if (isStale) return;
        if (!d.success) throw new Error(d.error || 'Unknown agent');
        profile.value = d;
        mergePosts(d.posts || []);
        hasMore.value = Boolean(d.hasMore);
        oldestId.value = d.oldestId ?? null;
      } catch (err) {
        const isCurrent = seq === requestSeq;
        if (isCurrent) loadError.value = 'Could not load this profile (' + err.message + ').';
      } finally {
        const isLatest = seq === requestSeq;
        if (isLatest) isLoading.value = false;
      }
    };
    const loadOlder = async () => {
      const canLoad = oldestId.value !== null && !isLoadingMore.value;
      if (!canLoad) return;
      const seq = requestSeq;
      isLoadingMore.value = true;
      moreError.value = '';
      try {
        const d = await window.ChemxUi.getJson(url('?before_id=' + oldestId.value));
        const isStale = seq !== requestSeq;
        if (isStale) return;
        if (!d.success) throw new Error(d.error || 'request failed');
        mergePosts(d.posts || []);
        hasMore.value = Boolean(d.hasMore);
        oldestId.value = d.oldestId ?? oldestId.value;
      } catch (err) {
        moreError.value = 'Could not load older posts (' + err.message + '). Try again.';
      } finally {
        isLoadingMore.value = false;
      }
    };

    const agent = computed(() => (profile.value && profile.value.agent) || {});
    const handle = computed(() => agent.value.id || props.agentId);
    const stats = computed(() => {
      const c = (profile.value && profile.value.counts) || {};
      return [
        { key: 'posts', label: 'posts', value: c.posts || 0 },
        { key: 'commits', label: 'commits', value: c.commits || 0 },
        { key: 'done', label: 'tasks done', value: c.tasksDone || 0 },
        { key: 'active', label: 'in progress', value: c.tasksInProgress || 0 }
      ];
    });
    const claims = computed(() => (profile.value && profile.value.claims) || []);
    const leases = computed(() => (profile.value && profile.value.leases) || []);
    const lastSeen = computed(() => window.ChemxUi.relativeTime(agent.value.heartbeat));
    const statusClass = computed(() => 'xo-prof-dot--' + String(agent.value.status || 'unknown').toLowerCase());
    const directory = computed(() => chemx.agents.value || chemx.agents || []);
    const openTask = (id) => chemx.openTaskDetail(id);
    const openAgent = (id) => chemx.navigate('#/agents/' + id);

    watch(() => props.agentId, load);
    onMounted(load);
    return {
      profile, posts, hasMore, isLoading, isLoadingMore, loadError, moreError, agent, handle, stats, claims, leases,
      lastSeen, statusClass, directory, load, loadOlder, openTask, openAgent, relativeTime: window.ChemxUi.relativeTime
    };
  },
  template: `
    <v-sheet class="xo-glass xo-prof" color="transparent">
      <template v-if="!agentId">
        <div class="xo-display">Agents</div>
        <div v-if="!directory.length" class="xo-stub mt-2">No agents are loaded yet.</div>
        <v-sheet v-else color="transparent" class="xo-prof-dir">
          <a v-for="a in directory" :key="a.id" class="xo-prof-dir-row" :href="'#/agents/' + a.id" @click.prevent="openAgent(a.id)">
            <xo-avatar :handle="a.id" :size="28" :link="false" />
            <span class="xo-prof-row-main">{{ a.id }}</span>
            <span class="xo-prof-muted">{{ a.status }}</span>
          </a>
        </v-sheet>
      </template>
      <div v-else-if="loadError" role="alert">
        <div class="xo-stub">{{ loadError }}</div>
        <v-btn size="x-small" variant="tonal" color="primary" class="mt-2" @click="load">Retry</v-btn>
      </div>
      <div v-else-if="isLoading || !profile" class="xo-stub">Loading profile...</div>
      <template v-else>
        <v-sheet color="transparent" class="xo-prof-head">
          <xo-avatar :handle="handle" :size="64" :link="false" />
          <v-sheet color="transparent" class="xo-prof-id">
            <span class="xo-prof-handle">{{ handle }}</span>
            <span class="xo-prof-meta">
              <span class="xo-prof-dot" :class="statusClass" aria-hidden="true"></span>
              <span>{{ agent.status || 'unknown' }}</span>
              <span v-if="agent.role">{{ agent.role }}</span>
              <span v-if="lastSeen">last seen {{ lastSeen }}</span>
            </span>
          </v-sheet>
        </v-sheet>
        <v-sheet color="transparent" class="xo-prof-stats">
          <v-sheet v-for="s in stats" :key="s.key" color="transparent" class="xo-prof-stat"><b>{{ s.value }}</b><span>{{ s.label }}</span></v-sheet>
        </v-sheet>
        <v-sheet color="transparent" class="xo-prof-section">
          <div class="xo-prof-title">Current claims</div>
          <div v-if="!claims.length" class="xo-prof-muted">No in-progress tasks.</div>
          <v-sheet v-for="c in claims" :key="c.id" color="transparent" class="xo-prof-row xo-prof-row--link" role="button" tabindex="0" @click="openTask(c.id)" @keyup.enter="openTask(c.id)">
            <span class="xo-mono">#{{ c.id }}</span><span class="xo-prof-row-main">{{ c.title }}</span>
            <span class="xo-prof-muted">{{ relativeTime(c.updatedAt) }}</span>
          </v-sheet>
        </v-sheet>
        <v-sheet color="transparent" class="xo-prof-section">
          <div class="xo-prof-title">Live locks</div>
          <div v-if="!leases.length" class="xo-prof-muted">No live file locks.</div>
          <v-sheet v-for="l in leases" :key="l.filePath" color="transparent" class="xo-prof-row">
            <v-icon icon="mdi-lock-outline" size="14" color="warning" />
            <span class="xo-prof-row-main xo-mono" :title="l.filePath">{{ l.filePath }}</span>
            <span v-if="l.purpose" class="xo-prof-muted">{{ l.purpose }}</span>
          </v-sheet>
        </v-sheet>
        <v-sheet color="transparent" class="xo-prof-section">
          <div class="xo-prof-title">Posts</div>
          <div v-if="!posts.length" class="xo-prof-muted">No posts yet.</div>
          <v-sheet color="transparent" class="xo-prof-posts">
            <xo-post-card v-for="p in posts" :key="p.id" :post="p" />
          </v-sheet>
          <v-sheet v-if="posts.length" color="transparent" class="xo-load-more">
            <v-btn v-if="hasMore" size="x-small" variant="tonal" color="primary" :loading="isLoadingMore" @click="loadOlder">Load older posts</v-btn>
            <span v-else class="xo-load-more__count">Start of this agent's posts</span>
            <span v-if="moreError" class="xo-load-more__count">{{ moreError }}</span>
          </v-sheet>
        </v-sheet>
      </template>
    </v-sheet>`
};

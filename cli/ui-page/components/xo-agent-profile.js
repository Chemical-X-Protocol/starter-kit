/**
 * <xo-agent-profile :agent-id />: one agent at #/agents/@handle (#7650, #7652). A header with who the agent is
 * (name, role, model, tier, crew, status, last seen) and a Message button; its record; and tabs:
 *   Activity  its posts, newest first, with Load older        Tasks  in progress and recently done
 *   Inbox     its DM conversations and threads (anyone may read them); messages go out as you (inject chemx.me)
 *   Locks     files it holds now                              About  every field the board keeps on it
 * Reads GET /api/agents/<handle>/profile and GET/POST /api/dms. Nothing is shown that the API did not return.
 */
(() => {
  const TABS = [{ id: 'activity', label: 'Activity' }, { id: 'tasks', label: 'Tasks' }, { id: 'inbox', label: 'Inbox' }, { id: 'locks', label: 'Locks' }, { id: 'about', label: 'About' }];
  const modelFamily = (model) => (String(model).match(/(haiku|sonnet|opus|fable)/) || [])[1] || model;
  const statusColor = (s) => ({ active: 'var(--x-ok)', idle: 'var(--x-accent)', offline: 'var(--x-text-3)' })[s] || 'var(--x-text-3)';

  window.ChemxUi.components['xo-agent-profile'] = {
    props: { agentId: { type: String, default: '' } },
    setup(props) {
      const { ref, computed, watch, onMounted } = Vue;
      const chemx = Vue.inject('chemx');
      const ui = window.ChemxUi;
      const profile = ref(null);
      const posts = ref([]);
      const hasMore = ref(false);
      const oldestId = ref(null);
      const isLoading = ref(false);
      const isLoadingMore = ref(false);
      const loadError = ref('');
      const tab = ref('activity');
      const conversations = ref([]);
      const peer = ref('');
      const thread = ref([]);
      const inboxError = ref('');
      const isComposing = ref(false);
      const draft = ref('');
      const isSending = ref(false);
      const sendError = ref('');
      const notice = ref('');
      let seq = 0;

      const handle = computed(() => profile.value?.agent?.id || props.agentId);
      const profileUrl = (extra) => '/api/agents/' + encodeURIComponent(props.agentId) + '/profile' + extra;
      const mergePosts = (rows) => {
        const byId = new Map();
        for (const p of [...rows.map(ui.toPost), ...posts.value]) byId.set(p.id, p);
        posts.value = [...byId.values()].sort((a, b) => b.id - a.id);
      };
      const load = async () => {
        const mine = ++seq;
        profile.value = null; posts.value = []; loadError.value = ''; conversations.value = []; peer.value = ''; thread.value = [];
        const hasAgent = Boolean(props.agentId);
        if (!hasAgent) return;
        isLoading.value = true;
        try {
          const d = await ui.getJson(profileUrl(''));
          const isStale = mine !== seq;
          if (isStale) return;
          if (!d.success) throw new Error(d.error || 'Unknown agent');
          profile.value = d;
          mergePosts(d.posts || []);
          hasMore.value = Boolean(d.hasMore);
          oldestId.value = d.oldestId ?? null;
          loadInbox();
        } catch (err) {
          const isCurrent = mine === seq;
          if (isCurrent) loadError.value = 'Could not load this agent (' + err.message + ').';
        } finally {
          const isCurrent = mine === seq;
          if (isCurrent) isLoading.value = false;
        }
      };
      const loadOlder = async () => {
        const canLoad = oldestId.value !== null && !isLoadingMore.value;
        if (!canLoad) return;
        isLoadingMore.value = true;
        try {
          const d = await ui.getJson(profileUrl('?before_id=' + oldestId.value));
          mergePosts(d.posts || []);
          hasMore.value = Boolean(d.hasMore);
          oldestId.value = d.oldestId ?? oldestId.value;
        } catch (err) {
          loadError.value = 'Could not load older posts (' + err.message + ').';
        } finally {
          isLoadingMore.value = false;
        }
      };
      const loadInbox = async () => {
        inboxError.value = '';
        try {
          const d = await ui.getJson('/api/dms?handle=' + encodeURIComponent(handle.value));
          conversations.value = d.conversations || [];
          const keepPeer = conversations.value.some((c) => c.with === peer.value);
          if (!keepPeer) peer.value = conversations.value[0]?.with || '';
          if (peer.value) await openThread(peer.value);
        } catch (err) {
          inboxError.value = 'Could not load DMs (' + err.message + ').';
        }
      };
      const openThread = async (who) => {
        peer.value = who;
        try {
          const d = await ui.getJson('/api/dms?handle=' + encodeURIComponent(handle.value) + '&with=' + encodeURIComponent(who));
          thread.value = d.messages || [];
        } catch (err) {
          inboxError.value = 'Could not load the conversation (' + err.message + ').';
        }
      };
      const send = async () => {
        const message = draft.value.trim();
        const canSend = Boolean(message) && !isSending.value;
        if (!canSend) return;
        isSending.value = true;
        sendError.value = '';
        try {
          const d = await ui.postJson('/api/dms', { from: chemx.me.value, to: handle.value, message });
          if (!d.success) throw new Error(d.error || 'not sent');
          draft.value = '';
          isComposing.value = false;
          notice.value = 'Sent to ' + handle.value + '. It is in their chemx team inbox.';
          tab.value = 'inbox';
          peer.value = chemx.me.value;
          await loadInbox();
        } catch (err) {
          sendError.value = 'Not sent: ' + err.message;
        } finally {
          isSending.value = false;
        }
      };
      onMounted(load);
      watch(() => props.agentId, () => { tab.value = 'activity'; notice.value = ''; load(); });

      const agent = computed(() => profile.value?.agent || {});
      const counts = computed(() => profile.value?.counts || {});
      const stats = computed(() => [
        ['Tasks done', counts.value.tasksDone], ['In progress', counts.value.tasksInProgress], ['Posts', counts.value.posts], ['Commits', counts.value.commits]
      ].map(([label, n]) => [label, Number(n || 0).toLocaleString()]));
      const unread = computed(() => conversations.value.reduce((n, c) => n + c.unread, 0));
      const isMe = computed(() => handle.value === chemx.me.value);
      const about = computed(() => {
        const a = agent.value;
        const caps = Array.isArray(a.capabilities) ? a.capabilities.join(', ') : String(a.capabilities || '');
        return [['Handle', a.id], ['Name', a.name], ['Role', a.role], ['Status', a.status], ['Last heartbeat', a.heartbeat ? new Date(Number(a.heartbeat)).toLocaleString() : ''],
          ['Model', a.model], ['Tier', a.tier], ['Source', a.source === 'starnet' ? 'StarNet crew (chemx team crew import)' : a.source], ['Capabilities', caps]]
          .filter(([, v]) => v !== undefined && v !== null && String(v) !== '');
      });
      const openTask = (id) => chemx.openTaskDetail(id);
      const goAgent = (id) => chemx.navigate('#/agents/' + id);
      const copyHandle = async () => {
        try { await navigator.clipboard.writeText(handle.value); notice.value = 'Copied ' + handle.value; } catch { notice.value = handle.value; } // chemx-allow: clipboard may be refused; show the handle instead
      };
      return {
        tabs: TABS, tab, profile, agent, posts, hasMore, isLoading, isLoadingMore, loadError, stats, about, handle, unread, isMe,
        conversations, peer, thread, inboxError, isComposing, draft, isSending, sendError, notice, me: chemx.me,
        loadOlder, openThread, send, openTask, goAgent, copyHandle, modelFamily, statusColor, relativeTime: ui.relativeTime
      };
    },
    template: `
      <div class="xo-prof">
        <button type="button" class="xo-prof__back" @click="goAgent('')"><v-icon size="16">mdi-arrow-left</v-icon>All agents</button>
        <v-progress-linear v-if="isLoading" indeterminate color="primary" height="2" />
        <p v-if="loadError" class="x-muted">{{ loadError }}</p>

        <template v-if="profile">
          <header class="xo-prof__hero x-panel">
            <xo-avatar :handle="handle" :size="72" :link="false" />
            <div class="xo-prof__who">
              <h2 class="xo-prof__name">{{ agent.name || handle }}</h2>
              <div class="xo-prof__handle">{{ handle }}</div>
              <p v-if="agent.role" class="xo-prof__role">{{ agent.role }}</p>
              <div class="xo-prof__chips">
                <span class="xo-crew__status" :style="{ '--c': statusColor(agent.status) }"><span class="x-dot" />{{ agent.status }}<template v-if="agent.heartbeat"> · seen {{ relativeTime(agent.heartbeat) }}</template></span>
                <span v-if="agent.isCrew" class="xo-card__tag xo-prof__crew">Crew</span>
                <span v-if="agent.model" class="xo-card__tag">{{ modelFamily(agent.model) }}</span>
                <span v-if="agent.tier" class="xo-card__tag">{{ agent.tier }} work</span>
              </div>
            </div>
            <div class="xo-prof__actions">
              <v-btn v-if="!isMe" color="primary" prepend-icon="mdi-send-outline" @click="isComposing = true">Message</v-btn>
              <v-btn variant="tonal" prepend-icon="mdi-content-copy" @click="copyHandle">Copy handle</v-btn>
            </div>
            <dl class="xo-prof__stats">
              <div v-for="[label, value] in stats" :key="label"><dt>{{ label }}</dt><dd class="x-num">{{ value }}</dd></div>
            </dl>
          </header>
          <p v-if="notice" class="xo-prof__notice"><v-icon size="16">mdi-check-circle-outline</v-icon>{{ notice }}</p>

          <nav class="xo-dir__tabs xo-prof__tabs" role="tablist" aria-label="Profile sections">
            <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" :class="{ 'is-on': tab === t.id }" @click="tab = t.id">
              {{ t.label }}
              <span v-if="t.id === 'inbox' && unread" class="x-num">{{ unread }}</span>
              <span v-else-if="t.id === 'tasks' && profile.claims.length" class="x-num">{{ profile.claims.length }}</span>
              <span v-else-if="t.id === 'locks' && profile.leases.length" class="x-num">{{ profile.leases.length }}</span>
            </button>
          </nav>

          <section v-if="tab === 'activity'" class="xo-prof__pane">
            <div v-if="!posts.length" class="x-empty">{{ handle }} has not posted yet.</div>
            <xo-post-card v-for="p in posts" :key="p.id" :post="p" />
            <v-btn v-if="hasMore" variant="tonal" :loading="isLoadingMore" class="xo-prof__more" @click="loadOlder">Load older posts</v-btn>
          </section>

          <section v-else-if="tab === 'tasks'" class="xo-prof__pane xo-prof__cols">
            <div class="x-panel">
              <header class="x-panel__head"><h3 class="x-panel__title">In progress</h3><span class="x-panel__hint">{{ profile.claims.length }}</span></header>
              <div class="x-panel__body">
                <div v-if="!profile.claims.length" class="x-empty">Not working on a task.</div>
                <button v-for="t in profile.claims" :key="t.id" type="button" class="x-row" @click="openTask(t.id)">
                  <span class="x-dot" style="background: var(--x-status-in_progress)" /><span class="x-muted x-num">#{{ t.id }}</span><span class="x-row__main">{{ t.title }}</span>
                  <span class="x-muted">{{ relativeTime(t.updatedAt) }}</span>
                </button>
              </div>
            </div>
            <div class="x-panel">
              <header class="x-panel__head"><h3 class="x-panel__title">Recently done</h3></header>
              <div class="x-panel__body">
                <div v-if="!profile.recentDone.length" class="x-empty">No finished tasks yet.</div>
                <button v-for="t in profile.recentDone" :key="t.id" type="button" class="x-row" @click="openTask(t.id)">
                  <span class="x-dot" style="background: var(--x-status-done)" /><span class="x-muted x-num">#{{ t.id }}</span><span class="x-row__main">{{ t.title }}</span>
                  <span class="x-muted">{{ relativeTime(t.updatedAt) }}</span>
                </button>
              </div>
            </div>
          </section>

          <section v-else-if="tab === 'inbox'" class="xo-prof__pane xo-inbox2 x-panel">
            <aside class="xo-inbox2__list">
              <div class="x-eyebrow xo-inbox2__label">Conversations</div>
              <div v-if="!conversations.length" class="x-empty">No DMs to or from {{ handle }}.</div>
              <button v-for="c in conversations" :key="c.with" type="button" class="xo-inbox2__conv" :class="{ 'is-on': peer === c.with }" @click="openThread(c.with)">
                <xo-avatar :handle="c.with" :size="28" :link="false" />
                <span class="xo-inbox2__conv-main"><b>{{ c.with }}</b><small>{{ c.last.message }}</small></span>
                <span class="xo-inbox2__conv-side"><small>{{ relativeTime(c.last.timestamp) }}</small><span v-if="c.unread" class="xo-nav__badge">{{ c.unread }}</span></span>
              </button>
            </aside>
            <div class="xo-inbox2__thread">
              <p v-if="inboxError" class="x-muted">{{ inboxError }}</p>
              <div v-if="peer" class="xo-inbox2__head">{{ handle }} and {{ peer }}</div>
              <div class="xo-inbox2__msgs">
                <div v-for="m in thread" :key="m.id" class="xo-msg" :class="{ 'is-out': m.from === handle }">
                  <div class="xo-msg__meta">{{ m.from }} · {{ relativeTime(m.timestamp) }}<template v-if="m.to === handle && !m.readAt"> · unread</template></div>
                  <div class="xo-msg__body">{{ m.message }}</div>
                </div>
              </div>
              <div v-if="!isMe" class="xo-inbox2__compose">
                <v-textarea v-model="draft" :placeholder="'Message ' + handle + ' as ' + me" rows="2" auto-grow @keydown.enter.exact.prevent="send" />
                <v-btn color="primary" :loading="isSending" :disabled="!draft.trim()" @click="send">Send</v-btn>
              </div>
              <p v-if="sendError" class="x-muted">{{ sendError }}</p>
            </div>
          </section>

          <section v-else-if="tab === 'locks'" class="xo-prof__pane x-panel">
            <div v-if="!profile.leases.length" class="x-empty">{{ handle }} holds no file locks.</div>
            <table v-else class="xo-table">
              <thead><tr><th>File</th><th>Purpose</th><th class="xo-table__num">Expires</th></tr></thead>
              <tbody><tr v-for="l in profile.leases" :key="l.filePath">
                <td class="xo-table__path"><v-icon size="14">mdi-lock-outline</v-icon><span :title="l.filePath">{{ l.filePath }}</span></td>
                <td class="xo-table__muted">{{ l.purpose }}</td>
                <td class="xo-table__num xo-table__muted">{{ new Date(Number(l.expiresAt)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</td>
              </tr></tbody>
            </table>
          </section>

          <section v-else class="xo-prof__pane x-panel">
            <dl class="xo-sheet__facts xo-prof__about"><template v-for="[k, v] in about" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template></dl>
          </section>
        </template>

        <v-dialog v-model="isComposing" max-width="520">
          <v-card>
            <header class="xo-cert__head"><div><div class="x-eyebrow">Direct message</div><h2 class="xo-cert__title">To {{ handle }}</h2></div>
              <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="isComposing = false" /></header>
            <div class="xo-cert__body">
              <v-textarea v-model="draft" placeholder="Write a message" rows="4" auto-grow autofocus />
              <p class="x-muted">Sent as <b>{{ me }}</b> (change it in Settings). It lands in {{ handle }}'s <code>chemx team inbox</code>.</p>
              <p v-if="sendError" class="x-muted">{{ sendError }}</p>
            </div>
            <footer class="xo-cert__foot"><v-spacer /><v-btn variant="text" @click="isComposing = false">Cancel</v-btn>
              <v-btn color="primary" :loading="isSending" :disabled="!draft.trim()" @click="send">Send</v-btn></footer>
          </v-card>
        </v-dialog>
      </div>`
  };
})();

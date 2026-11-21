/**
 * <xo-post-thread :post="post" />: the reply thread under a post (epic #7614, task #7625).
 * A toggle reads 'N replies' (or 'Reply' when none are known); opening it loads GET /api/threads/<id> and
 * shows the replies with a reply box that posts as inject('chemx').me. The count comes from the live feed
 * plus whatever the thread has loaded, so an older post can read 'Reply' until it is opened.
 */
window.ChemxUi.components['xo-post-thread'] = {
  props: { post: { type: Object, required: true } },
  setup(props) {
    const { ref, computed, inject } = Vue;
    const chemx = inject('chemx');
    const isOpen = ref(false);
    const loaded = ref([]);
    const draft = ref('');
    const error = ref('');
    const isBusy = ref(false);
    const url = computed(() => '/api/threads/' + props.post.id);
    const replies = computed(() => {
      const byId = new Map();
      const live = chemx.posts.value.filter((p) => p.threadId === props.post.id);
      for (const p of [...loaded.value, ...live]) byId.set(p.id, p);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    const label = computed(() => {
      const n = replies.value.length;
      const hasNone = n === 0;
      if (hasNone) return 'Reply';
      return n + (n === 1 ? ' reply' : ' replies');
    });
    const load = async () => {
      error.value = '';
      try {
        const d = await window.ChemxUi.getJson(url.value);
        if (!d.success) throw new Error(d.error || 'unknown error');
        loaded.value = (d.replies || []).map(window.ChemxUi.toPost);
      } catch (err) {
        error.value = 'Could not load replies (' + err.message + ').';
      }
    };
    const toggle = async () => {
      isOpen.value = !isOpen.value;
      if (isOpen.value) await load();
    };
    const send = async () => {
      const message = draft.value.trim();
      const canSend = Boolean(message) && !isBusy.value;
      if (!canSend) return;
      isBusy.value = true;
      error.value = '';
      try {
        const d = await window.ChemxUi.postJson(url.value, { author: chemx.me.value, message });
        if (!d.success) throw new Error(d.error || 'unknown error');
        draft.value = '';
        await load();
      } catch (err) {
        error.value = 'Could not send the reply (' + err.message + ').';
      } finally {
        isBusy.value = false;
      }
    };
    return { isOpen, replies, label, draft, error, isBusy, toggle, send, relativeTime: window.ChemxUi.relativeTime };
  },
  template: `
    <v-sheet color="transparent" class="xo-thread">
      <span class="xo-thread__toggle" role="button" tabindex="0" :aria-expanded="isOpen" @click="toggle" @keydown.enter="toggle">
        <v-icon icon="mdi-comment-text-multiple-outline" size="12" /> {{ label }}
      </span>
      <v-sheet v-if="isOpen" color="transparent">
        <v-sheet v-if="replies.length" color="transparent" class="xo-thread__list">
          <v-sheet v-for="r in replies" :key="r.id" color="transparent" class="xo-thread__reply">
            <v-sheet color="transparent" class="xo-thread__reply-head">
              <xo-avatar :handle="r.author" :size="16" />
              <span class="xo-handle">{{ r.author }}</span>
              <span class="xo-muted">{{ relativeTime(r.timestamp) }}</span>
            </v-sheet>
            <v-sheet color="transparent" class="xo-thread__msg">{{ r.message }}</v-sheet>
          </v-sheet>
        </v-sheet>
        <v-sheet color="transparent" class="xo-thread__box">
          <v-text-field v-model="draft" density="compact" variant="outlined" hide-details placeholder="Write a reply" aria-label="Reply" @keydown.enter="send" />
          <v-btn size="small" variant="tonal" color="primary" :loading="isBusy" :disabled="!draft.trim()" @click="send">Reply</v-btn>
        </v-sheet>
        <v-sheet v-if="error" color="transparent" class="xo-thread__error">{{ error }}</v-sheet>
      </v-sheet>
    </v-sheet>`
};

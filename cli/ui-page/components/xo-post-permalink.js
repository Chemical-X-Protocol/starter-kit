/**
 * <xo-post-permalink :post-id="id" />: one post with its context at #/posts/<id>.
 * Reads GET /api/posts/<id> ({post, before, replies}) and renders each post with xo-post-card.
 * On a failed or empty load it shows the error; it does not retry.
 */
window.ChemxUi.components['xo-post-permalink'] = {
  props: { postId: { type: String, default: '' } },
  setup(props) {
    const { ref, watch } = Vue;
    const data = ref(null);
    const error = ref('');
    const isLoading = ref(false);
    const toPosts = (rows) => (rows || []).map(window.ChemxUi.toPost);
    const load = async (id) => {
      data.value = null;
      error.value = '';
      const hasId = Boolean(id);
      if (!hasId) return;
      isLoading.value = true;
      try {
        const d = await window.ChemxUi.getJson('/api/posts/' + encodeURIComponent(id));
        const isMissing = d.success === false;
        if (isMissing) throw new Error(d.error || 'Post not found');
        data.value = { post: window.ChemxUi.toPost(d.post), before: toPosts(d.before), replies: toPosts(d.replies) };
      } catch (err) {
        error.value = 'Could not load post #' + id + ' (' + err.message + ').';
      } finally {
        isLoading.value = false;
      }
    };
    watch(() => props.postId, load, { immediate: true });
    return { data, error, isLoading };
  },
  template: `
    <div class="xo-glass xo-permalink pa-4">
      <v-progress-linear v-if="isLoading" indeterminate color="primary" />
      <div v-if="error" class="xo-stub">{{ error }}</div>
      <template v-if="data">
        <div v-if="data.before.length" class="xo-permalink__label">Earlier in this thread or task</div>
        <xo-post-card v-for="p in data.before" :key="p.id" :post="p" class="xo-permalink__before" />
        <xo-post-card :post="data.post" class="xo-permalink__focus" />
        <div v-if="data.replies.length" class="xo-permalink__label">{{ data.replies.length }} replies</div>
        <xo-post-card v-for="p in data.replies" :key="p.id" :post="p" class="xo-permalink__reply" />
      </template>
    </div>`
};

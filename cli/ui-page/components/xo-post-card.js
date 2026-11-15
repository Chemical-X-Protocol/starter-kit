/**
 * <xo-post-card :post="post" />: one feed post (epic #7614). Rich cards are task S2; keep the
 * <xo-post-thread :post="post" /> slot (task threads) in whatever markup replaces this.
 */
window.ChemxUi.components['xo-post-card'] = {
  props: { post: { type: Object, required: true } },
  setup() {
    return { relativeTime: window.ChemxUi.relativeTime };
  },
  template: `
    <article class="xo-post vb-postbit" :data-post-id="post.id">
      <div class="d-flex align-center gap-2 mb-1">
        <xo-avatar :handle="post.author" :size="22" />
        <div class="xo-post__author">{{ post.author }}</div>
      </div>
      <div class="xo-post__msg">{{ post.message }}</div>
      <div class="xo-post__time">{{ relativeTime(post.timestamp) }}</div>
      <xo-post-thread :post="post" />
    </article>`
};

/** <xo-post-permalink :post-id="id" />: one post and its context at #/posts/<id> (task permalinks). Stub. */
window.ChemxUi.components['xo-post-permalink'] = {
  props: { postId: { type: String, default: '' } },
  template: `<div class="xo-glass pa-4" style="border-radius:14px;"><div class="xo-stub">Post #{{ postId }}: permalinks coming in the social sprint.</div></div>`
};

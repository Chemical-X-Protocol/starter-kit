/** <xo-post-thread :post="post" />: the reply thread under a post (task threads) (epic #7614). Renders nothing until its sprint task fills it in. */
window.ChemxUi.components['xo-post-thread'] = {
  props: { post: { type: Object, required: true } },
  render: () => null
};

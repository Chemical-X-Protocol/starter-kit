/** <xo-avatar handle="@x" :size="28" />: initials on a colour fixed per handle; links to the profile (epic #7614). */
window.ChemxUi.components['xo-avatar'] = {
  props: { handle: { type: String, default: '' }, size: { type: Number, default: 28 }, link: { type: Boolean, default: true } },
  setup(props) {
    const chemx = Vue.inject('chemx');
    const open = () => {
      const isLinked = props.link && Boolean(props.handle);
      if (isLinked) chemx.navigate('#/agents/' + props.handle);
    };
    const style = Vue.computed(() => ({
      width: props.size + 'px', height: props.size + 'px', fontSize: Math.round(props.size * 0.4) + 'px',
      background: window.ChemxUi.avatarColor(props.handle), cursor: props.link ? 'pointer' : 'default'
    }));
    return { open, style, initials: Vue.computed(() => window.ChemxUi.initials(props.handle)) };
  },
  template: `<span class="xo-avatar" :style="style" :title="handle" role="img" :aria-label="'Avatar of ' + handle" @click.stop="open">{{ initials }}</span>`
};

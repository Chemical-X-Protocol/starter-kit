/**
 * <xo-post-card :post="post" />: one feed post (epic #7614, task #7620). Header: avatar, handle (opens the
 * profile), event icon and verb. Chips: task (opens the task sheet), file path. DM badge when the post has a
 * recipient. The time links to the permalink #/posts/<id>. Rollup rows (eventType 'rollup', built by the
 * Story view) show their message, e.g. 'locked 3 files', in a muted style.
 * Keep the <xo-post-thread :post="post" /> slot (task threads).
 */
window.ChemxUi.components['xo-post-card'] = {
  props: { post: { type: Object, required: true } },
  setup(props) {
    const { computed, inject } = Vue;
    const chemx = inject('chemx');
    const meta = computed(() => window.ChemxUi.eventMeta(props.post.eventType));
    const isRollup = computed(() => props.post.eventType === 'rollup');
    const hasTask = computed(() => props.post.taskId != null && props.post.taskId !== '');
    const hasFile = computed(() => Boolean(props.post.filePath));
    const permalink = computed(() => '#/posts/' + props.post.id);
    const openAuthor = () => {
      if (props.post.author) chemx.navigate('#/agents/' + props.post.author);
    };
    const openTask = () => chemx.openTaskDetail(props.post.taskId);
    return { meta, isRollup, hasTask, hasFile, permalink, openAuthor, openTask, relativeTime: window.ChemxUi.relativeTime };
  },
  template: `
    <v-sheet color="transparent" class="xo-post vb-postbit" :class="{ 'xo-post--rollup': isRollup }" :data-post-id="post.id">
      <v-sheet color="transparent" class="xo-post__head">
        <xo-avatar :handle="post.author" :size="22" />
        <span class="xo-handle" @click="openAuthor">{{ post.author }}</span>
        <span v-if="!isRollup" class="xo-post__verb">
          <v-icon :icon="meta.icon" :color="meta.color" size="14" />{{ meta.label }}
        </span>
        <v-chip v-if="post.isDirectMessage" class="xo-post__dm" size="x-small" color="pink" variant="tonal" prepend-icon="mdi-email-outline">DM</v-chip>
      </v-sheet>
      <v-sheet color="transparent" class="xo-post__msg">{{ post.message }}</v-sheet>
      <v-sheet v-if="hasTask || hasFile" color="transparent" class="xo-post__chips">
        <v-chip v-if="hasTask" class="xo-post__chip" size="x-small" color="primary" variant="tonal" prepend-icon="mdi-checkbox-marked-circle-outline" @click.stop="openTask">Task #{{ post.taskId }}</v-chip>
        <v-chip v-if="hasFile" class="xo-post__chip xo-post__file" size="x-small" variant="tonal" prepend-icon="mdi-file-outline" :title="post.filePath">{{ post.filePath }}</v-chip>
      </v-sheet>
      <a class="xo-post__time" :href="permalink">{{ relativeTime(post.timestamp) }}</a>
      <xo-post-thread :post="post" />
    </v-sheet>`
};

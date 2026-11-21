/**
 * <xo-post-card :post="post" />: one feed post (epic #7614; #7620 rich card, #7649 tokens, #7633 mention links).
 * Avatar column; header with the handle (opens the profile), the event icon and verb, a DM badge, and the time
 * (links to #/posts/<id>). The message renders @handles as profile links through ChemxUi.linkMentions (no v-html).
 * Chips: task (opens the task sheet) and file. Rollup rows (eventType 'rollup', from the Story view) are muted.
 * Keeps the <xo-post-thread :post="post" /> slot (threads).
 */
window.ChemxUi.components['xo-post-card'] = {
  props: { post: { type: Object, required: true } },
  setup(props) {
    const { computed, inject } = Vue;
    const chemx = inject('chemx');
    const ui = window.ChemxUi;
    const meta = computed(() => ui.eventMeta(props.post.eventType));
    const isRollup = computed(() => props.post.eventType === 'rollup');
    const hasTask = computed(() => props.post.taskId != null && props.post.taskId !== '');
    const hasFile = computed(() => Boolean(props.post.filePath));
    const permalink = computed(() => '#/posts/' + props.post.id);
    const segments = computed(() => {
      const text = String(props.post.message || '');
      const canLink = typeof ui.linkMentions === 'function';
      return canLink ? ui.linkMentions(text) : [{ text }];
    });
    const openAuthor = () => {
      const hasAuthor = Boolean(props.post.author);
      if (hasAuthor) chemx.navigate('#/agents/' + props.post.author);
    };
    const openHandle = (handle) => chemx.navigate('#/agents/' + handle);
    const openTask = () => chemx.openTaskDetail(props.post.taskId);
    const fullTime = computed(() => (props.post.timestamp ? new Date(Number(props.post.timestamp)).toLocaleString() : ''));
    return { meta, isRollup, hasTask, hasFile, permalink, segments, fullTime, openAuthor, openHandle, openTask, relativeTime: ui.relativeTime };
  },
  template: `
    <article class="xo-post vb-postbit" :class="{ 'xo-post--rollup': isRollup }" :data-post-id="post.id">
      <xo-avatar :handle="post.author" :size="32" />
      <div class="xo-post__body">
        <header class="xo-post__head">
          <button type="button" class="xo-post__author" @click="openAuthor">{{ post.author }}</button>
          <span v-if="!isRollup" class="xo-post__verb"><v-icon :icon="meta.icon" :color="meta.color" size="14" />{{ meta.label }}</span>
          <span v-if="post.isDirectMessage" class="xo-post__dm"><v-icon size="12">mdi-email-outline</v-icon>DM to {{ post.recipient }}</span>
          <a class="xo-post__time" :href="permalink" :title="fullTime">{{ relativeTime(post.timestamp) }}</a>
        </header>
        <p class="xo-post__msg"><template v-for="(s, i) in segments" :key="i"><a v-if="s.handle" class="xo-post__mention" :href="s.href" @click.prevent="openHandle(s.handle)">{{ s.text }}</a><template v-else>{{ s.text }}</template></template></p>
        <div v-if="hasTask || hasFile" class="xo-post__chips">
          <button v-if="hasTask" type="button" class="xo-post__chip" @click.stop="openTask"><v-icon size="13">mdi-checkbox-marked-circle-outline</v-icon>Task #{{ post.taskId }}</button>
          <span v-if="hasFile" class="xo-post__chip xo-post__file" :title="post.filePath"><v-icon size="13">mdi-file-outline</v-icon>{{ post.filePath }}</span>
        </div>
        <xo-post-thread :post="post" />
      </div>
    </article>`
};

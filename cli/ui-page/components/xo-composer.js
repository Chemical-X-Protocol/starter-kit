/**
 * <xo-composer />: post to the feed as inject('chemx').me (epic #7614).
 * Typing @ver shows handles from GET /api/handles?q=; an optional task number links the post to #<id>.
 * Posts with POST /api/feed. The handle is editable and saved to localStorage chemx_handle when storage works.
 * Also defines ChemxUi.linkMentions(text): segments [{ text } | { text, handle, href }] for rendering @mentions as links.
 */
(() => {
  const MENTION_RE = /@[A-Za-z0-9_][\w-]*/g;
  const TAIL_RE = /@([\w-]*)$/;

  /** Splits text into plain and mention segments; a mention's href is #/agents/<handle>. Pure, no HTML is produced. */
  window.ChemxUi.linkMentions = (text) => {
    const source = String(text ?? '');
    const segments = [];
    let last = 0;
    for (const m of source.matchAll(MENTION_RE)) {
      const before = source[m.index - 1];
      const isWord = before !== undefined && /[\w@]/.test(before);
      if (isWord) continue;
      const hasPlainBefore = m.index > last;
      if (hasPlainBefore) segments.push({ text: source.slice(last, m.index) });
      segments.push({ text: m[0], handle: m[0], href: '#/agents/' + m[0] });
      last = m.index + m[0].length;
    }
    const hasPlainTail = last < source.length;
    if (hasPlainTail) segments.push({ text: source.slice(last) });
    return segments;
  };

  window.ChemxUi.components['xo-composer'] = {
    setup() {
      const { ref, inject } = Vue;
      const chemx = inject('chemx');
      const message = ref('');
      const taskId = ref('');
      const suggestions = ref([]);
      const status = ref('');
      const isPosting = ref(false);
      const draftHandle = ref(chemx.me.value);

      const saveHandle = () => {
        const handle = String(draftHandle.value || '').trim();
        if (!handle) return;
        chemx.me.value = handle;
        try {
          localStorage.setItem('chemx_handle', handle);
        } catch {
          status.value = 'Handle changed for this session only; browser storage is unavailable.';
        }
      };

      const suggest = async (event) => {
        const target = event.target;
        const tail = TAIL_RE.exec(target.value.slice(0, target.selectionStart ?? target.value.length));
        if (!tail) {
          suggestions.value = [];
          return;
        }
        try {
          const d = await window.ChemxUi.getJson('/api/handles?q=' + encodeURIComponent(tail[1]));
          suggestions.value = d.handles || [];
        } catch {
          suggestions.value = [];
        }
      };

      const pick = (handle) => {
        message.value = message.value.replace(TAIL_RE, handle + ' ');
        suggestions.value = [];
      };

      const submit = async () => {
        const text = message.value.trim();
        const taskNumber = Number.parseInt(taskId.value, 10);
        const canPost = Boolean(text) && !isPosting.value;
        if (!canPost) return;
        isPosting.value = true;
        status.value = '';
        try {
          const body = { author: chemx.me.value, message: text, eventType: 'broadcast' };
          if (Number.isFinite(taskNumber)) body.taskId = taskNumber;
          const d = await window.ChemxUi.postJson('/api/feed', body);
          const isRefused = d.success === false;
          if (isRefused) throw new Error(d.error || 'The server refused the post');
          message.value = '';
          taskId.value = '';
        } catch (err) {
          status.value = 'Could not post (' + err.message + '). Your text is kept.';
        } finally {
          isPosting.value = false;
        }
      };

      return { chemx, message, taskId, suggestions, status, isPosting, draftHandle, saveHandle, suggest, pick, submit };
    },
    template: `
      <v-sheet color="transparent" class="xo-composer">
        <v-sheet color="transparent" class="xo-composer__as">
          <span>Posting as</span>
          <v-text-field v-model="draftHandle" density="compact" variant="underlined" hide-details class="xo-composer__handle" aria-label="Posting handle" @change="saveHandle" />
        </v-sheet>
        <v-textarea v-model="message" rows="2" auto-grow density="compact" variant="outlined" hide-details placeholder="Post an update. Type @ to mention an agent." @input="suggest" @keydown.ctrl.enter="submit" />
        <v-list v-if="suggestions.length" density="compact" class="xo-composer__suggest">
          <v-list-item v-for="s in suggestions" :key="s.handle" :title="s.handle" :subtitle="s.role || s.status" @click="pick(s.handle)" />
        </v-list>
        <v-sheet color="transparent" class="xo-composer__row">
          <v-text-field v-model="taskId" density="compact" variant="outlined" hide-details placeholder="#task (optional)" class="xo-composer__task" aria-label="Task number" />
          <v-btn size="small" color="primary" variant="tonal" :loading="isPosting" :disabled="!message.trim()" @click="submit">Post</v-btn>
        </v-sheet>
        <div v-if="status" class="xo-stub">{{ status }}</div>
      </v-sheet>`
  };
})();

/**
 * <xo-notification-bell />: app-bar bell for DMs, mentions and replies to the human (epic #7614).
 * Reads /api/notifications?handle=&since=; refreshes when inject('chemx').posts changes. The last-seen id is
 * kept per handle in localStorage (opening the menu marks the newest listed id as seen); the bell works without storage.
 */
window.ChemxUi.components['xo-notification-bell'] = {
  setup() {
    const { ref, computed, watch, inject, onMounted } = Vue;
    const chemx = inject('chemx');
    const data = ref(null);
    const loadError = ref('');
    const isOpen = ref(false);
    const keyFor = (handle) => 'chemx-notify-seen:' + handle;

    const readSeen = (handle) => {
      try { return Number(localStorage.getItem(keyFor(handle))) || 0; } catch (err) { return 0; }
    };
    const writeSeen = (handle, id) => {
      try { localStorage.setItem(keyFor(handle), String(id)); } catch (err) { /* chemx-allow: best-effort storage may be unavailable; the bell still works */ }
    };
    const load = async () => {
      const handle = chemx.me.value;
      if (!handle) return;
      try {
        data.value = await window.ChemxUi.getJson('/api/notifications?handle=' + encodeURIComponent(handle) + '&since=' + readSeen(handle));
        loadError.value = '';
      } catch (err) {
        loadError.value = 'Could not load notifications (' + err.message + ').';
      }
    };
    const items = computed(() => (data.value && data.value.notifications) || []);
    const unread = computed(() => (data.value && data.value.unread) || 0);
    const badge = computed(() => (unread.value > 99 ? '99+' : String(unread.value)));
    const LABELS = { dm: 'DM', reply: 'Reply', mention: 'Mention' };
    const labelOf = (item) => LABELS[item.kind] || item.kind;

    const open = (item) => {
      isOpen.value = false;
      chemx.navigate('#/posts/' + item.id);
    };
    // Mark the newest listed id as seen when the menu opens; the list keeps its unread dots until it is refreshed on close.
    watch(isOpen, (nowOpen) => {
      if (nowOpen) {
        const newest = items.value.length ? items.value[0].id : 0;
        if (newest) writeSeen(chemx.me.value, newest);
      } else {
        load();
      }
    });
    watch(() => chemx.posts.value, load);
    watch(() => chemx.me.value, load);
    onMounted(load);

    return { items, unread, badge, isOpen, loadError, labelOf, open, relativeTime: window.ChemxUi.relativeTime };
  },
  template: `<v-menu v-model="isOpen" :close-on-content-click="false" location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" icon variant="text" size="small" aria-label="Notifications">
        <v-badge :model-value="unread > 0" :content="badge" color="error" floating>
          <v-icon>mdi-bell-outline</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-list class="xo-glass xo-bell-list" density="compact">
      <v-list-item v-if="loadError" :title="loadError" />
      <v-list-item v-else-if="!items.length" title="No notifications for you yet." />
      <v-list-item v-for="n in items" :key="n.id" class="xo-bell-item" @click="open(n)">
        <v-list-item-title>
          <span class="xo-bell-dot" :class="{ 'xo-bell-unread': n.unread }"></span>
          <b>{{ labelOf(n) }}</b> from {{ n.author }} <span class="xo-muted">{{ relativeTime(n.timestamp) }}</span>
        </v-list-item-title>
        <v-list-item-subtitle>{{ n.message }}</v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </v-menu>`
};

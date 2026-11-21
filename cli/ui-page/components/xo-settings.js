/**
 * <xo-settings />: the Settings page (#7656). Reads GET /api/settings and writes one key at a time with
 * POST /api/settings; crew import with POST /api/crew/import; maintenance with POST /api/settings/action.
 * Sections: You, Guards and commits, Dispatch routing, Crew, Web UI, Board, Appearance. Browser-only
 * preferences (your handle, density) live in localStorage behind try/catch.
 */
(() => {
  const SECTIONS = [
    { id: 'you', label: 'You', icon: 'mdi-account-circle-outline' }, { id: 'guards', label: 'Guards and commits', icon: 'mdi-shield-check-outline' },
    { id: 'routing', label: 'Dispatch routing', icon: 'mdi-routes' }, { id: 'crew', label: 'Crew', icon: 'mdi-account-group-outline' },
    { id: 'web', label: 'Web UI', icon: 'mdi-monitor' }, { id: 'board', label: 'Board', icon: 'mdi-database-outline' },
    { id: 'appearance', label: 'Appearance', icon: 'mdi-palette-outline' }
  ];
  const NATIVE = [
    { value: 'block', title: 'Block', subtitle: 'Native Read/Edit/Grep on repo files are denied; agents must use chemx.' },
    { value: 'warn', title: 'Warn (default)', subtitle: 'Native tools run, with a nudge toward the chemx command.' },
    { value: 'allow', title: 'Allow', subtitle: 'No guard on native file tools.' }
  ];
  const store = {
    get: (key) => { try { return localStorage.getItem(key); } catch { return null; } }, // chemx-allow: storage can be blocked; the default applies
    set: (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } } // chemx-allow: storage can be blocked; the change lasts this session
  };
  const sizeLabel = (bytes) => {
    const n = Number(bytes);
    const hasSize = Number.isFinite(n) && n > 0;
    if (!hasSize) return '';
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  };

  window.ChemxUi.components['xo-settings'] = {
    setup() {
      const { ref, computed, onMounted } = Vue;
      const chemx = Vue.inject('chemx');
      const ui = window.ChemxUi;
      const data = ref(null);
      const loadError = ref('');
      const toast = ref('');
      const isToastOpen = ref(false);
      const busy = ref('');
      const handleDraft = ref(chemx.me.value);
      const coAuthorDraft = ref('');
      const crewResult = ref(null);
      const density = ref(store.get('chemx_density') || 'compact');

      const say = (text) => { toast.value = text; isToastOpen.value = true; };
      const load = async () => {
        loadError.value = '';
        try {
          data.value = await ui.getJson('/api/settings');
          coAuthorDraft.value = data.value.config.values['commit.coAuthor'].value || '';
        } catch (err) {
          loadError.value = 'Could not load settings (' + err.message + ').';
        }
      };
      onMounted(load);

      const value = (key) => data.value?.config.values[key]?.value;
      const isDefault = (key) => Boolean(data.value?.config.values[key]?.isDefault);
      const save = async (key, next) => {
        busy.value = key;
        try {
          const d = await ui.postJson('/api/settings', { key, value: next });
          if (!d.success) throw new Error(d.error);
          say('Saved ' + key + ' in ' + d.file);
          await load();
        } catch (err) {
          say('Not saved: ' + err.message);
        } finally {
          busy.value = '';
        }
      };
      const saveHandle = () => {
        const raw = handleDraft.value.trim().replace(/\s+/g, '-');
        const hasHandle = raw.length > 1;
        if (!hasHandle) return say('A handle needs at least one character after @.');
        const next = raw.startsWith('@') ? raw : '@' + raw;
        chemx.me.value = next;
        handleDraft.value = next;
        const isStored = store.set('chemx_handle', next);
        say(isStored ? 'You now post as ' + next : 'You post as ' + next + ' until this tab closes (browser storage is off).');
      };
      const importCrew = async () => {
        busy.value = 'crew';
        try {
          const d = await ui.postJson('/api/crew/import', {});
          if (!d.success) throw new Error(d.error);
          crewResult.value = d;
          say('Imported ' + d.crew.length + ' crew member(s).');
          await load();
        } catch (err) {
          say('Import failed: ' + err.message);
        } finally {
          busy.value = '';
        }
      };
      const runAction = async (action, label) => {
        busy.value = action;
        try {
          await ui.postJson('/api/settings/action', { action });
          say(label + ' done.');
          await load();
        } catch (err) {
          say(label + ' failed: ' + err.message);
        } finally {
          busy.value = '';
        }
      };
      const setDensity = (next) => {
        density.value = next;
        store.set('chemx_density', next);
        ui.applyDensity(next);
      };
      const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); say('Copied'); } catch { say(text); } // chemx-allow: clipboard may be refused; show the text instead
      };
      const goTo = (id) => document.getElementById('xo-set-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const profiles = computed(() => (data.value?.config.profiles || []).map((p) => ({ value: p.id, title: p.name })));
      return {
        sections: SECTIONS, native: NATIVE, data, loadError, toast, isToastOpen, busy, handleDraft, coAuthorDraft, crewResult, density, profiles,
        me: chemx.me, isLive: computed(() => chemx.isLive?.value), value, isDefault, save, saveHandle, importCrew, runAction, setDensity, copy, goTo, sizeLabel
      };
    },
    template: `
      <div class="xo-set">
        <nav class="xo-set__toc" aria-label="Settings sections">
          <button v-for="s in sections" :key="s.id" type="button" class="xo-nav__item" @click="goTo(s.id)"><v-icon size="16">{{ s.icon }}</v-icon>{{ s.label }}</button>
        </nav>
        <div class="xo-set__main">
          <p v-if="loadError" class="x-muted">{{ loadError }}</p>
          <div v-else-if="!data" class="x-empty">Loading settings…</div>
          <template v-else>
            <section id="xo-set-you" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">You</h3><span class="x-panel__hint">Stored in this browser</span></header>
              <div class="x-panel__body xo-set__rows">
                <div class="xo-set__row">
                  <div><b>Your handle</b><p>Notes, posts, replies and DMs you send from this page are signed with it.</p></div>
                  <div class="xo-set__ctl xo-set__inline"><v-text-field v-model="handleDraft" prefix="" @keydown.enter="saveHandle" /><v-btn color="primary" variant="tonal" @click="saveHandle">Save</v-btn></div>
                </div>
              </div>
            </section>

            <section id="xo-set-guards" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">Guards and commits</h3><span class="x-panel__hint">Saved to {{ data.config.writesTo }}</span></header>
              <div class="x-panel__body xo-set__rows">
                <div class="xo-set__row">
                  <div><b>Architecture profile</b><p>The rule set and line budgets audits and gates use.</p></div>
                  <v-select class="xo-set__ctl" :items="profiles" :model-value="value('profile')" :loading="busy === 'profile'" @update:model-value="save('profile', $event)" />
                </div>
                <div class="xo-set__row">
                  <div><b>Native file tools</b><p>What happens when an agent uses its own Read, Edit or Grep on repo files instead of chemx.</p></div>
                  <v-select class="xo-set__ctl" :items="native" item-title="title" item-value="value" :model-value="value('nativeFileTools')" :loading="busy === 'nativeFileTools'"
                    @update:model-value="save('nativeFileTools', $event)">
                    <template #item="{ props: p, item }"><v-list-item v-bind="p" :subtitle="item.raw.subtitle" /></template>
                  </v-select>
                </div>
                <div class="xo-set__row">
                  <div><b>Block guard nudges</b><p>Off: the shell guard only advises (chemx has a replacement for …). On: those commands are denied. <code>CHEMX_GUARD_NUDGES</code> overrides it per process.</p></div>
                  <v-switch class="xo-set__switch" color="primary" inset hide-details :model-value="value('guardNudges') === 'block'" :loading="busy === 'guardNudges'"
                    @update:model-value="save('guardNudges', $event ? 'block' : 'nudge')" />
                </div>
                <div class="xo-set__row">
                  <div><b>Add [skip ci] on the default branch</b><p><code>chemx commit</code> appends [skip ci] to commits on main. <code>--skip-ci</code> and <code>--no-skip-ci</code> still win.</p></div>
                  <v-switch class="xo-set__switch" color="primary" inset hide-details :model-value="Boolean(value('commit.skipCi'))" :loading="busy === 'commit.skipCi'"
                    @update:model-value="save('commit.skipCi', Boolean($event))" />
                </div>
                <div class="xo-set__row">
                  <div><b>Co-author trailer</b><p>Added to every <code>chemx commit</code> as Co-Authored-By. Empty adds none. <code>CHEMX_COAUTHOR</code> overrides it.</p></div>
                  <div class="xo-set__ctl xo-set__inline"><v-text-field v-model="coAuthorDraft" placeholder="Name <email>" /><v-btn variant="tonal" color="primary" :loading="busy === 'commit.coAuthor'" @click="save('commit.coAuthor', coAuthorDraft.trim())">Save</v-btn></div>
                </div>
              </div>
            </section>

            <section id="xo-set-routing" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">Dispatch routing</h3><span class="x-panel__hint">From {{ data.routing.source }}</span></header>
              <div class="x-panel__body">
                <p class="xo-set__note">Which model and effort <code>chemx team dispatch</code> uses for each needs tier. Set <code>modelRouting</code> in <code>.chemx/config.json</code> to change it.</p>
                <table class="xo-table"><thead><tr><th>Tier</th><th>Model</th><th>Effort</th><th>Used for</th></tr></thead><tbody>
                  <tr><td><b>light</b></td><td>{{ data.routing.tiers.light.model }}</td><td>{{ data.routing.tiers.light.effort }}</td><td class="xo-table__muted">Renames, cleanup, commit and repair passes</td></tr>
                  <tr><td><b>standard</b></td><td>{{ data.routing.tiers.standard.model }}</td><td>{{ data.routing.tiers.standard.effort }}</td><td class="xo-table__muted">Well-specified implementation</td></tr>
                  <tr><td><b>deep</b></td><td>{{ data.routing.tiers.deep.model }}</td><td>{{ data.routing.tiers.deep.effort }}</td><td class="xo-table__muted">Design and cross-cutting changes</td></tr>
                </tbody></table>
              </div>
            </section>

            <section id="xo-set-crew" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">Crew</h3><span class="x-panel__hint">{{ data.crew.count }} on the board</span></header>
              <div class="x-panel__body xo-set__rows">
                <div class="xo-set__row">
                  <div><b>StarNet roster</b><p v-if="data.crew.roster"><code>{{ data.crew.roster }}</code></p><p v-else>No roster found. Set <code>STARNET_WORKSPACES</code> or run <code>chemx team crew import &lt;path&gt;</code>.</p>
                    <p>Import adds or updates each member as a stable handle; it never copies system prompts.</p></div>
                  <v-btn color="primary" variant="tonal" prepend-icon="mdi-account-sync-outline" :disabled="!data.crew.roster" :loading="busy === 'crew'" @click="importCrew">{{ data.crew.count ? 'Re-import crew' : 'Import crew' }}</v-btn>
                </div>
                <table v-if="crewResult" class="xo-table"><thead><tr><th>Handle</th><th>Name</th><th>Tier</th><th></th></tr></thead><tbody>
                  <tr v-for="c in crewResult.crew" :key="c.handle"><td><code>{{ c.handle }}</code></td><td>{{ c.name }}</td><td>{{ c.tier }}</td><td class="xo-table__muted">{{ c.isNew ? 'new' : 'updated' }}</td></tr>
                </tbody></table>
              </div>
            </section>

            <section id="xo-set-web" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">Web UI</h3>
                <span class="xo-live" :class="{ 'is-live': isLive }"><span class="xo-live__dot" />{{ isLive ? 'Live updates connected' : 'Live updates disconnected' }}</span></header>
              <div class="x-panel__body xo-set__rows">
                <div class="xo-set__row"><div><b>Access token</b><p>{{ data.server.tokenMode }}. Set <code>CHEMX_UI_TOKEN</code> in your shell profile to keep one bookmarkable URL across restarts.</p></div>
                  <v-btn variant="text" prepend-icon="mdi-content-copy" @click="copy('export CHEMX_UI_TOKEN=')">Copy export line</v-btn></div>
                <div class="xo-set__row"><div><b>Open the browser on start</b><p>{{ data.server.autoOpen === 'on' ? 'On: chemx ui opens this page at its token URL.' : 'Off here: ' + data.server.autoOpen + '.' }} Use <code>--no-open</code> or <code>CHEMX_UI_NO_OPEN=1</code> to skip it.</p></div></div>
              </div>
            </section>

            <section id="xo-set-board" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">Board</h3><span class="x-panel__hint">{{ sizeLabel(data.board.sizeBytes) }}</span></header>
              <div class="x-panel__body xo-set__rows">
                <dl class="xo-sheet__facts">
                  <dt>Database</dt><dd><code>{{ data.board.db || 'in memory' }}</code></dd>
                  <dt>Project root</dt><dd><code>{{ data.board.projectRoot }}</code></dd>
                  <dt>Tasks</dt><dd class="x-num">{{ data.board.tasks.toLocaleString() }}</dd>
                  <dt>Agents</dt><dd class="x-num">{{ data.board.agents.toLocaleString() }}</dd>
                  <dt>Config read from</dt><dd><code>{{ data.config.source || 'none (defaults)' }}</code></dd>
                </dl>
                <div class="xo-set__row">
                  <div><b>Maintenance</b><p>Vacuum compacts the SQLite file. Heartbeat marks this UI as alive on the board.</p></div>
                  <div class="xo-set__inline">
                    <v-btn variant="tonal" prepend-icon="mdi-broom" :loading="busy === 'vacuum'" @click="runAction('vacuum', 'Vacuum')">Vacuum</v-btn>
                    <v-btn variant="tonal" prepend-icon="mdi-heart-pulse" :loading="busy === 'heartbeat'" @click="runAction('heartbeat', 'Heartbeat')">Heartbeat</v-btn>
                  </div>
                </div>
              </div>
            </section>

            <section id="xo-set-appearance" class="x-panel xo-set__sec">
              <header class="x-panel__head"><h3 class="x-panel__title">Appearance</h3><span class="x-panel__hint">Stored in this browser</span></header>
              <div class="x-panel__body xo-set__rows">
                <div class="xo-set__row"><div><b>Density</b><p>Compact fits more on screen; comfortable adds space and larger text.</p></div>
                  <div class="xo-board__seg" role="group" aria-label="Density">
                    <button v-for="d in ['compact', 'comfortable']" :key="d" type="button" :class="{ 'is-on': density === d }" :aria-pressed="density === d" @click="setDensity(d)">{{ d }}</button>
                  </div>
                </div>
              </div>
            </section>
          </template>
        </div>
        <v-snackbar v-model="isToastOpen" :timeout="3500" location="bottom right">{{ toast }}</v-snackbar>
      </div>`
  };
})();

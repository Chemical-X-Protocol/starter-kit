/**
 * Chemical X UI Template: AI Refactoring Prompt Workbench (R7)
 */
export const VIEW_WORKBENCH_TEMPLATE = `
    <main v-else-if="activeTab === 'workbench'" class="t-body--full">
      <div class="t-panel" style="gap:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong>🛠️ AI Refactoring Prompt Workbench</strong>
            <span class="a-badge badge-primary">{{ (workbenchScope || 'master').toUpperCase() }}</span>
            <span class="a-badge badge-lime">~{{ (workbenchTokens || 0).toLocaleString() }} tokens</span>
            <span class="a-badge badge-warning">{{ (workbenchChars || 0).toLocaleString() }} chars</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <label style="display:flex; align-items:center; gap:4px; font-size:11px; cursor:pointer; color:#94a3b8;">
              <input type="checkbox" v-model="workbenchExcludeSlop" @change="generateWorkbenchPrompt(workbenchScope)" /> Exclude AI Slop
            </label>
            <button class="a-btn" @click="generateWorkbenchPrompt(workbenchScope)">
              {{ workbenchLoading ? '⚡ Generating...' : '🔄 Generate Prompt' }}
            </button>
            <button class="a-btn a-btn--sec" @click="copyWorkbenchPrompt" :disabled="!workbenchPrompt">
              {{ workbenchCopied ? '✔ Copied to Clipboard!' : '📋 Copy Prompt' }}
            </button>
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <span style="font-size:11px; color:#94a3b8; margin-right:4px;">Refactor Scope:</span>
          <span
            v-for="s in workbenchScopes"
            :key="s.id"
            class="a-chip"
            :class="{'a-chip--active': workbenchScope === s.id}"
            @click="generateWorkbenchPrompt(s.id)"
          >
            {{ s.label }}
          </span>
        </div>
      </div>
      <div v-if="workbenchError" class="a-chip" style="color:#f87171; border-color:#f87171;">
        {{ workbenchError }}
      </div>
      <div class="t-panel" style="flex:1; display:flex; flex-direction:column; min-height:450px; overflow:hidden;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11px; color:#94a3b8;">Refactoring Specification & LLM Prompt Preview:</span>
          <span v-if="workbenchPrompt" style="font-size:10px; color:#38bdf8;">Ready to paste into Cursor / Claude / Windsurf</span>
        </div>
        <textarea
          class="workbench-textarea"
          readonly
          :value="workbenchPrompt"
          placeholder="Select a scope above and generate an AI refactoring prompt..."
        ></textarea>
      </div>
    </main>
`;

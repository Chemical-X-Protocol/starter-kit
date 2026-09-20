/**
 * Chemical X UI View Template: Codebase File Tree Explorer & Symbol Inspector
 */
export const VIEW_FILETREE_TEMPLATE = `
    <!-- Codebase File Tree Explorer & Symbol Inspector (R6) -->
    <main v-else-if="activeTab === 'codebase'" class="t-body--full">
      <div class="t-panel" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <strong>🧬 Codebase AST Explorer & Inspector</strong>
          <span class="a-badge badge-primary">{{ codebaseFiles.length }} Files</span>
          <span class="a-badge badge-lime">{{ cleanFileCount }} &le;100L</span>
          <span class="a-badge badge-pink">{{ monolithFileCount }} &gt;100L</span>
          <span v-if="codebaseHazardCount > 0" class="badge-hazard">⚠️ {{ codebaseHazardCount }} Hazards</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input v-model="fileFilterQuery" class="a-input" style="width:170px; padding:3px 6px;" placeholder="Filter files or tier..." />
          <button class="a-btn a-btn--sec" @click="expandAllFolders">Expand</button>
          <button class="a-btn a-btn--sec" @click="collapseAllFolders">Collapse</button>
          <button class="a-btn" @click="refreshCodebase">🔄 Rescan</button>
        </div>
      </div>

      <div class="filetree-container" style="display:grid; grid-template-columns: 340px 1fr; gap:10px; flex:1; min-height:0; overflow:hidden;">
        <!-- Left: Directory Tree Panel -->
        <div class="t-panel" style="overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:2px;">
          <div v-if="filteredFileTree.length === 0" style="color:#94a3b8; font-style:italic; padding:12px; text-align:center;">No indexed codebase files matching filter.</div>
          <div v-for="node in filteredFileTree" :key="node.path" :style="{ paddingLeft: (node.depth * 14) + 'px' }">
            <div v-if="node.isFolder" class="filetree-folder" @click="toggleFolder(node.path)">
              <span>{{ isFolderExpanded(node.path) ? '📂' : '📁' }}</span><strong style="color:#93c5fd; font-size:11px; flex:1;">{{ node.name }}</strong><span class="a-badge badge-primary" style="font-size:9px;">{{ node.fileCount }}</span>
            </div>
            <div v-else class="filetree-file" :class="{ 'filetree-file--selected': selectedFilePath === node.path }" @click="selectFile(node.path)">
              <span>📄</span><span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px;" :title="node.path">{{ node.name }}</span>
              <span class="a-badge" :class="node.lines > 100 ? 'badge-pink' : 'badge-lime'">{{ node.lines }}L</span>
              <span class="a-badge badge-primary" style="font-size:9px;">{{ node.tier }}</span>
              <span class="a-badge" :class="node.healthScore < 80 ? 'badge-warning' : 'badge-lime'" style="font-size:9px;">{{ node.healthScore }}%</span>
              <span v-if="node.hazardCount > 0" class="badge-hazard" style="font-size:9px;">⚠️{{ node.hazardCount }}</span>
            </div>
          </div>
        </div>

        <!-- Right: Inspector Panel -->
        <div class="t-panel inspector-panel" style="overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px;">
          <div v-if="selectedFileLoading" style="color:#94a3b8; padding:20px; text-align:center;">Loading AST inspector details...</div>
          <div v-else-if="selectedFileDetail" style="display:flex; flex-direction:column; gap:8px;">
            <div class="m-card" style="padding:8px 10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <strong style="color:#62c9ff; font-size:12px; word-break:break-all;">{{ selectedFileDetail.file.path }}</strong>
                <div style="display:flex; gap:6px; align-items:center;">
                  <span class="a-badge" :class="selectedFileDetail.file.lines > 100 ? 'badge-pink' : 'badge-lime'">{{ selectedFileDetail.file.lines }} Lines</span>
                  <span class="a-badge badge-primary">{{ selectedFileDetail.file.tier }}</span>
                  <span class="a-badge badge-lime">Health: {{ selectedFileDetail.file.healthScore }}%</span>
                  <span v-if="selectedFileDetail.file.hazardCount > 0" class="badge-hazard">⚠️ {{ selectedFileDetail.file.hazardCount }} Hazards</span>
                </div>
              </div>
            </div>

            <div style="display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid #1e385b; padding-bottom:6px;">
              <button class="a-btn" :class="{ 'a-btn--sec': inspectorTab !== 'outline' }" @click="inspectorTab = 'outline'">Outline ({{ selectedFileDetail.symbols.length }})</button>
              <button class="a-btn" :class="{ 'a-btn--sec': inspectorTab !== 'exports' }" @click="inspectorTab = 'exports'">Exports ({{ selectedFileDetail.exports.length }})</button>
              <button class="a-btn" :class="{ 'a-btn--sec': inspectorTab !== 'imports' }" @click="inspectorTab = 'imports'">Imports ({{ selectedFileDetail.imports.length }})</button>
              <button class="a-btn" :class="{ 'a-btn--sec': inspectorTab !== 'connections' }" @click="inspectorTab = 'connections'">Callers ({{ selectedFileDetail.connections.length }})</button>
              <button v-if="selectedFileDetail.violations.length > 0" class="a-btn" :class="{ 'a-btn--sec': inspectorTab !== 'violations' }" @click="inspectorTab = 'violations'">Hazards ({{ selectedFileDetail.violations.length }})</button>
            </div>

            <div v-if="inspectorTab === 'outline'" style="display:flex; flex-direction:column; gap:4px;">
              <div v-if="selectedFileDetail.symbols.length === 0" style="color:#94a3b8; font-style:italic;">No extracted symbols in AST index.</div>
              <div v-for="(sym, idx) in selectedFileDetail.symbols" :key="idx" class="m-card" style="padding:4px 8px; flex-direction:row; justify-content:space-between; align-items:center;"><div style="display:flex; gap:6px; align-items:center;"><span class="a-badge badge-primary" style="font-size:9px;">{{ sym.kind }}</span><strong style="color:#f8fafc; font-family:monospace; font-size:11px;">{{ sym.name }}</strong><span v-if="sym.isExport" class="a-badge badge-lime" style="font-size:8px;">export</span></div><span style="color:#94a3b8; font-family:monospace; font-size:10px;">L{{ sym.startLine }}-L{{ sym.endLine }}</span></div>
            </div>
            <div v-else-if="inspectorTab === 'exports'" style="display:flex; flex-direction:column; gap:4px;">
              <div v-if="selectedFileDetail.exports.length === 0" style="color:#94a3b8; font-style:italic;">No exported symbols.</div>
              <div v-for="(exp, idx) in selectedFileDetail.exports" :key="idx" class="m-card" style="padding:4px 8px; flex-direction:row; justify-content:space-between; align-items:center;"><div style="display:flex; gap:6px; align-items:center;"><span class="a-badge badge-lime" style="font-size:9px;">{{ exp.kind }}</span><strong style="color:#34d399; font-family:monospace; font-size:11px;">{{ exp.name }}</strong></div><span style="color:#94a3b8; font-family:monospace; font-size:10px;">Line {{ exp.startLine }}</span></div>
            </div>
            <div v-else-if="inspectorTab === 'imports'" style="display:flex; flex-direction:column; gap:4px;">
              <div v-if="selectedFileDetail.imports.length === 0" style="color:#94a3b8; font-style:italic;">No imported modules.</div>
              <div v-for="(imp, idx) in selectedFileDetail.imports" :key="idx" class="m-card" style="padding:4px 8px;"><div style="display:flex; justify-content:space-between; align-items:center;"><strong style="color:#e2e8f0; font-family:monospace; font-size:11px;">{{ imp.symbol }}</strong><span style="color:#94a3b8; font-size:10px;">Line {{ imp.line }}</span></div><div style="color:#38bdf8; font-family:monospace; font-size:10px;">from '{{ imp.source }}'</div></div>
            </div>
            <div v-else-if="inspectorTab === 'connections'" style="display:flex; flex-direction:column; gap:4px;">
              <div v-if="selectedFileDetail.connections.length === 0" style="color:#94a3b8; font-style:italic;">No dependent callers found.</div>
              <div v-for="(conn, idx) in selectedFileDetail.connections" :key="idx" class="m-card" style="padding:4px 8px;"><div style="display:flex; justify-content:space-between; align-items:center;"><strong style="color:#62c9ff; font-family:monospace; font-size:11px;">{{ conn.importerPath }}</strong><span class="a-badge badge-primary" style="font-size:9px;">{{ conn.tier }}</span></div><div style="color:#cbd5e1; font-size:10px;">imports <code style="color:#34d399;">{{ conn.importedSymbol }}</code> at line {{ conn.line }}</div></div>
            </div>
            <div v-else-if="inspectorTab === 'violations'" style="display:flex; flex-direction:column; gap:4px;">
              <div v-for="(viol, idx) in selectedFileDetail.violations" :key="idx" class="m-card" style="padding:4px 8px; border-left:3px solid #f43f5e;"><div style="display:flex; justify-content:space-between; align-items:center;"><strong style="color:#fb7185; font-size:11px;">{{ viol.rule }}</strong><span class="a-badge badge-pink" style="font-size:9px;">{{ viol.severity }} (L{{ viol.line }})</span></div><div style="color:#cbd5e1; font-size:10px; margin-top:2px;">{{ viol.hazard }}</div></div>
            </div>
          </div>
          <div v-else style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#94a3b8; padding:30px; text-align:center;">
            <span style="font-size:28px; margin-bottom:8px;">🔍</span><strong>Select a file from the tree to inspect</strong>
            <p style="font-size:11px; margin-top:4px;">View symbol outlines, imports, exports, and caller connections without loading raw full-file dumps.</p>
          </div>
        </div>
      </div>
    </main>
`;

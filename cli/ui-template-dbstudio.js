/**
 * Chemical X UI Template: phpMyAdmin-Style Database Studio (R8)
 */
export const VIEW_DBSTUDIO_TEMPLATE = `
    <main v-else-if="activeTab === 'database'" class="t-body--full" style="padding:4px; overflow:hidden;">
      <div class="pma-container">
        <aside class="pma-sidebar">
          <div class="pma-sidebar-header"><strong>📁 chemx ({{ pmaTables.length }})</strong></div>
          <div v-for="t in pmaTables" :key="t.name" class="pma-table-item" :class="{'pma-table-item--active': pmaSelectedTable === t.name}" @click="selectPmaTable(t.name)">
            <span class="pma-table-name">📄 {{ t.name }}</span>
            <span class="a-badge badge-primary">{{ t.rowCount }}</span>
          </div>
        </aside>
        <section class="pma-main">
          <div class="pma-nav">
            <span v-for="tab in pmaTabs" :key="tab.id" class="pma-tab" :class="{'pma-tab--active': pmaActiveNavTab === tab.id}" @click="setPmaNavTab(tab.id)">
              {{ tab.icon }} {{ tab.label }}
            </span>
          </div>

          <div v-if="pmaActiveNavTab === 'browse'" style="display:flex; flex-direction:column; gap:6px; flex:1; overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center; background:#162438; padding:4px 8px; border:1px inset #0c1524;">
              <span style="font-size:11px;">Table: <strong>{{ pmaSelectedTable }}</strong> ({{ pmaTotalRows }} rows, page {{ pmaPage }}/{{ pmaTotalPages }})</span>
              <div style="display:flex; gap:6px;">
                <button class="a-btn a-btn--sec" :disabled="pmaPage <= 1" @click="fetchPmaBrowse(pmaSelectedTable, pmaPage - 1)">« Prev</button>
                <button class="a-btn a-btn--sec" :disabled="pmaPage >= pmaTotalPages" @click="fetchPmaBrowse(pmaSelectedTable, pmaPage + 1)">Next »</button>
              </div>
            </div>
            <div style="flex:1; overflow:auto; border:1px inset #0c1524;">
              <table class="pma-table">
                <thead><tr><th style="width:60px; text-align:center;">Action</th><th v-for="c in pmaColumns" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, idx) in pmaRows" :key="idx" :class="idx % 2 === 0 ? 'pma-row-even' : 'pma-row-odd'">
                    <td style="text-align:center;"><span title="Inspect Row" style="cursor:pointer;" @click="inspectPmaRow(r)">🔍</span></td>
                    <td v-for="c in pmaColumns" :key="c" :title="String(r[c] ?? '')">{{ formatPmaCell(r[c]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="pmaActiveNavTab === 'structure'" style="flex:1; overflow:auto;">
            <table class="pma-table">
              <thead><tr><th>#</th><th>Column</th><th>Type</th><th>Not Null</th><th>Default</th><th>Primary Key</th></tr></thead>
              <tbody>
                <tr v-for="col in (pmaStructure.columns || [])" :key="col.cid" class="pma-row-even">
                  <td>{{ col.cid }}</td><td><strong>{{ col.name }}</strong></td><td>{{ col.type }}</td><td>{{ col.notnull ? 'YES' : 'NO' }}</td><td>{{ col.dflt_value ?? 'NULL' }}</td><td>{{ col.pk ? 'PRIMARY' : '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else-if="pmaActiveNavTab === 'sql'" style="display:flex; flex-direction:column; gap:8px; flex:1; overflow:hidden;">
            <textarea v-model="pmaSqlQuery" class="pma-sql-console" placeholder="SELECT * FROM ..."></textarea>
            <div style="display:flex; gap:8px; align-items:center;">
              <button class="a-btn" @click="runPmaQuery()">▶ Go</button>
              <button class="a-btn a-btn--sec" @click="pmaSqlQuery = 'SELECT * FROM ' + pmaSelectedTable + ' LIMIT 25'">Reset SELECT</button>
            </div>
            <div v-if="pmaSqlError" class="a-chip" style="color:#f87171; border-color:#f87171;">{{ pmaSqlError }}</div>
            <div v-if="pmaSqlResults" style="flex:1; overflow:auto; border:1px inset #0c1524;">
              <div style="padding:4px 8px; background:#162438; display:flex; justify-content:space-between; font-size:11px;">
                <span>Returned {{ pmaSqlResults.rowCount }} rows</span><span>{{ pmaSqlResults.durationMs }}ms</span>
              </div>
              <table class="pma-table">
                <thead><tr><th v-for="c in pmaSqlResults.columns" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, idx) in pmaSqlResults.rows" :key="idx" :class="idx % 2 === 0 ? 'pma-row-even' : 'pma-row-odd'">
                    <td v-for="c in pmaSqlResults.columns" :key="c">{{ formatPmaCell(r[c]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else class="t-panel" style="padding:16px;">
            <strong>{{ pmaActiveNavTab.toUpperCase() }}</strong>
            <p style="font-size:11px; color:#94a3b8; margin-top:6px;">Operation interface for table <code>{{ pmaSelectedTable }}</code>.</p>
          </div>
        </section>
      </div>
    </main>
`;

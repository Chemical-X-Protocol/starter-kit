/**
 * Chemical X UI Client: Prompt Workbench & phpMyAdmin Studio State (R7/R8)
 */
export const UI_CLIENT_STUDIO_SCRIPT = `
window.createStudioState = (Vue, api) => {
  const { ref } = Vue;
  const workbenchScope = ref('master'), workbenchPrompt = ref(''), workbenchTokens = ref(0), workbenchChars = ref(0);
  const workbenchLoading = ref(false), workbenchExcludeSlop = ref(false), workbenchCopied = ref(false), workbenchError = ref('');
  const workbenchScopes = [
    { id: 'master', label: 'Master' }, { id: 'grade-f', label: 'Grade F' }, { id: 'grade-d', label: 'Grade D' },
    { id: 'grade-c', label: 'Grade C' }, { id: 'grade-b', label: 'Grade B' }, { id: 'ai-slop', label: 'AI Slop' }, { id: 'hotspots', label: 'Hotspots' }
  ];

  const generateWorkbenchPrompt = async (scope) => {
    if (scope) workbenchScope.value = scope;
    workbenchLoading.value = true; workbenchError.value = '';
    const res = await api.generatePrompt(workbenchScope.value, workbenchExcludeSlop.value);
    workbenchLoading.value = false;
    if (res?.success) {
      workbenchPrompt.value = res.prompt || '';
      workbenchTokens.value = res.estimatedTokens || 0;
      workbenchChars.value = res.charCount || 0;
    } else { workbenchError.value = res?.error || 'Failed to generate prompt'; }
  };

  const copyWorkbenchPrompt = async () => {
    if (!workbenchPrompt.value) return;
    try { await navigator.clipboard.writeText(workbenchPrompt.value); }
    catch (_err) { const ta = document.querySelector('.workbench-textarea'); if (ta) { ta.select(); document.execCommand('copy'); } }
    workbenchCopied.value = true;
    setTimeout(() => { workbenchCopied.value = false; }, 2000);
  };

  const pmaTables = ref([]), pmaSelectedTable = ref('agent_tasks'), pmaActiveNavTab = ref('browse');
  const pmaTabs = [
    { id: 'browse', label: 'Browse', icon: '🔍' }, { id: 'structure', label: 'Structure', icon: '📐' },
    { id: 'sql', label: 'SQL', icon: '⚡' }, { id: 'search', label: 'Search', icon: '🔎' },
    { id: 'insert', label: 'Insert', icon: '➕' }, { id: 'operations', label: 'Operations', icon: '⚙️' }
  ];
  const pmaRows = ref([]), pmaColumns = ref([]), pmaTotalRows = ref(0), pmaPage = ref(1), pmaPageSize = ref(25), pmaTotalPages = ref(1);
  const pmaStructure = ref({ columns: [], indexes: [] }), pmaSqlQuery = ref('SELECT * FROM agent_tasks LIMIT 25');
  const pmaSqlResults = ref(null), pmaSqlError = ref('');

  const fetchPmaTables = async () => {
    const res = await api.fetchDbTables();
    if (res?.success && res.tables) {
      pmaTables.value = res.tables;
      if (!pmaSelectedTable.value && res.tables.length > 0) pmaSelectedTable.value = res.tables[0].name;
    }
  };

  const fetchPmaBrowse = async (table, page = 1) => {
    pmaSelectedTable.value = table; pmaPage.value = page;
    const res = await api.fetchDbBrowse(table, page, pmaPageSize.value);
    if (res?.success) {
      pmaRows.value = res.rows || []; pmaColumns.value = res.columns || [];
      pmaTotalRows.value = res.totalRows || 0; pmaTotalPages.value = res.totalPages || 1;
    }
  };

  const fetchPmaStructure = async (table) => {
    const res = await api.fetchDbStructure(table);
    if (res?.success) pmaStructure.value = res;
  };
  const selectPmaTable = async (table) => {
    pmaSelectedTable.value = table; pmaSqlQuery.value = 'SELECT * FROM ' + table + ' LIMIT 25';
    if (pmaActiveNavTab.value === 'structure') await fetchPmaStructure(table);
    else await fetchPmaBrowse(table, 1);
  };
  const setPmaNavTab = async (tabId) => {
    pmaActiveNavTab.value = tabId;
    if (tabId === 'browse') await fetchPmaBrowse(pmaSelectedTable.value, pmaPage.value);
    else if (tabId === 'structure') await fetchPmaStructure(pmaSelectedTable.value);
  };
  const runPmaQuery = async (query) => {
    const q = query || pmaSqlQuery.value;
    pmaSqlError.value = '';
    const res = await api.runDbQuery(q);
    if (res?.success) { pmaSqlResults.value = res; } else { pmaSqlError.value = res?.error || 'Query failed'; }
  };
  const inspectPmaRow = (r) => { alert(JSON.stringify(r, null, 2)); };
  const formatPmaCell = (v) => (v === null || v === undefined ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  const initStudio = async () => {
    await fetchPmaTables();
    if (pmaTables.value.length > 0) await fetchPmaBrowse(pmaSelectedTable.value, 1);
    await generateWorkbenchPrompt('master');
  };

  return {
    workbenchScope, workbenchPrompt, workbenchTokens, workbenchChars, workbenchLoading, workbenchExcludeSlop, workbenchCopied, workbenchError, workbenchScopes, generateWorkbenchPrompt, copyWorkbenchPrompt,
    pmaTables, pmaSelectedTable, pmaActiveNavTab, pmaTabs, pmaRows, pmaColumns, pmaTotalRows, pmaPage, pmaPageSize, pmaTotalPages, pmaStructure, pmaSqlQuery, pmaSqlResults, pmaSqlError,
    fetchPmaTables, fetchPmaBrowse, fetchPmaStructure, selectPmaTable, setPmaNavTab, runPmaQuery, inspectPmaRow, formatPmaCell, initStudio
  };
};
`;

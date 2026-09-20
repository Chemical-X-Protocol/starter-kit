/**
 * Chemical X UI File Tree & Inspector Reactive State
 */
export const UI_CLIENT_FILETREE_SCRIPT = `
window.createFileTreeState = (Vue, api, codebaseFiles) => {
  const { ref, computed } = Vue;
  const selectedFilePath = ref(''), selectedFileDetail = ref(null), selectedFileLoading = ref(false);
  const inspectorTab = ref('outline'), collapsedFolders = ref(new Set()), fileFilterQuery = ref('');

  const flattenedNodes = computed(() => {
    const files = codebaseFiles.value || [], folderMap = new Map(), nodes = [];
    for (const f of files) {
      const parts = (f.path || '').split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? cur + '/' + parts[i] : parts[i];
        if (!folderMap.has(cur)) folderMap.set(cur, { name: parts[i], path: cur, isFolder: true, depth: i, fileCount: 0 });
        folderMap.get(cur).fileCount++;
      }
    }
    const allPaths = Array.from(new Set([...folderMap.keys(), ...files.map((f) => f.path)])).sort();
    for (const p of allPaths) {
      if (folderMap.has(p)) {
        nodes.push(folderMap.get(p));
      } else {
        const fileObj = files.find((x) => x.path === p);
        if (fileObj) {
          const parts = p.split('/');
          nodes.push({
            name: parts[parts.length - 1], path: p, isFolder: false, depth: parts.length - 1,
            lines: Number(fileObj.lines || 0), tier: fileObj.tier || 'utility',
            healthScore: Number(fileObj.healthScore ?? 100), hazardCount: Number(fileObj.hazardCount ?? 0)
          });
        }
      }
    }
    return nodes;
  });

  const filteredFileTree = computed(() => {
    const q = fileFilterQuery.value.trim().toLowerCase();
    const collapsed = collapsedFolders.value;
    return flattenedNodes.value.filter((node) => {
      const parts = node.path.split('/');
      let prefix = '';
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? prefix + '/' + parts[i] : parts[i];
        if (collapsed.has(prefix)) return false;
      }
      if (!q) return true;
      if (node.isFolder) return true;
      return node.name.toLowerCase().includes(q) || (node.tier && node.tier.toLowerCase().includes(q));
    });
  });

  const cleanFileCount = computed(() => (codebaseFiles.value || []).filter((f) => Number(f.lines || 0) <= 100).length);
  const monolithFileCount = computed(() => (codebaseFiles.value || []).filter((f) => Number(f.lines || 0) > 100).length);
  const codebaseHazardCount = computed(() => (codebaseFiles.value || []).reduce((acc, f) => acc + Number(f.hazardCount || 0), 0));

  const isFolderExpanded = (path) => !collapsedFolders.value.has(path);
  const toggleFolder = (path) => {
    const next = new Set(collapsedFolders.value);
    if (next.has(path)) next.delete(path); else next.add(path);
    collapsedFolders.value = next;
  };
  const expandAllFolders = () => { collapsedFolders.value = new Set(); };
  const collapseAllFolders = () => {
    const all = new Set();
    for (const n of flattenedNodes.value) { if (n.isFolder) all.add(n.path); }
    collapsedFolders.value = all;
  };

  const selectFile = async (path) => {
    selectedFilePath.value = path;
    selectedFileLoading.value = true;
    const res = await api.fetchFileDetails(path);
    selectedFileLoading.value = false;
    if (res?.success) selectedFileDetail.value = res;
  };

  const refreshCodebase = async () => {
    const res = await api.fetchFileTree();
    if (res?.files) codebaseFiles.value = res.files;
    else codebaseFiles.value = await api.fetchCodebase();
  };

  return {
    selectedFilePath, selectedFileDetail, selectedFileLoading, inspectorTab, fileFilterQuery,
    filteredFileTree, cleanFileCount, monolithFileCount, codebaseHazardCount,
    isFolderExpanded, toggleFolder, expandAllFolders, collapseAllFolders, selectFile, refreshCodebase
  };
};
`;

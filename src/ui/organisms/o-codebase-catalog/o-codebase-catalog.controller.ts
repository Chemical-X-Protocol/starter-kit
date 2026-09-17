import { ref, computed } from 'vue';
import type { CodebaseCatalogProps, CodebaseCatalogEmits } from './types';
import type { CodebaseFileRecord } from '../../molecules/m-file-card/types';

export function useCodebaseCatalogController(props: CodebaseCatalogProps, emit: CodebaseCatalogEmits) {
  const selectedTier = ref('all');
  const tiers = ['all', 'atom', 'molecule', 'organism', 'view', 'cli', 'utility'];

  const matchesTier = (file: CodebaseFileRecord, tier: string) => {
    if (tier === 'all') return true;
    return (file.tier || '').toLowerCase() === tier.toLowerCase();
  };

  const filteredFiles = computed(() => (
    props.files.filter((f) => matchesTier(f, selectedTier.value))
  ));

  const totalFiles = computed(() => props.files.length);
  const compliantCount = computed(() => props.files.filter((f) => f.lines <= 100).length);
  const compliancePct = computed(() => (
    totalFiles.value > 0 ? Math.round((compliantCount.value / totalFiles.value) * 100) : 100
  ));

  const stats = computed(() => ({
    totalFiles: totalFiles.value,
    compliantCount: compliantCount.value,
    compliancePct: compliancePct.value
  }));

  const handleSelectTier = (tier: string) => { selectedTier.value = tier; };
  const handleSelectFile = (path: string) => { emit('select-file', path); };

  return {
    selectedTier,
    tiers,
    filteredFiles,
    stats,
    actions: {
      selectTier: handleSelectTier,
      selectFile: handleSelectFile
    }
  };
}

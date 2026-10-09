// Status of one planned file write: refused (a foreign entry was kept), create, unchanged or update.

export const resolveFileStatus = ({ isMissing, isUnchanged, isRefusedOnly = false }) => {
  if (isRefusedOnly) return 'refused';
  if (isMissing) return 'create';
  return isUnchanged ? 'unchanged' : 'update';
};

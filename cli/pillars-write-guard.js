import fs from 'node:fs';

export const GENERATED_MARKERS = {
  md: '<!-- chemx:generated pillars -->',
  rules: '# chemx:generated pillars'
};

const LEGACY_GENERATED_HEADERS = [
  'generated from your selected Chemical X pillars',
  'Generated from selected project pillars'
];

const GENERATED_SIGNATURES = [...Object.values(GENERATED_MARKERS), ...LEGACY_GENERATED_HEADERS];

export const isGeneratedContent = (content) => GENERATED_SIGNATURES.some((signature) => content.includes(signature));

const resolveExistingAction = (current, nextContent, isGuarded, isForce) => {
  const isIdentical = current === nextContent;
  if (isIdentical) return 'unchanged';
  const isProtected = isGuarded && !isGeneratedContent(current);
  const isRefused = isProtected && !isForce;
  return isRefused ? 'refused' : 'overwrite';
};

export const planFileWrite = (filePath, nextContent, { isForce = false, isGuarded = true } = {}) => {
  const isNewFile = !fs.existsSync(filePath);
  if (isNewFile) return { file: filePath, action: 'create', backupPath: null };

  const current = fs.readFileSync(filePath, 'utf-8');
  const action = resolveExistingAction(current, nextContent, isGuarded, isForce);
  const needsBackup = isGuarded && action === 'overwrite';
  return { file: filePath, action, backupPath: needsBackup ? `${filePath}.chemx-backup` : null };
};

export const applyFileWrites = (plans) => {
  const written = [];
  for (const plan of plans) {
    const isWritable = plan.action === 'create' || plan.action === 'overwrite';
    if (!isWritable) continue;
    if (plan.backupPath) fs.copyFileSync(plan.file, plan.backupPath);
    fs.writeFileSync(plan.file, plan.content, 'utf-8');
    written.push(plan.file);
  }
  return written;
};

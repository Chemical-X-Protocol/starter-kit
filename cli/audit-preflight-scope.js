import fs from 'node:fs';
import path from 'node:path';
import { hasGum, gumChoose, gumInput, promptQuestion } from './terminal.js';
import { resolveGitAuditScope } from './audit-preflight-git.js';

const CANDIDATE_NAMES = ['src', 'app', 'cli', 'components', 'lib', 'packages', 'modules'];

export const detectCandidateDirectories = (cwd = process.cwd()) => {
  return CANDIDATE_NAMES.filter((name) => {
    const fullPath = path.resolve(cwd, name);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  });
};

const promptSpecificDirectory = async (cwd) => {
  const candidates = detectCandidateDirectories(cwd);
  const options = [...candidates.map((dir) => `📂 ${dir}`), '✏️  Custom directory path...'];

  let choice = '';
  if (hasGum()) {
    choice = gumChoose(options, 'Select Target Directory:');
  } else {
    process.stdout.write('\n' + options.map((opt, i) => ` ${i + 1}. ${opt}`).join('\n') + '\n\n');
    const ans = await promptQuestion(`Select directory [1-${options.length}]: `);
    const index = parseInt(ans, 10) - 1;
    choice = options[index] || '';
  }

  const isCustomPath = !choice || choice.includes('Custom');
  if (isCustomPath) {
    if (hasGum()) {
      return gumInput('Target directory path:', 'src') || 'src';
    }
    const entered = await promptQuestion('Target directory path [src]: ');
    return entered || 'src';
  }

  const matched = candidates.find((dir) => choice.includes(dir));
  return matched || 'src';
};

export const promptAuditScope = async (defaultDir, rawArgs, cwd = process.cwd()) => {
  const hasGitFlag = rawArgs.includes('--git') || rawArgs.includes('--changed');
  if (hasGitFlag) {
    const gitScope = resolveGitAuditScope(cwd);
    return { targetDir: defaultDir, fileList: gitScope.ok ? gitScope.files : null };
  }

  const scopeOptions = [
    '📁 Whole Project (Scan entire workspace)',
    '📂 Specific Directory (Select target folder)',
    '🌿 Git Changed Files (Scan modified or staged files only)'
  ];

  let scopeChoice = '';
  if (hasGum()) {
    scopeChoice = gumChoose(scopeOptions, 'Select Audit Scope:');
  } else {
    process.stdout.write('\n' + scopeOptions.map((opt, i) => ` ${i + 1}. ${opt}`).join('\n') + '\n\n');
    const ans = await promptQuestion(`Select audit scope [1-${scopeOptions.length}]: `);
    const index = parseInt(ans, 10) - 1;
    scopeChoice = scopeOptions[index] || '';
  }

  const isCancelled = !scopeChoice;
  if (isCancelled) return null;

  const isGit = scopeChoice.includes('Git');
  if (isGit) {
    const gitScope = resolveGitAuditScope(cwd);
    const hasFiles = gitScope.ok;
    if (!hasFiles) {
      process.stdout.write('\n\x1b[33m⚠ No git modified or staged source files found. Auditing whole project.\x1b[0m\n');
      return { targetDir: defaultDir, fileList: null };
    }
    process.stdout.write(`\n\x1b[32m✔ Focused on ${gitScope.files.length} git modified/staged file(s).\x1b[0m\n`);
    return { targetDir: defaultDir, fileList: gitScope.files };
  }

  const isSpecific = scopeChoice.includes('Specific');
  if (isSpecific) {
    const chosenDir = await promptSpecificDirectory(cwd);
    return { targetDir: chosenDir, fileList: null };
  }

  return { targetDir: defaultDir, fileList: null };
};

import fs from 'node:fs';
import path from 'node:path';
import { ensureChemxDir } from './history.js';

const DISCUSSION_FILE = 'discussion.json';

export const getStoredDiscussion = (cwd = process.cwd()) => {
  try {
    const filePath = path.resolve(cwd, '.chemx', DISCUSSION_FILE);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export const saveStoredDiscussion = (data, cwd = process.cwd()) => {
  try {
    const dir = ensureChemxDir(cwd);
    const filePath = path.resolve(dir, DISCUSSION_FILE);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
};

export const clearStoredDiscussion = (cwd = process.cwd()) => {
  try {
    const filePath = path.resolve(cwd, '.chemx', DISCUSSION_FILE);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
};

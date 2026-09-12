import { spawnSync } from 'node:child_process';
import {
  DISCUSSION_CATEGORY,
  DISCUSSION_CATEGORY_SLUG
} from './social-constants.js';
import { matchesDiscussionTitle } from './rules-predicates.js';

export const publishDiscussionViaGh = (repo, title, body, category = DISCUSSION_CATEGORY) => {
  try {
    let res = spawnSync(
      'gh',
      ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', category],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (res.status === 0) {
      return { success: true, url: (res.stdout || '').trim(), error: null };
    }

    const errText = (res.stderr || '').trim();

    if (errText.includes('category') && category !== DISCUSSION_CATEGORY_SLUG) {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', DISCUSSION_CATEGORY_SLUG],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    if (errText.includes('category') && category !== 'Audits') {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', 'Audits'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    if (errText.includes('category')) {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', 'General'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    return { success: false, url: null, error: errText };
  } catch (err) {
    return { success: false, url: null, error: err.message };
  }
};

export const viewDiscussionViaGh = (repo, discussionNumber) => {
  try {
    const res = spawnSync(
      'gh',
      ['discussion', 'view', String(discussionNumber), '-R', repo, '--json', 'id,number,title,body,url'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (res.status === 0 && res.stdout) {
      return JSON.parse(res.stdout);
    }
    return null;
  } catch {
    return null;
  }
};

export const postDiscussionCommentViaGh = (repo, discussionNumber, commentBody) => {
  try {
    const res = spawnSync(
      'gh',
      ['discussion', 'comment', String(discussionNumber), '-R', repo, '--body', commentBody],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return res.status === 0;
  } catch {
    return false;
  }
};

export const editDiscussionViaGh = (repo, discussionNumber, title, body) => {
  try {
    const res = spawnSync(
      'gh',
      ['discussion', 'edit', String(discussionNumber), '-R', repo, '--title', title, '--body', body],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return res.status === 0;
  } catch {
    return false;
  }
};

export const findExistingDiscussionViaGh = (repo, projectName) => {
  try {
    const res = spawnSync(
      'gh',
      ['discussion', 'list', '-R', repo, '--limit', '25', '--json', 'id,number,title,body,url'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (res.status === 0 && res.stdout) {
      const list = JSON.parse(res.stdout);
      const targetLower = projectName.toLowerCase();
      const match = list.find((d) => {
        const titleLower = (d.title || '').toLowerCase();
        return matchesDiscussionTitle(titleLower, targetLower);
      });
      return match || null;
    }
    return null;
  } catch {
    return null;
  }
};

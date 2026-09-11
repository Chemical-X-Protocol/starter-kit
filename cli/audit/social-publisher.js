import {
  DISCUSSION_CATEGORY,
  DISCUSSION_CATEGORY_SLUG,
  ORG_DISCUSSIONS_URL,
  DEFAULT_DISCUSSION_REPO
} from './social-constants.js';

import {
  getStoredDiscussion,
  saveStoredDiscussion,
  clearStoredDiscussion
} from './discussion-store.js';

import {
  findMatchedCategory,
  publishDiscussionViaHttp,
  viewDiscussionViaHttp,
  postDiscussionCommentViaHttp,
  editDiscussionViaHttp
} from './social-http.js';

import {
  publishDiscussionViaGh,
  viewDiscussionViaGh,
  postDiscussionCommentViaGh,
  editDiscussionViaGh,
  findExistingDiscussionViaGh
} from './social-gh.js';

export {
  DISCUSSION_CATEGORY,
  DISCUSSION_CATEGORY_SLUG,
  ORG_DISCUSSIONS_URL,
  DEFAULT_DISCUSSION_REPO
} from './social-constants.js';

export {
  getStoredDiscussion,
  saveStoredDiscussion,
  clearStoredDiscussion
} from './discussion-store.js';

export {
  findMatchedCategory,
  publishDiscussionViaHttp,
  viewDiscussionViaHttp,
  postDiscussionCommentViaHttp,
  editDiscussionViaHttp
} from './social-http.js';

export {
  publishDiscussionViaGh,
  viewDiscussionViaGh,
  postDiscussionCommentViaGh,
  editDiscussionViaGh,
  findExistingDiscussionViaGh
} from './social-gh.js';

export const formatArchiveComment = (previousTitle, previousBody) => {
  const archiveTimestamp = new Date().toUTCString();
  return [
    '## 📜 Previous Audit Snapshot (Archived)',
    '',
    `> **Archived on:** ${archiveTimestamp}`,
    `> **Previous Status:** ${previousTitle || 'Prior Report'}`,
    '',
    '---',
    '',
    previousBody
  ].join('\n');
};

export const publishDiscussion = async (repo, title, body, category = DISCUSSION_CATEGORY) => {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) {
    const httpResult = await publishDiscussionViaHttp(envToken, repo, title, body, category);
    if (httpResult.success) {
      return httpResult;
    }
  }

  return publishDiscussionViaGh(repo, title, body, category);
};

export const publishOrUpdateDiscussion = async (
  repo = DEFAULT_DISCUSSION_REPO,
  title,
  body,
  category = DISCUSSION_CATEGORY,
  options = {}
) => {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const stored = getStoredDiscussion();
  const targetRepo = repo || DEFAULT_DISCUSSION_REPO;

  let existingDiscussion = null;

  if (stored && stored.number && (!stored.repo || stored.repo === targetRepo)) {
    if (envToken) {
      existingDiscussion = await viewDiscussionViaHttp(envToken, targetRepo, stored.number);
    }
    if (!existingDiscussion) {
      existingDiscussion = viewDiscussionViaGh(targetRepo, stored.number);
    }
  }

  if (!existingDiscussion && options.projectName) {
    existingDiscussion = findExistingDiscussionViaGh(targetRepo, options.projectName);
  }

  if (existingDiscussion && existingDiscussion.number) {
    const discussionNumber = existingDiscussion.number;
    const discussionId = existingDiscussion.id || stored?.discussionId;
    const previousBody = existingDiscussion.body || '';

    const hasPreviousBody = previousBody.trim().length > 0;
    if (hasPreviousBody) {
      const archiveComment = formatArchiveComment(existingDiscussion.title, previousBody);

      if (envToken && discussionId) {
        await postDiscussionCommentViaHttp(envToken, discussionId, archiveComment);
      } else {
        postDiscussionCommentViaGh(targetRepo, discussionNumber, archiveComment);
      }
    }

    let editSuccess = false;
    if (envToken && discussionId) {
      editSuccess = await editDiscussionViaHttp(envToken, discussionId, title, body);
    }
    if (!editSuccess) {
      editSuccess = editDiscussionViaGh(targetRepo, discussionNumber, title, body);
    }

    const fallbackUrl = `https://github.com/${targetRepo}/discussions/${discussionNumber}`;
    const discussionUrl = existingDiscussion.url || stored?.url || fallbackUrl;

    if (editSuccess) {
      saveStoredDiscussion({
        repo: targetRepo,
        number: discussionNumber,
        discussionId,
        url: discussionUrl,
        projectName: options.projectName || stored?.projectName || '',
        website: options.website || stored?.website || '',
        title,
        lastPublishedAt: new Date().toISOString()
      });

      return {
        success: true,
        url: discussionUrl,
        updated: true,
        discussionNumber,
        error: null
      };
    }
  }

  const pubResult = await publishDiscussion(targetRepo, title, body, category);
  if (pubResult.success && pubResult.url) {
    const match = pubResult.url.match(/\/discussions\/(\d+)/);
    const parsedNumber = match ? parseInt(match[1], 10) : null;
    const discussionNumber = pubResult.number || parsedNumber;

    saveStoredDiscussion({
      repo: targetRepo,
      number: discussionNumber,
      discussionId: pubResult.id || null,
      url: pubResult.url,
      projectName: options.projectName || '',
      website: options.website || '',
      title,
      lastPublishedAt: new Date().toISOString()
    });

    return {
      success: true,
      url: pubResult.url,
      updated: false,
      discussionNumber,
      error: null
    };
  }

  return {
    success: false,
    url: null,
    updated: false,
    discussionNumber: null,
    error: pubResult.error
  };
};

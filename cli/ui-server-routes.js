/**
 * Chemical X UI Server Route Handlers
 */
import {
  handleSwarmStatus, handlePostFeed, handleCreateFeedPost, handleUpdateSignature,
  handleGetTopics, handleGetTopicPosts, handleCreateTopic
} from './ui-handlers.js';
import { queryFeed, listTasks, getTask } from './team/team-db.js';
import { getForumCategories } from './ui-forum-data.js';
import {
  handleCodebaseIndex, handleCodebaseTree, handleCodebaseFile,
  handleCreateTask, handleClaimTask, handleCompleteTask,
  handleUpdateTaskStatus, handleAssignTask, handleAcquireLock,
  handleReleaseLock, handleOverrideLock, handleSettingsAction,
  handleGeneratePrompt, handleDbTables, handleDbBrowse,
  handleDbStructure, handleDbQuery, handleUpdateTaskVdsSlot, handleUpdateTaskTraceability
} from './ui-actions.js';
import { getDatabaseMetrics, executeSqlQuery } from './ui-db-studio.js';
import { scanAttentionItems, confirmAttentionItem } from './ui-attention.js';

export const routeGet = (pathname, db, cwd = process.cwd(), queryParams = {}) => {
  const [cleanPath, search] = (pathname || '').split('?');
  const parsedParams = search ? Object.fromEntries(new URLSearchParams(search)) : queryParams;
  const normPath = cleanPath.replace(/^\/api\/swarm\//, '/api/');

  const routes = {
    '/api/status': () => handleSwarmStatus(db, cwd),
    '/api/feed': () => ({ success: true, feed: queryFeed(db, parsedParams) }),
    '/api/tasks': () => ({ success: true, tasks: listTasks(db, parsedParams) }),
    '/api/categories': () => ({ success: true, categories: getForumCategories(db) }),
    '/api/agents': () => ({ success: true, agents: handleSwarmStatus(db, cwd).agents }),
    '/api/codebase': () => handleCodebaseIndex(db),
    '/api/codebase/tree': () => handleCodebaseTree(db),
    '/api/codebase/file': () => handleCodebaseFile(db, parsedParams.path, cwd),
    '/api/database/metrics': () => getDatabaseMetrics(db, cwd),
    '/api/topics': () => handleGetTopics(db, parsedParams.category),
    '/api/topics/posts': () => handleGetTopicPosts(db, parsedParams.topicId || parsedParams.topic_id),
    '/api/attention': () => scanAttentionItems(db, cwd),
    '/api/db/tables': () => handleDbTables(db, cwd),
    '/api/db/browse': () => handleDbBrowse(db, parsedParams), '/api/db/structure': () => handleDbStructure(db, parsedParams)
  };

  const hasRoute = Object.prototype.hasOwnProperty.call(routes, normPath);
  if (hasRoute) return routes[normPath]();

  const taskByIdMatch = normPath.match(/^\/api\/tasks\/(\d+)$/);
  if (taskByIdMatch) {
    const task = getTask(db, taskByIdMatch[1]);
    if (!task) return { success: false, error: 'Task not found' };
    return { success: true, task };
  }

  return null;
};

export const routePost = (pathname, db, body, cwd = process.cwd()) => {
  const [cleanPath] = (pathname || '').split('?');
  const postFeedHandler = handleCreateFeedPost || handlePostFeed;
  const normPath = cleanPath.replace(/^\/api\/swarm\//, '/api/');

  const routes = {
    '/api/feed': () => postFeedHandler(db, body),
    '/api/tasks': () => handleCreateTask(db, body),
    '/api/tasks/claim': () => handleClaimTask(db, body),
    '/api/tasks/done': () => handleCompleteTask(db, body, cwd),
    '/api/tasks/update': () => handleUpdateTaskStatus(db, body),
    '/api/tasks/slot': () => handleUpdateTaskVdsSlot(db, body),
    '/api/tasks/trace': () => handleUpdateTaskTraceability(db, body),
    '/api/tasks/assign': () => handleAssignTask(db, body),
    '/api/locks/acquire': () => handleAcquireLock(db, body), '/api/locks/release': () => handleReleaseLock(db, body),
    '/api/locks/override': () => handleOverrideLock(db, body),
    '/api/agents/signature': () => handleUpdateSignature(db, body),
    '/api/topics': () => handleCreateTopic(db, body),
    '/api/settings/action': () => handleSettingsAction(db, body),
    '/api/database/query': () => executeSqlQuery(db, body.query),
    '/api/attention/action': () => confirmAttentionItem(db, body.itemId, body.action),
    '/api/prompts/generate': () => handleGeneratePrompt(db, body, cwd),
    '/api/db/query': () => handleDbQuery(db, body)
  };

  const hasRoute = Object.prototype.hasOwnProperty.call(routes, normPath);
  if (hasRoute) return routes[normPath]();
  return null;
};

export const parseJsonBody = (req) => {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
};

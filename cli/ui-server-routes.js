/**
 * Chemical X UI Server Route Handlers
 * Dispatches API requests to corresponding database action handlers
 */

import { handleSwarmStatus, handlePostFeed } from './ui-handlers.js';
import {
  handleCodebaseIndex,
  handleCreateTask,
  handleClaimTask,
  handleCompleteTask,
  handleAcquireLock,
  handleReleaseLock,
  handleSettingsAction
} from './ui-actions.js';
import { getDatabaseMetrics, executeSqlQuery } from './ui-db-studio.js';
import { scanAttentionItems, confirmAttentionItem } from './ui-attention.js';

export const routeGet = (pathname, db, cwd = process.cwd()) => {
  const routes = {
    '/api/swarm/status': () => handleSwarmStatus(db),
    '/api/swarm/codebase': () => handleCodebaseIndex(db),
    '/api/swarm/database/metrics': () => getDatabaseMetrics(db, cwd),
    '/api/swarm/attention': () => scanAttentionItems(db, cwd)
  };

  const hasRoute = Object.prototype.hasOwnProperty.call(routes, pathname);
  if (hasRoute) return routes[pathname]();
  return null;
};

export const routePost = (pathname, db, body, cwd = process.cwd()) => {
  const routes = {
    '/api/swarm/feed': () => handlePostFeed(db, body),
    '/api/swarm/tasks': () => handleCreateTask(db, body),
    '/api/swarm/tasks/claim': () => handleClaimTask(db, body),
    '/api/swarm/tasks/done': () => handleCompleteTask(db, body, cwd),
    '/api/swarm/locks/acquire': () => handleAcquireLock(db, body),
    '/api/swarm/locks/release': () => handleReleaseLock(db, body),
    '/api/swarm/settings/action': () => handleSettingsAction(db, body),
    '/api/swarm/database/query': () => executeSqlQuery(db, body.query),
    '/api/swarm/attention/action': () => confirmAttentionItem(db, body.itemId, body.action)
  };

  const hasRoute = Object.prototype.hasOwnProperty.call(routes, pathname);
  if (hasRoute) return routes[pathname]();
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

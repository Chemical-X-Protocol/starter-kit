/**
 * The social layer's routes (epic #7614): one module per feature, each owning its own file so
 * sprint builders never share one. Each module exports getRoutes, postRoutes and API_DOCS, and may export
 * getPatterns / postPatterns for id paths: (db, input, ctx) => [[/^\/api\/posts\/(\d+)$/, (match) => result], ...].
 */
import * as feed from './ui-social-feed.js';
import * as digest from './ui-social-digest.js';
import * as posts from './ui-social-posts.js';
import * as profile from './ui-social-profile.js';
import * as threads from './ui-social-threads.js';
import * as mentions from './ui-social-mentions.js';
import * as notify from './ui-social-notify.js';
import * as directory from './ui-agents-directory.js';
import * as dms from './ui-social-dms.js';
import * as settings from './ui-settings.js';

const MODULES = [feed, digest, posts, profile, threads, mentions, notify, directory, dms, settings];

export const SOCIAL_API_DOCS = MODULES.flatMap((m) => m.API_DOCS);

export const socialGetRoutes = (db, params, ctx = {}) =>
  Object.assign({}, ...MODULES.map((m) => m.getRoutes(db, params, ctx)));

export const socialPostRoutes = (db, body, ctx = {}) =>
  Object.assign({}, ...MODULES.map((m) => m.postRoutes(db, body, ctx)));

/** The first module pattern matching the path runs; null when none matches. kind is 'getPatterns' or 'postPatterns'. */
const matchPattern = (kind, pathname, db, input, ctx, modules) => {
  for (const m of modules) {
    for (const [pattern, handler] of m[kind]?.(db, input, ctx) || []) {
      const match = pathname.match(pattern);
      if (match) return handler(match);
    }
  }
  return null;
};

export const matchSocialGet = (pathname, db, params, ctx = {}, modules = MODULES) =>
  matchPattern('getPatterns', pathname, db, params, ctx, modules);

export const matchSocialPost = (pathname, db, body, ctx = {}, modules = MODULES) =>
  matchPattern('postPatterns', pathname, db, body, ctx, modules);

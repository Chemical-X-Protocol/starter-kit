/**
 * The social layer's routes (epic #7614): one module per feature, each owning its own file so
 * sprint builders never share one. Each module exports getRoutes, postRoutes and API_DOCS.
 */
import * as feed from './ui-social-feed.js';
import * as digest from './ui-social-digest.js';
import * as posts from './ui-social-posts.js';
import * as profile from './ui-social-profile.js';
import * as threads from './ui-social-threads.js';
import * as mentions from './ui-social-mentions.js';
import * as notify from './ui-social-notify.js';

const MODULES = [feed, digest, posts, profile, threads, mentions, notify];

export const SOCIAL_API_DOCS = MODULES.flatMap((m) => m.API_DOCS);

export const socialGetRoutes = (db, params, ctx = {}) =>
  Object.assign({}, ...MODULES.map((m) => m.getRoutes(db, params, ctx)));

export const socialPostRoutes = (db, body, ctx = {}) =>
  Object.assign({}, ...MODULES.map((m) => m.postRoutes(db, body, ctx)));

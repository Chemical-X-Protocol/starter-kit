/** Feed pages and lease rows for the UI's read routes (#7604). */
import { queryFeed } from './team/team-db.js';

export const readLeases = (db) => db.prepare('SELECT file_path, locked_by FROM file_leases').all()
  .map((l) => ({ filePath: l.file_path, lockedBy: l.locked_by }));

// Feed rows come back oldest-first; oldestId is the before_id of the next older page.
export const readFeedPage = (db, params = {}) => {
  const feed = queryFeed(db, params);
  const limit = Math.min(Number(params.limit || 50), 200);
  const isBackwardRead = !params.since_id;
  const hasMore = isBackwardRead && feed.length === limit;
  return { success: true, feed, hasMore, oldestId: feed.length > 0 ? feed[0].id : null };
};

# `chemx ui`: loading and pagination

`chemx ui` serves one page plus a JSON API. The page and every live update are bounded in size, whatever the size of the coordination db. Long lists page on demand, both in the page and over the API.

## What loads when

| When | What | Size bound |
| :--- | :--- | :--- |
| Page load | The HTML with the live view inlined (`window.__CHEMX_HYDRATED_STATE__`) | 50 most recently updated tasks, 50 most recently seen agents, 50 newest feed posts, task and agent counts |
| Every POST that changes state | The same live view, pushed over SSE (`/api/events`) | same as above |
| First visit to a tab | That tab's data: the board (`/api/tasks/board`), the codebase, the attention inbox, the db tables, the workbench prompt | one page per board column; the codebase list once |
| "Load more" / pager | The next page of that list | one page |

The open tab is kept in the URL hash (`#/tasks`, `#/codebase`, and so on), so a reload or a shared link opens the same tab.

Measured on 2026-11-15 against the monorepo coordination db (7,407 tasks, 1,610 agents): the page went from 12.8 MB and 2.8 s to 172 KB, with the load event at 0.6 s. The board's first load (5 columns, 25 cards each) takes 0.18 s.

## In the page

- **Kanban**: each column holds its own server page (25 cards). The count chip is the column's total under the current filters, and the column footer says "Showing N of M tasks" with a "Load 25 more" button. Search (`q`), tier and the test-task shield run in SQL, so they cover every task, not only the loaded cards. A live update re-reads each column to the depth already loaded.
- **Task sheet**: it opens on the card at once, then fills in the whole row (`/api/tasks/:id`) and its feed.
- **Agents rail**: 50 agents at a time, newest heartbeat first. The filter chips show their counts and filter on the server.
- **Timeline**: the newest 50 posts. "Load older posts" pages back until "Start of the timeline".
- **Codebase**: fetched once, rendered 60 file cards per page with a numbered pager.
- **Database Studio**: 25 rows per page of the chosen table, with a numbered pager.

## Over the API (for agents and scripts)

Send the launch token as the `x-chemx-token` header (or `?token=`). `GET /api/` returns the endpoint list with every parameter, so an agent never needs the client source.

Every paged list answers with the same envelope next to its rows:

```json
{ "total": 2914, "limit": 25, "offset": 0, "page": 1, "totalPages": 117, "hasMore": true, "nextOffset": 25 }
```

Repeat the call with `offset=nextOffset` until `hasMore` is false. `limit` defaults to 25 and is capped at 200. `page` works instead of `offset`.

| Endpoint | Returns | Parameters |
| :--- | :--- | :--- |
| `/api/tasks` | Task cards: board columns plus `subtaskCount`, `isVerified`, `health_after`, `tokenStamp`; no description or JSON receipts | `status` (comma list; `done` includes `completed`, `blocked` includes `failed`), `q` (title, path, assignee or `#id`), `tier`, `hideTests=1`, `sort=priority\|recent\|newest`, `full=1` for whole rows, and the CLI filters (`assigned_agent_id`, `repo`, `needs`, `search`, `parent_id`, `moscow`, `priority`, `sprint_tag`) |
| `/api/tasks/board` | `columns.<status>`, each a page with the envelope | the `/api/tasks` filters, `limit`, `columns` |
| `/api/tasks/:id` | One whole task row | n/a |
| `/api/agents` | Agents with `counts` per status | `status=all\|active\|idle\|offline`, paging |
| `/api/feed` | Posts oldest-first, `hasMore`, `oldestId` | `limit` (default 50, max 200), `before_id`, `since_id`, `task_id`, `thread_id`, `author_id`, `event_type` |
| `/api/db/browse` | Rows of one code-index table | `table`, `page`, `pageSize` (max 100) |

Done-like columns (`done`, `completed`, `cancelled`, `duplicate`) sort most recently updated first by default; the others sort by priority, then id.

The code: `cli/ui-paging.js` (page params and envelope), `cli/ui-paging-tasks.js` and `cli/ui-paging-task-where.js` (task pages and board), `cli/ui-paging-agents.js` (agent pages), `cli/ui-api-index.js` (`GET /api/`), `cli/ui-handlers.js` (the live view), `cli/ui-index.html` (the page). `cli/ui-index.html` is the page `chemx ui` serves.

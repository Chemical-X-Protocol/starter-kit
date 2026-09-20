/**
 * Chemical X UI Forum View Template
 */
import { VIEW_TOPIC_THREAD_TEMPLATE } from './ui-template-thread.js';
import { VIEW_TIMELINE_TEMPLATE } from './ui-template-timeline.js';

export const VIEW_FORUM_TEMPLATE = `
    <main v-if="activeTab === 'social' || activeTab === 'forum'" class="t-body--full">
` + VIEW_TOPIC_THREAD_TEMPLATE + `
      <div v-if="!selectedTopic" style="display:flex; flex-direction:column; gap:8px;">
        <table class="vb-table">
          <thead>
            <tr class="vb-thead">
              <th style="text-align:left; width:45%;">Forum Category</th>
              <th style="text-align:center; width:12%;">Threads</th>
              <th style="text-align:center; width:12%;">Posts</th>
              <th style="text-align:left; width:31%;">Last Post</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(cat, idx) in forumCategories" :key="cat.id" :class="idx % 2 === 0 ? 'vb-row-alt1' : 'vb-row-alt2'" style="cursor:pointer;" @click="selectCategory(cat.id)">
              <td class="vb-cell">
                <div style="font-weight:bold; font-size:12px; color:#93c5fd;">📁 {{ cat.name }}</div>
                <div style="font-size:10px; color:#94a3b8;">{{ cat.desc }}</div>
              </td>
              <td class="vb-cell" style="text-align:center; font-weight:bold; color:#f8fafc;">{{ Number(cat.threadsCount || 0).toLocaleString() }}</td>
              <td class="vb-cell" style="text-align:center; font-weight:bold; color:#f8fafc;">{{ Number(cat.postsCount || 0).toLocaleString() }}</td>
              <td class="vb-cell">
                <div style="font-size:10px; color:#cbd5e1;">{{ new Date(cat.lastPostTimestamp || Date.now()).toLocaleTimeString() }}</div>
                <div style="font-size:10px;">by <span class="vb-model-badge" style="cursor:pointer;" @click.stop="openAgentProfile(cat.authorBadge)">{{ cat.authorBadge }}</span></div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="selectedCategory" style="display:flex; align-items:center; gap:6px;">
          <span class="a-badge badge-warning">Filtered by Category: {{ selectedCategory }}</span>
          <button class="a-btn a-btn--sec" style="padding:1px 6px; font-size:10px;" @click="selectCategory(null)">Show All Topics</button>
        </div>

        <div class="vb-cat-header" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Community Topics & Feature Discussions ({{ filteredTopics.length }})</span>
          <button class="a-btn" style="font-size:10px; padding:2px 8px;" @click="showNewTopicModal = !showNewTopicModal">+ New Feature Topic</button>
        </div>

        <div v-if="showNewTopicModal" style="background:#101c2e; padding:8px; border:1px outset #294e79; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; gap:6px;">
            <input v-model="newTopicTitle" class="a-input" style="flex:2;" placeholder="Topic title (e.g. Molecular Refactoring Architecture)..." />
            <select v-model="newTopicCat" class="kanban-select" style="flex:1;"><option v-for="c in forumCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select>
            <input v-model="newTopicTag" class="a-input" style="flex:1;" placeholder="Feature tag (e.g. AST, UI, Rules)..." />
          </div>
          <input v-model="newTopicMsg" class="a-input" placeholder="Opening topic message / description..." @keydown.enter="submitNewTopic" />
          <div style="display:flex; justify-content:flex-end; gap:6px;">
            <button class="a-btn a-btn--sec" @click="showNewTopicModal = false">Cancel</button>
            <button class="a-btn" :disabled="isPostingTopic" @click="submitNewTopic">Publish Topic</button>
          </div>
        </div>

        <table class="vb-table">
          <thead>
            <tr class="vb-thead">
              <th style="text-align:left; width:48%;">Feature Topic</th>
              <th style="text-align:center; width:14%;">Tag</th>
              <th style="text-align:center; width:12%;">Replies</th>
              <th style="text-align:left; width:26%;">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, idx) in filteredTopics" :key="t.id" :class="idx % 2 === 0 ? 'vb-row-alt1' : 'vb-row-alt2'" style="cursor:pointer;" @click="selectTopic(t)">
              <td class="vb-cell">
                <div style="font-weight:bold; font-size:12px; color:#93c5fd;">{{ t.pinned ? '📌 ' : '💬 ' }}{{ t.title }}</div>
                <div style="font-size:10px; color:#94a3b8;">Started by <span class="vb-model-badge" style="cursor:pointer;" @click.stop="openAgentProfile(t.authorId)">{{ t.authorId }}</span> in [{{ t.categoryId }}]</div>
              </td>
              <td class="vb-cell" style="text-align:center;"><span class="a-badge badge-primary">{{ t.featureTag }}</span></td>
              <td class="vb-cell" style="text-align:center; font-weight:bold; color:#f8fafc;">{{ Number(t.repliesCount || 0).toLocaleString() }}</td>
              <td class="vb-cell">
                <div style="font-size:10px; color:#cbd5e1;">{{ new Date(t.lastPostTimestamp || t.updatedAt).toLocaleTimeString() }}</div>
                <div style="font-size:10px;">by <span class="vb-model-badge" style="cursor:pointer;" @click.stop="openAgentProfile(t.lastPostAuthor)">{{ t.lastPostAuthor }}</span></div>
              </td>
            </tr>
          </tbody>
        </table>
` + VIEW_TIMELINE_TEMPLATE + `
      </div>
    </main>
`;

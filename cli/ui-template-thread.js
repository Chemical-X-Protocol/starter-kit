/**
 * Chemical X UI Forum Topic Thread View Template
 */
export const VIEW_TOPIC_THREAD_TEMPLATE = `
      <div v-if="selectedTopic" style="display:flex; flex-direction:column; gap:8px;">
        <div class="vb-cat-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="a-btn a-btn--sec" style="font-size:10px; padding:2px 6px;" @click="selectTopic(null)">← Back to Topics</button>
            <strong style="color:#ffffff; font-size:12px;">{{ selectedTopic.pinned ? '📌 ' : '' }}{{ selectedTopic.title }}</strong>
            <span class="a-badge badge-primary">{{ selectedTopic.featureTag }}</span>
          </div>
          <div style="font-size:10px; color:#94a3b8;">
            Started by <span class="vb-model-badge" style="cursor:pointer;" title="View Profile" @click="openAgentProfile(selectedTopic.authorId)">{{ selectedTopic.authorId }}</span>
          </div>
        </div>

        <div v-if="topicPosts.length === 0" class="vb-postbit" style="padding:12px; color:#94a3b8; font-style:italic;">
          No replies yet in this feature discussion. Be the first to reply!
        </div>

        <div v-for="p in topicPosts" :key="p.id" class="vb-postbit">
          <div class="vb-postbit__author" style="cursor:pointer;" title="Click to view agent profile" @click="openAgentProfile(p.authorMeta || p.author)">
            <div class="vb-avatar">{{ (p.author || '@')[1]?.toUpperCase() || 'A' }}</div>
            <strong style="color:#62c9ff; word-break:break-all;">{{ p.author }}</strong>
            <span class="vb-title-flair">{{ p.authorMeta?.userTitle || (p.author === '@user' ? 'Human Operator' : 'Swarm Contributor') }}</span>
            <div class="vb-rank-stars">{{ p.authorMeta?.rankStars || '★★★★★' }}</div>
            <span class="vb-model-badge">{{ p.authorMeta?.model || (p.author === '@user' ? 'Human Operator' : 'Gemini 3.8 Flash') }}</span>
            <div style="font-size:9px; color:#94a3b8; margin-top:2px;">Join Date: {{ p.authorMeta?.joinDate || 'Sep 2026' }}</div>
            <div style="font-size:9px; color:#94a3b8;">Posts: {{ p.authorMeta?.postsCount || 1 }}</div>
          </div>
          <div class="vb-postbit__body">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="vb-token-stamp">{{ p.tokenStamp || '[P: 250 | C: 45 | Cost: $0.0014]' }}</span>
                <span class="a-badge badge-warning">{{ p.eventType }}</span>
              </div>
              <p style="font-size:12px; color:#f8fafc; margin-top:6px; white-space:pre-wrap;">{{ p.message }}</p>
            </div>
            <div>
              <div class="vb-sig-divider"></div>
              <div class="vb-signature">{{ p.signature || p.authorMeta?.signature || (p.author === '@user' ? 'Chemical X Project Director' : 'Chemical X Autonomous Swarm Agent') }}</div>
            </div>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin:4px 0; background:#101c2e; padding:8px; border:1px outset #294e79;">
          <input v-model="topicReplyText" class="a-input" placeholder="Write reply to this feature discussion as @user..." @keydown.enter="sendTopicReply" />
          <button class="a-btn" @click="sendTopicReply">Submit Reply</button>
        </div>
      </div>
`;

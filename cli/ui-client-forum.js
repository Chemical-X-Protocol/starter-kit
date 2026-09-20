/**
 * Chemical X UI Forum & Feature Topics Reactive State
 */
export const UI_CLIENT_FORUM_SCRIPT = `
window.createForumState = (Vue, api, agents, hydratedState) => {
  const { ref, computed } = Vue;
  const topics = ref(hydratedState?.topics || []);
  const selectedCategory = ref(null);
  const selectedTopic = ref(null);
  const topicPosts = ref([]);
  const showNewTopicModal = ref(false);
  const newTopicTitle = ref('');
  const newTopicCat = ref('announcements');
  const newTopicTag = ref('ast-engine');
  const newTopicMsg = ref('');
  const topicReplyText = ref('');
  const isPostingTopic = ref(false);

  const filteredTopics = computed(() => {
    if (!selectedCategory.value) return topics.value;
    return topics.value.filter((t) => t.categoryId === selectedCategory.value);
  });

  const selectCategory = (catId) => {
    selectedCategory.value = selectedCategory.value === catId ? null : catId;
    selectedTopic.value = null;
  };

  const selectTopic = async (topic) => {
    selectedTopic.value = topic;
    if (!topic) {
      topicPosts.value = [];
      return;
    }
    const res = await api.fetchTopicPosts(topic.id);
    if (res?.success) topicPosts.value = res.posts || [];
  };

  const submitNewTopic = async () => {
    const title = newTopicTitle.value.trim();
    if (!title) return;
    isPostingTopic.value = true;
    const res = await api.createTopic({
      categoryId: newTopicCat.value,
      title,
      featureTag: newTopicTag.value || 'feature',
      authorId: '@user',
      message: newTopicMsg.value.trim()
    });
    isPostingTopic.value = false;
    if (res?.topic) {
      topics.value.unshift(res.topic);
      newTopicTitle.value = '';
      newTopicMsg.value = '';
      showNewTopicModal.value = false;
      await selectTopic(res.topic);
    }
  };

  const sendTopicReply = async () => {
    const msg = topicReplyText.value.trim();
    if (!msg || !selectedTopic.value) return;
    await api.postJson('/api/swarm/feed', {
      message: msg,
      author: '@user',
      threadId: selectedTopic.value.id
    });
    topicReplyText.value = '';
    const res = await api.fetchTopicPosts(selectedTopic.value.id);
    if (res?.success) topicPosts.value = res.posts || [];
    if (selectedTopic.value) selectedTopic.value.repliesCount = (selectedTopic.value.repliesCount || 0) + 1;
  };

  const refreshTopics = async () => {
    const res = await api.fetchTopics(selectedCategory.value || '');
    if (res?.success) topics.value = res.topics;
  };

  return {
    topics, selectedCategory, selectedTopic, topicPosts, showNewTopicModal,
    newTopicTitle, newTopicCat, newTopicTag, newTopicMsg, topicReplyText, isPostingTopic,
    filteredTopics, selectCategory, selectTopic, submitNewTopic, sendTopicReply, refreshTopics
  };
};
`;

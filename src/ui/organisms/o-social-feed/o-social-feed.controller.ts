import { ref, computed } from 'vue';
import type { FeedPostRecord } from '../../molecules/m-feed-post/types';
import type { SocialFeedProps, FeedChannelFilter, SocialFeedEmits } from './types';

const matchesChannel = (post: FeedPostRecord, filter: FeedChannelFilter): boolean => {
  const isAllFilter = filter === 'all';
  if (isAllFilter) return true;

  const isGeneralFilter = filter === 'general';
  if (isGeneralFilter) {
    const isUnassignedChannel = !post.channel;
    const isGeneralChannel = post.channel === 'general';
    return isUnassignedChannel || isGeneralChannel;
  }

  const isAlertsFilter = filter === 'alerts';
  if (isAlertsFilter) {
    const isAlertEvent = post.eventType.includes('alert');
    const isBlockEvent = post.eventType.includes('block');
    return isAlertEvent || isBlockEvent;
  }

  const isLocksFilter = filter === 'locks';
  if (isLocksFilter) {
    return post.eventType.includes('lock');
  }

  return true;
};

export function useSocialFeedController(props: SocialFeedProps, emit: SocialFeedEmits) {
  const currentFilter = ref<FeedChannelFilter>('all');
  const postList = computed((): readonly FeedPostRecord[] => props.posts || []);

  const totalPosts = computed((): number => postList.value.length);
  const filteredPosts = computed((): readonly FeedPostRecord[] => (
    postList.value.filter((p) => matchesChannel(p, currentFilter.value))
  ));

  const hasPosts = computed((): boolean => filteredPosts.value.length > 0);
  const shouldShowEmpty = computed((): boolean => !hasPosts.value);

  const setFilter = (filter: FeedChannelFilter) => {
    currentFilter.value = filter;
  };

  const handleBroadcast = (msg: string) => {
    const clean = msg.trim();
    const isEmptyMessage = clean.length === 0;
    if (isEmptyMessage) return;
    emit('post', clean);
  };

  return {
    currentFilter,
    filteredPosts,
    totalPosts,
    setFilter,
    handleBroadcast
  };
}

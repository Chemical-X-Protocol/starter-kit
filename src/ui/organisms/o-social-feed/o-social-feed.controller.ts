import { ref, computed } from 'vue';
import type { FeedPostRecord } from '../../molecules/m-feed-post/types';
import type { SocialFeedProps, FeedChannelFilter, SocialFeedEmits } from './types';

const matchesChannel = (post: FeedPostRecord, filter: FeedChannelFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'general') return !post.channel || post.channel === 'general';
  if (filter === 'alerts') return post.eventType.includes('alert') || post.eventType.includes('block');
  if (filter === 'locks') return post.eventType.includes('lock');
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
    if (clean.length === 0) return;
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

import { ref } from 'vue';
import type { FeedPostRecord } from '../molecules/m-feed-post/types';
import { useSelfCleaningTimeout } from './useSelfCleaningTimeout';

export function useSwarmFeed(author = '@ui-specialist') {
  const posts = ref<FeedPostRecord[]>([]);
  const isLoading = ref<boolean>(false);
  const error = ref<Error | null>(null);

  const fetchFeed = async () => {
    const isFetchUnavailable = typeof fetch !== 'function';
    if (isFetchUnavailable) return;
    try {
      isLoading.value = true;
      const res = await fetch('/api/swarm/status');
      const isResponseOk = Boolean(res.ok);
      if (isResponseOk) {
        const data = await res.json();
        const hasPosts = Boolean(data.posts);
        if (hasPosts) posts.value = data.posts;
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
      poller.start();
    }
  };

  const poller = useSelfCleaningTimeout(() => {
    const isPageHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (isPageHidden) {
      poller.start();
      return;
    }
    fetchFeed();
  }, 3000);

  const sendPost = async (message: string) => {
    const isFetchUnavailable = typeof fetch !== 'function';
    if (isFetchUnavailable) return;
    try {
      await fetch('/api/swarm/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, author })
      });
      await fetchFeed();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  fetchFeed();

  return {
    posts,
    sendPost,
    isLoading,
    error,
    refreshFeed: fetchFeed
  };
}

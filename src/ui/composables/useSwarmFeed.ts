import { ref } from 'vue';
import type { FeedPostRecord } from '../molecules/m-feed-post/types';
import { useSelfCleaningTimeout } from './useSelfCleaningTimeout';

export function useSwarmFeed(author = '@ui-specialist') {
  const posts = ref<FeedPostRecord[]>([]);
  const isLoading = ref<boolean>(false);
  const error = ref<Error | null>(null);

  const fetchFeed = async () => {
    if (typeof fetch !== 'function') return;
    try {
      isLoading.value = true;
      const res = await fetch('/api/swarm/status');
      if (res.ok) {
        const data = await res.json();
        if (data.posts) posts.value = data.posts;
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
      poller.start();
    }
  };

  const poller = useSelfCleaningTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      poller.start();
      return;
    }
    fetchFeed();
  }, 3000);

  const sendPost = async (message: string) => {
    if (typeof fetch !== 'function') return;
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

import type { FeedPostRecord } from '../../molecules/m-feed-post/types';

export type FeedChannelFilter = 'all' | 'general' | 'alerts' | 'locks';

export interface SocialFeedProps {
  readonly posts?: readonly FeedPostRecord[];
  readonly currentAgent?: string;
}

export interface SocialFeedEmits {
  (e: 'post', message: string): void;
}

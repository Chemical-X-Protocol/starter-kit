import type { BadgeTone } from '../../atoms/a-badge/types';

export interface FeedPostRecord {
  readonly id: number;
  readonly author: string;
  readonly eventType: string;
  readonly message: string;
  readonly timestamp: number;
  readonly channel?: string;
}

export interface EventConfig {
  readonly tone: BadgeTone;
  readonly label: string;
  readonly icon: string;
}

export interface FeedPostProps {
  readonly post: FeedPostRecord;
}

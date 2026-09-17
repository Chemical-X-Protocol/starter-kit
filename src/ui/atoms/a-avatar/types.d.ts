export type PresenceStatus = 'idle' | 'busy' | 'offline' | 'active';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  readonly src?: string;
  readonly name?: string;
  readonly size?: AvatarSize;
  readonly status?: PresenceStatus;
}

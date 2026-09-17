export type TextTag = 'p' | 'span' | 'strong' | 'h1' | 'h2' | 'h3' | 'h4' | 'label' | 'code';
export type TextVariant = 'body' | 'heading' | 'title' | 'caption' | 'code' | 'mono';
export type TextTone = 'default' | 'primary' | 'muted' | 'success' | 'warning' | 'danger';

export interface TextProps {
  readonly tag?: TextTag;
  readonly variant?: TextVariant;
  readonly tone?: TextTone;
  readonly text?: string | number;
}

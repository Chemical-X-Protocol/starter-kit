export interface InputProps {
  readonly modelValue?: string | number;
  readonly placeholder?: string;
  readonly type?: 'text' | 'number' | 'search';
  readonly disabled?: boolean;
  readonly size?: 'sm' | 'md' | 'lg';
}

export interface InputEmits {
  (e: 'update:modelValue', value: string): void;
  (e: 'submit'): void;
}

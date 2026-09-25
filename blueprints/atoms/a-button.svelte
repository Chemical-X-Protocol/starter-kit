<script lang="ts">
  let {
    type = 'button',
    disabled = false,
    ariaLabel = undefined,
    variant = 'primary',
    class: className = '',
    onclick,
    children
  } = $props<{
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    ariaLabel?: string;
    variant?: 'primary' | 'ghost' | 'glass';
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
  }>();
</script>

<button
  {type}
  {disabled}
  aria-label={ariaLabel}
  class="a-button cursor-pointer {className}"
  data-variant={variant}
  {onclick}
>
  {@render children?.()}
</button>

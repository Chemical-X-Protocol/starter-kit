<script lang="ts">
  let {
    title,
    children
  } = $props<{
    title: string;
    children?: import('svelte').Snippet;
  }>();
</script>

<main class="view-template">
  <header class="view-template__header">
    <h1 class="view-template__title">{title}</h1>
  </header>
  <div class="view-template__content">
    {@render children?.()}
  </div>
</main>

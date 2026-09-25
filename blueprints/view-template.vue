<script setup lang="ts">
interface Props {
  title: string;
}

defineProps<Props>();
</script>

<template>
  <main class="view-template">
    <header class="view-template__header">
      <h1 class="view-template__title">{{ title }}</h1>
    </header>
    <div class="view-template__content">
      <slot />
    </div>
  </main>
</template>

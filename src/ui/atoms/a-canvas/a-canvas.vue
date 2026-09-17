<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { CanvasProps, CanvasEmits } from './types';

const props = withDefaults(defineProps<CanvasProps>(), {
  width: 540,
  height: 280
});

const emit = defineEmits<CanvasEmits>();
const canvasRef = ref<HTMLCanvasElement | null>(null);

onMounted(() => {
  if (canvasRef.value) {
    emit('ready', canvasRef.value);
  }
});
</script>

<template>
  <canvas
    ref="canvasRef"
    :width="props.width"
    :height="props.height"
    class="a-canvas"
  />
</template>

<style lang="scss" scoped>
@use "./a-canvas";
</style>

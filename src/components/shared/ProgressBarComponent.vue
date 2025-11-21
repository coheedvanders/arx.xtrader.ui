<template>
  <div class="progress-bar">
    <div class="track"></div>
    <div class="fill" :style="{ width: percentage + '%' }">
      <div class="shimmer"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  max: number;
  value: number;
}

const props = withDefaults(defineProps<Props>(), {
  max: 100,
  counter: 0,
});

const percentage = computed(() => {
  return Math.min((props.value / props.max) * 100, 100);
});
</script>

<style scoped>
.progress-bar {
  position: relative;
  height: 12px;
  border-radius: 9999px;
}

.track {
  position: absolute;
  inset: 0;
  background: #ffffff;
  border: 1px solid #c5c5c5;
  border-radius: 9999px;
  box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.5);
}

.fill {
  position: relative;
  height: 100%;
  background: #3f3f3f;
  border-radius: 9999px;
  transition: width 300ms ease-out;
  box-shadow: 
    0 0 20px rgba(255, 255, 255, 0.8),
    inset 0 0 10px rgba(255, 255, 255, 0.5);
}

.shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.4),
    transparent
  );
  border-radius: 9999px;
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
</style>
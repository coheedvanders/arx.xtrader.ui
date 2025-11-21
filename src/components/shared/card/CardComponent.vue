<template>
  <div class="card" :class="cardClass">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  flat?: boolean
  border?: boolean,
  shadow?: boolean
}>(), {
  border: true,
  shadow: true
})

const cardClass = computed(() => ({
  'shadow-sm': !props.flat && props.shadow,
  'border': !props.flat && props.border
}))
</script>

<style scoped>
.card {
  background-color: white;
  border-radius: 0.5rem;
  overflow: hidden;
}

.border {
  border: 1px solid #e5e7eb;
}
</style>

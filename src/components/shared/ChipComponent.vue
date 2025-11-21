<template>
  <div class="chip" :class="chipClasses">
    <span>{{ label }}</span>
    <button v-if="closable" class="chip-close" @click="removeChip">
      <i class="fas fa-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  label: string
  color?: string // You can pass a custom color or use predefined ones (e.g., 'primary', 'secondary')
  closable?: boolean
}>()

const emit = defineEmits(['remove'])

const chipClasses = computed(() => ({
  'chip-primary': !props.color || props.color === 'primary',
  'chip-secondary': props.color === 'secondary',
  'chip-danger': props.color === 'danger',
  'chip-success': props.color === 'success',
}))

const removeChip = () => {
  emit('remove')
}
</script>

<style scoped>
.chip {
  display: flex;
  align-items: center;
  background-color: #f0f0f0;
  border-radius: 20px;
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  gap: 0.5rem;
}

.chip-primary {
  background-color: #2d3032;
  color: white;
}

.chip-secondary {
  background-color: #f3f3f3;
  color: #121212;
}

.chip-danger {
  background-color: #dc3545;
  color: white;
}

.chip-success {
  background-color: #28a745;
  color: white;
}

.chip-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
}

.chip-close:hover {
  color: #666;
}
</style>

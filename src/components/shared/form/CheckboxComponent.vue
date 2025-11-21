<template>
  <label class="checkbox-wrapper">
    <input
      type="checkbox"
      class="checkbox-input"
      :checked="modelValue"
      @change="e => emit('update:modelValue', (e.target as HTMLInputElement).checked)"
    />
    <span class="checkbox-label">
      <slot />
    </span>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits(['update:modelValue'])
</script>

<style scoped>
.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  user-select: none;
}

.checkbox-input {
  width: 1rem;
  height: 1rem;
  accent-color: #1c1c1c;
  border: 1px solid #ccc;
  border-radius: 5px;
}

.checkbox-label {
  flex: 1;
}
</style>

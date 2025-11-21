<template>
  <label class="radio-wrapper">
    <input
      type="radio"
      class="radio-input"
      :value="value"
      :checked="modelValue === value"
      @change="emit('update:modelValue', value)"
    />
    <span class="radio-circle"></span>
    <span class="radio-label">
      <slot />
    </span>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string | number
  value: string | number
}>()

const emit = defineEmits(['update:modelValue'])
</script>

<style scoped>
.radio-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  user-select: none;
}

.radio-input {
  appearance: none;
  width: 1rem;
  height: 1rem;
  border: 2px solid #ccc;
  border-radius: 9999px;
  position: relative;
  transition: border-color 0.2s;
}

.radio-input:checked {
  border-color: #1c1c1c;
}

.radio-input:checked::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0.5rem;
  height: 0.5rem;
  background-color: #1c1c1c;
  border-radius: 9999px;
  transform: translate(-50%, -50%);
}

.radio-label {
  flex: 1;
}
</style>

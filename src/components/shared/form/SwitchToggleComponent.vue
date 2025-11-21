<template>
  <label class="switch-wrapper">
    <input
      type="checkbox"
      class="switch-input"
      :checked="modelValue"
      @change="e => {
        const checked = (e.target as HTMLInputElement).checked
        emit('update:modelValue', checked)
        emit('change', checked) 
      }"
    />
    <span class="switch-slider" />
    <span class="switch-label">
      <slot />
    </span>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits(['update:modelValue','change'])
</script>

<style scoped>
.switch-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.switch-input {
  appearance: none;
  width: 2.5rem;
  height: 1.25rem;
  background-color: #ccc;
  border-radius: 9999px;
  position: relative;
  outline: none;
  transition: background-color 0.3s;
}

.switch-input:checked {
  background-color: #1c1c1c; /* blue-500 */
}

.switch-input::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1rem;
  height: 1rem;
  background-color: white;
  border-radius: 50%;
  transition: transform 0.3s;
}

.switch-input:checked::before {
  transform: translateX(1.25rem);
}

.switch-label {
  flex: 1;
}
</style>

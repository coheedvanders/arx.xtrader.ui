<template>
  <div class="color-picker-wrapper">
    <input
      type="color"
      class="color-input"
      :value="modelValue"
      @input="updateColor"
    />
    <div class="color-display" :style="{ backgroundColor: modelValue }"></div>
    <div class="color-info">
      <span class="color-value">{{ modelValue }}</span>
      <button class="copy-btn" @click="copyToClipboard">
        <i class="fas fa-copy"></i> Copy
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

// Update the modelValue when the color changes
const updateColor = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

// Copy the color value to the clipboard
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(props.modelValue)
    alert('Color copied to clipboard!')
  } catch (err) {
    alert('Failed to copy color.')
  }
}
</script>

<style scoped>
.color-picker-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-direction: column;
}

.color-input {
  width: 100%;
  height: 40px;
  border: none;
  cursor: pointer;
  padding: 0;
  border-radius: 5px;
}

.color-display {
  width: 100%;
  height: 40px;
  margin-top: 0.5rem;
  border-radius: 5px;
}

.color-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.color-value {
  font-size: 0.875rem;
  color: #333;
}

.copy-btn {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.3s;
}

.copy-btn:hover {
  background-color: #0056b3;
}
</style>

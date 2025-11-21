<template>
  <div class="radio-group">
    <RadioButtonComponent
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :modelValue="modelValue"
      @update:modelValue="updateValue"
    >
      {{ option.label }}
    </RadioButtonComponent>
  </div>
</template>

<script setup lang="ts">
import RadioButtonComponent from './RadioButtonComponent.vue'

const props = defineProps<{
  modelValue: string | number
  options: { label: string; value: string | number }[]
}>()

const emit = defineEmits(['update:modelValue'])

const updateValue = (val: string | number) => {
  emit('update:modelValue', val)
}
</script>

<style scoped>
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>

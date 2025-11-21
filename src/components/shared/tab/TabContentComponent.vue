<template>
  <div v-if="modelValue === value" class="pt-sm">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
const modelValue = defineModel<string>({ required: true })
const props = defineProps<{
  value: string
}>()
</script>

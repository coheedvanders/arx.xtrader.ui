<template>
  <div class="tabs">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
const modelValue = defineModel<string>({ required: true })
</script>

<template>
  <div class="button-group">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
// No props needed – fully slot-driven
</script>

<style scoped>
.button-group {
  display: inline-flex;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #ccc;
}

.button-group ::v-deep(button) {
  margin: 0;
  border: none;
  background: white;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  cursor: pointer;
  border-right: 1px solid #ccc;
  transition: background 0.2s;
}

.button-group ::v-deep(button:last-child) {
  border-right: none;
}

.button-group ::v-deep(button:hover) {
  background-color: #f2f2f2;
}
</style>

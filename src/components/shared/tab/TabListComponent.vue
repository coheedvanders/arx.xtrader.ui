<template>
  <div class="tab-list flex border-b py-xs px-xs">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
// purely for layout
</script>

<style scoped>
.tab-list{
    display: inline-block;
    background: #f4f4f5;
    border-radius: 0.5rem;
}
</style>
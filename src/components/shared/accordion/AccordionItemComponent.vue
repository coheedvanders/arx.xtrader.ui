<template>
  <div class="accordion-item">
    <slot></slot>
    <div class="divider-wrapper text-center w-full">
        <div class="divider ml-xs d-inline-block"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, provide } from 'vue';

const isOpen = ref(false);
const toggle = () => (isOpen.value = !isOpen.value);
provide('isOpen', isOpen);
provide('toggleAccordion', toggle);
</script>

<style scoped>
.accordion-item {
  
}

.divider-wrapper{
    display: inline-block;
    height: 0px;
}

.divider{
    width:99%
}
</style>
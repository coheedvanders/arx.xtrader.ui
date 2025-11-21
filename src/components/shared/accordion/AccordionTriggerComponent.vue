<template>
  <button class="accordion-trigger px-sm pb-sm pt-md" @click="toggle">
    <div class="trigger-text font-semibold d-inline-block">
        <slot></slot>
    </div>
    <span :class="{ 'rotated': isOpen }">
        <i class="fas fa-chevron-down chevron" ></i>
    </span>
  </button>
</template>

<script setup lang="ts">
import { inject, provide, ref, type Ref } from 'vue';
const isOpen = inject('isOpen') as Ref<boolean>;
const toggle = inject('toggleAccordion') as () => void;
</script>

<style scoped>
.accordion-trigger {
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}



.accordion-trigger:hover .trigger-text{
    text-decoration: underline;
}

.chevron {
  transition: transform 0.2s ease;
}

.rotated .chevron {
  transform: rotate(180deg);
}
</style>
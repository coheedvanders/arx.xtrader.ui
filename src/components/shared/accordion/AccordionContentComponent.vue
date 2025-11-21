<template>
  <transition name="slide">
    <div v-if="isOpen" class="accordion-content py-xs px-sm">
      <slot></slot>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { inject, type Ref } from 'vue';
const isOpen = inject('isOpen') as Ref<boolean>;
</script>

<style scoped>
.accordion-content {

}

/* Sliding transition */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.1s ease;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
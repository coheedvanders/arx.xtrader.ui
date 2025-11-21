<template>
  <component
    :is="tag"
    class="btn font-semibold text-sm"
    :class="[
      `btn--${color}`,
      { 
        'btn--outlined': outlined,
        'btn--bordered': bordered,
        'btn--rounded': rounded,
        'btn--disabled': disabled
      }
    ]"
    :disabled="isButton && disabled"
    v-bind="$attrs"
    @click="handleClick"
  >
    <slot></slot>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  color?: 'primary' | 'secondary' | 'danger' | 'ghost',
  outlined?: boolean,
  bordered?: boolean,
  rounded?: boolean,
  disabled?: boolean,
  href?: string
}>()

const emit = defineEmits(['click'])

const handleClick = (event: MouseEvent) => {
  if (!props.disabled) emit('click', event)
}

const isButton = computed(() => !props.href)
const tag = computed(() => props.href ? 'a' : 'button')
</script>

<style scoped>
.btn {
  padding: 0.5rem 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  display: inline-block;
  text-decoration: none;
  border: 1px solid transparent;
}

/* Color Variants */
.btn--primary {
  background-color: #161616;
  color: white;
}

.btn--primary:hover {
  background-color: #0a0a0a;
}

.btn--secondary {
  background-color: #f4f4f5;
  color: #313131;
}

.btn--secondary:hover {
  background-color: #d7d7d7;
}

.btn--danger {
  background-color: #dc3545;
  color: white;
}

.btn--danger:hover {
  background-color: #c82333;
}

.btn--ghost {
  background-color: transparent;
  color: #333;
}

.btn--ghost:hover {
  background-color: #f1f1f1;
}

/* Styles */
.btn--outlined {
  border: 1px solid currentColor;
}

.btn--bordered {
  border: 1px solid #ccc;
}

.btn--rounded {
  border-radius: 0.5rem;
}

/* Disabled */
.btn--disabled {
  /* background-color: #e0e0e0 !important; */
  color: #999 !important;
  cursor: not-allowed;
  pointer-events: none;
}
</style>

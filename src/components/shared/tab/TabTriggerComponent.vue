<template>
  <button
    class="px-xl py-xs text-sm font-semibold tab-trigger"
    :class="{
      'active': isActive,
      'border-transparent text-gray-500 hover:text-black': !isActive
    }"
    @click="activateTab"
  >
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const modelValue = defineModel<string>({ required: true })
const props = defineProps<{
  value: string
}>()

const isActive = computed(() => modelValue.value === props.value)
const activateTab = () => {
  modelValue.value = props.value
}
</script>


<style scoped>
.tab-trigger{
    background-color: transparent;
    border: none;
    cursor:pointer;
    border-radius: 0.5rem;
}

.tab-trigger.active{
    background-color: white;
}
</style>
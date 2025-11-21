<template>
  <transition name="fade">
    <div v-if="modelValue" class="dialog-backdrop" @click.self="close(false)">
      <div class="dialog pa-lg" :style="{ width, height }">
        <button 
          class="close-dialog" 
          @mouseover="isCloseHovered = true"
          @mouseout="isCloseHovered = false"
          @click="close(true)">
          <span v-if="isCloseHovered">
            <i class="fas fa-circle-notch color-red-2"></i>
          </span>
          <span v-else>
            <i class="fas fa-circle"></i>
          </span>
        </button>
        <slot></slot>
      </div> 
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  modelValue: Boolean,
  showClose: {
    type: Boolean,
    default: true
  },
  isPersistent: {
    type: Boolean,
    default: false
  },
  width: {
    type: String,
    default: "300px"
  },
  height: {
    type: String,
    default: "auto"
  }
})
const emit = defineEmits(['update:modelValue'])

const isCloseHovered = ref(false)

const close = (isProperClose: boolean) => {
    if (props.isPersistent) {
        if (isProperClose) {
            isCloseHovered.value = false;
            emit('update:modelValue', false)    
        }
    } else {
        isCloseHovered.value = false;
        emit('update:modelValue', false)
    }
}
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgb(0 0 0 / 80%);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 50;
}

.dialog {
  background: white;
  border-radius: 8px;
  min-width: 300px;
  max-width: 90%;
  position: relative;
}

.close-dialog {
  border: none;
  background: unset;
  cursor: pointer;
  position: absolute;
  right: 8px;
  top: 8px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

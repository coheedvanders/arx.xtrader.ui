<template>
  <div class="btn-dropdown" :class="{ open: isOpen, split: splitButton }" ref="dropdownRef">
    <!-- Main action button (when in split mode) -->
    <component
      v-if="splitButton"
      :is="tag"
      class="btn split-btn font-semibold text-sm"
      :class="[
        `btn--${color}`,
        { 
          'btn--outlined': outlined,
          'btn--bordered': bordered,
          'btn--rounded-left': rounded,
          'btn--disabled': disabled
        }
      ]"
      :disabled="isButton && disabled"
      @click="$emit('action')"
    >
      <slot name="button">Action</slot>
    </component>

    <!-- Dropdown toggle button -->
    <component
      :is="tag"
      class="btn toggle-btn font-semibold flex items-center justify-center text-sm"
      :class="[
        `btn--${color}`,
        { 
          'btn--outlined': outlined,
          'btn--bordered': bordered,
          'btn--rounded': rounded && !splitButton,
          'btn--rounded-right': rounded && splitButton,
          'btn--disabled': disabled
        }
      ]"
      :disabled="isButton && disabled"
      @click="toggleDropdown"
    >
      <template v-if="!splitButton">
        <slot name="button">Dropdown</slot>
      </template>

      <span :class="{ 'chevron-rotate': isOpen }" v-if="!hideIcon">
        <i class="fas fa-chevron-down text-xs"></i>
      </span>
      
    </component>

    <!-- Dropdown menu -->
     <transition name="fade-slide">
      <teleport to="body">
        <div 
          v-if="isOpen" 
          class="dropdown-menu absolute"
          :style="dropdownStyle"
          @click="handleMenuItemClick"
        >
          <slot name="menu"></slot>
        </div>
      </teleport>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{
  color?: 'primary' | 'secondary' | 'danger' | 'ghost',
  outlined?: boolean,
  bordered?: boolean,
  rounded?: boolean,
  disabled?: boolean,
  hideIcon?: boolean,
  href?: string,
  closeOnSelect?: boolean,
  splitButton?: boolean
}>(), {
  color: 'primary',
  closeOnSelect: true,
  splitButton: false
})

const emit = defineEmits(['action'])

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const toggleDropdown = (event?: MouseEvent) => {
  if (!props.disabled) {
    isOpen.value = !isOpen.value

    if (isOpen.value && dropdownRef.value) {
      const rect = dropdownRef.value.getBoundingClientRect()
      dropdownStyle.value = {
        top: `${rect.bottom + window.scrollY + 4}px`,
        left: `${rect.left + window.scrollX}px`,
        minWidth: `${rect.width}px`
      }
    }
  }
}

const handleMenuItemClick = (event: MouseEvent) => {
  // Check if the clicked element or its parent is a dropdown-item
  const target = event.target as HTMLElement
  const isDropdownItem = target.classList.contains('dropdown-item') || 
                         target.closest('.dropdown-item')
  
  if (isDropdownItem && props.closeOnSelect) {
    isOpen.value = false
  }
}

const isButton = computed(() => !props.href)
const tag = computed(() => props.href ? 'a' : 'button')
const dropdownStyle = ref({})

// Handle click outside
const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
/* Reset button styles to avoid user agent styles */
button {
  appearance: none;
  -webkit-appearance: none;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.btn-dropdown {
  position: relative;
  display: inline-flex;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  transition: all 0.2s ease;
  cursor: pointer;
  font-weight: 600;
  box-sizing: border-box;
  line-height: normal;
  text-align: center;
}

/* Split button styling */
.btn-dropdown.split .split-btn {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.btn-dropdown.split .toggle-btn {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0.5rem;
  min-width: 2.5rem;
}

/* Button variations */
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
  /* color: #333; */
}

.btn--ghost:hover {
  background-color: #f3f4f6;
}

.btn--outlined {
  background-color: transparent !important;
  border: 1px solid currentColor;
}

.btn--outlined.btn--primary {
  color: #161616;
}

.btn--outlined.btn--secondary {
  color: #313131;
}

.btn--outlined.btn--danger {
  color: #dc3545;
}

.btn--bordered {
  border: 1px solid #d1d5db;
}

.btn--rounded {
  border-radius: 0.5rem;
}

.btn--rounded-left {
  border-radius: 0.5rem 0 0 0.5rem;
}

.btn--rounded-right {
  border-radius: 0 0.5rem 0.5rem 0;
}

.btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  min-width: 100%;
  background-color: white;
  border: 1px solid #e5e7eb;
  padding: 0.25rem 0;
  border-radius: 0.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  z-index: 1000;
  text-align: left;
  width: max-content;
}

/* Using :deep instead of ::v-deep for Vue 3 */
:deep(.dropdown-item) {
  padding: 0.5rem 1rem;
  cursor: pointer;
  transition: background 0.2s;
  display: block;
  white-space: nowrap;
}

:deep(.dropdown-item:hover) {
  background-color: #f3f4f6;
}

.toggle-btn .fa-chevron-down {
  transition: transform 0.2s ease;
}

/* Make sure a tags have similar reset */
a.btn {
  text-decoration: none;
}

.toggle-btn .fa-chevron-down {
  transition: transform 0.2s ease;
}

.chevron-rotate .fa-chevron-down {
  transform: rotate(180deg);
}

.toggle-btn .fa-chevron-down {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

.fade-slide-enter-to,
.fade-slide-leave-from {
  opacity: 1;
  transform: translateY(0);
}
</style>
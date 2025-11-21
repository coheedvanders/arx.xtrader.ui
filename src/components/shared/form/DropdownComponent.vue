<template>
  <div class="dropdown-wrapper" ref="dropdownRef">
    <!-- Mobile: Native Select -->
    <select
      v-if="isMobile"
      class="dropdown-native"
      :value="modelValue"
      @change="e => emit('update:modelValue', (e.target as HTMLSelectElement).value)"
    >
      <slot v-if="hasSlot" />
      <option
        v-else
        v-for="option in normalizedOptions"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label }}
      </option>
    </select>

    <!-- Desktop: Custom Dropdown -->
    <div v-else class="dropdown" :class="{ 'dropdown-text': textOnly }">
      <button
        class="dropdown-toggle"
        :class="{ 'text-style': textOnly, 'hover-border': hoverBorder }"
        :style="{ fontSize: props.textSize }"
        @click="toggleDropdown"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
        @focus="isFocused = true"
        @blur="isFocused = false"
      >
        {{ label || 'Select...' }}
        <span v-if="!hideDropdownArrow || (hideDropdownArrow && (isHovered || isFocused))" class="icon">
          <i 
            class="fas fa-chevron-down pl-sm" 
          />
        </span>
      </button>
    </div>
  </div>

  <!-- Dropdown Menu via Teleport -->
  <Teleport to="body">
    <div
      v-if="showDropdown"
      class="dropdown-menu"
      :style="dropdownMenuStyle"
      ref="menuRef"
    >
      <slot v-if="hasSlot" />
      <div
        v-else
        class="dropdown-item"
        v-for="option in normalizedOptions"
        :key="option.value"
        @click="select(option.value)"
      >
        {{ option.label }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watchEffect,
  useSlots,
  nextTick,
  watch,
} from 'vue'

const props = defineProps<{
  modelValue: string | number | undefined
  options?: {
    label: string
    value: string | number
    object: any
  }[]
  textOnly?: boolean
  textSize?: string
  hoverBorder?: boolean
  hideDropdownArrow?: boolean
}>()

const emit = defineEmits(['update:modelValue', 'change'])

const slots = useSlots()
const hasSlot = computed(() => !!slots.default)

const showDropdown = ref(false)
const isMobile = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const label = ref('')

const isHovered = ref(false)
const isFocused = ref(false)

const normalizedOptions = computed(() => props.options ?? [])

const dropdownMenuStyle = ref<Record<string, string>>({})

const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value
}

const select = (value: string | number) => {
  emit('update:modelValue', value)
  emit('change', value)
  showDropdown.value = false
}

watchEffect(() => {
  label.value =
    normalizedOptions.value.find(
      (o) => `${o.value}` === `${props.modelValue}`
    )?.label ?? ''
})

watch(showDropdown, (visible) => {
  if (visible) {
    nextTick(() => {
      updateDropdownPosition()
    })
  }
})

const updateDropdownPosition = () => {
  if (!dropdownRef.value || !menuRef.value) return

  const triggerRect = dropdownRef.value.getBoundingClientRect()

  dropdownMenuStyle.value = {
    position: 'absolute',
    top: `${triggerRect.bottom + window.scrollY}px`,
    left: `${triggerRect.left + window.scrollX}px`,
    zIndex: '9999',
  }

  if(!props.textOnly){
    dropdownMenuStyle.value.minWidth = `${triggerRect.width}px`
  }
}

const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768
}

const handleClickOutside = (e: MouseEvent) => {
  if (
    dropdownRef.value &&
    !dropdownRef.value.contains(e.target as Node) &&
    menuRef.value &&
    !menuRef.value.contains(e.target as Node)
  ) {
    showDropdown.value = false
  }
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.dropdown-wrapper {
  position: relative;
  width: 100%;
}

.dropdown {
  position: relative;
}

.dropdown-toggle {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  background-color: white;
  border-radius: 5px;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dropdown-toggle .icon {
  color: #939393;
}

.dropdown-menu {
  position: absolute;
  background: white;
  border: 1px solid #ccc;
  border-radius: 5px;
  margin-top: 0.25rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.dropdown-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}

.dropdown-item:hover {
  background-color: #f2f2f2;
}

.dropdown-native {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 5px;
  font-size: 0.875rem;
}

/* Text-only styles */
.dropdown-text {
  display: inline-block;
  width: auto;
}

.dropdown-toggle.text-style {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.875rem;
  color: inherit;
  width: auto;
  box-shadow: none;
}

.dropdown-toggle.text-style i {
  margin-left: 0.25rem;
}

.hover-border {
  border-color: white;
}

.hover-border:hover {
  border-color: #d4d4d8;
}

.hover-border:focus {
  border-color: #929292;
}
</style>

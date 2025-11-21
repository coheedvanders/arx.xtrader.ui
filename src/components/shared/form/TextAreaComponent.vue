<template>
  <textarea
    :class="['base-textarea', { 
      'rounded-textarea': rounded, 
      'hover-border': hoverBorder  
    }]"
    :value="modelValue"
    @input="updateValue"
    :rows="rows"
    v-bind="$attrs"
  ></textarea>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string | undefined
  rounded?: boolean
  rows?: number,
  hoverBorder?: boolean
}>()

const emit = defineEmits(['update:modelValue','change'])

const updateValue = (event: Event) => {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  emit('change', target.value)
}
</script>

<style scoped>
.base-textarea {
  padding-top: .5rem;
  padding-bottom: .5rem;
  padding-left: .75rem;
  padding-right: .75rem;
  border: 1px solid #e4e4e7;
  font-size: .875rem;
  line-height: 1.25rem;
  width: 100%;
  border-radius: 5px;
  outline: none;
  resize: vertical;
  transition: border-color 0.2s;
  width:100%
}

.base-textarea:focus {
  border-color: #929292;
}

.rounded-textarea {
  border-radius: 9999px;
}

.hover-border {
  border-color: white;
}

.hover-border:hover {
  border-color: #d4d4d8; /* subtle gray */
}

.hover-border:focus {
  border-color: #929292;
}
</style>

<template>
  <div class="tag-input-wrapper">
    <!-- Display Tags as Chips -->
    <div class="tags-container">
      <ChipComponent
        v-for="(tag, index) in internalTags"
        :key="tag.id"
        :label="tag.label"
        color="secondary"
        closable
        @remove="removeTag(index)"
      />
    </div>

    <!-- Input Field to Add Tags -->
    <input
      v-model="newTag"
      @keydown.enter="addTag"
      @keydown.delete="handleDelete"
      class="tag-input"
      type="text"
      placeholder="Type and press enter to add a tag"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import ChipComponent from '../ChipComponent.vue'

const props = defineProps<{
  modelValue: { id: string | number; label: string }[] // Array of objects with 'id' and 'label'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: { id: string | number; label: string }[]): void
  (e: 'onTagAdded', tag: { id: string | number; label: string }): void
  (e: 'onTagRemoved', tag: { id: string | number; label: string }): void
}>()

const internalTags = ref<{ id: string | number; label: string }[]>([]) // Internal ref for managing tag data
const newTag = ref('') // Temporary ref for the input value

// Watch for changes to v-model (modelValue) and sync with internalTags
watch(
  () => props.modelValue,
  (newVal) => {
    internalTags.value = newVal
  },
  { immediate: true }
)

// Add tag to the tags array
const addTag = () => {
  const tag = newTag.value.trim()
  if (tag && !internalTags.value.some(t => t.label === tag)) {
    const newTagData = { id: Date.now(), label: tag } // Using timestamp as a unique id
    internalTags.value.push(newTagData)
    newTag.value = ''
    emit('update:modelValue', internalTags.value)
    emit('onTagAdded', newTagData)
  }
}

// Remove tag from the tags array
const removeTag = (index: number) => {
  const tag = internalTags.value[index]
  internalTags.value.splice(index, 1)
  emit('update:modelValue', internalTags.value)
  emit('onTagRemoved', tag)
}

// Handle delete key to remove the last tag if any
const handleDelete = (event: KeyboardEvent) => {
  if (event.key === 'Backspace' && !newTag.value && internalTags.value.length > 0) {
    const tag = internalTags.value.pop()!
    emit('update:modelValue', internalTags.value)
    emit('onTagRemoved', tag)
  }
}
</script>

<style scoped>
.tag-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tags-container {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tag-input {
  padding: 0.5rem 1rem;
  border: 1px solid #ccc;
  border-radius: 5px;
  font-size: 0.875rem;
  width: 100%;
  outline: none;
  transition: border-color 0.2s;
}

.tag-input:focus {
  border-color: #929292;
}
</style>

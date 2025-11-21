<template>
  <div class="file-upload-wrapper">
    <!-- Upload Button -->
    <ButtonComponent color="ghost" v-if="props.toggleSelectFileButton && files.length == 0" class="upload-button" @click="triggerFileInput" :disabled="disabled">
      <i class="fas fa-upload"></i> Select File{{ multiple ? 's' : '' }}
    </ButtonComponent>

    <!-- Hidden File Input -->
    <input
      ref="fileInputRef"
      type="file"
      :multiple="multiple"
      :accept="acceptTypes"
      :disabled="disabled"
      class="hidden-input"
      @change="handleFileChange"
    />

    <!-- Selected Files as Chips -->
    <div v-if="files.length" class="file-list">
      <ChipComponent
        color="secondary"
        v-for="(file, index) in files"
        :key="file.name + index"
        :label="`${file.name} (${formatFileSize(file.size)})`"
        closable
        @remove="removeFile(index, file)"
      />
    </div>

    <!-- Error Message -->
    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import ChipComponent from '../ChipComponent.vue'
import ButtonComponent from './ButtonComponent.vue';

const props = defineProps<{
  modelValue: File[]
  accept?: string
  maxSize?: number // in bytes
  multiple?: boolean
  disabled?: boolean
  toggleSelectFileButton?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: File[]): void
  (e: 'file-added', files: File[]): void
  (e: 'file-removed', file: File): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const files = ref<File[]>([...props.modelValue])
const errorMessage = ref('')

watch(() => props.modelValue, (newVal) => {
  files.value = [...newVal]
})

const acceptTypes = computed(() => props.accept || '')

const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const selectedFiles = input.files
  if (!selectedFiles) return

  const validFiles: File[] = []
  const invalids: string[] = []

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i]
    const validSize = !props.maxSize || file.size <= props.maxSize
    const validType = checkFileType(file.name)

    if (validSize && validType) {
      validFiles.push(file)
    } else {
      invalids.push(`${file.name} (${!validSize ? 'too large' : 'invalid type'})`)
    }
  }

  if (invalids.length) {
    errorMessage.value = `Invalid: ${invalids.join(', ')}`
  } else {
    errorMessage.value = ''
  }

  if (!props.multiple) {
    files.value = validFiles.slice(0, 1)
  } else {
    files.value = validFiles
  }

  emit('update:modelValue', files.value)
  if (validFiles.length) emit('file-added', validFiles)

  // Reset file input to allow reselecting the same file
  input.value = ''
}

const removeFile = (index: number, file: File) => {
  files.value.splice(index, 1)
  emit('update:modelValue', files.value)
  emit('file-removed', file)
}

const checkFileType = (name: string) => {
  if (!props.accept) return true
  const allowed = props.accept.split(',').map(ext => ext.trim().toLowerCase())
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return allowed.includes(ext)
}

const formatFileSize = (size: number) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  return `${size.toFixed(2)} ${units[index]}`
}
</script>

<style scoped>
.file-upload-wrapper {
  width: 100%;
}

.hidden-input {
  display: none;
}

.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.error-message {
  color: red;
  margin-top: 0.5rem;
  font-size: 0.875rem;
}
</style>

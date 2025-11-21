<template>
  <div class="datetime-picker">
    <template v-if="parts.includes('MM')">
      <select v-model="month" @change="emitChange">
        <option v-for="m in 12" :key="m" :value="m">{{ pad(m) }}</option>
      </select>
    </template>

    <template v-if="parts.includes('dd')">
      <select v-model="day" @change="emitChange">
        <option v-for="d in daysInMonth" :key="d" :value="d">{{ pad(d) }}</option>
      </select>
    </template>

    <template v-if="parts.includes('yyyy')">
      <select v-model="year" @change="emitChange">
        <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
      </select>
      <span v-if="nextIs('hh')">-</span>
    </template>

    <template v-if="parts.includes('hh')">
      <select v-model="hour" @change="emitChange">
        <option v-for="h in 12" :key="h" :value="h">{{ pad(h) }}</option>
      </select>
      <span>:</span>
    </template>

    <template v-if="parts.includes('mm')">
      <select v-model="minute" @change="emitChange">
        <option v-for="m in 60" :key="m" :value="m">{{ pad(m) }}</option>
      </select>
      <span>:</span>
    </template>

    <template v-if="parts.includes('ss')">
      <select v-model="second" @change="emitChange">
        <option v-for="s in 60" :key="s" :value="s">{{ pad(s) }}</option>
      </select>
    </template>

    <template v-if="parts.includes('tt')">
      <select v-model="ampm" @change="emitChange">
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  modelValue: Date
  format?: string
  mode?: 'date' | 'time' | 'datetime'
  minYear?: number
  maxYear?: number
}>()

const emit = defineEmits(['update:modelValue'])

const now = new Date()
const mode = props.mode || 'datetime'
const format = props.format || (mode === 'date' ? 'MM/dd/yyyy' : mode === 'time' ? 'hh:mm:ss tt' : 'MM/dd/yyyy hh:mm:ss tt')
const parts = format.split(/[^a-zA-Z]+/).filter(Boolean)

const model = ref(new Date(props.modelValue))
const year = ref(model.value.getFullYear())
const month = ref(model.value.getMonth() + 1)
const day = ref(model.value.getDate())
const hour = ref(model.value.getHours() % 12 || 12)
const minute = ref(model.value.getMinutes())
const second = ref(model.value.getSeconds())
const ampm = ref(model.value.getHours() >= 12 ? 'PM' : 'AM')

const maxYear = props.maxYear || now.getFullYear()
const years = computed(() => {
  const min = props.minYear || 1900
  return Array.from({ length: maxYear - min + 1 }, (_, i) => min + i)
})

const daysInMonth = computed(() => {
  return new Date(year.value, month.value, 0).getDate()
})

const pad = (n: number) => n.toString().padStart(2, '0')

const nextIs = (target: string) => {
  const currentIndex = parts.findIndex(p => p === target)
  return currentIndex !== -1 && currentIndex < parts.length - 1
}

const emitChange = () => {
  const h = ampm.value === 'PM' ? (hour.value % 12) + 12 : hour.value % 12
  const date = new Date(
    year.value,
    month.value - 1,
    day.value,
    parts.includes('hh') ? h : 0,
    parts.includes('mm') ? minute.value : 0,
    parts.includes('ss') ? second.value : 0
  )
  emit('update:modelValue', date)
}

watch(() => props.modelValue, val => {
  model.value = new Date(val)
  year.value = model.value.getFullYear()
  month.value = model.value.getMonth() + 1
  day.value = model.value.getDate()
  hour.value = model.value.getHours() % 12 || 12
  minute.value = model.value.getMinutes()
  second.value = model.value.getSeconds()
  ampm.value = model.value.getHours() >= 12 ? 'PM' : 'AM'
})
</script>

<style scoped>
.datetime-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

select {
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.875rem;
  min-width: 60px;
}
</style>
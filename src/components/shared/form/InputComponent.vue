<template>
  <input
    :type="type === 'numeric' ? 'number' : 'text'"
    :class="[
      'base-input',
      { 
        'rounded-input': rounded,
        'hover-border': hoverBorder 
      }
    ]"
    :value="modelValue"
    @input="updateValue"
    @change="updateValue"
    @click.stop=""
    :min="type === 'numeric' ? min : undefined"
    :max="type === 'numeric' ? max : undefined"
    v-bind="$attrs"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string | number | null | undefined
  type?: 'text' | 'numeric'
  rounded?: boolean
  min?: number
  max?: number
  hoverBorder?: boolean
  mask?: string
}>()

const emit = defineEmits(['update:modelValue'])

const updateValue = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value: string | number = target.value;

  if (props.type === 'numeric') {
    let num = Number(value);
    if (!isNaN(num)) {
      if (props.min !== undefined) num = Math.max(props.min, num);
      if (props.max !== undefined) num = Math.min(props.max, num);
      value = num;
    }
  }

  emit('update:modelValue', value);
};
</script>

<script setup lang="ts">

</script>


<style scoped>
.base-input {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  width: 100%;
  border-radius: 5px;
  outline: none;
  transition: border-color 0.2s;
  border: 1px solid #e4e4e7;
}

.base-input:focus {
  border-color: #929292;
}

.rounded-input {
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

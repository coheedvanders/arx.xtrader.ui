<template>
  <div v-if="isVisible" :class="['alert', alertTypeClass]" role="alert">
    <button
      v-if="dismissible"
      type="button"
      class="close"
      @click="closeAlert"
      aria-label="Close"
    >
      <span aria-hidden="true">&times;</span>
    </button>
    <slot></slot> <!-- This renders the content passed from parent -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

const props = defineProps({
  type: {
    type: String,
    default: 'info',
  },
  dismissible: {
    type: Boolean,
    default: true,
  },
  duration: {
    type: Number,
    default: 0, // Auto-close after 5 seconds
  },
});

const isVisible = ref(true);

const alertTypeClass = computed(() => `alert-${props.type}`);

const closeAlert = () => {
  isVisible.value = false;
};

const emit = defineEmits(['closed']);

// Auto-close the alert after the specified duration
onMounted(() => {
  if (props.duration > 0) {
    setTimeout(() => {
      isVisible.value = false;
    }, props.duration);
  }
});

// Watch visibility state
watch(isVisible, (newValue) => {
  if (!newValue) {
    emit('closed');
  }
});
</script>

<style scoped>
.alert {
  padding: 8px;
  border-radius: 5px;
  margin: 10px 0;
  transition: opacity 0.5s ease;
  display: flex;
  align-items: center;   /* vertical centering */
  gap: 8px;              /* space between text and button */
}

.alert-success {
  background-color: #28a745;
  color: white;
}

.alert-danger {
  background-color: #dc3545;
  color: white;
}

.alert-info {
  background-color: #17a2b8;
  color: white;
}

.alert-warning {
  background-color: #ffc107;
  color: black;
}

.alert-ghost{
  background-color: #e6e6e6;
  color: rgb(58, 58, 58);
  border-color: gray;
}

.close {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.5em;
  cursor: pointer;
}

.close span {
  font-weight: bold;
}
</style>

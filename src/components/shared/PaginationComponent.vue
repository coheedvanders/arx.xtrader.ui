<template>
  <div class="pagination">
    <button :disabled="page === 1" @click="goToPage(1)">«</button>
    <button :disabled="page === 1" @click="goToPage(page - 1)">‹</button>

    <template v-for="(p, index) in pagesToShow" :key="index">
      <button
        v-if="p.type === 'page'"
        :class="{ active: page === p.label }"
        @click="goToPage(Number(p.label))"
      >
        {{ p.label }}
      </button>
      <span v-else class="ellipsis">…</span>
    </template>

    <button :disabled="page === totalPages" @click="goToPage(page + 1)">›</button>
    <button :disabled="page === totalPages" @click="goToPage(totalPages)">»</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  page: number
  totalItems: number
  itemsPerPage: number
}>()

const emit = defineEmits(['update:page'])

const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.totalItems / props.itemsPerPage))
)

const goToPage = (newPage: number) => {
  const clamped = Math.min(Math.max(newPage, 1), totalPages.value)
  emit('update:page', clamped)
}

interface PageItem {
  type: 'page' | 'ellipsis'
  label: number | string
}

const pagesToShow = computed((): PageItem[] => {
  const pages: PageItem[] = []
  const current = props.page
  const total = totalPages.value

  if (total <= 7) {
    // Show all pages if there are 7 or fewer
    for (let i = 1; i <= total; i++) {
      pages.push({ type: 'page', label: i })
    }
  } else {
    // Always show first page
    pages.push({ type: 'page', label: 1 })
    
    // Show ellipsis if current page is far from the beginning
    if (current > 3) {
      pages.push({ type: 'ellipsis', label: 'start' })
    } else {
      // If we're near the start, show more beginning pages
      pages.push({ type: 'page', label: 2 })
    }

    // Show pages around current page
    const startPage = Math.max(current > 3 ? current - 1 : 3, 2)
    const endPage = Math.min(current < total - 2 ? current + 1 : total - 2, total - 1)
    
    for (let i = startPage; i <= endPage; i++) {
      // Avoid duplicating pages that might already be added
      if (i > 2 && i < total - 1) {
        pages.push({ type: 'page', label: i })
      }
    }

    // Show ellipsis if current page is far from the end
    if (current < total - 2) {
      pages.push({ type: 'ellipsis', label: 'end' })
    } else {
      // If we're near the end, show more ending pages
      pages.push({ type: 'page', label: total - 1 })
    }
    
    // Always show last page
    pages.push({ type: 'page', label: total })
  }

  return pages
})
</script>

<style scoped>
.pagination {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}

.pagination button,
.pagination .ellipsis {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border: 1px solid #ccc;
  background: white;
  cursor: pointer;
  border-radius: 4px;
  min-width: 2rem;
  text-align: center;
}

.pagination button.active {
  background-color: #161616;
  color: white;
  font-weight: bold;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ellipsis {
  padding: 0.25rem 0.5rem;
  color: #999;
  user-select: none;
}
</style>
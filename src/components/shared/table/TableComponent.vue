<template>
  <div class="table-wrapper" :class="wrapperClasses">
    <table class="table">
      <slot name="header"></slot>
      <slot name="body"></slot>
      <slot name="footer"></slot>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  borderType?: 'all' | 'rows' | 'columns' | 'none'
  alternateRowColor?: boolean,
  outerBorder?: boolean
}>()

const wrapperClasses = computed(() => ({
  'border-all': props.borderType === 'all',
  'border-rows': props.borderType === 'rows',
  'border-columns': props.borderType === 'columns',
  'border-none': props.borderType === 'none',
  'alternate-rows': props.alternateRowColor,
  'outer-border': props.outerBorder
}))
</script>

<style>
.table-wrapper {
  border-radius: 5px;
  max-height: 100%;
}

.table-wrapper.outer-border{
  border: 1px solid #e4e4e7; /* outer border */
}

/* Table styles */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  border: none; /* prevent double border */
  border-radius: 5px;
}

/* Header & cell padding */
.table th,
.table td {
  padding: 0.25rem 0.5rem;
  text-align: left;
}

.table tfoot td{
    border-top: 1px solid #e4e4e7;
}

/* Border styles */
.border-all .table th:first-child{
    border-bottom: 1px solid #e4e4e7;  
}

.border-all .table th {
    border-bottom: 1px solid #e4e4e7;  
}

.border-all .table th:not(:last-child){
    border-right: 1px solid #e4e4e7;
}

.border-all .table tr:not(:last-child) td{
    border-bottom: 1px solid #e4e4e7;
}

.border-all .table td:not(:last-child){
    border-right: 1px solid #e4e4e7;
}

.border-rows .table tr:not(:last-child) {
  border-bottom: 1px solid #e4e4e7;
}

.border-rows .table th{
    border-bottom: 1px solid #e4e4e7;
}

.border-columns .table th,
.border-columns .table td {
  border-right: 1px solid #e4e4e7;
}

.border-columns .table th:last-child,
.border-columns .table td:last-child {
  border-right: none;
}

.border-none .table th,
.border-none .table td {
  border: none !important;
}

/* Alternate row color */
.alternate-rows tbody tr:nth-child(even) {
  background-color: #f9f9f9;
}
</style>

<!-- AppHeader.vue -->
<template>
  <header class="app-header">
    <!-- Left: Logo or Label -->
    <div class="left">
      <router-link to="/" class="logo-container">
        <img src="/src/assets/images/x-airo-logo.png" class="logo" alt="Z-Bionix" />
        <span class="logo-text">z-Bionix</span>
      </router-link>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

// Nothing needed yet, logo is handled by router-link
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: white;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  padding: 0.75rem 1.5rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.left,
.center,
.right {
  flex: 1;
}

.center {
  text-align: center;
}

.right {
  text-align: right;
  position: relative;
}

.search-input {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  width: 60%;
  max-width: 300px;
}

.account-btn {
  background: none;
  border: none;
  font-weight: 500;
  cursor: pointer;
}

.dropdown-menu {
  position: absolute;
  right: 0;
  top: 2.5rem;
  background: white;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 10;
  padding: 0.5rem;
  width: 170px;
}

.dropdown-menu ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.dropdown-menu li a {
  display: block;
  padding: 0.5rem;
  text-decoration: none;
  color: #333;
}

.dropdown-menu li a:hover {
  background-color: #f0f0f0;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 500;
  font-size: 18px;
  cursor: pointer;
  text-decoration: none;
  color: #000;
  transition: all 0.3s ease;
  padding: 0.5rem 0;
}

.logo-container:hover {
  opacity: 0.8;
  transform: translateX(-2px);
}

.logo {
  width: 32px;
  height: auto;
  transition: all 0.3s ease;
}

.logo-container:hover .logo {
  transform: scale(1.05);
}

.logo-text {
  line-height: 1;
  letter-spacing: 0.5px;
}
</style>
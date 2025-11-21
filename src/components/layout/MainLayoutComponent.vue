<template>
  <div class="app-layout">
    <HeaderComponent />

    <div class="layout-body">

      <main class="main-content">
        <router-view :key="$route.fullPath" />
      </main>

      <NotificationComponent />
    </div>
  </div>
</template>

<script setup lang="ts">
import HeaderComponent from '../navigation/HeaderComponent.vue';
import NotificationComponent from '../shared/NotificationComponent.vue';

</script>

<style scoped>


html,
body {
  height: 100%;
  font-family: sans-serif;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}



.layout-body {
  display: flex;
  flex: 1;
  min-height: 0; /* important for proper flex scrolling */
  overflow: hidden;
}

.main-content {
  flex: 1;
  padding: 1.5rem;
  overflow-y: auto;
  min-width: 0; /* ensures flex children don't overflow */
}

</style>

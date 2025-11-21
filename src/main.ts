import './assets/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

import '@fortawesome/fontawesome-free/css/all.min.css';
import '@fortawesome/fontawesome-free/js/all.min.js';
import { useNotificationStore } from './stores/notificationStore';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

async function initApp() {
  // Init Vue app
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(router);

  // Mount the app
  app.mount('#app');

  // Now that app is mounted and pinia is usable, expose the store
  window.AIRO = window.AIRO || {};
  window.AIRO.notificationStore = useNotificationStore();

  // Optional: expose router too
  window.__AIRO_ROUTER__ = router;
}

initApp();

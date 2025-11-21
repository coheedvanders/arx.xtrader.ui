<template>
  <!-- Notification Groups by Location -->
    <div
      v-for="loc in locations"
      :key="loc"
      class="notification-group"
      :class="loc"
    >
      <div
        v-for="(note, index) in notificationsByLocation(loc)"
        :key="`${loc}-${index}`"
        class="notification"
        :class="note.type"
      >
        <div>
            <strong>{{ note.title }}</strong>
        </div>
        <div>
            {{ note.message }}
        </div>
      </div>
    </div>

    <transition name="fade">
      <div v-if="notificationStore.preloader.visible" class="preloader-overlay">
        <div class="preloader-box">
          <!-- <div class="preloader-line-loader">
            <div class="line-bar"></div>
          </div> -->
          <LinesPreLoader />
          <h2 class="preloader-title">{{ notificationStore.preloader.title }}</h2>
          <p class="preloader-message">{{ notificationStore.preloader.message }}</p>
        </div>
      </div>
    </transition>

    <!-- Alert Modal -->
    <div v-if="notificationStore.alert.visible" class="modal">
      <div class="modal-content" :class="notificationStore.alert.type">
        <div class="floater-wrapper text-center w-full">
          <div class="floater"></div>
        </div>
        <h3 class="font-semibold">{{ notificationStore.alert.title }}</h3>
        <p class="mt-md alert-message">{{ notificationStore.alert.message }}</p>
        <div class="text-right">
            <ButtonComponent rounded :color="'ghost'" @click="notificationStore.hideAlert()">close</ButtonComponent>
        </div>
      </div>
    </div>

    <!-- Dialog Modal -->
    <div v-if="notificationStore.dialog.visible" class="modal">
      <div class="modal-content">
        <h3 class="font-semibold">{{ notificationStore.dialog.title }}</h3>
        <p class="mt-md">{{ notificationStore.dialog.message }}</p>
        <div class="dialog-buttons">
          <ButtonComponent
            v-for="(btn, i) in notificationStore.dialog.buttons"
            :key="i"
            :class="btn.type || 'primary'"
            @click="handleDialogButton(btn)"
          >
            {{ btn.label }}
          </ButtonComponent>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { useNotificationStore } from '@/stores/notificationStore';
import { computed } from 'vue';
import ButtonComponent from './form/ButtonComponent.vue';
import LinesPreLoader from './preloader/LinesPreLoader.vue';

const notificationStore = useNotificationStore();

function handleDialogButton(button: any) {
  button.onClick();
  notificationStore.hideDialog();
}

// Define valid positions
const locations = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

// Filter notifications by location
const notificationsByLocation = (location: string) =>
  notificationStore.notifications.filter(n => (n.location || 'top-right') === location);
</script>

<style scoped>
.notification-wrapper {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

/* Group container for different positions */
.notification-group {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: all;
}

/* Top positions */
.top-left     { top: 10px; left: 10px; align-items: flex-start; }
.top-center   { top: 10px; left: 50%; transform: translateX(-50%); align-items: center; }
.top-right    { top: 10px; right: 10px; align-items: flex-end; }

/* Middle verticals */
.middle-left  { top: 50%; left: 10px; transform: translateY(-50%); align-items: flex-start; }
.middle-right { top: 50%; right: 10px; transform: translateY(-50%); align-items: flex-end; }

/* Bottom positions */
.bottom-left  { bottom: 10px; left: 10px; align-items: flex-start; }
.bottom-center{ bottom: 10px; left: 50%; transform: translateX(-50%); align-items: center; }
.bottom-right { bottom: 10px; right: 10px; align-items: flex-end; }

.notification {
  padding: 10px 16px;
  border-radius: 4px;
  color: white;
  min-width: 200px;
  max-width: 300px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  background: #333;
  animation: fadeIn 0.2s ease-out;
  z-index: 99999;
}

.notification.success { background-color: #38a169; }
.notification.warning { background-color: #dd6b20; }
.notification.info    { background-color: #3182ce; }
.notification.danger  { background-color: #e53e3e; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Modal and buttons: unchanged from previous */
.modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-content {
  position: relative;
  background: white;
  padding: 20px;
  border-radius: 8px;
  min-width: 300px;
}

/* .modal-content.success   { border-top: 5px solid #38a169; border-bottom: 5px solid #38a169; }
.modal-content.warning   { border-top: 5px solid #dd6b20; border-bottom: 5px solid #dd6b20; }
.modal-content.info      { border-top: 5px solid #3182ce; border-bottom: 5px solid #3182ce; }
.modal-content.danger    { border-top: 5px solid #e53e3e; border-bottom: 5px solid #e53e3e; } */

.floater-wrapper{
  position:absolute;
  width: 100%;
  left: 1px;
  top: -14px;
}

.floater-wrapper .floater{
  display:inline-block;
  border-top: 3px solid;
  width: 115px;
  border-bottom-left-radius: 10px;
  border-bottom-right-radius: 10px;
}

.modal-content.success .floater-wrapper .floater{ border-color:#38a169; }
.modal-content.warning .floater-wrapper .floater{ border-color:#dd6b20; }
.modal-content.info .floater-wrapper .floater{ border-color:#3182ce; }
.modal-content.danger .floater-wrapper .floater{ border-color:#e53e3e; }




.dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 1rem;
}

button.primary {
  background: #3182ce;
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
}

button.secondary {
  background: #e2e8f0;
  color: #1a202c;
  padding: 6px 12px;
  border-radius: 4px;
}

button.danger {
  background: #e53e3e;
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
}

/* PRE LOADER */
.preloader-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preloader-box {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  text-align: center;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

/* Line Loader */
.preloader-line-loader {
  position: relative;
  height: 4px;
  background-color: #e2e8f0; /* light gray base */
  overflow: hidden;
  border-radius: 4px;
  margin-bottom: 1.5rem;
}

.line-bar {
  position: absolute;
  width: 40%;
  height: 100%;
  background-color: #f3a641; /* blue highlight */
  animation: line-slide 1.2s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes line-slide {
  0%   { left: -40%; }
  50%  { left: 60%; }
  100% { left: 100%; }
}

.preloader-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 0.5rem;
}

.preloader-message {
  color: #4a5568;
}

.alert-message {
  margin-top: 1rem;
  white-space: pre-wrap;
  text-align: left;
}
</style>
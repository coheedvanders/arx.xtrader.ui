// stores/notificationStore.ts
import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';

type NotificationType = 'success' | 'warning' | 'info' | 'danger';

interface PreLoaderPayload {
  title: string;
  message: string;
  visible: boolean;
}

interface NotificationPayload {
  type: NotificationType;
  location?: string;
  title: string;
  message: string;
}

interface AlertPayload {
  type: NotificationType;
  title: string;
  message: string;
}

interface DialogButton {
  label: string;
  type?: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

interface DialogPayload {
  title: string;
  message: string;
  buttons: DialogButton[];
  visible: boolean;
}

export const useNotificationStore = defineStore('notification-store', () => {
  const preloader = reactive<PreLoaderPayload>({
    title: '',
    message: '',
    visible: false,
  });

  // Toast / banner notifications
  const notifications = ref<NotificationPayload[]>([]);

  // Alert modal (single OK/Cancel)
  const alert = reactive<AlertPayload & { visible: boolean }>({
    type: 'info',
    title: '',
    message: '',
    visible: false,
  });

  // Dialog modal (multi-button)
  const dialog = reactive<DialogPayload>({
    title: '',
    message: '',
    buttons: [],
    visible: false,
  });

  function showPreLoader(title: string, message: string){
    preloader.title = title;
    preloader.message = message;
    preloader.visible = true;
  }

  function hidePreLoader(){
    preloader.title = '';
    preloader.message = '';
    preloader.visible = false;
  }

  function showNotification(type: NotificationType, location: string, title: string, message: string) {
    notifications.value.push({ type, location, title, message });

    // Auto-remove after 4 seconds
    setTimeout(() => {
      notifications.value.shift();
    }, 4000);
  }

  function showAlert(type: NotificationType, title: string, message: string) {
    alert.type = type;
    alert.title = title;
    alert.message = message;
    alert.visible = true;
  }

  function hideAlert() {
    alert.visible = false;
  }

  function showDialog(title: string, message: string, configuration: DialogButton[]) {
    dialog.title = title;
    dialog.message = message;
    dialog.buttons = configuration;
    dialog.visible = true;
  }

  function hideDialog() {
    dialog.visible = false;
  }

  function sendNotification(symbol: string, side: string) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const isBuy = side.toUpperCase() === 'BUY';
      const color = isBuy ? '%234CAF50' : '%23F44336'; // Green for BUY, Red for SELL
      const bgColor = isBuy ? '4CAF50' : 'F44336';
      
      new Notification(`${symbol} - ${side.toUpperCase()} Signal`, {
        icon: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23${bgColor}"/></svg>`,
        tag: symbol, // Replaces previous notification for same symbol
        requireInteraction: false
      })
    }
  }

  return {
    preloader,
    notifications,
    alert,
    dialog,
    showPreLoader,
    hidePreLoader,
    showNotification,
    showAlert,
    hideAlert,
    showDialog,
    hideDialog,
    sendNotification
  };
});

/**
 * firebase-messaging-sw.js — FCM background push handler.
 * ---------------------------------------------------------------------
 * Must live at the site root (not bundled by Vite) so it can register with
 * scope "/". Firebase's config is NOT secret (it's already embedded in the
 * main JS bundle via VITE_FIREBASE_*), but this file itself is a plain
 * static asset with no build-time env access -- so the client passes the
 * config through the registration URL's query string instead of a build
 * step. See src/lib/pushNotifications.ts for the registration call.
 */
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

if (firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'سِين';
    const body = (payload.notification && payload.notification.body) || '';
    const link = (payload.fcmOptions && payload.fcmOptions.link) || '/';
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      data: { link },
    });
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = (event.notification.data && event.notification.data.link) || '/';
    event.waitUntil(self.clients.openWindow(link));
  });
}

// からだのおしらせ — Service Worker v1
const CACHE = 'karada-v1';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(self.clients.claim());
});

// Push notification received
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(err) { data = {title:'からだのおしらせ', body: e.data ? e.data.text() : ''}; }
  
  var options = {
    body:    data.body  || 'お知らせがあります',
    icon:    data.icon  || '/icon-192.png',
    badge:   '/icon-192.png',
    tag:     data.tag   || 'karada',
    data:    { url: data.url || '/' },
    actions: [
      { action: 'done',   title: '✅ できた' },
      { action: 'snooze', title: '⏰ あとで' },
    ]
  };
  
  e.waitUntil(
    self.registration.showNotification(data.title || 'からだのおしらせ', options)
  );
});

// Notification click
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var action = e.action;
  var url    = e.notification.data.url || '/';
  var tag    = e.notification.tag;
  
  e.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(clients) {
      // Try to focus existing window
      for (var i = 0; i < clients.length; i++) {
        var client = clients[i];
        if (client.url.includes(self.location.origin)) {
          client.postMessage({ type: 'notif_action', action: action, tag: tag });
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url + '?action=' + action + '&tag=' + tag);
    })
  );
});

// Background sync: schedule notifications
self.addEventListener('periodicsync', function(e) {
  if (e.tag === 'check-reminders') {
    e.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  // This runs in background — check scheduled times
  var clients = await self.clients.matchAll();
  if (clients.length > 0) return; // App is open, skip (app handles it)
  // Could check IndexedDB for scheduled items here
}

// からだのおしらせ — Service Worker v3
// ネットワーク優先・キャッシュなし戦略
// ホーム画面追加後の空白ページ問題を防ぐ

const SW_VERSION = 'v3';

// インストール：即座に有効化
self.addEventListener('install', function(event) {
  console.log('[SW] install', SW_VERSION);
  self.skipWaiting();
});

// 有効化：古いキャッシュを全削除
self.addEventListener('activate', function(event) {
  console.log('[SW] activate', SW_VERSION);
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          console.log('[SW] deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// フェッチ：常にネットワークから取得（キャッシュしない）
self.addEventListener('fetch', function(event) {
  // GETリクエストのみ処理
  if (event.request.method !== 'GET') return;

  // ナビゲーション（ページ遷移）は必ずネットワーク優先
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(function(response) {
          return response;
        })
        .catch(function(error) {
          console.log('[SW] navigate fetch failed:', error);
          // オフライン時のみキャッシュから返す
          return caches.match(event.request);
        })
    );
    return;
  }

  // その他のリソースもネットワーク優先
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .catch(function() {
        return caches.match(event.request);
      })
  );
});

// プッシュ通知を受信
self.addEventListener('push', function(event) {
  console.log('[SW] push received');
  var data = {};
  try {
    data = event.data.json();
  } catch(e) {
    data = {
      title: 'からだのおしらせ',
      body: event.data ? event.data.text() : 'お知らせがあります'
    };
  }

  var options = {
    body:    data.body  || 'お知らせがあります',
    icon:    '/yururun/icon-192.png',
    badge:   '/yururun/icon-192.png',
    tag:     data.tag   || 'yururun',
    renotify: true,
    data: {
      url: data.url || '/yururun/',
      tag: data.tag || ''
    },
    actions: [
      { action: 'done',   title: '✅ できた' },
      { action: 'snooze', title: '⏰ あとで' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'からだのおしらせ',
      options
    )
  );
});

// 通知をタップした時
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] notification click:', event.action);
  event.notification.close();

  var action = event.action || 'open';
  var tag    = event.notification.data ? event.notification.data.tag : '';
  var url    = event.notification.data ? event.notification.data.url : '/yururun/';

  // アクション付きURLを作成
  if (action && tag) {
    url = url + '?action=' + action + '&tag=' + tag;
  }

  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clients) {
      // 既存のウィンドウがあればフォーカス＋メッセージ送信
      for (var i = 0; i < clients.length; i++) {
        var client = clients[i];
        if (client.url.indexOf('karada-oshirase') !== -1) {
          client.postMessage({
            type: 'notif_action',
            action: action,
            tag: tag
          });
          return client.focus();
        }
      }
      // なければ新しいウィンドウを開く
      return self.clients.openWindow(url);
    })
  );
});

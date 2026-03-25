// ゆるるん — Service Worker v4
// ネットワーク優先・キャッシュなし戦略
// ホーム画面追加後の空白ページ問題を防ぐ

const SW_VERSION = 'v4';

// 処理待ち通知をIDBに保存（postMessageが届かなかった場合のフォールバック）
function storePendingNotif(data) {
  var req = indexedDB.open('yururun_badge', 1);
  req.onupgradeneeded = function(e) { e.target.result.createObjectStore('kv'); };
  req.onsuccess = function(e) {
    try { e.target.result.transaction('kv','readwrite').objectStore('kv').put(data,'pending_notif'); } catch(err) {}
  };
}

// IndexedDB ヘルパー — unread通知数をSW↔ページ間で共有
function badgeIDB(mode, value) {
  return new Promise(function(resolve) {
    var req = indexedDB.open('yururun_badge', 1);
    req.onupgradeneeded = function(e) { e.target.result.createObjectStore('kv'); };
    req.onerror = function() { resolve(0); };
    req.onsuccess = function(e) {
      var db = e.target.result;
      if (mode === 'write') {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, 'unread');
        tx.oncomplete = function() { resolve(value); };
        tx.onerror    = function() { resolve(0); };
      } else {
        var r = db.transaction('kv', 'readonly').objectStore('kv').get('unread');
        r.onsuccess = function(ev) { resolve(ev.target.result || 0); };
        r.onerror   = function()   { resolve(0); };
      }
    };
  });
}

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
      title: 'ゆるるん',
      body: event.data ? event.data.text() : 'お知らせがあります'
    };
  }

  // 同じ項目の通知でも時刻が違えば別通知として表示するためタイムスタンプを付与
  var notifTag = (data.tag || 'yururun') + '-' + Date.now();
  var options = {
    body:    data.body  || 'お知らせがあります',
    icon:    '/yururun/icon-192.png',
    badge:   '/yururun/icon-192.png',
    tag:     notifTag,
    renotify: false,
    data: {
      url: data.url || 'https://dangomushi56.github.io/yururun/',
      tag: data.tag || ''
    },
    actions: [
      { action: 'done',   title: '✅ できた' },
      { action: 'skip',   title: '⏭ スキップ' },
      { action: 'snooze', title: '⏰ あとで' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ゆるるん', options)
      .then(function() {
        // IndexedDB のカウントを +1 してバッジに反映
        return badgeIDB('read').then(function(count) {
          var n = count + 1;
          return badgeIDB('write', n).then(function() {
            // iOSではSWからsetAppBadgeが動かない場合があるが試みる
            if ('setAppBadge' in self.navigator) {
              return self.navigator.setAppBadge(n).catch(function(){});
            }
          });
        });
      })
      .then(function() {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .then(function(clients) {
        // 開いているウィンドウにも通知してページ側でバッジ同期
        clients.forEach(function(c) {
          c.postMessage({ type: 'push_received', tag: data.tag || '' });
        });
      })
  );
});

// 通知をタップした時
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] notification click:', event.action);
  event.notification.close();

  var action  = event.action || '';
  var tag     = event.notification.data ? event.notification.data.tag : '';
  var title   = event.notification.title || '';
  var body    = event.notification.body  || '';
  var baseUrl = 'https://dangomushi56.github.io/yururun/';
  var url;

  // 通知をタップしたのでIDBとバッジをリセット
  badgeIDB('write', 0);
  if ('clearAppBadge' in self.navigator) {
    self.navigator.clearAppBadge().catch(function(){});
  }

  // IDBに処理待ちを保存（postMessageが届かない場合のフォールバック）
  storePendingNotif({
    tag: tag, title: title, body: body, action: action, ts: Date.now()
  });

  // 通知本体タップ → モーダル表示URL（アプリが閉じている場合に使用）
  if (action === 'done' || action === 'skip' || action === 'snooze') {
    url = baseUrl + '?source=push&actionId=' + tag + '&action=' + action;
  } else {
    url = baseUrl + '?source=push&actionId=' + tag;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        var client = clients[i];
        if (client.url.indexOf('yururun') !== -1) {
          // アプリが開いている場合はpostMessageで即時処理（IDBのフォールバックより速い）
          if (action === 'done' || action === 'skip' || action === 'snooze') {
            client.postMessage({ type: 'notif_action', action: action, tag: tag });
          } else {
            client.postMessage({ type: 'show_notif_modal', tag: tag, title: title, body: body });
          }
          return client.focus();
        }
      }
      // 閉じていれば新しいウィンドウを開く
      return self.clients.openWindow(url);
    })
  );
});

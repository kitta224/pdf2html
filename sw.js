// Service Worker for PDF to HTML Converter PWA
const CACHE_NAME = 'pdf2html-v1.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/pdf.js',
  '/js/pdf.worker.js',
  '/manifest.json',
  '/share-target.html'
];

// インストール時にキャッシュを作成
self.addEventListener('install', (event) => {
  console.log('Service Worker installing.');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// フェッチ時にキャッシュから返す
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // キャッシュにあれば返す、なければネットワークから取得
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// アクティベート時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating.');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// メッセージイベントの処理（共有ファイル用）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHARED_FILE') {
    // 共有ファイル情報をログ
    console.log('Shared file processed:', event.data);
  }
});

// Web Share Target APIの処理
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/share-target')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file');

          if (file && file.type === 'application/pdf') {
            // ファイルをクライアントに送信
            const clients = await self.clients.matchAll();
            clients.forEach(client => {
              client.postMessage({
                type: 'SHARED_FILE_RECEIVED',
                file: {
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  lastModified: file.lastModified
                }
              });
            });

            // share-target.htmlにリダイレクト
            return Response.redirect('/share-target.html?shared=true', 302);
          } else {
            return new Response('Invalid file type', { status: 400 });
          }
        } catch (error) {
          console.error('Share target error:', error);
          return new Response('Error processing shared file', { status: 500 });
        }
      })()
    );
  } else {
    // 通常のキャッシュ処理
    event.respondWith(
      caches.match(event.request)
        .then((response) => response || fetch(event.request))
    );
  }
});
// Service Worker for PDF to HTML Converter PWA
const CACHE_NAME = 'pdf2html-v1.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
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
        // キャッシュ失敗してもインストールを続行
        return cache.addAll(urlsToCache).catch((error) => {
          console.warn('Some resources failed to cache:', error);
          // 個別にキャッシュを試行
          return Promise.allSettled(
            urlsToCache.map(url =>
              cache.add(url).catch(err =>
                console.warn(`Failed to cache ${url}:`, err)
              )
            )
          );
        });
      })
  );
  self.skipWaiting();
});

// フェッチ時にキャッシュから返す（ランタイムキャッシュ戦略）
self.addEventListener('fetch', (event) => {
  // Web Share Target APIの処理
  if (event.request.url.includes('/share-target')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file');

          if (file && file.type === 'application/pdf') {
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
    return;
  }

  // 外部リソース（CDNなど）はネットワーク優先（キャッシュしない）
  if (event.request.url.includes('cdnjs.cloudflare.com') ||
      event.request.url.includes('fonts.googleapis.com') ||
      event.request.url.includes('chrome-extension://')) {
    return fetch(event.request);
  } else {
    // 内部リソースはキャッシュ優先
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          // キャッシュにない場合はネットワークから取得してキャッシュ
          return fetch(event.request).then((response) => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return response;
          });
        })
    );
  }
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

// Web Share Target APIの処理をメインのfetchハンドラーに統合
// メインのfetchイベントリスナー内で処理
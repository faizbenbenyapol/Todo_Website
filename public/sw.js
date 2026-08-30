/* Service worker ของ Eisenhower Board — ทำให้เปิดแอปได้แม้เน็ตหลุด */
const APP_VERSION = '0.7.0';
const CACHE_NAME = `eisenhower-board-${APP_VERSION}`;
const OFFLINE_URL = '/index.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  `/css/style.css?v=${APP_VERSION}`,
  `/js/app.js?v=${APP_VERSION}`,
  `/js/theme-init.js?v=${APP_VERSION}`,
  '/manifest.webmanifest',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // ถ้าไฟล์ใดไฟล์หนึ่งโหลดไม่ได้ (เช่นเวอร์ชันใน URL ไม่ตรงกัน) ต้องไม่ทำให้ service worker ล้มทั้งตัว
    const results = await Promise.allSettled(PRECACHE_URLS.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`${url} → ${response.status}`);
      await cache.put(url, response);
    }));
    const failed = results.filter((item) => item.status === 'rejected');
    if (failed.length > 0) {
      console.warn('[sw] แคชล่วงหน้าไม่ครบ', failed.map((item) => String(item.reason)));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// หน้าเว็บดึงของใหม่ก่อนเสมอ แล้วค่อยตกมาใช้สำเนาที่แคชไว้เมื่อออฟไลน์
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(OFFLINE_URL, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(OFFLINE_URL);
    if (cached) return cached;
    throw error;
  }
}

// ไฟล์ static ใช้สำเนาในแคชทันที แล้วอัปเดตเบื้องหลังไว้ใช้รอบถัดไป
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error('offline');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // ข้อมูลจาก API ต้องสดเสมอ ห้ามเสิร์ฟจากแคช
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

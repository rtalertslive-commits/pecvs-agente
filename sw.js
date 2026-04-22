// v1.0.2 - SW Update
const CACHE_NAME = 'pecvs-agent-v1';
const assets = ['./', './index.html'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(assets)));
});

self.addEventListener('fetch', e => {
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

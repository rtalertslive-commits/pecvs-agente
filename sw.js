// v1.0.2 - SW Update
const CACHE_NAME = 'pecvs-agent-v1';
const assets = ['./', './index.html'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(assets);
        })
    );
    self.skipWaiting(); // FUERZA LA ACTIVACIÓN DE LA NUEVA VERSIÓN
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim()); // TOMA EL CONTROL DE LA PÁGINA INMEDIATAMENTE
});

self.addEventListener('fetch', e => {
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

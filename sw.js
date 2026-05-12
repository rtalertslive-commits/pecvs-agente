const CACHE_NAME = 'pecvs-agent-mainnet-v1.9.8';
const assets = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png',
    './favicon-32.png'
];

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(assets)));
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        // Borra TODOS los caches viejos
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
        await self.clients.claim();
        // Avisa a todas las pestañas/PWAs que hay nueva versión activa
        // para que recarguen el HTML (necesario en iOS PWA donde el HTML
        // queda cacheado en memoria del proceso aun con network-first).
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'sw-activated', version: CACHE_NAME }));
    })());
});

self.addEventListener('fetch', e => {
    // Estrategia Network-First para la navegación principal (index.html)
    // Esto asegura que si hay internet, siempre descargue la última versión de GitHub.
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        // Cache-First para otros assets estáticos
        e.respondWith(
            caches.match(e.request).then(res => res || fetch(e.request))
        );
    }
});

const CACHE_NAME = 'pecvs-agent-mainnet-v1.15.0';
const assets = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png',
    './favicon-32.png'
];

// ─── FIREBASE CLOUD MESSAGING ─────────────────────────────────────────────────
// Importamos los SDKs compat de Firebase para Service Worker. La versión 10.x
// modular no funciona en SW (solo en módulos ES); por eso usamos -compat.
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyDPNoWHEktWMcxHTnxpGrbtzYz4wEf2EHo",
    authDomain: "bitacora-agente.firebaseapp.com",
    projectId: "bitacora-agente",
    storageBucket: "bitacora-agente.firebasestorage.app",
    messagingSenderId: "322544925589",
    appId: "1:322544925589:web:25021c345574e9ee0c149c"
});

const messaging = firebase.messaging();

// Handler de mensajes en background (app cerrada o no enfocada).
// Cuando la PWA está abierta, FCM dispara onMessage en el cliente directamente
// y este handler NO se ejecuta. Solo aplica cuando el SW recibe el push solo.
messaging.onBackgroundMessage(payload => {
    const title = (payload.notification && payload.notification.title) || 'PECVS$';
    const body  = (payload.notification && payload.notification.body)  || '';
    const data  = payload.data || {};
    return self.registration.showNotification(title, {
        body,
        icon: './icon-192.png',
        badge: './favicon-32.png',
        data,
        // En Android, tag agrupa notificaciones; en iOS lo ignora
        tag: data.tag || 'pecvs-notif',
        // requireInteraction: true mantiene la notif hasta que el user la toque
        requireInteraction: false
    });
});

// Click en la notificación → abrir/enfocar la app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil((async () => {
        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            // Si ya hay una ventana de la app abierta, enfocarla
            if (client.url.includes(self.registration.scope) && 'focus' in client) {
                return client.focus();
            }
        }
        // Si no, abrir nueva
        if (clients.openWindow) return clients.openWindow(url);
    })());
});

// ─── INSTALL / ACTIVATE / FETCH ──────────────────────────────────────────────
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
    // Ignorar requests a dominios externos (Firebase, gstatic, etc.) — solo cacheamos same-origin
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;

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

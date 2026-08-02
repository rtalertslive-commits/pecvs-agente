const CACHE_NAME = 'pecvs-agent-mainnet-v1.20.1';
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
// OJO — esto va envuelto en try/catch a proposito. importScripts es SINCRONO y
// bloqueante: si gstatic falla, la excepcion sube y el Service Worker entero no
// instala. Sin SW no hay handler de fetch, y el arranque de la app se queda sin
// respuesta -> pantalla negra.
//
// Envuelto, un gstatic caido degrada a "sin notificaciones push" en vez de
// tumbar la app. El resto del SW (cache, navegacion) se registra igual.
//
// Lo que esto NO cubre: si gstatic no falla sino que se CUELGA, importScripts se
// queda esperando sin timeout. Eso solo se elimina hospedando los SDK en el
// mismo origen. Pendiente.
let messaging = null;
try {
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

messaging = firebase.messaging();

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
} catch (err) {
    // La app funciona sin push. No funciona sin fetch handler.
    console.warn('[sw] FCM no disponible, sigo sin push:', err);
}

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

// Timeout de red para la navegación. Sin esto, un fetch colgado (señal mala,
// torre saturada, captive portal) deja al SW sin responder — y el splash nativo
// del PWA se queda en pantalla hasta que el browser aborta solo (30-120s).
// Con 4s servimos cache y la app abre al instante; la próxima carga trae fresh.
const NAV_TIMEOUT_MS = 4000;
const LAST_RESORT_MS = 15000;

// CDNs de assets estaticos que el <head> carga BLOQUEANDO el render: Chart.js,
// Font Awesome y Google Fonts. Antes se dejaban pasar sin cachear ("solo
// cacheamos same-origin"), asi que cada arranque de la app dependia de que los
// tres CDNs respondieran. Si uno se colgaba —WiFi con captive portal, DNS
// muerto— el browser no pintaba NADA: pantalla negra hasta que el sistema
// abortara la peticion, y por eso "se arreglaba" al cambiar de WiFi a LTE.
// Cacheados, a partir del segundo arranque no vuelven a tocar la red.
const STATIC_CDN = [
    'cdn.jsdelivr.net',        // chart.js
    'cdnjs.cloudflare.com',    // font awesome
    'fonts.googleapis.com',    // css de fuentes
    'fonts.gstatic.com'        // archivos de fuentes
];

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    const sameOrigin  = url.origin === self.location.origin;
    const isStaticCdn = STATIC_CDN.indexOf(url.hostname) !== -1;

    // Todo el resto cross-origin (Firestore, FCM, APIs de hora) se deja pasar
    // intacto: cachear respuestas de API seria un desastre de datos viejos.
    if (!sameOrigin && !isStaticCdn) return;
    if (e.request.method !== 'GET') return;

    // Network-First CON TIMEOUT para la navegación principal (index.html).
    // Si hay internet decente, descarga la última versión de GitHub.
    // Si la red tarda más de NAV_TIMEOUT_MS, sirve el cache sin esperar.
    if (e.request.mode === 'navigate') {
        e.respondWith((async () => {
            // Preparamos el fallback ANTES de la carrera. './index.html' cubre el
            // caso de URLs con query params o hash que no matchean exacto.
            const cached = (await caches.match(e.request))
                || (await caches.match('./index.html'))
                || (await caches.match('./'));

            try {
                const res = await Promise.race([
                    fetch(e.request, { cache: 'no-store' }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('sw-nav-timeout')), NAV_TIMEOUT_MS))
                ]);
                if (res && res.ok) {
                    const clone = res.clone();
                    // Fire-and-forget: un error de cache nunca debe romper la response.
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
                }
                return res;
            } catch (err) {
                // Timeout o fallo de red → cache si lo tenemos.
                if (cached) return cached;
                // Sin cache (primera instalacion offline, o cache recien purgado).
                // Timeout generoso: suficiente para una conexion mala legitima, pero
                // ACOTADO — un fetch sin limite aca deja PANTALLA NEGRA indefinida y
                // solo se recupera al cambiar de red (lo que aborta el fetch colgado).
                // Al expirar, respondWith rechaza y el browser muestra su error real.
                return await Promise.race([
                    fetch(e.request),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('sw-last-resort-timeout')), LAST_RESORT_MS))
                ]);
            }
        })());
    } else {
        // Cache-First para assets estaticos, propios y de CDN.
        e.respondWith((async () => {
            const cached = await caches.match(e.request);

            if (cached) {
                // Refresco en segundo plano solo para los CDN: sirve el cache al
                // instante y va actualizando sin bloquear nada. Si la red esta
                // muerta, el .catch() lo absorbe y el usuario no se entero.
                if (isStaticCdn) {
                    fetch(e.request).then(res => {
                        if (!res) return;
                        // Los CDN sin CORS devuelven respuestas 'opaque': status 0 y
                        // ok=false. Son cacheables igual, asi que hay que aceptarlas
                        // explicitamente o nunca se guardaria ninguna fuente.
                        if (res.ok || res.type === 'opaque') {
                            const clone = res.clone();
                            caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
                        }
                    }).catch(() => {});
                }
                return cached;
            }

            // Primera vez: a la red, y guardamos para que no vuelva a depender de ella.
            const res = await fetch(e.request);
            if (isStaticCdn && res && (res.ok || res.type === 'opaque')) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
            }
            return res;
        })());
    }
});

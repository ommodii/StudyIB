const CACHE_VERSION = 'studyib-shell-v11';
const APP_SHELL = [
    '/',
    '/index.html',
    '/index.css?v=2.0.1',
    '/atom.css?v=1.1.0',
    '/styles/tokens.css?v=2.0.0',
    '/styles/base.css?v=1.1.0',
    '/styles/components.css?v=1.1.0',
    '/styles/atom-components.css?v=1.1.0',
    '/manifest.webmanifest',
    '/assets/icons/studyib-icon.svg?v=2',
    '/assets/icons/apple-touch-icon.png?v=2',
    '/assets/icons/icon-192.png?v=2',
    '/assets/icons/icon-512.png?v=2'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key.startsWith('studyib-shell-') && key !== CACHE_VERSION).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || /\.pdf(?:$|\?)/i.test(url.href)) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put('/index.html', copy));
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cached => cached || fetch(request).then(response => {
            if (response.ok && ['style', 'script', 'image', 'font'].includes(request.destination)) {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
            }
            return response;
        }))
    );
});

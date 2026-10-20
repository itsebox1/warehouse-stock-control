// WSC service worker: do not cache app pages or API responses.
// This keeps deployments and Firebase/QuickBooks operations network-based.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

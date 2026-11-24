// Service worker do Orelhão Digital (necessário para instalar como app).
// Não guarda cópia do site: tudo vem sempre da internet, então cada atualização publicada aparece na hora.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

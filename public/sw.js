const CACHE = "pm-scalps-v1";
const STATIC = ["/journal", "/journal/history"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // No interceptar API calls ni supabase
  const url = e.request.url;
  if (url.includes("supabase") || url.includes("/api/") || url.includes("anthropic")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Solo cachear respuestas válidas
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => {
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          // Fallback para navegación — devolver página principal
          if (e.request.destination === "document") {
            return caches.match("/journal");
          }
          return new Response("Offline", { status: 503 });
        });
      })
  );
});
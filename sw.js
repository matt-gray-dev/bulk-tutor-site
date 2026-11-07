// Bulk Tutor offline support. Network first, so new data shows as soon as it's published;
// the cached copy is used only when there's no connection. Other sites (fonts) pass through.
const CACHE = "bulk-tutor-v1";   // old caches (binder-brew-v1) are cleared on activate
const SHARE = "bulk-tutor-share";   // a file shared to the installed app (Android), waiting for the page
const SHELL = ["./", "./index.html", "./engine.js", "./manifest.webmanifest", "./icons/icon-192.png"];
// Card images and mana symbols you've looked at, kept for offline use (most recent IMAGE_MAX). They stay
// Scryfall's: fetched from their image servers (no rate limit there) and kept only in this browser.
// Only CORS responses are kept: an opaque one would count as megabytes against the storage quota.
const IMAGES = "bulk-tutor-images";
const IMAGE_HOSTS = new Set(["cards.scryfall.io", "svgs.scryfall.io"]);
const IMAGE_MAX = 800;
let corsOk = true;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE && k !== IMAGES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Share target (see share_target in manifest.webmanifest): keep the shared file, then open the
// page with ?shared=1, which imports it. GitHub Pages can't take a POST, so this never reaches it.
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.getAll("file").find(f => f && typeof f !== "string" && f.size > 0);
    const text = ["title", "text"].map(k => form.get(k)).filter(x => typeof x === "string" && x.trim()).join("\n");
    const cache = await caches.open(SHARE), key = new URL("shared-item", self.registration.scope).href;
    if (file) await cache.put(key, new Response(file, { headers: { "x-name": encodeURIComponent(file.name || "Shared file"), "x-kind": "file" } }));
    else if (text) await cache.put(key, new Response(text, { headers: { "x-name": "Shared text", "x-kind": "text" } }));
  } catch {}
  return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
}

async function cachedImage(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  if (corsOk) {
    try {
      const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
      if (res.ok) cache.put(req.url, res.clone()).then(() => trimImages(cache)).catch(() => {});
      return res;
    } catch {}
  }
  const res = await fetch(req);          // no CORS from this host (or offline): pass through, keep nothing
  if (res.type === "opaque") corsOk = false;
  return res;
}
async function trimImages(cache) {
  const keys = await cache.keys();
  if (keys.length > IMAGE_MAX) await Promise.all(keys.slice(0, keys.length - IMAGE_MAX).map(k => cache.delete(k)));
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method === "GET" && IMAGE_HOSTS.has(url.hostname)) { e.respondWith(cachedImage(e.request).catch(() => Response.error())); return; }
  if (url.origin !== self.location.origin) return;
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) { e.respondWith(receiveShare(e.request)); return; }
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || Response.error()))
  );
});

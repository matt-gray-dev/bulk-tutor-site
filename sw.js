// Bulk Tutor offline support. What each kind of request gets (the project notes, notes/offline.md, have the reasons):
//   the page and its files  the saved copy at once; all of them are checked against the site behind it and replaced
//                           together when any changed, and the open page is told ("shell-updated")
//   data that changes       the network, if the whole file arrives within LIMIT ms; otherwise, or on a failure or a
//                           server error, the saved copy
//                           (decks, combos, prices and each printing's prices, legality, config.json)
//   data that can't change  the saved copy when there is one: card text, picture IDs, tokens and printings, whose address names the
//                           data version they belong to
//   fonts, icons            the saved copy; icons are checked behind it, fonts never (a changed font gets a new name)
//   card images, symbols    the saved copy, from Scryfall's image servers: the pictures you chose to keep (PICTURES,
//                           filled by the page's offline download) and the newest IMAGE_MAX you've looked at
const CACHE = "bulk-tutor-v1";   // old caches (binder-brew-v1) are cleared on activate
const SHARE = "bulk-tutor-share";   // a file shared to the installed app (Android), waiting for the page
const PAGE = "./";
// The page's script, in the order index.html loads it (tests/test_scripts.py checks the two lists agree).
const APP = ["core", "example", "record", "import", "find", "collection", "builds", "generator", "workbench", "overhaul", "buildsheets", "tune", "cards",
  "pictures", "cardviews", "tokens", "browse", "sorting", "views", "putaway", "addcards", "changes", "filing", "about", "sync", "main"].map(f => `./app/${f}.js`);
// The app itself: these belong to one version of the site and are only ever replaced together (refreshShell).
const SHELL = [PAGE, "./theme.css", "./styles.css", "./icons.svg", "./engine.js", ...APP, "./manifest.webmanifest", "./icons/icon-192.png"];
// The Latin font files (theme.css): saved at install so the first offline visit has them. Latin Extended ones are saved when used.
const FONTS = ["spectral-latin-500", "spectral-latin-600", "spectral-latin-700", "ibm-plex-sans-latin-400", "ibm-plex-sans-latin-500",
  "ibm-plex-sans-latin-600", "ibm-plex-mono-latin-400", "ibm-plex-mono-latin-500", "ibm-plex-mono-latin-600"].map(f => `./fonts/${f}-normal.woff2`);
const LIMIT = 3000;              // how long changing data may take before the saved copy is used
const HURRY = 250;               // ...and how long while the connection is known to be slow (no connection fails sooner)
const SLOW_FOR = 180000;         // a file's slow answer is remembered this long, so the next opens don't each wait LIMIT
const slowUntil = new Map();     // address -> until when; per file, since a small file arriving quickly says nothing
                                 // about a large one. In memory only: a restarted worker waits LIMIT once more.
const REFRESH_LIMIT = 45000;     // a background check of the app's files gives up after this (six rounds of four files)
// Card images and mana symbols you've looked at, kept for offline use (most recent IMAGE_MAX). They stay
// Scryfall's: fetched from their image servers (no rate limit there) and kept only in this browser.
// Only CORS responses are kept: an opaque one would count as megabytes against the storage quota.
const IMAGES = "bulk-tutor-images";
const IMAGE_HOSTS = new Set(["cards.scryfall.io", "svgs.scryfall.io"]);
const IMAGE_MAX = 800;
// The offline download (Settings, Offline): pictures for your builds and decks or your whole collection. The page
// fills and prunes this cache itself, a few pictures at a time; the worker only answers from it, before anything else.
const PICTURES = "bulk-tutor-pictures";
let corsOk = true;

const SCOPE = new URL(self.registration.scope);
const abs = u => new URL(u, SCOPE).href;
const SHELL_URLS = new Set(SHELL.map(abs));
// Where a request sits under the site ("data/decks.json", "" for the page), or null outside it.
const relOf = url => url.pathname.startsWith(SCOPE.pathname) ? url.pathname.slice(SCOPE.pathname.length) : null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const tellPages = async msg => { try { for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage(msg); } catch {} };
const sameBytes = (a, b) => { if (a.byteLength !== b.byteLength) return false; const x = new Uint8Array(a), y = new Uint8Array(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([
    c.addAll(SHELL.map(u => new Request(u, { cache: "no-cache" }))),
    c.addAll(FONTS).catch(() => {}),      // a missing font must not cost the app its offline copy
  ])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE && k !== IMAGES && k !== PICTURES).map(k => caches.delete(k))))
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
  const kept = await caches.match(req.url, { cacheName: PICTURES });
  if (kept) return kept;
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  // A picture the page fetches for the offline download (a fetch(), not an <img>) goes into PICTURES there: keeping it
  // here as well would store it twice and push the pictures you've looked at out of the newest IMAGE_MAX.
  const viewing = req.destination !== "";
  if (corsOk) {
    try {
      const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
      if (res.ok && viewing) cache.put(req.url, res.clone()).then(() => trimImages(cache)).catch(() => {});
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

// ------------------------------------------------------------ the app's own files
// Fetch every file of the app; if all arrive and any differs from its saved copy, replace them all and tell the open
// pages. All or nothing, so a saved page never runs beside a script from another version.
// A page load that arrives while a check is running asks for one more after it: the running one may have fetched its
// files before the site changed.
let refreshing = null, again = false;
function refreshShell() {
  if (refreshing) { again = true; return refreshing; }
  refreshing = doRefresh().catch(() => {}).finally(() => { refreshing = null; if (again) { again = false; return refreshShell(); } });
  return refreshing;
}
async function doRefresh() {
  const cache = await caches.open(CACHE), stop = new AbortController(), timer = setTimeout(() => stop.abort(), REFRESH_LIMIT);
  // Four at a time: over HTTP/1.1 a browser has six connections per site, and every file at once made the page's own
  // request for the card data wait behind them (a second longer to the first screen at one second per request). Four
  // leaves it the two it starts with. (It was two at a time while the app was seven files; it is 24 since 0.52.0.)
  const fresh = []; let next = 0;
  const some = async () => {
    while (next < SHELL.length) {
      const u = SHELL[next++], res = await fetch(u, { cache: "no-cache", signal: stop.signal });
      if (!res.ok) throw new Error("not there");
      fresh.push({ u, type: res.headers.get("Content-Type") || "", bytes: await res.arrayBuffer() });
    }
  };
  try { await Promise.all([some(), some(), some(), some()]); } finally { clearTimeout(timer); }
  const hadPage = !!(await cache.match(PAGE));
  let changed = false;
  for (const f of fresh) {
    const old = await cache.match(f.u);
    if (!old || !sameBytes(f.bytes, await old.arrayBuffer())) changed = true;
  }
  if (!changed) return;
  // Stored as plain new responses: the bytes are already decoded, and a redirected response couldn't answer a page load.
  await Promise.all(fresh.map(f => cache.put(f.u, new Response(f.bytes, { status: 200, headers: f.type ? { "Content-Type": f.type } : {} }))));
  if (!hadPage) return;     // nothing was saved before, so no page is running an older copy
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "shell-updated" });
}

async function page(e) {
  const cache = await caches.open(CACHE), hit = await cache.match(PAGE);
  e.waitUntil(refreshShell());
  if (hit) return hit;
  return fetch(e.request).catch(() => Response.error());     // nothing saved yet
}

// Icons, fonts and anything else that isn't data: the saved copy when there is one.
async function asset(e, url, rel) {
  const cache = await caches.open(CACHE), key = url.origin + url.pathname;
  const hit = await cache.match(key);
  const get = () => fetch(key, { cache: "no-cache" }).then(res => { if (res.ok) cache.put(key, res.clone()).catch(() => {}); return res; });
  if (hit) {
    if (!SHELL_URLS.has(key) && !rel.startsWith("fonts/")) e.waitUntil(get().catch(() => {}));
    return hit;
  }
  return get().catch(() => Response.error());
}

// ------------------------------------------------------------ data
// A saved copy handed over because the network didn't answer says why, so the page can say "offline" and not "no data".
async function saved(hit, why) {
  return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers: plainHeaders(hit.headers, { "X-BT-Saved": why }) });
}
// Headers for a response rebuilt from its contents: those are already decoded, whatever the server's headers say
// (and it is no longer one of several encodings, so Vary goes too: a saved copy must match however it is asked for).
function plainHeaders(from, extra) {
  const h = new Headers(from); for (const k of ["Content-Encoding", "Content-Length", "Vary"]) h.delete(k);
  for (const k in extra || {}) h.set(k, extra[k]);
  return h;
}
// Data that changes under one address. The saved copy is the server's last real answer, and "not there" (404) is an
// answer too: it is what tells private mode from public mode when the network is slow or gone. Server errors never are.
// A slow connection (0.50.2): the page is told it got the saved copy ("X-BT-Saved: slow") and, when the download does
// arrive, whether it differs from what was handed over ({type: "data-late", file, changed}), or that it never did
// ({…, down: true}). A file's slowness is remembered for SLOW_FOR, during which its saved copy goes out after HURRY;
// its download arriving within LIMIT ends that.
async function fresh(e, url) {
  const cache = await caches.open(CACHE), key = url.origin + url.pathname + url.search;
  const answer = res => res.ok || res.status === 404;
  const started = Date.now(), hurry = started < (slowUntil.get(key) || 0);
  let handed = null, landed = false;      // the saved copy handed over for slowness; the download has been saved
  // The whole file, not just its first bytes, has to arrive within the limit: on one bar of signal a megabyte of
  // card data can take a minute, and the saved copy is right there. The download goes on and is saved for next time.
  const net = fetch(e.request).then(async res => {
    if (!answer(res)) return res;
    const body = await res.blob(), init = { status: res.status, statusText: res.statusText, headers: plainHeaders(res.headers) };
    await cache.put(key, new Response(body, init)).catch(() => {});
    landed = true;
    if (Date.now() - started < LIMIT) slowUntil.delete(key); else slowUntil.set(key, Date.now() + SLOW_FOR);
    if (handed) {
      let changed = true;
      try { changed = handed.status !== res.status || !sameBytes(await handed.arrayBuffer(), await body.arrayBuffer()); } catch {}
      await tellPages({ type: "data-late", file: relOf(url), changed });
    }
    return new Response(body, init);
  });
  e.waitUntil(net.catch(() => { if (handed) { slowUntil.delete(key); return tellPages({ type: "data-late", file: relOf(url), down: true }); } }));
  let res = null, why = "slow";
  try { res = await Promise.race([net, wait(hurry ? HURRY : LIMIT).then(() => null)]); if (res && !answer(res)) why = "error"; }
  catch { why = "offline"; }
  if (res && answer(res)) return res;
  const hit = await cache.match(key);
  if (hit && why === "slow") {
    if (landed) return net;               // it arrived while the saved copy was being fetched: that is the answer
    handed = hit.clone(); slowUntil.set(key, Date.now() + SLOW_FOR);
  }
  if (hit) return saved(hit, why);
  if (res) return res;                                              // a server error and nothing saved: pass it on
  return why === "slow" ? net.catch(() => Response.error()) : Response.error();   // nothing saved: wait for the network
}
// Data whose address names its version (text/NN.json?v=…, images.json?v=…): it never changes, so the saved copy is right.
async function fixed(e, url) {
  const cache = await caches.open(CACHE), key = url.origin + url.pathname + url.search;
  const hit = await cache.match(key);
  if (hit) return hit;
  return fetch(e.request).then(res => { if (res.ok) e.waitUntil(cache.put(key, res.clone()).catch(() => {})); return res; }).catch(() => Response.error());
}
const isFixed = (url, rel) => url.searchParams.has("v") && (rel.startsWith("data/text/") || rel === "data/images.json" || rel === "data/tokens.json" || rel === "data/printings.json");

// The page says which data it is running on: drop saved files of other versions (each weekly rebuild would otherwise
// leave its set behind), then save the weekly files this visit didn't ask for, so the next one works with no connection.
async function keepData(version, files) {
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    const url = new URL(req.url), rel = relOf(url), v = url.searchParams.get("v");
    if (rel && rel.startsWith("data/") && v !== null && v !== version) await cache.delete(req);
  }
  for (const f of files || []) {
    const url = new URL(f, SCOPE), rel = relOf(url);
    if (url.origin !== SCOPE.origin || !rel || !rel.startsWith("data/")) continue;
    const key = url.origin + url.pathname + url.search;
    if (await cache.match(key)) continue;
    try { const res = await fetch(key, { cache: "no-cache" }); if (res.ok) await cache.put(key, res); } catch { return; }   // no connection: next visit
  }
}
self.addEventListener("message", e => {
  const m = e.data || {};
  if (m.type === "data" && typeof m.version === "string") e.waitUntil(keepData(m.version, Array.isArray(m.files) ? m.files : []).catch(() => {}));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "GET" && IMAGE_HOSTS.has(url.hostname)) { e.respondWith(cachedImage(req).catch(() => Response.error())); return; }
  if (url.origin !== self.location.origin) return;
  const rel = relOf(url);
  if (rel === null) return;
  if (req.method === "POST" && url.pathname.endsWith("/share-target")) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== "GET") return;
  if (rel === "sw.js") return;
  if (req.mode === "navigate" && (rel === "" || rel === "index.html")) { e.respondWith(page(e)); return; }
  if (rel.startsWith("data/") || rel === "config.json") { e.respondWith(isFixed(url, rel) ? fixed(e, url) : fresh(e, url)); return; }
  e.respondWith(asset(e, url, rel));
});

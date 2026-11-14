"use strict";
// Bulk Tutor, the page's script, part "pictures": the offline download: pictures kept on this device by choice (Settings, Offline).
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ the offline download (0.51.0; notes/offline.md)
// Pictures kept on this device by choice (Settings, Offline): for your builds and decks, for your whole collection, or
// both. Only addresses that need no lookup, at the size the screens show: your own printing's (the import's Scryfall
// ID) or the default printing's (images.json). The page fetches them from Scryfall's image servers a few at a time
// into a cache of their own, which the service worker answers pictures from first. Each pass starts from what that
// cache holds, so a download carries on wherever it stopped, and what is no longer wanted (a card gone from the
// collection, a deleted build, a choice switched off) is removed. Every card's text is kept without asking (tellWorker).
const PICS = "bulk-tutor-pictures", PIC_GUESS = 102000;   // bytes a picture, until this device has measured its own (2,072 pictures came to about 212 MB on an iPhone, Nov 11 2026)
let PICS_AT_ONCE = 4, KEEP_UNDO = 8000;                  // tests change these
// The two choices, and what this device has measured: pictures downloaded so far and their bytes (bt.offline; this
// device only, never synced: another phone makes its own choice).
const KEEP = { builds: false, coll: false, n: 0, bytes: 0 };
try { const o = JSON.parse(store.get("bt.offline") || "{}"); for (const k in KEEP) if (typeof o[k] === typeof KEEP[k]) KEEP[k] = o[k]; } catch {}
const saveKeep = () => store.set("bt.offline", JSON.stringify(KEEP));
const canKeep = () => "caches" in window && "serviceWorker" in navigator;
const keepOn = () => KEEP.builds || KEEP.coll;
// How the last pass left things. want/have = pictures wanted and saved; none = cards with no address to save;
// waiting = no answer (no connection, or the server refusing for now); full = the device has no room.
const PICS_NOW = { running: false, checked: false, want: 0, have: 0, got: 0, none: 0, waiting: false, full: false };
const picsBad = new Set();      // addresses with no picture behind them (a 404), this visit
let picsBusy = null, picsAgain = false, picsHold = 0, picsTimer = null;
let keepText = "", keepNote = "";   // the panel's two lines that need asking the browser, as last answered (fillKeepNotes)

// The cards a choice covers (normalized name -> name). Builds and decks: every build (a hot-swap's other versions
// too), every saved deck, and the cards in your deck locations, owned or not.
function keepNames(which, into = new Map()) {
  const add = c => { const n = typeof c === "string" ? c : c && c.name; if (n && !into.has(norm(n))) into.set(norm(n), n); };
  if (which === "coll") { for (const a of AGG.values()) add(a.name); return into; }
  for (const l of [...BUILDS, ...SAVED]) {
    (l.cards || []).forEach(add); (l.side || []).forEach(add); (l.commanders || []).forEach(add);
    for (const pack of Object.values((l.hotswap && l.hotswap.packages) || {})) (pack || []).forEach(add);
  }
  for (const a of AGG.values()) if ([...a.locs.values()].some(l => l.inDeck)) add(a.name);
  return into;
}
// Their pictures' addresses: the front, and the back of a two-faced card. `none` counts cards with no address here
// (card data without picture IDs, a name it doesn't know): those are looked up and kept as you view them, as before.
function keepAddresses(names) {
  const urls = new Set(); let none = 0;
  for (const name of names.values()) {
    const d = directFor(name); if (!d) { none++; continue; }
    urls.add(d.normal); if (hasBack(name)) urls.add(faceUrl(d.normal, true));
  }
  return { urls, none };
}
const keepWanted = () => { const names = new Map(); for (const w of ["builds", "coll"]) if (KEEP[w]) keepNames(w, names); return keepAddresses(names); };
// Every address is known (the picture IDs loaded, or this data has none): only then is "not wanted" a reason to remove.
const picsWhole = () => !!DATA && (!FILES().images || idsState === "ready");

// One pass at a time. Asking for another while one runs stops its downloads after the pictures in flight and starts
// again from the choices and the cards as they are then.
function picsSync() {
  if (!canKeep()) return Promise.resolve();
  if (picsBusy) { picsAgain = true; return picsBusy; }
  picsBusy = picsPass().catch(() => {}).finally(() => {
    picsBusy = null; PICS_NOW.running = false; syncWakeLock(); renderKeep();
    if (picsAgain) { picsAgain = false; picsSync(); }
    else if (PICS_NOW.waiting && !offline()) picsSoon(60000);      // the server said "not now": ask again in a minute
  });
  return picsBusy;
}
function picsSoon(ms = 2500) { if (!canKeep()) return; clearTimeout(picsTimer); picsTimer = setTimeout(picsSync, ms); }
async function picsPass() {
  const st = PICS_NOW;
  if (!DATA) return;
  if (!keepOn()) {
    if (Date.now() >= picsHold && await caches.has(PICS)) await caches.delete(PICS);
    Object.assign(st, { checked: true, want: 0, have: 0, none: 0, waiting: false, full: false });
    return;
  }
  if (waitForIds()) return;                                // the picture IDs are on their way: loadIds comes back here
  const { urls, none } = keepWanted(), cache = await caches.open(PICS);
  const held = new Set((await cache.keys()).map(r => r.url));
  // Switching a choice off removes its pictures only once its Undo has gone (picsHold).
  if (picsWhole() && Date.now() >= picsHold) for (const u of held) if (!urls.has(u)) { await cache.delete(u); held.delete(u); }
  const todo = []; let have = 0;
  for (const u of urls) { if (held.has(u)) have++; else if (!picsBad.has(u)) todo.push(u); }
  Object.assign(st, { checked: true, want: urls.size, have, none, waiting: false, full: false });
  if (!todo.length) return;
  if (offline()) { st.waiting = true; return; }
  st.running = true; syncWakeLock(); renderKeepStatus();
  const viewed = await caches.open("bulk-tutor-images");
  let stop = false, since = 0;
  const some = async () => {
    while (todo.length && !stop && !picsAgain) {
      const url = todo.shift(); let res;
      try { res = await fetch(url, { mode: "cors", credentials: "omit" }); } catch { st.waiting = stop = true; return; }
      if (res.status === 404 || res.status === 410) { picsBad.add(url); continue; }
      if (!res.ok) { st.waiting = stop = true; return; }
      try {
        const blob = await res.blob();
        await cache.put(url, new Response(blob, { headers: { "Content-Type": res.headers.get("Content-Type") || "image/jpeg" } }));
        viewed.delete(url).catch(() => {});                // it was among the pictures you'd looked at: kept once
        KEEP.n++; KEEP.bytes += blob.size; st.have++; st.got++;
        if (++since >= 25) { since = 0; saveKeep(); }
      } catch { st.full = stop = true; return; }           // the device's storage is full
      renderKeepStatus();
    }
  };
  await Promise.all(Array.from({ length: PICS_AT_ONCE }, some));
  saveKeep();
}

const picAvg = () => KEEP.n >= 20 ? KEEP.bytes / KEEP.n : PIC_GUESS;
const sizeText = b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e7 ? `${Math.round(b / 1e6)} MB` : b >= 1e5 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const picsWord = n => `${n.toLocaleString()} picture${n === 1 ? "" : "s"}`;
function keepStatusHTML() {
  const st = PICS_NOW;
  if (!keepOn() || !st.checked) return "";
  const size = sizeText(st.have * picAvg()), left = st.want - st.have;
  const count = `<span class="num">${st.have.toLocaleString()} of ${st.want.toLocaleString()}</span> pictures saved`;
  const line = !st.want ? "No pictures to save yet."
    : st.full ? `${count}. This device has no room for more.`
    : st.waiting ? `${count}. The rest come when there's a connection.`
    : st.running ? `${count}, about ${size} so far. Keep Bulk Tutor open while it downloads; if it stops, it carries on from here next time.`
    : left > 0 ? `${count}, about ${size}. Scryfall has no picture for the other ${left.toLocaleString()}.`
    : `All ${picsWord(st.want)} are saved on this device, about ${size}.`;
  const cards = st.none === 1 ? ["1 card has", "it loads", "it"] : [`${st.none.toLocaleString()} cards have`, "they load", "them"];
  return `${st.want && left > 0 ? `<div class="meter" aria-hidden="true"><span class="free" style="width:${(st.have / st.want * 100).toFixed(1)}%"></span></div>` : ""}
    <p class="small" data-keep-line>${line}</p>
    ${st.none ? `<p class="muted small">${cards[0]} no picture address in the card data, so ${cards[1]} as you view ${cards[2]}.</p>` : ""}`;
}
function keepPanelHTML() {
  if (!canKeep()) return `<p class="small">This browser can't keep Bulk Tutor for use with no connection.</p>`;
  const ready = !!DATA && !waitForIds();     // asks for the picture IDs if nothing has yet; loadIds draws this again
  const sub = which => { if (!ready) return ""; const n = keepAddresses(keepNames(which)).urls.size; return n ? `${picsWord(n)}, about ${sizeText(n * picAvg())}` : "No pictures to save yet"; };
  return `<p class="small">The app, your collection, your builds and the card data are always kept on this device. <span id="keep-text">${esc(keepText)}</span></p>
    <p class="muted small">Pictures are kept for the cards you've looked at lately. To have more of them with no connection, choose here.</p>
    ${switchHTML(`data-keep="builds"`, KEEP.builds, "Pictures for your builds and decks", sub("builds"))}
    ${switchHTML(`data-keep="coll"`, KEEP.coll, "Pictures for your whole collection", sub("coll"))}
    <div id="keep-status">${keepStatusHTML()}</div>
    <p class="muted small" id="keep-note"${keepNote ? "" : " hidden"}>${esc(keepNote)}</p>`;
}
// What needs asking the browser: how many of the card text files are saved, and whether it may clear this site's data.
async function fillKeepNotes() {
  if (!$("#keep-text")) return;
  let files = null, safe = null;
  try { if (DATA && FILES().text) { const v = `?v=${encodeURIComponent(DATA.version)}`; files = (await (await caches.open("bulk-tutor-v1")).keys()).filter(r => r.url.includes("/data/text/") && r.url.endsWith(v)).length; } } catch {}
  try { if (navigator.storage && navigator.storage.persisted) safe = await navigator.storage.persisted(); } catch {}
  keepText = files === null ? "" : files >= FILES().text ? "So is every card's text." : `Every card's text is being saved too (${files} of ${FILES().text} files so far).`;
  keepNote = isIOS && !isStandalone() ? "In Safari, an iPhone clears a site's saved data after a week without a visit, your collection included. Add Bulk Tutor to your Home Screen and it's kept."
    : !keepOn() ? ""
    : safe ? "This device won't clear Bulk Tutor's data to make room for other things."
    : "This browser may clear saved data when the device runs low on space. Pictures can be downloaded again; for your collection and builds, connect Dropbox or keep a backup.";
  const text = $("#keep-text"), note = $("#keep-note"); if (!text || !note) return;
  text.textContent = keepText; note.textContent = keepNote; note.hidden = !keepNote;
}
const renderKeepStatus = () => { const el = $("#keep-status"); if (el) el.innerHTML = keepStatusHTML(); };
const renderKeep = withFocus(() => { const el = $("#keep-panel"); if (!el) return; el.innerHTML = keepPanelHTML(); fillKeepNotes(); }, "#keep-panel");
document.addEventListener("change", e => {
  const t = e.target; if (!t || !t.matches || !t.matches("[data-keep]")) return;
  const which = t.dataset.keep;
  const set = on => { KEEP[which] = on; saveKeep(); picsHold = on ? 0 : Date.now() + KEEP_UNDO + 1000; picsSync(); renderKeep(); };
  set(t.checked);
  if (t.checked) {
    // Ask the browser not to clear this site's data to make room (it decides by itself: a Home Screen app usually gets it).
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(fillKeepNotes, () => {}); } catch {}
    return;
  }
  // The pictures go only once this message has, so Undo costs no download.
  setTimeout(() => { if (Date.now() >= picsHold) picsSync(); }, KEEP_UNDO + 1100);
  toast(`Stopped keeping pictures for your ${which === "coll" ? "whole collection" : "builds and decks"}`, "Undo", () => set(true), KEEP_UNDO);
});
// Assemble is where a build's pictures are wanted away from home: it points at the choice until one is made.
const keepOfferHTML = () => canKeep() && !keepOn() ? `<p class="muted small">Gathering cards somewhere with no connection? <button class="btn link" data-keep-go>Keep your builds' pictures on this device</button></p>` : "";
document.addEventListener("click", e => {
  if (!(e.target.closest && e.target.closest("[data-keep-go]"))) return;
  showView("settings"); const el = $("#offline-set"); if (el) el.scrollIntoView();
});

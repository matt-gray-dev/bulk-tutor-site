"use strict";
// Bulk Tutor, the page's script, part "cards": mana symbols, card images and their lookups, card data loaded on demand (picture IDs, prices, legality), two-faced cards.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ mana symbols
// SYMBOLS = "scryfall": the real symbols, as Scryfall's symbol images (svgs.scryfall.io, no rate limit;
// Matt chose these Nov 6, with a note to consider our own once the branding settles). "drawn": our own
// coloured circles (.msd), which are also the fallback whenever an image can't load (offline or blocked).
// Costs come from costOf (engine) in Scryfall notation; symbols are drawn per token.
const SYMBOLS = "scryfall";
// Magic's colours, from theme.css (--mana-*), the same in every theme.
const SYM_COLOR = { W: "var(--mana-w)", U: "var(--mana-u)", B: "var(--mana-b)", R: "var(--mana-r)", G: "var(--mana-g)", C: "var(--mana-c)" };
const SYM_WORD = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colourless", T: "tap", Q: "untap", S: "snow", E: "energy", X: "X", Y: "Y", Z: "Z" };
function symLabel(sym) {
  const parts = sym.split("/"), phy = parts.includes("P");
  const words = parts.filter(p => p !== "P").map(p => SYM_WORD[p] || p);
  return words.join(" or ") + (phy ? " or 2 life" : "");
}
function drawnSym(sym) {
  const parts = sym.split("/"), phy = parts.includes("P"), cols = parts.filter(p => SYM_COLOR[p] && p !== "C");
  const a = SYM_COLOR[cols[0]] || SYM_COLOR.C, b = cols[1] ? SYM_COLOR[cols[1]] : /^\d+$/.test(parts[0]) && cols[0] ? SYM_COLOR.C : a;
  const text = cols.length === 2 ? "" : /^\d+$/.test(parts[0]) ? parts[0] : cols.length ? (parts[0] === cols[0] ? cols[0] : "") : parts[0].slice(0, 2);
  const style = cols.length === 1 && /^\d+$/.test(parts[0]) ? `--a:${SYM_COLOR.C};--b:${a}` : `--a:${a};--b:${b}`;
  return `<span class="msd${phy ? " phy" : ""}" style="${style}"><i>${esc(text)}</i></span>`;
}
function symHTML(sym) {
  if (SYMBOLS !== "scryfall" || !/^[0-9A-Z/]+$/.test(sym)) return drawnSym(sym);
  return `<img class="ms" src="https://svgs.scryfall.io/card-symbols/${sym.replace(/\//g, "")}.svg" alt="" data-sym="${esc(sym)}" decoding="async">`;
}
// A cost as symbols, read out as words ("Mana cost: 2, red, white or blue").
function manaHTML(cost, label = "Mana cost: ") {
  const syms = costSymbols(cost); if (!syms.length) return "";
  const said = syms.map(x => x === "//" ? "and" : symLabel(x)).join(", ");
  return `<span class="cost" role="img" aria-label="${esc(label + said)}">${syms.map(x => x === "//" ? `<span class="sep">//</span>` : symHTML(x)).join("")}</span>`;
}
// A symbol image that can't load is replaced by the drawn one.
document.addEventListener("error", e => {
  const img = e.target; if (!img || img.tagName !== "IMG" || !img.classList.contains("ms")) return;
  img.outerHTML = drawnSym(img.dataset.sym || "");
}, true);

// ------------------------------------------------------------ card images (Scryfall)
// Images load only in Grid or Stacks view and the card sheet. Cards you own with a Scryfall ID from
// the import (ManaBox has them) use that printing's image address directly: cards.scryfall.io paths
// are built from the ID and that host has no rate limit. Everything else is looked up by name on
// /cards/collection, 75 cards per request, which Scryfall limits to 2 requests a second (a 429 locks
// the API for 30 s): requests go IMG_GAP apart, and a rate-limited batch waits and is retried rather
// than shown as names. If a direct address fails, that card falls back to a lookup by name.
const IMG_GAP = 600;
let IMG_RETRY_MS = 31000;     // how long a rate-limited batch waits (tests shorten it)
const directImg = (sid, size) => /^[0-9a-f-]{36}$/i.test(sid || "") ? `https://cards.scryfall.io/${size}/front/${sid[0]}/${sid[1]}/${sid}.jpg` : null;
const noDirect = new Set();   // cards whose direct address failed
// Pictures and lookups that got no answer at all (no connection), as opposed to a "no" from Scryfall. Nothing is wrong
// with the card or its address, so these are forgotten when the connection is back (netBack) or the card is drawn again:
// at once if they failed while the device said it was offline (`off`), otherwise after IMG_AGAIN.
const IMG_DOWN = new Map();   // normalized name -> { at, off }
let IMG_AGAIN = 30000;        // tests shorten it
const stillDown = d => navigator.onLine === false || (!d.off && Date.now() - d.at < IMG_AGAIN);
const markDown = k => IMG_DOWN.set(k, { at: Date.now(), off: navigator.onLine === false });
function forgetDown(k) {
  IMG_DOWN.delete(k); noDirect.delete(k);
  if (IMG.get(k) === null) IMG.delete(k);
  if (LOOKUP_FAILED.delete(k) && TEXT.get(k) === null) TEXT.delete(k);
}
let CARDVIEW = "list";
const IMG = new Map();        // normalized name -> { small, normal } | null (no image)
const imgQueue = new Map();   // normalized name -> Scryfall identifier
// Card text (rules text, type line, power/toughness) comes with the same /cards/collection lookups,
// so it costs no extra requests: kept for this visit only. normalized name -> faces[] | null (lookup failed)
const TEXT = new Map();
const PRINT_ARTIST = new Map();   // Scryfall printing ID (or "n:" + name) -> its artist, from lookups
const SHARDS = new Map();          // text file number -> "loading" | "ready" | "failed"
function shardOf(name) { const n = FILES().text, i = LOOKUP.get(norm(name)); return n && i != null ? i % n : null; }
function loadShard(b) {
  SHARDS.set(b, "loading");
  dataFetch(dataUrl(`text/${String(b).padStart(2, "0")}.json`), undefined, false).then(r => r.ok ? r.json() : null).then(j => {
    if (!j || !DATA || j.version !== DATA.version) throw new Error("stale");
    for (const [i, faces] of Object.entries(j.cards)) TEXT.set(KEY[+i], faces.map(f => ({ name: f[0], cost: f[1], type: f[2], text: f[3], pt: f[4] })));
    SHARDS.set(b, "ready");
  }).catch(() => SHARDS.set(b, "failed")).then(() => {
    // Anything still waiting on this file (a card it lacked, or the file didn't load) asks Scryfall instead.
    document.querySelectorAll("#sheet [data-textk]").forEach(el => { if (!TEXT.has(el.dataset.textk)) needText(el.dataset.name); });
    paintText();
  });
}
// Cards whose lookup failed (offline, blocked, rate-limited past the retries), as opposed to ones Scryfall
// answered: opening the card again, or "Try again", asks once more. Answers are never asked twice.
const LOOKUP_FAILED = new Set();
const imgInflight = new Set();
let imgTimer = null, imgBusy = false;

function loadImgCache() {
  try { const o = JSON.parse(store.get("bt.img") || "{}"); for (const k in o) IMG.set(k, o[k]); } catch {}
}
function saveImgCache() {
  const o = {}; let n = 0;
  for (const [k, v] of IMG) if (v && v.normal && !v.direct && n++ < 5000) o[k] = v.back ? { normal: v.normal, back: true } : { normal: v.normal };
  store.set("bt.img", JSON.stringify(o));
}
const sidFor = name => { const a = AGG.get(norm(name)); return (a && a.sid) || null; };

// ------------------------------------------------------------ card data loaded on demand
// Since data format 4 the weekly build writes, beside decks.json (all Scryfall data, never encrypted):
// images.json (each card's default printing, so its image loads straight from cards.scryfall.io with no
// lookup), text/NN.json (rules text; card i is in file i % DATA.files.text) and prices.json (refreshed
// daily; since format 15 printings.json and the print-prices files too: prices, below). Older data and the demo data have none of these, and fall back to lookups (flushImgs).
const FILES = () => (DATA && DATA.files) || {};
const dataUrl = path => `data/${path}?v=${encodeURIComponent(DATA.version)}`;
let IMG_IDS = null, idsState = "idle";   // idle | loading | ready | failed
let BACKS = new Set();                   // card indices whose picture has a back face (images.json "backs", format 5)
function loadIds() {
  if (idsState !== "idle") return;
  idsState = "loading";
  dataFetch(dataUrl("images.json"), undefined, false).then(r => r.ok ? r.json() : null)
    .then(j => { if (j && DATA && j.version === DATA.version) { IMG_IDS = j.ids; BACKS = new Set(j.backs || []); idsState = "ready"; } else idsState = "failed"; })
    .catch(() => { idsState = "failed"; })
    .then(() => {
      paintImgs(); paintText();
      picsSoon(1500); renderKeep();     // the offline download can tell which pictures it wants now
      // Pictures drawn before this knew nothing of back faces: redraw so two-faced cards get their flip button.
      if (BACKS.size && document.querySelector(".cimg")) refreshFaces();
    });
}
// True while image IDs are on their way (so nothing is looked up that they'll answer).
function waitForIds() { if (!FILES().images || !DATA || idsState === "ready" || idsState === "failed") return false; loadIds(); return true; }
const uuid = h => /^[0-9a-f]{32}$/.test(h || "") ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null;
function defaultId(name) { if (!IMG_IDS) return null; const i = LOOKUP.get(norm(name)); return i == null ? null : uuid(IMG_IDS[i]); }
// Your own printing's image (its Scryfall ID came with the import), else the default printing's.
function directFor(name) {
  const k = norm(name); if (noDirect.has(k)) return null;
  const id = sidFor(name) || defaultId(name), n = directImg(id, "normal");
  return n ? { normal: n, small: directImg(id, "small"), direct: true } : null;
}
// ------------------------------------------------------------ prices (0.68.0; Matt, Nov 12)
// prices.json (daily): `low` / `lowEur` = each card's cheapest printing in dollars (TCGplayer) and euros (Cardmarket),
// which becomes the card table's price: what a card you don't own costs. Your own copies are priced by their printing
// and finish from printings.json and one print-prices file (engine: copyPrice, ownValue), loaded once the collection
// names a printing. BUY.cur is the currency you chose (Settings, Prices); CURRENCY (engine) the one in use, which
// stays dollars when the data has no euros.
let PRICES_UPDATED = null;
let PRICE_DOC = null, PRICE_BASE = null;   // prices.json as loaded; the card table's own prices, for cards the file has none for
const PRICE_OLD_HOURS = 26;                // older than this, the screens that total prices say so (the site refreshes once a day)
const wantCurrency = () => (typeof BUY !== "undefined" && BUY.cur === "eur" ? "eur" : "usd");
const eurosOffered = () => !!(PRICE_DOC && Array.isArray(PRICE_DOC.lowEur));
function applyPrices() {
  const j = PRICE_DOC; if (!j || !DATA) return;
  if (!PRICE_BASE || PRICE_BASE.length !== DATA.cards.length) PRICE_BASE = DATA.cards.map(c => c[3] || 0);
  const eur = wantCurrency() === "eur" && eurosOffered(), low = eur ? j.lowEur : Array.isArray(j.low) ? j.low : null;
  setCurrency(eur ? "eur" : "usd");
  // In dollars a card with no cheapest printing keeps the one price the file or the table has; in euros it has none.
  DATA.cards.forEach((c, i) => { const p = low ? low[i] : null; c[3] = p != null ? p : eur ? 0 : j.prices[i] != null ? j.prices[i] : PRICE_BASE[i]; });
  CHANGE++;
}
// Daily prices: overlay them on the card table when they belong to it.
function loadPrices() {
  if (!FILES().prices || !DATA) return Promise.resolve("none");
  const version = DATA.version;
  return dataFetch(dataUrl("prices.json"), { cache: "no-cache" }).then(async r => {
    const saved = r.headers.get("X-BT-Saved"), j = r.ok ? await r.json() : null;
    if (!j || !DATA || DATA.version !== version || !Array.isArray(j.prices)) return "failed";
    if (j.version !== version) return "newer";            // the site has rebuilt its card data: these prices belong to it
    const same = !!PRICE_DOC && PRICE_DOC.version === j.version && PRICE_DOC.updated === j.updated;
    if (!same) {                                          // the file already in use changes nothing on screen
      PRICE_DOC = j; PRICES_UPDATED = j.updated || null;
      applyPrices();
      if (typeof renderAll === "function") renderAll();
    }
    return saved ? "saved" : same ? "same" : "fresh";
  }).catch(() => "failed");
}
// Every printing (the address names the data version, so the saved copy is right) and its prices in the currency in
// use: asked for once the collection names a printing, and again when the currency changes or prices are refreshed.
let printsState = "idle", printPriceAsked = "";   // idle | loading | ready | failed; the currency whose prices were last asked for
const collNamesPrints = () => !!(COLL && COLL.entries.some(e => e.set && e.cn));
function loadPrintings(again = false) {
  if (!DATA || !FILES().printings || !collNamesPrints()) return;
  if (printsState === "idle") {
    printsState = "loading";
    const version = DATA.version;
    dataFetch(dataUrl("printings.json"), undefined, false).then(r => r.ok ? r.json() : null)
      .then(j => { printsState = DATA && DATA.version === version && setPrintings(j) ? "ready" : "failed"; })
      .catch(() => { printsState = "failed"; })
      .then(() => { if (printsState === "ready") { printPriceAsked = ""; loadPrintings(); tellWorker(); } });
    return;
  }
  if (printsState !== "ready" || (printPriceAsked === CURRENCY && !again)) return;
  printPriceAsked = CURRENCY;
  const cur = CURRENCY;
  dataFetch(dataUrl(cur === "eur" ? "print-prices-eur.json" : "print-prices.json"), { cache: "no-cache" }).then(r => r.ok ? r.json() : null)
    .then(j => { if (cur === CURRENCY && setPrintPrices(j) && typeof renderAll === "function") renderAll(); })
    .catch(() => { if (printPriceAsked === cur) printPriceAsked = ""; });       // asked again at the next redraw
}
// The currency you chose changed (Settings, or a sync): the table and your copies follow.
function currencyChanged() {
  applyPrices(); tellWorker(); loadPrintings();
  if (typeof renderAll === "function") renderAll();
}

// How old the prices in use are. Scryfall calls prices "dangerously stale after 24 hours"; Matt (Nov 12): "alert users
// if their price data is outdated… and give them the option to refresh data at that point if they're online. Warning
// should be there regardless." The line is drawn at PRICE_OLD_HOURS, since the site's daily refresh lands a little
// later some days than others.
let PRICE_CHECK = { at: 0, got: "" };      // the last refresh asked for here: when, and what came of it
const pricesAgeHours = () => (PRICES_UPDATED ? (Date.now() - Date.parse(PRICES_UPDATED)) / 36e5 : 0);
const pricesOld = () => !!(DATA && !DATA.demo && PRICES_UPDATED && pricesAgeHours() > PRICE_OLD_HOURS);
function pricesAgeText() { const h = pricesAgeHours(); return h < 48 ? "more than a day old" : `${Math.floor(h / 24)} days old`; }
// The warning, for every screen that totals prices: "" while they are fresh.
function pricesOldHTML() {
  if (!pricesOld()) return "";
  const checked = Date.now() - PRICE_CHECK.at < 6e5 ? PRICE_CHECK.got : "";
  const next = offline() ? "They'll update when you're back online."
    : checked === "same" ? "The site has nothing newer yet."
    : checked === "newer" ? `Newer card data is ready. <button class="btn link" data-reload>Reload</button>`
    : checked === "loading" ? "Checking…"
    : `${checked === "failed" || checked === "saved" ? "The site didn't answer. " : ""}<button class="btn link" data-prices-refresh>Refresh</button>`;
  return `<p class="small price-old" data-price-old><span class="warn">Prices are ${pricesAgeText()}</span> (from ${esc(shortDate(Date.parse(PRICES_UPDATED)))}). ${next}</p>`;
}
// Ask the site for today's prices. Quiet: when the page comes back into view with old prices (an installed app can
// stay open for days), with no message unless something changed on screen.
async function refreshPrices(quiet = false) {
  if (!DATA || !FILES().prices || PRICE_CHECK.got === "loading") return;
  PRICE_CHECK = { at: Date.now(), got: "loading" };
  if (!quiet) repaintPriceOld();
  const got = await loadPrices();
  PRICE_CHECK = { at: Date.now(), got };
  if (got === "fresh") { loadPrintings(true); if (!quiet) toast("Prices updated"); }
  else if (got === "newer" && typeof newVersionReady === "function") newVersionReady("Newer card data is ready.");
  repaintPriceOld();
}
function repaintPriceOld() { document.querySelectorAll("[data-price-old]").forEach(el => { el.outerHTML = pricesOldHTML(); }); }
document.addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-prices-refresh]")) refreshPrices(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && pricesOld() && !offline() && Date.now() - PRICE_CHECK.at > 18e5) refreshPrices(true);
});

// Format legality (legal.json, refreshed daily): loaded the first time something shows or filters by it.
let legalState = "idle";   // idle | loading | ready | failed
function loadLegal() {
  if (legalState !== "idle" || !FILES().legal || !DATA) return;
  legalState = "loading";
  dataFetch(dataUrl("legal.json"), { cache: "no-cache" }).then(r => r.ok ? r.json() : null)
    .then(j => { legalState = setLegal(j) ? "ready" : "failed"; })
    .catch(() => { legalState = "failed"; })
    .then(() => {
      if (view === "browse") renderBrowse();
      if ($("#filters") && $("#filters").open) renderFilters();
      const dlg = $("#sheet"); if (dlg && dlg.open) paintFormats();
      if (view === "build") paintBracket();
    });
}
// Whether this data can show formats at all (it has the file, and it hasn't failed to load).
const formatsOffered = () => !!(FILES().legal && DATA && legalState !== "failed");

// ------------------------------------------------------------ two-faced cards
// A card whose picture has a back (transform, modal double-faced…) gets a flip button wherever it's pictured.
// Flipping is per card for the visit (FLIP), so every picture of it turns together. Scryfall keeps a back face's
// picture at the front's address with /back/ for /front/, for every size and the art crop alike.
const FLIP = new Set();   // norm names showing their back
function hasBack(name) {
  const k = norm(name), i = LOOKUP.get(k), v = IMG.get(k);
  return (i != null && BACKS.has(i)) || !!(v && v.back);
}
const showsBack = name => FLIP.has(norm(name)) && hasBack(name);
const faceUrl = (url, back) => url && back ? url.replace("/front/", "/back/") : url;
function backName(name) {   // the back face's own name when its text is here, else "Name (back)"
  const f = TEXT.get(norm(name)), b = f && f[1];
  return (b && (b.name || b[0])) || `${name} (back)`;
}
function flipBtnHTML(name, cls = "") {
  if (!hasBack(name)) return "";
  const on = showsBack(name);
  return `<button class="flip-btn${cls ? " " + cls : ""}" data-flip="${esc(name)}" aria-pressed="${on}" aria-label="Show the ${on ? "front" : "back"} of ${esc(name)}">${MARK.flip} ${on ? "Front" : "Back"}</button>`;
}
// A picture tile, with its flip button under it when the card has a back (buttons can't nest).
const tileCell = (tile, name) => hasBack(name) ? `<div class="ccell">${tile}${flipBtnHTML(name)}</div>` : tile;
function setFlip(name, on) {
  const k = norm(name);
  if (on) FLIP.add(k); else FLIP.delete(k);
  refreshFaces(k);
}
// Redraw pictures (all, or one card's) after a flip or once the backs list arrives.
function refreshFaces(k) {
  const sel = k ? `[data-imgk="${CSS.escape(k)}"]` : "[data-imgk]";
  document.querySelectorAll(`.cimg${sel}`).forEach(el => { el.outerHTML = imgTag(el.dataset.name, el.dataset.size || "normal"); });
  document.querySelectorAll(".cimg[data-pid]").forEach(el => {
    if (k && norm(el.dataset.name) !== k) return;
    const img = el.querySelector("img"); if (!img) return;
    const back = showsBack(el.dataset.name); img.src = faceUrl(directImg(el.dataset.pid, "normal"), back); img.alt = back ? backName(el.dataset.name) : el.dataset.name;
  });
  if (!k) { rerenderCurrent(); if ($("#hand") && $("#hand").open) renderHand(); const dlg = $("#sheet"); if (dlg.open && SHEET_NOW && SHEET_NOW.card) openSheet(...SHEET_NOW.card); }
  else document.querySelectorAll("[data-flip]").forEach(b => {   // in place, so a pressed button keeps focus
    if (norm(b.dataset.flip) !== k) return;
    const on = showsBack(b.dataset.flip);
    b.setAttribute("aria-pressed", String(on)); b.textContent = `${MARK.flip} ${on ? "Front" : "Back"}`;
    b.setAttribute("aria-label", `Show the ${on ? "front" : "back"} of ${b.dataset.flip}`);
  });
  paintImgs();
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-flip]"); if (!t) return;
  e.preventDefault(); setFlip(t.dataset.flip, !showsBack(t.dataset.flip));
});

function imgTag(name, size = "normal") {
  const k = norm(name), down = IMG_DOWN.get(k);
  if (down && !stillDown(down)) forgetDown(k);          // it failed for want of a connection: ask again
  if (!IMG.has(k)) { const d = directFor(name); if (d) IMG.set(k, d); }
  const hit = IMG.get(k);
  if (hit === undefined && !waitForIds()) queueImg(name);
  const back = showsBack(name), src = hit ? faceUrl(hit[size] || hit.normal || hit.small, back) : "", alt = back ? backName(name) : name;
  return `<span class="cimg" data-imgk="${esc(k)}" data-size="${size}" data-name="${esc(name)}">${src
    ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`
    : `<span class="cph">${esc(name)}</span>`}</span>`;
}
function queueImg(name) {
  const k = norm(name);
  if (imgQueue.has(k) || imgInflight.has(k)) return;
  const sid = noDirect.has(k) ? null : sidFor(name);
  imgQueue.set(k, sid ? { id: sid } : { name: String(name).split(" // ")[0] });
  clearTimeout(imgTimer); imgTimer = setTimeout(flushImgs, 40);
}
const sleep = ms => new Promise(res => setTimeout(res, ms));
let imgLimited = 0;            // rate-limited retries in a row
let imgLastCall = 0;           // when the last lookup went out, across runs of flushImgs
let imgCoolUntil = 0;          // after a 429, nothing goes out before this, retries and new cards alike
async function flushImgs() {
  if (imgBusy) { imgTimer = setTimeout(flushImgs, 250); return; }
  imgBusy = true;
  while (imgQueue.size) {
    const batch = [...imgQueue.entries()].slice(0, 75);
    batch.forEach(([k]) => { imgQueue.delete(k); imgInflight.add(k); });
    let answered = false;
    try {
      const wait = Math.max(imgLastCall + IMG_GAP, imgCoolUntil) - Date.now(); if (wait > 0) await sleep(wait);
      imgLastCall = Date.now();
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ identifiers: batch.map(([, id]) => id) }),
      });
      answered = true;
      if (r.status === 429) {
        // Scryfall locks the API for 30 s: every later request waits it out. The batch goes back in the
        // queue up to 3 times in a row; after that it's marked failed (Try again / reopening asks later,
        // still after the cool-off), so a long lockout never turns into a stream of requests.
        imgCoolUntil = Date.now() + Math.max(IMG_RETRY_MS, (+r.headers.get("Retry-After") || 0) * 1000);
        if (imgLimited < 3) {
          imgLimited++;
          batch.forEach(([k, id]) => { imgInflight.delete(k); imgQueue.set(k, id); });
          continue;
        }
      }
      if (!r.ok) throw new Error(String(r.status));
      imgLimited = 0;
      const data = await r.json();
      const byName = new Map(), byId = new Map(), textBy = new Map();
      for (const c of data.data || []) {
        const art = c.artist || ((c.card_faces || [])[0] || {}).artist;
        if (art) { PRINT_ARTIST.set(c.id, art); PRINT_ARTIST.set("n:" + norm(c.name), art); }
        const u = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris);
        const back = !c.image_uris && !!(c.card_faces && c.card_faces[1] && c.card_faces[1].image_uris);
        const v = u ? { small: u.small, normal: u.normal, ...(back ? { back: true } : {}) } : null;
        byName.set(norm(c.name), v); byId.set(c.id, v);
        textBy.set(c.id, cardFaces(c)); textBy.set(norm(c.name), cardFaces(c));
      }
      for (const [k, id] of batch) {
        const cur = IMG.get(k);
        if (!(cur && cur.direct)) IMG.set(k, (id.id && byId.get(id.id)) || byName.get(k) || null);
        TEXT.set(k, (id.id && textBy.get(id.id)) || textBy.get(k) || null);
        LOOKUP_FAILED.delete(k);
      }
    } catch {
      for (const [k] of batch) {                              // offline or blocked, or Scryfall said no
        if (!IMG.has(k)) IMG.set(k, null); if (!TEXT.has(k)) TEXT.set(k, null); LOOKUP_FAILED.add(k);
        if (!answered) markDown(k);                          // no answer at all: tried again when the connection is back
      }
    }
    batch.forEach(([k]) => imgInflight.delete(k));
    paintImgs(); paintText();
  }
  imgBusy = false;
  saveImgCache();
}
// An image that didn't load: a direct address falls back to a lookup by name once; otherwise the name shows.
// With no connection the address isn't at fault: it is kept, and the picture is asked for again when the connection is
// back (before 0.50.1 the card was written off until the app was closed, and then shown in another printing).
function imgFailed(el) {
  if (!el.querySelector("img")) return;                  // already handled (two listeners can see one failure)
  const k = el.dataset.imgk, v = IMG.get(k);
  el.innerHTML = `<span class="cph">${esc(el.dataset.name)}</span>`;
  if (navigator.onLine === false) { markDown(k); return; }
  if (v && v.direct && !noDirect.has(k)) { noDirect.add(k); IMG.delete(k); queueImg(el.dataset.name); }
}
document.addEventListener("error", e => { const el = e.target && e.target.tagName === "IMG" && e.target.closest(".cimg"); if (el) imgFailed(el); }, true);
function paintImgs() {
  document.querySelectorAll("[data-imgk]").forEach(el => {
    if (el.querySelector("img")) return;
    const k = el.dataset.imgk, down = IMG_DOWN.get(k);
    if (down) { if (stillDown(down)) return; forgetDown(k); }
    if (!IMG.has(k)) { const d = directFor(el.dataset.name); if (d) IMG.set(k, d); else if (!waitForIds()) queueImg(el.dataset.name); }
    const v = IMG.get(k); if (!v) return;
    const back = showsBack(el.dataset.name), src = faceUrl(v[el.dataset.size] || v.normal || v.small, back); if (!src) return;
    const img = new Image();
    img.alt = back ? backName(el.dataset.name) : el.dataset.name; img.loading = "lazy"; img.decoding = "async"; img.src = src;
    img.addEventListener("error", () => imgFailed(el));
    el.innerHTML = ""; el.appendChild(img);
  });
}

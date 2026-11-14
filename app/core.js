"use strict";
// Bulk Tutor, the page's script, part "core": helpers, browser storage, loading the card data (and private mode), the connection, banners, keeping focus across redraws.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Icons from icons.svg (Matt is drawing replacements: design/logo-brief.md, design/icons.html shows the set).
const icon = (name, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} aria-hidden="true"><use href="icons.svg#${name}"/></svg>`;
// Small marks the script writes, in one place so they can be redrawn together (theme.css holds the
// stylesheet's fold markers). Text characters today; one that Matt draws becomes icon("…") here.
const MARK = {
  go: "›", back: "←", backTo: "‹", open: "▾", sortUp: "▴", sortDown: "▾", jump: "↓", becomes: "→",
  remove: "✕", removeRow: "×", pass: "✓", fail: "✕", unsure: "?", under: "−", selected: "✓",
  flip: "↻", info: "i", fewer: "−", more: "+", commander: "★", swaps: "⇄",
  toSide: "↓", toDeck: "↑",   // a card to the sideboard (it sits under the list) and back; Matt may change these (Nov 11)
};
// The page's own markup marks its few glyphs with data-mark, so they follow MARK too.
document.querySelectorAll("[data-mark]").forEach(e => { e.innerHTML = MARK[e.dataset.mark]; });
// In the currency the prices in use are in (engine CURRENCY: dollars, or euros once you choose them in Settings).
const CUR_SIGN = { usd: "$", eur: "€" }, CUR_NAME = { usd: "US dollars", eur: "euros" };
const curSign = () => CUR_SIGN[CURRENCY] || "$";
const money = n => curSign() + (n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2));
const TYPE_NAMES = { C: "Creatures", I: "Instants", S: "Sorceries", A: "Artifacts", E: "Enchantments", P: "Planeswalkers", B: "Battles", L: "Lands", O: "Other" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// Bulk Tutor was called Binder Brew, and a build was a "brew": move anything saved under the old
// names, once. Safe to run every time; it only acts while old keys are still there.
(function moveOldKeys() {
  const renamed = { "df.collection": "bt.collection", "df.view": "bt.view", "df.prefix": "bt.prefix",
    "bb.brews": "bt.builds", "bb.brew": "bt.build", "bb.brewmode": "bt.buildmode" };
  for (const k of ["password", "group", "sort", "cardview", "img", "decks", "fold", "install", "dbx", "dbx-pkce", "tomb", "csvdone", "theme", "hs-sync"]) renamed["bb." + k] = "bt." + k;
  for (const [from, to] of Object.entries(renamed)) {
    const v = store.get(from); if (v === null) continue;
    if (store.get(to) !== null || store.set(to, v)) store.del(from);
  }
  if (store.get("bt.view") === "brew") store.set("bt.view", "build");
})();
// Colour markers (0.86.0; Matt, Nov 12: "using the real color markers throughout"): Magic's own mana symbol for each
// colour, the same ones costs use (cards.js symHTML: Scryfall's image, or the drawn stand-in when it can't load).
const pip = c => `<span class="pip">${symHTML(c)}</span>`;
const pips = colors => { const cs = (colors || "C").split(""); return `<span class="pips" role="img" aria-label="${cs.map(c => COLOR_NAMES[c] || c).join(", ")}">${cs.map(pip).join("")}</span>`; };

// ------------------------------------------------------------ state
let RESULTS = [];         // computed deck matches
let view = "decks";
let shown = 40;
const colorSel = new Set();

// ------------------------------------------------------------ data
// ------------------------------------------------------------ private mode
// When the data files are published encrypted (decks.json.enc), the page asks for a
// password. Format: OpenSSL "enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256" of gzipped JSON.
let PASSWORD = null;

async function decryptFile(buf, password) {
  const bytes = new Uint8Array(buf);
  if (new TextDecoder().decode(bytes.slice(0, 8)) !== "Salted__") throw new Error("not encrypted");
  const salt = bytes.slice(8, 16), body = bytes.slice(16);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 }, base, 384));
  const key = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-CBC", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: bits.slice(32, 48) }, key, body);
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

// ------------------------------------------------------------ connection
// Whether the app is working without the network. navigator.onLine only knows about having no connection at all, so
// NET.down also records that the site's own data didn't answer: a request failed, or the service worker handed over
// its saved copy because the network failed (sw.js marks that response "X-BT-Saved: offline").
const NET = { down: false, slow: new Set(), newer: false, told: false, early: new Map() };
const offline = () => navigator.onLine === false || NET.down;
// A slow connection (0.50.2): the worker handed over saved copies of these files instead of waiting ("X-BT-Saved: slow").
// A file leaves the set when its download arrives unchanged (the worker's "data-late"), or with a live answer; one that
// arrived changed stays, since the screen still shows the older copy, and the person is offered a reload.
const fileOf = url => String(url).split("?")[0].replace(/^\.\//, "");
function slowSeen(url, on) {
  const f = fileOf(url), had = NET.slow.size;
  if (on) NET.slow.add(f); else NET.slow.delete(f);
  if (!had !== !NET.slow.size) renderStatus();
  slowTell();
  if (on && NET.early.has(f)) { const m = NET.early.get(f); NET.early.delete(f); dataLate(m); }   // its download beat its answer here
}
// Said once per visit, when the marker first shows with the card data loaded (the chip has no room for the date on a phone).
function slowTell() { if (NET.slow.size && !NET.told && DATA) { NET.told = true; toast(slowText(), null, null, 6000); } }
const slowText = () => `Slow connection. Showing the card data saved on this device${DATA && !DATA.demo ? `, from ${shortDate(DATA.version)}` : ""}.`;
function dataLate(m) {
  if (m.down) { NET.slow.clear(); netSeen(true); renderStatus(); return; }          // it never arrived: that's offline
  // A download that lands just after the saved copy went out can be reported before this page has read that answer:
  // kept a few seconds for slowSeen. (Also another page's file, which then simply expires.)
  if (!NET.slow.has(m.file)) { NET.early.set(m.file, m); setTimeout(() => { if (NET.early.get(m.file) === m) NET.early.delete(m.file); }, 10000); return; }
  if (!m.changed) { slowSeen(m.file, false); return; }
  NET.newer = true; renderStatus();
  newVersionReady("Newer card data is ready.");
}
function netSeen(down) {
  if (NET.down === down) return;
  NET.down = down; renderStatus(); repaintPriceOld();        // the warning on old prices says whether Refresh can work
  if (!down) { netBack(); if (pricesOld() && Date.now() - PRICE_CHECK.at > 6e4) refreshPrices(true); }   // back online: today's prices, quietly
}
// Every request for the site's own data goes through here. `live` = this request always tries the network (card text
// and picture IDs are answered from the saved copy when there is one, which says nothing about the connection).
async function dataFetch(url, opts, live = true) {
  let r;
  try { r = await fetch(url, opts); } catch (e) { netSeen(true); throw e; }
  const why = r.headers.get("X-BT-Saved");
  if (why === "offline") netSeen(true); else if (why === "slow") slowSeen(url, true); else if (live && !why) { netSeen(false); slowSeen(url, false); }
  return r;
}

// Loads data/<name>.json, or its encrypted .enc copy (the encrypted copy wins if both exist).
// Returns the parsed JSON or null if neither exists. Throws "locked" if a password is needed, "password" if the one
// given doesn't open the file, and "unreachable" if the answer isn't known: no connection and no saved copy, or a
// server error. Only "password" may cost a remembered password: a failed request says nothing about it.
let DATA_ENC = false;     // the data is published encrypted (private mode)
async function loadJSON(name) {
  const get = async file => {
    let r;
    try { r = await dataFetch(`data/${file}`, { cache: "no-cache" }); } catch { throw new Error("unreachable"); }
    if (r.ok) return r;
    if (r.status === 404 || r.status === 410) return null;
    throw new Error("unreachable");
  };
  // Both are asked for at once: on a slow connection each is answered from its saved copy after the worker's
  // time limit, and one after the other would wait that limit twice.
  const plain = get(`${name}.json`); plain.catch(() => {});
  let enc = null, unsure = false;
  try { enc = await get(`${name}.json.enc`); } catch { unsure = true; }
  if (enc) {
    let buf;
    try { buf = await enc.arrayBuffer(); } catch { throw new Error("unreachable"); }
    if (new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(8, buf.byteLength))) !== "Salted__") throw new Error("unreachable");   // not the file: an error page
    DATA_ENC = true;
    if (!PASSWORD) throw new Error("locked");
    try { return await decryptFile(buf, PASSWORD); } catch { throw new Error("password"); }
  }
  const r = await plain;
  if (!r && unsure) throw new Error("unreachable");     // the plain file isn't there and the encrypted one didn't answer
  if (r) DATA_ENC = false;
  return r ? r.json() : null;
}

function showLock(message) {
  $("#lock").hidden = false;
  $("#lock-msg").textContent = message || "";
  $("#lock-msg").hidden = !message;
  document.querySelector("nav.tabs").hidden = true;
  for (const name of ["decks", "deck", "build", "combos", "collection", "import", "browse"]) $("#view-" + name).hidden = true;
  $("#banners").hidden = true;
  setTimeout(() => $("#lock-pass").focus(), 0);
}

async function unlock() {
  const pass = $("#lock-pass").value;
  if (!pass) return;
  $("#lock-go").disabled = true; $("#lock-go").textContent = "Unlocking…";
  PASSWORD = pass;
  const st = await loadData();
  $("#lock-go").disabled = false; $("#lock-go").textContent = "Unlock";
  if (st === "unreachable") { PASSWORD = null; showLock(offline() ? "You're offline. Connect to unlock Bulk Tutor." : "The card data didn't load. Try again in a moment."); return; }
  if (st !== "ok" && st !== "missing") { PASSWORD = null; showLock("That password didn't work."); return; }
  if ($("#lock-remember").checked) store.set("bt.password", pass); else store.del("bt.password");
  $("#lock").hidden = true;
  document.querySelector("nav.tabs").hidden = false;
  await finishStart();
}

// How loading the card data went: "ok", "missing" (the site has none), "unreachable" (no answer and no saved copy),
// "locked" (it needs a password) or "password" (the password doesn't open it, or the file is damaged).
let DATA_STATE = "loading";
async function loadData() {
  try {
    DATA = await loadJSON("decks");
    DATA_STATE = DATA ? "ok" : "missing";
    setData(DATA);
    loadPrices();
    tellWorker();
  } catch (e) {
    DATA = null;
    DATA_STATE = ["locked", "password", "unreachable"].includes(e.message) ? e.message : PASSWORD ? "password" : "missing";
  }
  renderStatus();
  return DATA_STATE;
}
// Tell the service worker which data this visit runs on. It drops saved files of older data, and saves the weekly
// files this visit hasn't asked for (combos, picture IDs, legality, tokens), so the next visit works with no connection:
// on a first visit the card data itself is among them, because it was fetched before the worker was in charge.
// Every card's text comes last (0.51.0: about 2 MB to download after each weekly rebuild), so a card never opened
// before can be read with no connection.
function tellWorker() {
  if (!DATA || !DATA.version || !("serviceWorker" in navigator)) return;
  const enc = DATA_ENC ? ".enc" : "", f = FILES();
  const files = [`data/decks.json${enc}`, `data/combos.json${enc}`, ...["images", "legal", "prices", "tokens"].filter(k => f[k]).map(k => dataUrl(`${k}.json`)),
    // Every printing and its prices, once your collection names one (cards.js loadPrintings): your cards' value offline.
    ...(f.printings && collNamesPrints() ? [dataUrl("printings.json"), dataUrl(CURRENCY === "eur" ? "print-prices-eur.json" : "print-prices.json")] : []),
    ...Array.from({ length: f.text || 0 }, (_, b) => dataUrl(`text/${String(b).padStart(2, "0")}.json`))];
  navigator.serviceWorker.ready.then(reg => { if (reg.active) reg.active.postMessage({ type: "data", version: String(DATA.version), files }); }).catch(() => {});
}

function renderStatus() {
  renderStatusText();
  const el = $("#status"), warn = el.classList.contains("demo") || el.classList.contains("stale"), g = $("#gear");
  g.classList.toggle("has-warn", warn);
  g.setAttribute("aria-label", warn ? `Settings (${$("#status-text").textContent})` : "Settings");
  if (view === "settings") renderSettings();
}
function renderStatusText() {
  const el = $("#status"), t = $("#status-text");
  el.className = "status"; el.title = "";
  if (!DATA && !$("#lock").hidden) { el.classList.add("demo"); t.textContent = "Restricted"; return; }
  if (offline()) {
    // Shown on phones too (styles.css): a basement with no signal is where this gets used.
    el.classList.add("off"); t.textContent = "Offline";
    el.title = DATA ? `No connection. Bulk Tutor is using the card data saved on this device${DATA.demo ? "" : `, from ${shortDate(DATA.version)}`}.`
      : "No connection, and the card data isn't saved on this device yet.";
    return;
  }
  if (DATA && NET.slow.size) {
    // Shown on phones too, like Offline: what's on screen may be older than what the site has.
    el.classList.add("slow"); t.innerHTML = `Slow<span class="wide"> connection</span>`; slowTell();   // "Slow" on a phone: the full label wraps the header
    el.title = `${slowText()} ${NET.newer ? "Newer data has arrived: reload to use it." : "Newer data, if there is any, is on its way."}`;
    return;
  }
  if (!DATA && DATA_STATE === "unreachable") { el.classList.add("stale"); t.textContent = "Data didn't load"; return; }
  if (!DATA) { el.classList.add("stale"); t.textContent = "No deck data"; return; }
  if (DATA.demo) { el.classList.add("demo"); t.textContent = "Demo data"; return; }
  const built = new Date(DATA.version);
  // Calendar days in the viewer's time zone, not 24-hour periods: data built at 11pm shows as
  // "yesterday" the next morning. (Rounding absorbs daylight-saving hours.)
  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(built)) / 864e5);
  if (days > 14) el.classList.add("stale");
  // Short enough to sit beside the title on a phone; the details are in the tooltip.
  const date = shortDate(built);
  t.textContent = `Updated ${days === 0 ? "today" : days === 1 ? "yesterday" : date}`;
  el.title = `${DATA.edhrec === false ? "Card prices and combos" : "Deck lists, card prices and combos"} updated ${date}${days > 1 ? ` (${days} days ago)` : ""}`;
}

// Which price a screen shows (0.68.0; Matt, Nov 12). priceOf: what the card costs to buy, its cheapest printing (the
// card table's price). priceNum and priceText: beside a card on a screen, your own copies' price by their printing and
// finish when you have it (the copies in `loc` when the screen is one location; a range when they differ), else the
// cheapest printing's. Totals of your cards add engine copyPrice(entry) or ownValue(name, loc).sum.
const priceOf = name => tablePrice(name);
const priceNum = (name, loc = null) => shownPrice(name, loc).hi;
const priceText = (name, loc = null) => { const p = shownPrice(name, loc); return !p.hi ? "" : p.lo < p.hi ? `${money(p.lo)}–${money(p.hi)}` : money(p.hi); };

// ------------------------------------------------------------ render: banners
function renderBanners() {
  const b = [];
  if (DATA && DATA.demo) b.push(`<div class="banner"><span><strong>Demo data.</strong> The cards, decks and prices here are a small made-up set for trying Bulk Tutor out, not real card data.</span></div>`);
  if (!DATA && DATA_STATE === "unreachable") b.push(`<div class="banner"><span>${offline()
    ? `<strong>You're offline.</strong> The card data isn't saved on this device yet. Your collection still works on the Collection tab, and the rest loads when you're back online.`
    : `<strong>The card data didn't load.</strong> The site answered with an error. Your collection still works on the Collection tab.`}</span><button class="btn" data-reload>Try again</button></div>`);
  else if (!DATA) b.push(`<div class="banner"><span><strong>No deck data found.</strong> The data file hasn't been built yet. Your collection still works on the Collection tab.</span></div>`);
  if (COLL && COLL.example && !needsWelcome()) b.push(`<div class="banner info"><span><strong>Example collection.</strong> You're seeing sample cards. Import yours to see your own matches.</span><button class="btn primary" data-go="import">Import your collection</button></div>`);
  // Once, after the first open of 0.88.0 brought the collection over (record.js): the counts before and after.
  const mv = movedInfo();
  if (mv && !mv.seen && COLL && !COLL.example && !COLL.fromLink) b.push(`<div class="banner info" id="moved-note"><span><strong>Bulk Tutor keeps your collection in a new way now.</strong> It was brought over as it was: ${countsWords(mv.before)} before, ${countsWords(mv.after)} after. The copy from before is still in this browser: Settings, Backups.</span><button class="btn" data-moved-ok>Got it</button></div>`);
  if (MOVE_FAILED) b.push(`<div class="banner" id="move-failed"><span><strong>Your collection couldn't be brought over to this version.</strong> Nothing is lost: it is still in this browser as it was. Download it under Backups in Settings, and please report this from About.</span><button class="btn" data-settings>Settings</button></div>`);
  if (COLL && COLL.fromLink) b.push(`<div class="banner info"><span>Loaded a collection from a link (${COLL.entries.length} entries).</span><button class="btn" id="keep-link">Save it in this browser</button></div>`);
  if (showInstallHint()) b.push(installHintHTML());
  if (showHomeScreenSyncHint()) b.push(`<div class="banner info"><span><strong>Already using Bulk Tutor in Safari?</strong> The Home Screen app keeps its own copy of your data. Connect Dropbox to bring your builds and saved decks over; a backup file brings your collection for now.</span>
    <span class="actions"><button class="btn primary" data-dbx="connect">Connect Dropbox</button><button class="btn" data-hs-dismiss>Not now</button></span></div>`);
  $("#banners").innerHTML = b.join("");
  $("#banners").hidden = !b.length;
}

// The screens that are nothing without the card data (Workbench, Combos, Find decks) say so in its place, and why:
// no connection and no saved copy (or a server error), or a site whose data hasn't been built.
function noDataHTML(what) {
  if (DATA_STATE !== "unreachable") return `<div class="empty panel"><p>${what} the card data, which hasn't been built yet.</p></div>`;
  // The banner above says why (offline, or an error) and offers Try again; this says what that means here.
  return `<div class="empty panel"><p>${what} the card data, which isn't saved on this device yet.</p>
    <div class="actions"><button class="btn primary" data-go="collection">Open your collection</button></div></div>`;
}

// ------------------------------------------------------------ keep focus across re-renders
// Screens are redrawn with innerHTML after almost every tap, which drops keyboard focus to the top
// of the page. These wrappers note the focused control (by id, or by its data-* attributes, which
// every action button carries) before a redraw and focus the same control afterwards.
function focusKey(el) {
  if (!el || el === document.body) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  const attrs = [...el.attributes].filter(x => x.name.startsWith("data-")).map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join("");
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}
function withFocus(fn, rootSel) {
  return function (...args) {
    const a = document.activeElement, root = document.querySelector(rootSel);
    const key = a && root && root.contains(a) ? focusKey(a) : null;
    const out = fn.apply(this, args);
    if (key) {
      const again = document.querySelector(rootSel), el = again && again.querySelector(key);
      if (el && el !== document.activeElement) try { el.focus({ preventScroll: true }); } catch {}
    }
    return out;
  };
}

"use strict";
// Bulk Tutor, the page's script, part "collection": the Collection screen, buying-list price ranges, locations (icons, which are decks, who leads a deck), Settings.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ render: collection
// The Collection page (redesign, 0.28.0): a compact summary, search, Decks, Binders and boxes, then Stats and
// Export folded. Search opens the collection browser (BROWSE) with every card; its filters live in a sheet.
const SEARCH_ICON = icon("i-search", "search-ico");
// Where the dearest copy of a card is (Most valuable names one place).
const dearestLoc = name => { let best = null; for (const c of ownCopies(name)) if (!best || c.price > best.price) best = c; return best ? best.e.loc : ""; };
// How the values on this screen are worked out, in a sentence (the whole account is in About, Prices).
function valueNoteHTML() {
  const src = CURRENCY === "eur" ? "Cardmarket's" : "TCGplayer's market";
  return printPricesReady()
    ? `Each copy is valued by its own printing and finish where your import names them, at ${src} price for a Near Mint copy. A copy with no printing named counts as the card's cheapest printing.`
    : `Values use each card's cheapest printing, at ${src} price for a Near Mint copy${collNamesPrints() && FILES().printings ? "; your own printings' prices are loading" : ""}.`;
}
function renderCollection() {
  const el = $("#view-collection");
  if (!COLL || !AGG.size) {
    el.innerHTML = `<div class="empty panel"><p>No collection yet.</p><button class="btn primary" data-go="import">Import your collection</button></div>${changesLeadHTML()}`;   // an import undone leaves no cards, and its row to do it again
    return;
  }
  let total = 0, value = 0, unpriced = 0;
  const byColor = new Map(), byType = new Map(), priced = [];
  for (const [k, a] of AGG) {
    total += a.qty;
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    const own = ownValue(a.name), p = own.hi;          // each copy by its own printing and finish (engine)
    if (!c && !BASICS.has(k)) unpriced += a.qty;
    value += own.sum;
    if (c) {
      const col = c[1].length > 1 ? "M" : c[1];
      byColor.set(col, (byColor.get(col) || 0) + a.qty);
      byType.set(c[2], (byType.get(c[2]) || 0) + a.qty);
      if (p > 0) priced.push({ name: a.name, p, a });
    }
  }
  priced.sort((x, y) => y.p - x.p);
  const bars = (map, names, order) => {
    const entries = order.filter(k => map.has(k)).map(k => [k, map.get(k)]);
    const max = Math.max(...entries.map(e => e[1]), 1);
    return entries.map(([k, v]) => `<div class="bar-row"><span class="label">${names === COLOR_NAMES && k !== "M" ? pips(k) + " " : ""}${names[k] || k}</span><span class="bar"><span style="width:${(v / max * 100).toFixed(1)}%"></span></span><span class="num small">${v.toLocaleString()}</span></div>`).join("");
  };
  const when = COLL.importedAt ? shortDate(Date.parse(COLL.importedAt)) : "";
  const from = COLL.example ? "Example collection" : `From ${esc(COLL.source || "your import")}${when ? `, ${esc(when)}` : ""}`;
  const fold = (k, def, title, note, body) => `<details class="panel fold" data-fold="${k}"${foldOpen(k, def) ? " open" : ""}>
      <summary><h3>${title}</h3><span class="muted small">${note}</span></summary><div class="fold-body">${body}</div></details>`;
  el.innerHTML = `
    <div class="panel coll-sum">
      <h2>Your collection</h2>
      <p class="coll-nums num">${cardsWord(total)} · ${AGG.size.toLocaleString()} unique${DATA ? ` · <span class="value">${money(value)}</span>` : ""}</p>
      <p class="muted small">${from}${DATA && PRICES_UPDATED ? ` · prices ${esc(shortDate(Date.parse(PRICES_UPDATED)))}` : ""}</p>
      ${pricesOldHTML()}
      ${DATA && unpriced ? `<p class="muted small">${unpriced.toLocaleString()} card${unpriced === 1 ? " isn't" : "s aren't"} in the card data yet${DATA.demo ? ` (the demo data only knows ${DATA.cards.length} cards)` : ""}, so ${unpriced === 1 ? "it's" : "they're"} left out of the value and stats.</p>` : ""}
      <div class="actions"><button class="btn primary" data-update>Update collection</button>${ownColl() ? `<button class="btn" id="coll-add" data-add-cards="" aria-haspopup="dialog">Add cards</button>` : ""}<span id="sync-line-slot"></span></div>
    </div>
    ${putAwayLeadHTML()}
    <button class="search-btn" id="coll-search">${SEARCH_ICON}<span>Search your cards</span></button>
    <div id="coll-decks" class="fold-stack"></div>
    ${changesLeadHTML()}
    ${fold("stats", false, "Stats", "value, colors, types", `
      <div><h4 class="subhead">Most valuable</h4><div class="list">${priced.slice(0, 10).map(x => `<div class="line"><span class="name">${esc(x.name)}${x.a.qty > 1 ? ` <span class="muted num">×${x.a.qty}</span>` : ""} <span class="muted small">· ${esc(locName(dearestLoc(x.name)))}</span></span><span class="price num">${money(x.p)}</span></div>`).join("") || `<p class="muted">Prices appear once the card data is loaded.</p>`}</div></div>
      ${DATA ? `<p class="muted small">${valueNoteHTML()}</p>` : ""}
      <div><h4 class="subhead">By color</h4><div class="bars">${bars(byColor, COLOR_NAMES, ["W", "U", "B", "R", "G", "M", "C"])}</div></div>
      <div><h4 class="subhead">By type</h4><div class="bars">${bars(byType, TYPE_NAMES, ["C", "I", "S", "A", "E", "P", "B", "L", "O"])}</div></div>`)}
    ${fold("export", false, "Export", "CSV, card list", `
      <p class="muted small">The CSV has one row per card per location, with whether that location is a deck. Backups (everything, for another device) are in Settings.</p>
      <div class="actions"><button class="btn" id="dl-coll">Download CSV</button><button class="btn" id="copy-coll">Copy as card list</button></div>
      <div id="coll-out"></div>`)}`;
  renderCollectionDecks();
  renderSyncBits();
}

// The Update collection sheet: a new export replaces or adds to the collection (the import page asks which).
function openUpdate() {
  const dlg = $("#update"), body = $("#update-body"); if (!dlg || !body) return;
  const when = COLL && COLL.importedAt ? shortDate(Date.parse(COLL.importedAt)) : "";
  const last = COLL && !COLL.example && COLL.entries.length ? `Last import: ${esc(COLL.source || "a file")}${when ? `, ${esc(when)}` : ""} · ${cardsWord(entryCount(COLL.entries))}` : "";
  body.innerHTML = `<h2 id="update-title">Update your collection</h2>
    ${last ? `<p class="muted small">${last}</p>` : ""}
    <label class="drop udrop" for="update-file"><strong>Choose an export</strong><span class="muted small">A CSV file from ManaBox or another app, or drop it here</span></label>
    <input type="file" id="update-file" accept=".csv,.txt,text/csv,text/plain" hidden>
    <p class="small"><button class="btn link" data-update-paste>Paste a list instead</button> · <button class="btn link" data-which-apps>Which apps work?</button></p>
    ${dbxConnected() ? `<p class="note small"><strong>Already in Dropbox?</strong> A ManaBox export saved to Dropbox › Apps › ${esc(CONFIG.dropboxFolder || "Bulk Tutor")} becomes your collection the next time Bulk Tutor syncs.</p>` : ""}
    <p class="muted small">Your builds and saved decks stay put; their cards are matched to the new collection.</p>
    <div class="sheet-pair"><button class="btn" data-update-close>Cancel</button><label class="btn primary" for="update-file">Choose file</label></div>`;
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
function closeUpdate() { const dlg = $("#update"); if (dlg && dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }
function importFile(f) { closeUpdate(); showView("import"); window.scrollTo({ top: 0 }); return f.text().then(t => doImport(t, f.name)); }
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-update], [data-update-close], [data-update-paste], [data-which-apps]");
  if (!t) { if (e.target.id === "update") closeUpdate(); return; }
  if (t.dataset.update != null) { openUpdate(); return; }
  closeUpdate();
  if (t.dataset.updatePaste != null) { showView("import"); const p = $("#paste"); if (p) { p.focus(); p.scrollIntoView({ block: "center" }); } }
  else if (t.dataset.whichApps != null) { if (view !== "import") showView("import"); const w = $("#which-apps"); if (w) { w.open = true; w.scrollIntoView({ behavior: "smooth", block: "start" }); } }
});
document.addEventListener("change", e => { if (e.target.id === "update-file" && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ""; importFile(f); } });
document.addEventListener("dragover", e => { if (e.target.closest && e.target.closest(".udrop")) { e.preventDefault(); e.target.closest(".udrop").classList.add("over"); } });
document.addEventListener("dragleave", e => { const d = e.target.closest && e.target.closest(".udrop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", e => { const d = e.target.closest && e.target.closest(".udrop"); if (!d) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importFile(f); });

// ------------------------------------------------------------ buying list: price ranges (0.38.0)
// The person's price ranges for the buying list (engine canonBuckets, BUY_DEFAULT): stored in bt.buy and synced in
// builds.json and backups as `buy`, {buckets, at}; the newer one wins as a whole.
// Since 0.68.0 the currency you see prices in lives with them (`cur`: "usd" | "eur"; Settings, Prices): the ranges are in it.
let BUY = { buckets: BUY_DEFAULT, cur: "usd", at: 0 };
const buyCur = j => (j && j.cur === "eur" ? "eur" : "usd");
let BUY_INDECKS = false;   // Assemble's "also cards only in your other decks", for the visit
function loadBuy() {
  try { const j = JSON.parse(store.get("bt.buy") || "null"); if (j && Array.isArray(j.buckets)) BUY = { buckets: canonBuckets(j.buckets), cur: buyCur(j), at: j.at || 0 }; } catch {}
  if (PRICE_DOC) applyPrices();     // prices that arrived before this was read
}
function saveBuy(fromSync) { store.set("bt.buy", JSON.stringify(BUY)); if (!fromSync) syncSoon(); }
function setBuckets(list) { BUY = { buckets: canonBuckets(list), cur: BUY.cur, at: Date.now() }; saveBuy(); }
// The currency prices are shown in. The ranges keep their numbers (2 stays 2): they are yours to set.
function setCurrencyPref(cur) {
  const to = cur === "eur" ? "eur" : "usd"; if (to === BUY.cur) return;
  BUY = { ...BUY, cur: to, at: Date.now() }; saveBuy();
  currencyChanged();
}
// Settings, Prices: the currency, where the prices come from and how old they are.
function pricesPanelHTML() {
  const opt = (k, label) => `<button aria-pressed="${BUY.cur === k}" data-currency="${k}"${k === "eur" && !eurosOffered() ? " disabled" : ""}>${label}</button>`;
  const when = PRICES_UPDATED ? `Updated ${esc(shortDate(Date.parse(PRICES_UPDATED)))}; the site refreshes them once a day.` : "";
  return `<div class="seg seg-fill" role="group" aria-label="Currency" id="cur-seg">${opt("usd", "US dollars")}${opt("eur", "Euros")}</div>
    <p class="muted small">US dollars are TCGplayer's market prices and euros are Cardmarket's, both by way of Scryfall, for Near Mint copies. ${when}${PRICE_DOC && !eurosOffered() ? " This card data has no euro prices." : ""}</p>
    ${pricesOldHTML()}
    <p class="small"><button class="btn link" data-about="prices">How prices work</button></p>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-currency]"); if (!t || t.disabled) return;
  setCurrencyPref(t.dataset.currency);
});
const rangeText = g => g.upTo == null ? (g.from ? `over ${money(g.from)}` : "any price") : g.from ? `${money(g.from)}–${money(g.upTo)}` : `up to ${money(g.upTo)}`;

// ------------------------------------------------------------ location icons
// Each location (a binder, box or deck in the import) can have a symbol and a colour to match the real thing.
// Unset ones use the default for decks or for binders and boxes (Settings). Stored in bt.locstyle and synced in
// builds.json as `locStyle`; each entry carries `at`, and the newer one wins (a reset is an entry with no icon/color).
// `decks` (0.47.0) holds your say on which locations are decks: {loc: {deck: true|false, at}}, merged the same way; an
// entry with no `deck` follows the import again (engine applyDeckMarks; "Choose your decks" below).
const LOC_ICONS = [["deckbox", "Deck box"], ["binder", "Binder"], ["box", "Storage box"], ["tin", "Tin or crate"], ["pile", "Pile or other"]];
const LOC_COLORS = [["black", "Black"], ["white", "White"], ["blue", "Blue"], ["red", "Red"], ["green", "Green"],
  ["yellow", "Yellow"], ["purple", "Purple"], ["orange", "Orange"], ["brown", "Brown"], ["grey", "Grey"]];
const LOC_LIGHT = new Set(["white", "yellow", "grey"]);   // light colours get a dark symbol
const LOC_BUILTIN = { deck: { icon: "deckbox", color: "purple" }, other: { icon: "binder", color: "purple" } };
const iconOk = i => LOC_ICONS.some(x => x[0] === i), colorOk = c => LOC_COLORS.some(x => x[0] === c);
const LOCSTYLE_PARTS = ["locs", "defaults", "decks"];
let LOCSTYLE = { locs: {}, defaults: {}, decks: {} };
function loadLocStyle() {
  try { LOCSTYLE = JSON.parse(store.get("bt.locstyle") || "null") || {}; } catch { LOCSTYLE = {}; }
  for (const k of LOCSTYLE_PARTS) if (!LOCSTYLE[k] || typeof LOCSTYLE[k] !== "object") LOCSTYLE[k] = {};
  syncLocNames();
}
function saveLocStyle(fromSync) { syncLocNames(); store.set("bt.locstyle", JSON.stringify(LOCSTYLE)); if (!fromSync) syncSoon(); }
// ---- a location's name here (0.55.0; Matt, Nov 11: "decks, builds, and the collection objects should all be able to be
// renamed under actions"). A box or binder can go by another name in Bulk Tutor: LOCSTYLE.locs[loc].name, kept with its
// icon and colour and synced the same way. The collection's entries keep the import's name, so imports, deck marks and
// moves still match; the engine's locName(loc) (LOCNAMES, filled here) is the name to show everywhere.
function syncLocNames() {
  const names = Object.entries(LOCSTYLE.locs || {}).filter(([k, s]) => s && typeof s.name === "string" && s.name.trim() && s.name.trim() !== k).map(([k, s]) => [k, s.name.trim()]);
  if (JSON.stringify(names) !== JSON.stringify([...LOCNAMES])) { LOCNAMES = new Map(names); CHANGE++; }
  setMadeLocs(Object.entries(LOCSTYLE.locs || {}).filter(([, s]) => s && s.made === true).map(([k]) => k));   // the boxes made here (below)
}
// ---- boxes and binders made here (0.72.0; Matt, Nov 12: "In general we should allow users to create empty
// boxes/binders in their collection"). A box you make is LOCSTYLE.locs[name].made, kept and synced with its icon,
// colour and name, and the engine's MADE says so to everything that asks where cards can go: the Collection lists it
// ("Empty"), "Put … in…" and a filing rule can name it, and it stays when its last card leaves. A box from an import
// isn't one: emptied here it is gone, as before, until you make it by name. An empty one can be removed again.
// ---- a note on a box, binder or deck's box (0.73.0; Matt, Nov 11: "maybe adding a description or notes section to
// boxes/decks"; Nov 12: "Notes field should be added as well, yes"). LOCSTYLE.locs[loc].note, kept and synced with the
// location's icon and name: free text for the person (how the box is sorted inside, what it is for). Shown under the
// box's or deck's title and, in the put-away list, under the box a card is going to.
const NOTE_MAX = 500;
const locNote = loc => { const s = LOCSTYLE.locs[loc]; return s && typeof s.note === "string" ? s.note : ""; };
function setLocNote(loc, text) {
  const note = String(text).replace(/\r\n?/g, "\n").trim().slice(0, NOTE_MAX);
  if (note === locNote(loc)) return;
  const { note: gone, ...rest } = LOCSTYLE.locs[loc] || {};
  LOCSTYLE.locs[loc] = { ...rest, ...(note ? { note } : {}), at: Date.now() };
  saveLocStyle();
}
// A box's or binder's own order (0.76.0; Matt, Nov 12: "a default sorting could be saved per box"): a sort as text
// (engine: canonSort) in LOCSTYLE.locs[loc].sort, kept and synced with its name and note. Its screen opens in it, and
// Assemble's, a list by location's and the put-away list's rows for the box follow it (sorting.js: locSorter). Not for
// the put-away pile or a hot-swap's Swaps location, which aren't boxes with an inside to flip through.
const canOrderLoc = loc => !!loc && loc !== PUT_AWAY && swapsBase(loc) == null;
const locSort = loc => { const s = LOCSTYLE.locs[loc]; return s && typeof s.sort === "string" && s.sort ? canonSort(s.sort) : ""; };
function setLocSort(loc, spec) {
  const sort = spec ? canonSort(spec) : "";
  if (sort === locSort(loc)) return;
  const { sort: gone, ...rest } = LOCSTYLE.locs[loc] || {};
  LOCSTYLE.locs[loc] = { ...rest, ...(sort ? { sort } : {}), at: Date.now() };
  saveLocStyle();
  if (LOCPICK && LOCPICK.kind === "loc" && LOCPICK.key === loc && $("#locstyle") && $("#locstyle").open) renderLocPicker();
  if (view === "browse" && BROWSE.loc === loc && !BROWSE.saved) { BROWSE.sort = sort || "name"; BROWSE.shown = 0; renderBrowse(); }
}
const locNoteHTML = (loc, id = "") => (locNote(loc) ? `<p class="small loc-note"${id ? ` id="${id}"` : ""}>${esc(locNote(loc))}</p>` : "");
const isMadeLoc = loc => !!(LOCSTYLE.locs[loc] && LOCSTYLE.locs[loc].made === true);
const locHolds = loc => !!COLL && COLL.entries.some(e => e.loc === loc && e.qty > 0);
// The location a name means, whether the import's name or the one given here: in the collection, or made here.
function locByName(name) {
  const hit = COLL ? COLL.entries.find(e => e.loc !== PUT_AWAY && (e.loc === name || locName(e.loc) === name)) : null;
  if (hit) return hit.loc;
  return [...MADE].find(l => l === name || locName(l) === name) || null;
}
// A new box's name → {loc, fresh?, plain?} to use, or {problem}. A name already in the collection is that box (unless
// it is a deck). Any other name is fine (Matt, Nov 11: "within Bulk Tutor itself I'm not sure I understand that
// restriction"): `fresh` = it isn't in the collection yet; `plain` marks one an import would read as a deck (its prefix,
// "Deck – Spares") or that you once marked as one, and using it records your say that it isn't (LOCSTYLE.decks, as
// "Choose your decks" would), so it stays a box.
function newPlace(name) {
  if (!name) return { problem: "Give the box a name." };
  if (name === PUT_AWAY || swapsBase(name) != null) return { problem: "That name is one Bulk Tutor uses itself." };
  const loc = locByName(name);
  if (loc) return isDeckLoc(loc) || swapsBase(loc) != null ? { problem: `${name} holds a deck, and cards put there would count as part of it. Choose a box or binder that isn't a deck.` } : { loc };
  return { loc: name, fresh: true, plain: looksLikeDeck(name) || markOf(LOCSTYLE.decks, name) === true };
}
// Make the box a name stands for (newPlace's answer) part of the collection → a function that takes it back.
function makeBox(r) {
  const locs = JSON.stringify(LOCSTYLE.locs[r.loc] || null), marks = JSON.stringify(LOCSTYLE.decks);
  LOCSTYLE.locs[r.loc] = { ...(LOCSTYLE.locs[r.loc] || {}), made: true, at: Date.now() };
  if (r.plain) LOCSTYLE.decks[r.loc] = { deck: false, at: Date.now() };
  saveLocStyle();
  return () => { const was = JSON.parse(locs); if (was) LOCSTYLE.locs[r.loc] = { ...was, at: Date.now() }; else LOCSTYLE.locs[r.loc] = { at: Date.now() }; LOCSTYLE.decks = JSON.parse(marks); saveLocStyle(); };
}
// An empty box made here leaves the collection again (its look and name go with it); Undo brings it back.
function removeBox(loc) {
  if (!isMadeLoc(loc) || locHolds(loc)) return;
  const was = JSON.stringify(LOCSTYLE.locs[loc]), name = locName(loc);
  LOCSTYLE.locs[loc] = { at: Date.now() }; saveLocStyle();
  if (LOCPICK) delete LOCPICK.note;   // its note goes with it: nothing typed is saved back as the sheet closes
  closeLocPicker();
  if (view === "browse" && BROWSE.loc === loc) showView("collection"); else renderAll();
  toast(`Removed ${name}`, "Undo", () => { LOCSTYLE.locs[loc] = { ...JSON.parse(was), at: Date.now() }; saveLocStyle(); renderAll(); });
}
// What to call the place a card is: a deck by the deck's name, any other location by its own.
const placeName = (loc, inDeck) => inDeck && swapsBase(loc) == null && isDeckLoc(loc) ? deckName(loc) : locName(loc);
const stName = st => placeName(st.loc, st.kind === "indeck");
// Which locations can be renamed here: not a hot-swap's Swaps location (its name says whose it is), not the put-away
// pile, and not a deck the import itself names (that is a list: rename the deck).
const canNameLoc = loc => swapsBase(loc) == null && loc !== PUT_AWAY && !(COLL && COLL.entries.some(e => e.loc === loc && importedDeck(e) && e.inDeck));
function setLocName(loc, to) {
  const name = String(to).trim(), was = locName(loc);
  if (name === was || (!name && was === loc)) return was;
  if (name && locByName(name) && locByName(name) !== loc) { toast(`Another box or binder is already called ${name}`); return was; }
  const b = isDeckLoc(loc) ? buildForDeck(loc) : null, auto = !!b && autoDeckName(b, loc);   // a deck still named after its box follows it
  const { name: gone, ...rest } = LOCSTYLE.locs[loc] || {};
  LOCSTYLE.locs[loc] = { ...rest, ...(name && name !== loc ? { name } : {}), at: Date.now() };
  saveLocStyle();
  if (auto && b.name !== deckDefaultName(loc)) { b.name = uniqueBuildName(deckDefaultName(loc)); b.updated = Date.now(); saveBuilds(); }
  return locName(loc);
}
const locNameNote = loc => locName(loc) !== loc ? `${esc(COLL && COLL.source && !COLL.example ? COLL.source : "Your import")} calls it <strong>${esc(loc)}</strong>, and imports still go by that. Clear the field to use that name here too.`
  : `A name for Bulk Tutor only: it changes nothing in ${esc(COLL && COLL.source && !COLL.example ? COLL.source : "the app your collection comes from")}.`;
function locDefault(kind) {
  const d = LOCSTYLE.defaults[kind] || {}, b = LOC_BUILTIN[kind];
  return { icon: iconOk(d.icon) ? d.icon : b.icon, color: colorOk(d.color) ? d.color : b.color };
}
let DECK_LOCS = { change: -1, set: new Set() };
function isDeckLoc(loc) {
  if (DECK_LOCS.change !== CHANGE) DECK_LOCS = { change: CHANGE, set: new Set((COLL ? COLL.entries : []).filter(e => e.inDeck).map(e => e.loc)) };
  return DECK_LOCS.set.has(loc);
}
function locStyleOf(loc, inDeck = isDeckLoc(loc)) {
  const s = LOCSTYLE.locs[loc] || {}, d = locDefault(inDeck ? "deck" : "other");
  return { icon: iconOk(s.icon) ? s.icon : d.icon, color: colorOk(s.color) ? s.color : d.color };
}
// The tile. `st` overrides the location's own style (the picker previews with it).
function locIconHTML(loc, inDeck, st, cls = "") {
  const { icon, color } = st || locStyleOf(loc, inDeck);
  return `<span class="loc-ic${cls ? " " + cls : ""}" style="--lc: var(--loc-${color}); --lf: var(${LOC_LIGHT.has(color) ? "--loc-on-light" : "--loc-on"})" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="icons.svg#li-${icon}"/></svg></span>`;
}
const neutralIconHTML = (sym, cls = "") => `<span class="loc-ic neutral${cls ? " " + cls : ""}" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="icons.svg#li-${sym}"/></svg></span>`;
// The picker: for one location (kind "loc") or a default (kind "default", key deck|other).
let LOCPICK = null;
function openLocPicker(kind, key) {
  LOCPICK = { kind, key }; LEADPICK = null; if (kind === "loc") LOCPICK.note = locNote(key);
  renderLocPicker();
  const dlg = $("#locstyle"); if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
function closeLocPicker() {
  // A note still being typed when the sheet closes (Done, a tap outside) is kept.
  if (LOCPICK && LOCPICK.kind === "loc" && typeof LOCPICK.note === "string" && LOCPICK.note.trim() !== locNote(LOCPICK.key)) { const loc = LOCPICK.key; setLocNote(loc, LOCPICK.note); LOCPICK.note = locNote(loc); repaintLocIcons(); }
  const dlg = $("#locstyle"); if (dlg && dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } LOCPICK = null; LEADPICK = null; }
function pickedStyle() { return LOCPICK.kind === "loc" ? locStyleOf(LOCPICK.key) : locDefault(LOCPICK.key || "other"); }
function renderLocPicker() {
  const body = $("#locstyle-body"); if (!body || !LOCPICK) return;
  if (LEADPICK) { body.innerHTML = leadPageHTML("locstyle-title"); return; }
  if (LOCPICK.kind === "new") {   // "New box or binder" on the Collection: its name, then it is listed (and its icon opens this sheet for the rest)
    body.innerHTML = `<h2 id="locstyle-title" tabindex="-1" autofocus>New box or binder</h2>
      <div class="field"><label for="box-new-name">Its name</label><input type="text" id="box-new-name" value="${esc(LOCPICK.name || "")}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>
      <p class="muted small">It starts empty: put cards in it from “${esc(PUT_AWAY)}”, or let a filing rule send them. Give a binder the same name in ManaBox, and your next import finds its cards there.</p>
      <p class="small warn-text" id="box-new-msg"${LOCPICK.msg ? "" : " hidden"}>${esc(LOCPICK.msg || "")}</p>
      <div class="sheet-pair"><button class="btn" data-lp-done>Cancel</button><button class="btn primary" data-box-new-go>Add it</button></div>`;
    return;
  }
  const cur = pickedStyle(), isLoc = LOCPICK.kind === "loc";
  const title = isLoc ? esc(locName(LOCPICK.key)) : LOCPICK.key === "deck" ? "Decks" : "Binders and boxes";
  const nameHTML = isLoc && canNameLoc(LOCPICK.key) ? `<div class="field"><label for="loc-name">Name</label><input type="text" id="loc-name" value="${esc(locName(LOCPICK.key))}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>
    <p class="muted small" id="loc-name-note">${locNameNote(LOCPICK.key)}</p>` : "";
  // What the location is comes before how it looks: a switch for "this is a deck" (a hot-swap's Swaps location only says whose it is).
  const info = isLoc ? deckLocations().find(l => l.loc === LOCPICK.key) : null;
  const deckHTML = !info ? "" : info.swaps != null ? `<p class="muted small">Swaps for ${esc(info.swaps)}. Its cards count as in use with that deck.</p>`
    : `<div class="deck-say">${switchHTML(`data-deck-mark="${esc(info.loc)}"`, info.deck, "This is a deck", "Its cards count as in use, and it's listed with your decks.")}${info.deck ? leadLinkHTML(info.loc) : ""}</div>`;
  const noteHTML = isLoc ? `<div class="field"><label for="loc-note">Notes</label><textarea id="loc-note" rows="3" maxlength="${NOTE_MAX}" placeholder="How it's sorted inside, what it's for…">${esc(LOCPICK.note || "")}</textarea></div>${info && info.deck ? `<p class="muted small" id="loc-note-deck">About the box itself. The deck has notes of its own, in its Actions.</p>` : ""}` : "";
  const orderHTML = isLoc && canOrderLoc(LOCPICK.key) ? `<div class="field"><span class="flabel-sm" id="loc-order-label">Order inside</span><button class="btn sort-open" id="loc-order" data-sort-open="box" data-sort-arg="${esc(LOCPICK.key)}" aria-haspopup="dialog" aria-describedby="loc-order-label">${locSort(LOCPICK.key) ? esc(sortText(locSort(LOCPICK.key))) : "Not set"}</button></div>` : "";
  body.innerHTML = `<h2 id="locstyle-title">${title}</h2>
    ${nameHTML}${noteHTML}${orderHTML}${deckHTML}
    <p class="muted small">${isLoc ? "Pick a symbol and a colour to match the real thing." : `What ${LOCPICK.key === "deck" ? "decks" : "binders and boxes"} start with, unless you've picked one for them.`}</p>
    <div class="lp-icons" role="group" aria-label="Symbol">${LOC_ICONS.map(([k, name]) => `<button class="lp-icon" data-lp-icon="${k}" aria-pressed="${cur.icon === k}" aria-label="${name}" title="${name}">${locIconHTML(null, false, { icon: k, color: cur.color })}</button>`).join("")}</div>
    <div class="lp-colors" role="group" aria-label="Colour">${LOC_COLORS.map(([k, name]) => `<button class="lp-color" data-lp-color="${k}" aria-pressed="${cur.color === k}" aria-label="${name}" title="${name}" style="--lc: var(--loc-${k})"></button>`).join("")}</div>
    <div class="sheet-pair"><button class="btn" data-lp-reset>${isLoc ? "Use default" : "Reset"}</button><button class="btn primary" data-lp-done>Done</button></div>
    ${isLoc && isMadeLoc(LOCPICK.key) && !locHolds(LOCPICK.key) ? `<button class="btn link danger" data-box-remove="${esc(LOCPICK.key)}">Remove this empty box</button>` : ""}`;
}
function setLocStyle(change) {
  const part = LOCPICK.kind === "loc" ? "locs" : "defaults", prev = LOCSTYLE[part][LOCPICK.key] || {};
  LOCSTYLE[part][LOCPICK.key] = change ? { ...prev, ...change, at: Date.now() } : { ...(prev.name ? { name: prev.name } : {}), ...(prev.made === true ? { made: true } : {}), ...(prev.note ? { note: prev.note } : {}), ...(prev.sort ? { sort: prev.sort } : {}), at: Date.now() };   // "Use default" is about the look
  saveLocStyle(); renderLocPicker(); repaintLocIcons();
}
// ---- which locations are decks (0.47.0)
// A switch: a checkbox with role="switch", its label and a line under it.
const switchHTML = (attr, on, title, sub = "") => `<label class="switch-row"><span class="mi-text"><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" role="switch" class="switch" ${attr}${on ? " checked" : ""}></label>`;
// Saying it only when it differs from the import: a location the import already calls a deck needs no mark, and taking
// your mark back follows the import again.
function setDeckMark(loc, want) {
  if (!COLL) return;
  const imported = COLL.entries.some(e => e.loc === loc && importedDeck(e));
  const prev = markEntry(loc), keep = Array.isArray(prev.cmd) && prev.cmd.length ? { cmd: prev.cmd } : {};   // who leads it stays with the mark
  LOCSTYLE.decks[loc] = want === imported ? { ...keep, at: Date.now() } : { ...keep, deck: want, at: Date.now() };
  saveLocStyle(); setCollection(COLL);
}
// ---- who leads a deck (0.47.0). A box named after its colour, not its commander, can't say who leads it, so you do:
// LOCSTYLE.decks[loc].cmd = [one name, or two that share command], kept with the mark and used while those cards are in
// the box. Builds started from the deck get it (engine ownedDeckList), and the Collection shows it beside the deck.
const markEntry = loc => (Object.hasOwn(LOCSTYLE.decks, loc) && LOCSTYLE.decks[loc]) || {};
const sameCard = (a, b) => norm(a) === norm(b);
function deckLead(loc) {
  const m = markEntry(loc);
  return (Array.isArray(m.cmd) ? m.cmd : []).filter(n => { const a = AGG.get(norm(n)); return !!a && a.locs.has(loc); }).slice(0, 2);
}
// The box's cards as the deck's list. Once the deck's build has a sideboard (0.57.0), the sideboard cards the box holds
// are split off as `side`, so a copy, a saved deck or a template made from the deck counts the deck alone.
function deckListOf(loc) {
  const d = ownedDeckList(loc, deckLead(loc)), b = buildForDeck(loc), keys = b ? sideKeys(b) : null;
  if (!keys || !keys.size) return d;
  const deck = new Set(b.cards.map(c => norm(c.name))), side = d.cards.filter(c => keys.has(norm(c.name)) && !deck.has(norm(c.name)));
  return side.length ? { ...d, cards: d.cards.filter(c => !side.includes(c)), side } : d;
}
// ---- a deck's name (0.54.0; Matt, Nov 11: "the ones I've marked as decks still have their names as boxes").
// A deck is a list with a name of its own that lives in a box. Its first name: what the import calls it when the import
// calls it a deck ("Deck – Krenko" → "Krenko"), otherwise who leads the box, otherwise the box's name. Once the deck has
// its build (builds.js: deckBuild), the build's name is the deck's, and renaming either renames it.
const bareDeck = loc => { const p = deckPrefix(); return (p && loc.toLowerCase().startsWith(p.toLowerCase()) ? loc.slice(p.length).replace(/^\s*[-–—:·]?\s*/, "").trim() : "") || loc; };
function deckDefaultName(loc) {
  if (COLL && COLL.entries.some(e => e.loc === loc && importedDeck(e))) return bareDeck(loc);
  const lead = COLL ? deckListOf(loc).commanders : [];
  return lead.length ? lead.join(" + ") : locName(loc);
}
const deckName = loc => { const b = buildForDeck(loc); return b ? b.name : deckDefaultName(loc); };
// A name the app gave (a box's, before 0.54.0, or the deck's first name) follows the deck; one you typed stays.
const autoDeckName = (b, loc) => b.name === deckDefaultName(loc) || b.name === ownedDeckList(loc).name;
function setDeckLead(loc, names) {
  const b = buildForDeck(loc), auto = !!b && autoDeckName(b, loc);
  const { cmd, ...rest } = markEntry(loc);
  LOCSTYLE.decks[loc] = { ...rest, ...(names.length ? { cmd: names } : {}), at: Date.now() };
  saveLocStyle();
  // The deck's own build, if it's open already and has no commander yet, takes the answer too, and a name it was given takes the new leader's.
  const mine = b ? names.filter(n => b.cards.some(c => sameCard(c.name, n))) : [];
  let changed = false;
  if (b && !b.commanders.length && mine.length) { b.commanders = mine; HISTORY_WHY = "Commander set from the deck"; changed = true; }
  if (auto && b.name !== deckDefaultName(loc)) { b.name = uniqueBuildName(deckDefaultName(loc)); changed = true; }
  if (changed) { b.updated = Date.now(); saveBuilds(); }
  repaintLocIcons();
}
// Decks opened as builds before 0.54.0 were named after their box: those take the deck's first name, once, at the start.
function nameDecks() {
  let changed = false;
  for (const b of BUILDS) {
    const loc = b.source && b.source.kind === "owned" ? b.source.loc : null;
    if (!loc || !locHasCards(loc) || buildForDeck(loc) !== b) continue;
    const want = deckDefaultName(loc);
    if (b.name !== want && b.name === ownedDeckList(loc).name) { b.name = uniqueBuildName(want); b.updated = Date.now(); changed = true; }
  }
  if (changed) saveBuilds();
}
// One tap for the usual case: a commander replaces the last pick and closes the question. A card that can share command
// (a partner, a Background) keeps it open, and a second one of those joins the first. Tapping a pick again takes it off.
function pickDeckLead(loc, name) {
  const cur = deckLead(loc), cand = deckLeaders(loc), shares = n => { const x = cand.find(c => sameCard(c.name, n)); return !!x && x.partner; };
  if (cur.some(n => sameCard(n, name))) { setDeckLead(loc, cur.filter(n => !sameCard(n, name))); return true; }
  if (cur.length === 1 && shares(name) && shares(cur[0])) { setDeckLead(loc, [cur[0], name]); return false; }
  setDeckLead(loc, [name]);
  return shares(name);   // stay: its partner may be next
}
let LEADPICK = null;   // {loc, all}: the question is showing, in whichever sheet is open
const LEAD_SHOWN = 6;
const leadLinkHTML = loc => {
  if (!deckLeaders(loc).length) return "";
  const lead = deckListOf(loc).commanders;
  return `<button class="btn link lead-link" data-lead-open="${esc(loc)}">${lead.length ? `Led by ${lead.map(esc).join(" + ")}` : "Who leads it?"}</button>`;
};
function leadPageHTML(titleId) {
  const loc = LEADPICK.loc, cand = deckLeaders(loc), cur = deckLead(loc), named = cur.length ? [] : deckListOf(loc).commanders;
  const on = x => cur.some(n => sameCard(n, x.name));
  const n = LEADPICK.all ? cand.length : Math.max(LEAD_SHOWN, cand.filter(x => x.covers).length);
  const shown = cand.filter((x, i) => i < n || on(x));
  const row = x => `<button class="menu-item pick-row" data-lead-set="${esc(x.name)}" aria-pressed="${on(x)}"><span class="mi-text"><strong>${esc(x.name)}</strong><small>${pips(x.colors)} ${x.covers ? "every card in it fits these colours" : `${x.fits} of ${x.of} cards fit these colours`}${x.partner ? " · can share command" : ""}</small></span>${on(x) ? `<span class="mi-check" aria-hidden="true">${MARK.selected}</span>` : ""}</button>`;
  const partner = cur.length === 1 && cand.some(x => on(x) && x.partner);
  return `<h2 id="${titleId}" tabindex="-1" autofocus>Who leads ${esc(locName(loc))}?</h2>
    <p class="muted small">Pick its commander. Builds you start from this deck use it, and the Collection shows it beside the deck.${named.length ? ` The name suggests ${named.map(esc).join(" + ")}.` : ""}${partner ? " Pick a second card if two share command." : ""}</p>
    <div class="menu-list">${shown.map(row).join("")}</div>
    ${shown.length < cand.length ? `<button class="btn link more-link" data-lead-all>Show all ${cand.length}</button>` : ""}
    <div class="sheet-pair"><button class="btn${cur.length ? " primary" : ""}" data-lead-back>${cur.length ? "Done" : "Back"}</button></div>`;
}
function openLead(loc) {
  const dlg = $("#pickdecks");
  LEADPICK = { loc, all: false, top: dlg && dlg.open ? dlg.scrollTop : 0 };
  renderLeadHost();
}
function closeLead() {
  const was = LEADPICK; LEADPICK = null; renderLeadHost();
  if (!was) return;
  const dlg = $("#pickdecks"); if (dlg && dlg.open) dlg.scrollTop = was.top;
  const link = [...document.querySelectorAll("[data-lead-open]")].find(b => b.dataset.leadOpen === was.loc && b.closest("dialog[open]")); if (link) link.focus({ preventScroll: true });
}
// The question takes over the sheet it was asked in, and hands it back.
function renderLeadHost() { if ($("#pickdecks").open) renderPickDecks(); else if ($("#locstyle").open) renderLocPicker(); }
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-lead-open], [data-lead-set], [data-lead-all], [data-lead-back]"); if (!t) return;
  const d = t.dataset;
  if (d.leadOpen != null) openLead(d.leadOpen);
  else if (!LEADPICK) return;
  else if (d.leadAll != null) { LEADPICK.all = true; renderLeadHost(); }
  else if (d.leadSet != null) {
    if (pickDeckLead(LEADPICK.loc, d.leadSet)) { renderLeadHost(); const b = [...document.querySelectorAll("[data-lead-set]")].find(x => x.dataset.leadSet === d.leadSet); if (b) b.focus(); }
    else closeLead();
  } else closeLead();
});
// "Choose your decks": every location with a switch. The groups are fixed while the sheet is open, so rows don't jump as they're switched.
let PICKDECKS = null;
function openPickDecks() {
  LEADPICK = null;
  const locs = deckLocations().filter(l => l.swaps == null);
  PICKDECKS = { decks: locs.filter(l => l.deck).map(l => l.loc), likely: locs.filter(l => l.likely).map(l => l.loc), rest: locs.filter(l => !l.deck && !l.likely).map(l => l.loc) };
  renderPickDecks(); openDlg($("#pickdecks"));
}
function renderPickDecks() {
  const body = $("#pickdecks-body"); if (!body || !PICKDECKS) return;
  if (LEADPICK) { body.innerHTML = leadPageHTML("pickdecks-title"); return; }
  const by = new Map(deckLocations().map(l => [l.loc, l]));
  const row = loc => { const l = by.get(loc); return !l ? "" : `<div class="pick-deck"><label class="menu-item switch-row">${locIconHTML(loc, l.deck)}<span class="mi-text"><strong>${esc(locName(loc))}</strong><small>${cardsWord(l.qty)}</small></span><input type="checkbox" role="switch" class="switch" data-deck-mark="${esc(loc)}" aria-label="${esc(locName(loc))} is a deck"${l.deck ? " checked" : ""}></label><span class="lead-slot">${l.deck ? leadLinkHTML(loc) : ""}</span></div>`; };
  const group = (label, list) => list.length ? `<div class="menu-group"><h4 class="subhead">${label}</h4><div class="menu-list">${list.map(row).join("")}</div></div>` : "";
  const n = [...by.values()].filter(l => l.deck && l.swaps == null).length;
  body.innerHTML = `<h2 id="pickdecks-title" tabindex="-1" autofocus>Choose your decks</h2>
    <p class="muted small">Switch on each box or binder that holds a deck. A deck's cards count as in use, so new builds leave them where they are unless you ask. This only changes Bulk Tutor, not the app your collection comes from.</p>
    ${group("Your decks", PICKDECKS.decks)}${group("About the size of a deck", PICKDECKS.likely)}${group(PICKDECKS.decks.length || PICKDECKS.likely.length ? "Other boxes and binders" : "Boxes and binders", PICKDECKS.rest)}
    <p class="muted small" id="pickdecks-count">${deckCountText(n)}</p>
    <div class="sheet-pair"><button class="btn primary" data-pickdecks-done>Done</button></div>`;
}
const deckCountText = n => n ? `${n} deck${n === 1 ? "" : "s"} chosen.` : "No decks chosen yet.";
function closePickDecks() {
  closeDlg($("#pickdecks")); PICKDECKS = null; LEADPICK = null; const body = $("#pickdecks-body"); if (body) body.innerHTML = "";
  if (LAST_IMPORT && $("#import-result [data-pick-decks]")) reportImport(LAST_IMPORT);   // the import's summary offered this: say how it stands now
}
document.addEventListener("close", e => { if (e.target.id === "pickdecks" && PICKDECKS) closePickDecks(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "pickdecks") { closePickDecks(); return; }
  const t = e.target.closest && e.target.closest("[data-pick-decks], [data-pickdecks-done]"); if (!t) return;
  if (t.dataset.pickDecks != null) openPickDecks(); else closePickDecks();
});
document.addEventListener("change", e => {
  const loc = e.target.dataset && e.target.dataset.deckMark; if (loc == null) return;
  const inPicker = !!e.target.closest("#locstyle");
  setDeckMark(loc, e.target.checked);
  if (inPicker) { renderLocPicker(); const sw = $("#locstyle [data-deck-mark]"); if (sw) sw.focus(); }
  else if (PICKDECKS) {   // the row keeps its place; its tile and the count follow
    const tile = e.target.closest(".switch-row").querySelector(".loc-ic"); if (tile) tile.outerHTML = locIconHTML(loc, e.target.checked);
    const slot = e.target.closest(".pick-deck").querySelector(".lead-slot"); if (slot) slot.innerHTML = e.target.checked ? leadLinkHTML(loc) : "";
    const c = $("#pickdecks-count"); if (c) c.textContent = deckCountText(deckLocations().filter(l => l.deck && l.swaps == null).length);
  }
});
document.addEventListener("change", e => {
  if (e.target.id !== "loc-name" || !LOCPICK || LOCPICK.kind !== "loc") return;
  const loc = LOCPICK.key, name = setLocName(loc, e.target.value);
  e.target.value = name;
  const h = $("#locstyle-title"), note = $("#loc-name-note"); if (h) h.textContent = name; if (note) note.innerHTML = locNameNote(loc);
  repaintLocIcons();
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "loc-name") e.target.blur(); });
document.addEventListener("input", e => { if (e.target.id === "box-new-name" && LOCPICK && LOCPICK.kind === "new") LOCPICK.name = e.target.value; else if (e.target.id === "loc-note" && LOCPICK && LOCPICK.kind === "loc") LOCPICK.note = e.target.value; });
document.addEventListener("change", e => {
  if (e.target.id !== "loc-note" || !LOCPICK || LOCPICK.kind !== "loc") return;
  setLocNote(LOCPICK.key, e.target.value); LOCPICK.note = locNote(LOCPICK.key);
  repaintLocIcons();
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "box-new-name") { e.preventDefault(); const go = $("#locstyle [data-box-new-go]"); if (go) go.click(); } });
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-new-box], [data-box-new-go], [data-box-remove]"); if (!t) return;
  if (t.dataset.newBox != null) { openLocPicker("new", null); const f = $("#box-new-name"); if (f) f.focus(); return; }
  if (t.dataset.boxRemove != null) { removeBox(t.dataset.boxRemove); return; }
  if (!LOCPICK || LOCPICK.kind !== "new") return;
  const name = (LOCPICK.name || "").trim(), r = newPlace(name);
  const problem = r.problem || (!r.fresh ? `${name} is already in your collection.` : "");
  if (problem) { LOCPICK.msg = problem; renderLocPicker(); const f = $("#box-new-name"); if (f) f.focus(); return; }
  const undo = makeBox(r);
  closeLocPicker(); renderAll();
  toast(`${name} added, empty`, "Undo", () => { undo(); renderAll(); });
});
function repaintLocIcons() {
  if (view === "collection") renderCollectionDecks();
  else if (view === "settings") renderSettings();
  else if (view === "browse") renderBrowse();
  else if (view === "putaway") renderPutAway();
  else if (view === "build") renderBuild();
}
document.addEventListener("click", e => {
  if (e.target.id === "locstyle") { closeLocPicker(); return; }
  const t = e.target.closest && e.target.closest("[data-loc-style], [data-loc-default], [data-lp-icon], [data-lp-color], [data-lp-reset], [data-lp-done]"); if (!t) return;
  const d = t.dataset;
  if (d.locStyle != null) openLocPicker("loc", d.locStyle);
  else if (d.locDefault) openLocPicker("default", d.locDefault);
  else if (d.lpIcon) setLocStyle({ icon: d.lpIcon });
  else if (d.lpColor) setLocStyle({ color: d.lpColor });
  else if (d.lpReset != null) setLocStyle(null);
  else closeLocPicker();
});

// ------------------------------------------------------------ settings (the gear in the header)
let SETTINGS_FROM = "build";   // the view to go back to
// Settings › Buying list: name each price range and where it ends; the last takes everything above. Changes apply when
// a field is left; removing a range or resetting offers Undo.
function buyRangesHTML() {
  const bs = BUY.buckets, last = bs.length - 1;
  const rows = bs.map((x, i) => `<div class="buy-range" data-range="${i}">
      <input type="text" data-buy-name="${i}" value="${esc(x.name)}" maxlength="40" aria-label="Name of price range ${i + 1}" enterkeyhint="done">
      ${i < last ? `<label class="buy-upto"><span>up to ${curSign()}</span><input type="number" data-buy-up="${i}" value="${x.upTo}" min="0.01" step="0.01" inputmode="decimal" aria-label="${esc(x.name)} ends at, in ${CUR_NAME[CURRENCY]}" enterkeyhint="done"></label>`
        : `<span class="buy-upto muted small">${i ? `over ${money(bs[i - 1].upTo)}` : "any price"}</span>`}
      ${bs.length > 1 ? `<button class="icon" data-buy-del="${i}" aria-label="Remove ${esc(x.name)}">${MARK.removeRow}</button>` : `<span></span>`}
    </div>`).join("");
  return `<p class="muted small">How Assemble groups the cards you'd buy. Name each price range and set where it ends; the last one takes everything above.</p>
    <div class="buy-ranges">${rows}</div>
    <div class="sheet-pair"><button class="btn" data-buy-add>Add a price range</button><button class="btn" data-buy-reset>Reset to the defaults</button></div>`;
}
function bucketsFromForm() {
  return BUY.buckets.map((x, i) => {
    const n = $(`[data-buy-name="${i}"]`), u = $(`[data-buy-up="${i}"]`), v = u ? parseFloat(u.value) : NaN;
    return { name: n ? n.value : x.name, upTo: x.upTo == null ? null : v > 0 ? v : x.upTo };
  });
}
document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset || (t.dataset.buyName == null && t.dataset.buyUp == null)) return;
  setBuckets(bucketsFromForm());
  // Redraw once focus has moved on (a tap on the next field), and give it back, so typing there isn't lost.
  setTimeout(() => {
    const a = document.activeElement, d = (a && a.dataset) || {};
    const key = d.buyName != null ? `[data-buy-name="${d.buyName}"]` : d.buyUp != null ? `[data-buy-up="${d.buyUp}"]` : null;
    if (view === "settings") renderSettings();
    const f = key && $(key); if (f) f.focus();
  }, 0);
});
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-buy-add], [data-buy-del], [data-buy-reset]"); if (!t) return;
  const prev = BUY.buckets, again = () => { setBuckets(prev); renderSettings(); };
  if (t.hasAttribute("data-buy-add")) {
    const caps = prev.filter(x => x.upTo != null), top = caps.length ? caps[caps.length - 1].upTo : 0;
    setBuckets([...caps, { name: "New range", upTo: top ? Math.max(top * 5, top + 5) : 5 }, prev[prev.length - 1]]); renderSettings();
    const f = $(`[data-buy-name="${BUY.buckets.length - 2}"]`); if (f) { f.focus(); f.select(); }
  } else if (t.hasAttribute("data-buy-del")) {
    const i = +t.dataset.buyDel, gone = prev[i];
    setBuckets(prev.filter((_, j) => j !== i)); renderSettings(); toast(`Removed ${gone.name}`, "Undo", again);
  } else {
    setBuckets(BUY_DEFAULT); renderSettings(); toast("Price ranges reset", "Undo", again);
  }
});
function renderSettings() {
  const el = $("#view-settings"); if (!el) return;
  const def = k => `<button class="loc-def" data-loc-default="${k}">${locIconHTML(null, k === "deck", locDefault(k))}<span>${k === "deck" ? "Decks" : "Binders and boxes"}</span><span class="chev" aria-hidden="true">${MARK.go}</span></button>`;
  el.innerHTML = `<div class="actions"><button class="btn" data-settings-back>${MARK.back} Back</button></div>
    <h2 id="settings-title">Settings</h2>
    <section class="set-group"><h3 class="set-h">Card data</h3><div class="panel"><p class="small data-line"><span class="status ${$("#status").className.replace("status", "").trim()}"><span class="dot"></span><span>${esc($("#status-text").textContent)}</span></span>${$("#status").title ? ` <span class="muted">${esc($("#status").title)}</span>` : ""}</p></div></section>
    <section class="set-group" id="offline-set"><h3 class="set-h">Offline</h3><div class="panel" id="keep-panel">${keepPanelHTML()}</div></section>
    <section class="set-group"><h3 class="set-h">Dropbox sync</h3><div class="panel" id="sync-panel"></div></section>
    <section class="set-group"><h3 class="set-h">Backups</h3><div class="panel">${backupPanelHTML()}</div></section>
    ${ownColl() ? `<section class="set-group" id="chdays-set"><h3 class="set-h">Recent changes</h3><div class="panel" id="chdays-panel">${chDaysPanelHTML()}</div></section>` : ""}
    <section class="set-group"><h3 class="set-h">Appearance</h3><div class="panel"><div class="seg seg-fill" role="group" aria-label="Theme" id="theme-seg">${themeSegHTML()}</div></div></section>
    <section class="set-group"><h3 class="set-h">Location icons</h3><div class="panel">
      <p class="muted small">What new locations start with. To change one location, tap its icon in your collection.</p>
      <div class="loc-defs">${def("deck")}${def("other")}</div></div></section>
    ${tokensOffered() ? `<section class="set-group" id="tokens-set"><h3 class="set-h">Tokens</h3><div class="panel">${switchHTML('id="tok-track"', TOKOWN.on, "Track the tokens you own", "A deck lists the tokens it makes either way. With this on it also says which you're missing, and each box lists the tokens kept in it.")}</div>${tokensHostHTML("loose")}</section>` : ""}
    ${DATA && FILES().prices ? `<section class="set-group" id="prices-set"><h3 class="set-h">Prices</h3><div class="panel">${pricesPanelHTML()}</div></section>` : ""}
    <section class="set-group" id="rules-set"><h3 class="set-h">Filing rules</h3><div class="panel" id="rules-panel">${filingPanelHTML()}</div></section>
    <section class="set-group" id="buy-ranges"><h3 class="set-h">Buying list</h3><div class="panel">${buyRangesHTML()}</div></section>
    <section class="set-group"><h3 class="set-h">About</h3><div class="panel">
      <p class="small">Bulk Tutor ${APP_VERSION} beta</p>
      <div class="sheet-pair"><button class="btn" data-about>About and install</button><a class="btn" href="${reportMailto()}">Report a problem</a></div>
      <p class="muted small">Something stuck, or waiting on a new version? Reloading is safe: your collection and builds stay on this device.</p>
      <div class="actions"><button class="btn" data-reload>Reload the app</button></div></div></section>`;
  renderSyncBits();
  fillKeepNotes();
  if ((KEEP.builds || KEEP.coll) && !PICS_NOW.checked) picsSoon(200);
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-settings], [data-settings-back]"); if (!t) return;
  if (t.hasAttribute("data-settings")) { if (view === "settings") showView(SETTINGS_FROM || "build"); else { showView("settings"); window.scrollTo({ top: 0 }); } }
  else showView(SETTINGS_FROM && SETTINGS_FROM !== "settings" ? SETTINGS_FROM : "build");
});

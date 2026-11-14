"use strict";
// Bulk Tutor, the page's script, part "browse": the collection browser and the deck screen: quick filters, the Actions sheet, the table view, the Filters sheet.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ collection: decks, binders, browser
// The browser shows one location (BROWSE.loc), one saved decklist (BROWSE.saved), or everything. A box you marked as a
// deck opens two ways: as the deck (from Decks) or as the box it is (BROWSE.box, from Binders and boxes; 0.54.0).
// Formats: fmtMode "legal" (legal in every ticked format) or "banned" (banned in any), with the ticked formats.
// set, rar, foil (0.69.0): filters on your copies themselves (their set, rarity and finish), not on the card.
const BROWSE = { loc: null, saved: null, box: false, q: "", role: "", colors: new Set(), fmtMode: "legal", formats: new Set(), set: "", rar: "", foil: "", sort: "name", group: "", shown: 0, confirmDel: false,
  quick: quickBlank() };   // the deck screen's quick filters (engine quickMatch)
// The deck screen: one of your decks (a deck binder) or a saved decklist. It gets the compact head and its own Actions.
const browseIsDeck = () => !!savedById(BROWSE.saved) || (!BROWSE.box && isDeckLoc(BROWSE.loc));
// Whose copies a price on this screen is about: the location's, or every copy you have (the whole collection, a saved decklist).
const browseScope = () => (BROWSE.saved ? null : BROWSE.loc);

// A box or binder cards can be added to by name (addcards.js): one of your own that isn't a deck's box, the pile or
// a hot-swap's Swaps location (as "Put … in…": cards in a deck's box count as part of that deck).
const canAddTo = loc => !!loc && ownColl() && loc !== PUT_AWAY && swapsBase(loc) == null && !isDeckLoc(loc);

function locationSummary() {
  const locs = new Map();
  for (const e of COLL ? COLL.entries : []) {
    const o = locs.get(e.loc) || { loc: e.loc, qty: 0, value: 0, inDeck: e.inDeck };
    o.qty += e.qty; o.value += copyPrice(e) * e.qty;
    if (e.inDeck) o.inDeck = true;
    locs.set(e.loc, o);
  }
  if (COLL) for (const loc of MADE) if (!locs.has(loc)) locs.set(loc, { loc, qty: 0, value: 0, inDeck: false });   // boxes made here that hold nothing yet (0.72.0)
  return [...locs.values()].sort((a, b) => locName(a.loc).localeCompare(locName(b.loc), undefined, { numeric: true }));   // by the names shown
}

// Which Collection boxes are folded, remembered in this browser (key → true when folded).
function foldState() { try { return JSON.parse(store.get("bt.fold") || "{}") || {}; } catch { return {}; } }
const foldOpen = (k, def) => { const f = foldState(); return k in f ? !f[k] : def; };
document.addEventListener("toggle", e => {
  const k = e.target.dataset && e.target.dataset.fold; if (!k) return;
  const f = foldState(); f[k] = !e.target.open; store.set("bt.fold", JSON.stringify(f));
}, true);

let COLL_ALL_DECKS = false;   // "Show all" on the Decks list, for the visit
const DECKS_SHOWN = 3;
function renderCollectionDecks() {
  const box = $("#coll-decks"); if (!box) return;
  const all = locationSummary(), isSw = l => swapsBase(l.loc) != null;
  // A hot-swap's Swaps binder is listed under its deck ("Deck – Marchesa" or "Marchesa" for "Marchesa · Swaps"), otherwise with the decks.
  const bare = loc => norm(loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, ""));
  const swapsOf = d => all.filter(l => isSw(l) && (norm(swapsBase(l.loc)) === norm(d.loc) || norm(swapsBase(l.loc)) === bare(d.loc)));
  // A deck is listed by its own name, with its box under it (0.54.0). A box you marked as a deck is still a box: it stays
  // under Binders and boxes, saying which deck it holds. A deck the import names (ManaBox's deck binders, the prefix) isn't one.
  for (const l of all) { l.box = locName(l.loc); l.name = l.inDeck && !isSw(l) ? deckName(l.loc) : l.box; }
  const marked = new Set(deckLocations().filter(l => l.deck && !l.imported && l.swaps == null).map(l => l.loc));
  const decksOnly = all.filter(l => l.inDeck && !isSw(l)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), attached = new Set(decksOnly.flatMap(d => swapsOf(d).map(l => l.loc)));
  // The pile of cards waiting to be filed isn't a box: the Collection leads with it instead (putaway.js).
  const locs = all, decks = [...decksOnly, ...all.filter(l => isSw(l) && !attached.has(l.loc))], binders = all.filter(l => !isSw(l) && l.loc !== PUT_AWAY && (!l.inDeck || marked.has(l.loc)));
  const total = locs.reduce((n, l) => n + l.qty, 0), value = locs.reduce((n, l) => n + l.value, 0);
  const binderQty = binders.reduce((n, l) => n + l.qty, 0);
  // icon: a location's tile (a button that opens the picker) or a fixed symbol for saved decks and All cards
  const row = (attr, name, sub, icon) => `<div class="loc-row">${icon}<button class="loc-main" ${attr}><span class="loc-text"><strong>${esc(name)}</strong><small>${sub}</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div>`;
  const icBtn = (loc, inDeck) => `<button class="loc-ic-btn" data-loc-style="${esc(loc)}" aria-label="Options for ${esc(locName(loc))}">${locIconHTML(loc, inDeck)}</button>`;
  const rows = [
    ...decks.map(d => {
      const b = isSw(d) ? null : buildForDeck(d.loc), ch = b ? deckChanges(b) : null;
      // What the deck's list and its box don't agree on yet (Assemble has the cards).
      const status = ch && (ch.add || ch.out) ? ` · ${[ch.add ? `${ch.add} to put in` : "", ch.out ? `${ch.out} to take out` : ""].filter(Boolean).join(", ")}` : "";
      const sw = isSw(d) ? [] : swapsOf(d);
      const lead = isSw(d) ? "" : deckLead(d.loc).join(" + ");
      const sideN = b && sideOf(b).length ? (deckListOf(d.loc).side || []).reduce((n, c) => n + c.qty, 0) : 0;   // the sideboard cards its box holds
      const sub = [d.name !== d.box ? `In ${esc(d.box)}` : "", lead && lead !== d.name ? esc(lead) : "", sideN ? `${cardsWord(d.qty - sideN)} + ${sideN} sideboard` : cardsWord(d.qty), DATA ? money(d.value) : ""].filter(Boolean).join(" · ") + status;
      return row(`data-browse="${esc(d.loc)}"`, d.name, sub, icBtn(d.loc, true))
        + sw.map(l => `<div class="loc-sub">${row(`data-browse="${esc(l.loc)}"`, l.box, `Swaps for ${esc(d.name)} · ${cardsWord(l.qty)}${DATA ? " · " + money(l.value) : ""}`, icBtn(l.loc, true))}</div>`).join("");
    }),
    ...SAVED.map(d => {
      const st = savedStats(d), b = buildForSaved(d.id);
      return row(`data-browse-saved="${esc(d.id)}"`, d.name, `Saved decklist · ${cardsWord(st.total)}${sideQty(d) ? ` + ${sideQty(d)} sideboard` : ""} · ${st.pct}% owned${b ? " · build in progress" : ""}`, neutralIconHTML("list"));
    })];
  const shown = COLL_ALL_DECKS || rows.length <= DECKS_SHOWN + 1 ? rows : rows.slice(0, DECKS_SHOWN);
  const counts = [decks.length ? `${decks.length}` : "", SAVED.length ? `${SAVED.length} saved` : ""].filter(Boolean).join(" · ") || "none yet";
  const canPick = all.some(l => !isSw(l));
  const deckBody = rows.length
    ? `<div class="loc-list">${shown.join("")}</div>${shown.length < rows.length ? `<button class="btn link more-link" data-coll-more>Show all ${rows.length}</button>` : ""}${canPick ? `<button class="btn link more-link" data-pick-decks>Choose your decks</button>` : ""}`
    : `<p class="muted small">${canPick ? "If some of your boxes or binders hold decks, say which, so their cards count as in use." : "No decks in your collection yet."} To keep a decklist that isn't built, use “Save as deck” in a build.</p>${canPick ? `<div class="actions"><button class="btn primary" data-pick-decks>Choose your decks</button></div>` : ""}`;
  box.innerHTML = `
    <details class="panel fold" data-fold="decks"${foldOpen("decks", true) ? " open" : ""}>
      <summary><h3>Decks</h3><span class="muted small">${counts}</span></summary>
      <div class="fold-body">${deckBody}</div>
    </details>
    <details class="panel fold" data-fold="binders"${foldOpen("binders", true) ? " open" : ""}>
      <summary><h3>Binders and boxes</h3><span class="muted small">${binders.length} · ${cardsWord(binderQty)}</span></summary>
      <div class="loc-list">${[row(`data-browse=""`, "All cards", `${cardsWord(total)}${DATA ? " · " + money(value) : ""}`, neutralIconHTML("all")),
        ...binders.map(l => l.inDeck ? row(`data-browse-box="${esc(l.loc)}"`, l.box, `Holds ${l.name !== l.box ? esc(l.name) : "a deck"} · ${cardsWord(l.qty)}${DATA ? " · " + money(l.value) : ""}`, icBtn(l.loc, true))
          : row(`data-browse="${esc(l.loc)}"`, l.box, l.qty ? `${cardsWord(l.qty)}${DATA ? " · " + money(l.value) : ""}` : "Empty", icBtn(l.loc, false)))].join("")}</div>
      ${ownColl() ? `<button class="btn link more-link" data-new-box>New box or binder</button>` : ""}
    </details>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-coll-more], #coll-search, [data-sync-goto]"); if (!t) return;
  if (t.id === "coll-search") { openBrowse(null); const q = $("#bsq"); if (q) q.focus(); return; }
  if (t.dataset.syncGoto != null) { showView("settings"); window.scrollTo({ top: 0 }); return; }
  COLL_ALL_DECKS = true; renderCollectionDecks();
});

function openBrowse(loc, savedId, asBox = false) {
  if (loc === PUT_AWAY && !savedId) { openPutAway(); return; }   // the pile has a screen of its own (0.65.0)
  BSEL = null;   // a selection belongs to the screen it was made on
  const saved = savedById(savedId);
  const isDeck = !!saved || (!asBox && !!(loc && COLL && COLL.entries.some(e => e.loc === loc && e.inDeck)));
  Object.assign(BROWSE, { loc: saved ? null : loc || null, saved: saved ? saved.id : null, box: !saved && !!asBox, q: "", role: "", fmtMode: "legal", set: "", rar: "", foil: "", sort: (!saved && loc && locSort(loc)) || "name", group: isDeck ? "type" : "", shown: 0, confirmDel: false, quick: quickBlank() });
  BROWSE.colors.clear(); BROWSE.formats.clear();
  showView("browse"); window.scrollTo({ top: 0 });
}

// Cards in the current location, saved deck, or everywhere, merged by name.
function browseCards() {
  const m = new Map(), saved = savedById(BROWSE.saved);
  if (saved) {
    for (const c of saved.cards) {
      const name = canonical(c.name), k = norm(name), a = AGG.get(k);
      const o = m.get(k) || { name, k, qty: 0, locs: new Set(a ? a.locs.keys() : []), cmd: isCmd(saved, name), comp: isComp(saved, name) };
      o.qty += c.qty; m.set(k, o);
    }
    for (const c of sideOf(saved)) {   // its sideboard (0.57.0), as a group of its own
      const name = canonical(c.name), k = norm(name), a = AGG.get(k);
      const o = m.get(k) || { name, k, qty: 0, locs: new Set(a ? a.locs.keys() : []), side: true };
      o.qty += c.qty; m.set(k, o);
    }
    return [...m.values()];
  }
  for (const e of COLL ? COLL.entries : []) {
    if (BROWSE.loc != null && e.loc !== BROWSE.loc) continue;
    const name = canonical(e.name), k = norm(name);
    const o = m.get(k) || { name, k, qty: 0, locs: new Set() };
    o.qty += e.qty; o.locs.add(e.loc); m.set(k, o);
  }
  // A deck with a sideboard: the box holds both, and the deck screen keeps them apart.
  if (BROWSE.loc != null && !BROWSE.box && isDeckLoc(BROWSE.loc)) for (const c of deckListOf(BROWSE.loc).side || []) { const o = m.get(norm(c.name)); if (o) o.side = true; }
  return [...m.values()];
}
// ---- Selecting several cards here (0.59.0; Matt, Nov 11; the Workbench's is in builds.js and workbench.js). BSEL = a
// Set of normalized names, or null when not selecting; it lasts until Done or another screen. The ticks are drawn as in a
// build (paintTicks); "Select all" takes every card the search and filters match, shown yet or not. The group actions
// are the ones a card's details have here: add to the open build (its deck, or its sideboard) and your taste.
let BSEL = null;
let BSEL_RM = false;   // the selection's sheet is asking whether to remove the selected cards (0.83.0)
const bselCount = () => (BSEL ? BSEL.size : 0);
const bselHas = (_list, name) => !!BSEL && BSEL.has(norm(name));
function bselPrune(all) { const here = new Set(all.map(c => c.k)); for (const k of [...BSEL]) if (!here.has(k)) BSEL.delete(k); }
const bselNames = () => browseCards().filter(c => BSEL.has(c.k)).map(c => c.name);
function bselLineHTML(n) {
  if (!BSEL) return `<p class="sel-line"><button class="btn link small" data-bsel-mode="on">Select cards</button> <span class="muted small">to add several to a build, or set your taste for them</span></p>`;
  return `<p class="sel-line"><button class="btn small" data-bsel-all>Select all ${n.toLocaleString()}</button><button class="btn small" data-bsel-none>Clear</button><span class="muted small">Tap cards${BROWSE.group ? ", or a group's box," : ""} to select them.</span></p>`;
}
function bselPaint() {
  const root = $("#view-browse"); if (!root || !BSEL) return;
  paintTicks(root, bselHas);
  const bar = $("#bselbar"); if (bar) bar.innerHTML = selBarHTML(BSEL.size).replace("data-sel-actions", "data-bsel-actions").replace('data-sel-mode="off"', 'data-bsel-mode="off"');
}
// What each action would touch: the open build takes cards while it isn't built, as a card's own details offer.
function bselActions() {
  const names = bselNames(), b = curBuild(), open = b && !b.built ? b : null;
  return { names, build: open, add: open ? names.filter(n => canAdd(open, canonical(n), false)) : [], addside: open ? names.filter(n => canAdd(open, canonical(n), true)) : [], taste: names.filter(n => !isBasic(n) && cardOf(n)),
    rm: ownColl() && !BROWSE.saved ? names : [] };   // out of the collection (addcards.js): the copies in this box or deck, or every copy
}
function renderBselMenu(body) {
  if (!BSEL || !BSEL.size) { closeSelMenu(); return; }
  const a = bselActions(), b = a.build;
  if (BSEL_RM && a.rm.length) {   // asked first: it takes every copy of each card in view
    const copies = rmSelectedCount(a.rm), loc = rmScope(), n = a.rm.length;
    body.innerHTML = `<h2 id="selmenu-title" tabindex="-1" autofocus>Remove ${n === 1 ? esc(a.rm[0]) : `${n.toLocaleString()} cards`}${copies !== n ? ` (${copies.toLocaleString()} copies)` : ""}?</h2>
      <p class="small">${copies === 1 ? "It leaves" : "They leave"} ${loc != null ? `<strong>${esc(locName(loc))}</strong> and your collection` : "your collection, every copy in every box"}.</p>
      <p class="muted small">For cards you have sold, traded or lost. A later import doesn't bring them back; Undo is under Recent changes on the Collection.</p>
      <div class="sheet-pair"><button class="btn" data-sel-do="rmno">Keep ${copies === 1 ? "it" : "them"}</button><button class="btn danger" data-sel-do="rm">Remove ${copies === 1 ? "it" : "them"}</button></div>`;
    return;
  }
  BSEL_RM = false;
  const item = (act, label, list) => list.length ? `<button class="menu-item" data-sel-do="${act}"><span class="mi-text"><span>${label}</span><small>${cardsWord(list.length)}</small></span></button>` : "";
  const levels = new Set(a.taste.map(n => tasteOf(n))), same = levels.size === 1 ? [...levels][0] : null;
  const adds = b ? item("add", `Add to ${esc(b.name)}`, a.add) + item("addside", `Add to the sideboard of ${esc(b.name)}`, a.addside) : "";
  body.innerHTML = `<h2 id="selmenu-title" tabindex="-1" autofocus>${cardsWord(a.names.length)} selected</h2>
    ${adds ? `<div class="menu-list">${adds}</div>` : `<p class="muted small">${b ? `Every one of them is already in ${esc(b.name)}.` : curBuild() ? "The open build is marked as built, so cards aren't added to it from here." : "Open a build in the Workbench to add these cards to it."}</p>`}
    ${a.taste.length ? `<div class="taste"><p class="small"><strong>Your taste</strong> <span class="muted">for ${a.taste.length === 1 ? "this card" : `these ${cardsWord(a.taste.length)}`}, everywhere</span></p>
      <div class="seg seg-fill" role="group" aria-label="Your taste for the selected cards">${TASTE.map(([v, label]) => `<button data-sel-do="taste" data-lv="${v}" aria-pressed="${same === v}">${label}</button>`).join("")}</div></div>` : ""}
    ${a.rm.length ? `<div class="menu-list"><button class="menu-item danger" data-sel-do="rmask"><span class="mi-text"><span>Remove from your collection</span><small>${cardsWord(rmSelectedCount(a.rm))}${rmScope() != null ? ` in ${esc(locName(rmScope()))}` : ""} · sold, traded or lost</small></span></button></div>` : ""}
    <div class="sheet-pair"><button class="btn" data-sel-close>Close</button></div>`;
}
function bselDo(act, arg) {
  if (!BSEL) return;
  const a = bselActions();
  if (act === "rmask" || act === "rmno") { BSEL_RM = act === "rmask"; renderSelMenu(); const h = $("#selmenu-title"); if (h) h.focus(); return; }
  BSEL_RM = false;
  if (act === "rm") { if (a.rm.length) { BSEL.clear(); rmSelected(a.rm); } return; }
  if (act === "add" || act === "addside") { BSEL.clear(); if (!addMany(a[act], act === "addside")) renderBrowse(); return; }
  if (act !== "taste" || !a.taste.length) return;
  const prefs = a.taste.map(n => [n, prefOf(n) ? { ...prefOf(n) } : null]);
  for (const n of a.taste) setTaste(n, arg);
  BSEL.clear(); GEN_IDEAS.clear(); TUNE_CACHE.clear(); renderBrowse();
  toast(`${cardsWord(a.taste.length)}: ${tasteName(arg)}`, "Undo", () => { for (const [n, prev] of prefs) restorePref(n, prev); GEN_IDEAS.clear(); TUNE_CACHE.clear(); rerenderCurrent(); }, 8000);
}
// Taps while selecting, caught before the listeners that would open a card.
$("#view-browse").addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-bsel-mode], [data-bsel-all], [data-bsel-none], [data-sel-grp], [data-bsel-actions], [data-pick]"); if (!t) return;
  if (t.dataset.bselMode) {
    e.preventDefault(); e.stopPropagation();
    BSEL = t.dataset.bselMode === "on" ? new Set() : null; renderBrowse();
    const next = $(BSEL ? "#view-browse [data-bsel-all]" : "#view-browse [data-bsel-mode]"); if (next) next.focus({ preventScroll: true });
    return;
  }
  if (!BSEL) return;
  if (t.matches("label[data-pick]")) return;   // a row's own checkbox does the work (the change listener below)
  e.preventDefault(); e.stopPropagation();
  const put = (names, on) => { for (const n of names) if (on) BSEL.add(norm(n)); else BSEL.delete(norm(n)); };
  if (t.dataset.bselActions != null) { BSEL_RM = false; openSelMenu("browse"); return; }
  if (t.dataset.bselAll != null) put(filteredBrowse().map(c => c.name), true);   // every match, not only the page shown
  else if (t.dataset.bselNone != null) BSEL.clear();
  else if (t.dataset.selGrp != null) { const els = [...selGroupOf(t).querySelectorAll("[data-pick]")]; put(els.map(el => el.dataset.card), !els.every(el => el.classList.contains("on"))); }
  else put([t.dataset.card], !BSEL.has(norm(t.dataset.card)));
  bselPaint();
}, true);
document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset || t.dataset.selBox == null || !BSEL) return;
  const row = t.closest("#view-browse [data-pick]"); if (!row) return;
  if (t.checked) BSEL.add(norm(row.dataset.card)); else BSEL.delete(norm(row.dataset.card));
  bselPaint();
});

function cardWords(c) {
  // Everything a search can match: name, type, "legendary", "historic" (artifacts, legendaries and Sagas), creature types,
  // keywords, and the artist of any printing.
  const row = cardOf(c.name), words = [c.k];
  if (row) {
    words.push((TYPE_SINGULAR[row[2]] || "").toLowerCase());
    if (isLegendary(row)) words.push("legendary");
    if (hasLegendary() && isHistoric(row)) words.push("historic");
    if (row.length > 8 && DATA.subtypes) for (const i of row[8]) words.push((DATA.subtypes[i] || "").toLowerCase());
    if (row.length > 9 && DATA.keywords) for (const i of row[9]) words.push((DATA.keywords[i] || "").toLowerCase());
    for (const a of artistIdx(c.name).all) for (const n of artistSpellings(a)) words.push(norm(n));
  }
  return words.join(" | ");
}
// ---- Filters on your copies (0.69.0; call 7 of the price work, Matt, Nov 12): Set, Rarity and Finish. The browser's
// rows are cards, and these are about copies: a card stays when a copy of it on this screen fits every one that is on,
// and its row then counts and prices only those copies (c.fit). Not on a saved decklist, which names cards, not copies.
const RARITY_NAMES = { c: "Common", u: "Uncommon", r: "Rare", m: "Mythic", s: "Special", b: "Bonus" };
const copyFiltersOffered = () => !BROWSE.saved && !!COLL && COLL.entries.some(e => e.set || e.rar || e.foil);
const copyFilterOn = () => copyFiltersOffered() && !!(BROWSE.set || BROWSE.rar || BROWSE.foil);
function copyFits(e) {
  if (BROWSE.foil === "foil" ? !e.foil : BROWSE.foil === "non" && e.foil) return false;
  if (BROWSE.set && (e.set || "") !== BROWSE.set) return false;
  return !BROWSE.rar || copyPrint(e).rar === BROWSE.rar;
}
// The copies of a card on this screen that fit → {qty, lo, hi, locs} (what ownValue gives for all of them, and where they are).
function copyFit(name) {
  let qty = 0, lo = 0, hi = 0; const at = browseScope(), locs = new Set();
  for (const c of ownCopies(name)) {
    if ((at != null && c.e.loc !== at) || !copyFits(c.e)) continue;
    qty += c.e.qty; locs.add(c.e.loc);
    if (c.price > 0) { lo = lo ? Math.min(lo, c.price) : c.price; hi = Math.max(hi, c.price); }
  }
  return { qty, lo, hi, locs };
}
// A row's price: of the copies that fit when a copy filter is on, else of every copy on the screen.
const rowPriceNum = c => (c.fit ? c.fit.hi : priceNum(c.name, browseScope()));
const rowPriceText = c => (c.fit ? (!c.fit.hi ? "" : c.fit.lo < c.fit.hi ? `${money(c.fit.lo)}–${money(c.fit.hi)}` : money(c.fit.hi)) : priceText(c.name, browseScope()));
// What the sheet offers: the sets and rarities among the copies on this screen, sets newest first.
function copyChoices() {
  const at = browseScope(), sets = new Map(), rars = new Set();
  for (const e of COLL ? COLL.entries : []) {
    if (at != null && e.loc !== at) continue;
    if (e.set) sets.set(e.set, (sets.get(e.set) || 0) + e.qty);
    const r = copyPrint(e).rar; if (r) rars.add(r);
  }
  const when = code => { const s = setOf(code); return s ? s.released : ""; };
  return { sets: [...sets.keys()].sort((a, b) => when(b).localeCompare(when(a)) || setName(a).localeCompare(setName(b))), rars: Object.keys(RARITY_NAMES).filter(r => rars.has(r)) };
}
function filteredBrowse(skip) {
  const deck = browseIsDeck(), terms = norm(BROWSE.q).split(/\s+/).filter(Boolean);
  const bit = BROWSE.role && hasRoles() ? DATA.roles.indexOf(BROWSE.role) : -1, byCopy = copyFilterOn();
  let list = browseCards().filter(c => {
    const row = cardOf(c.name);
    if (byCopy) { const fit = copyFit(c.name); if (!fit.qty) return false; c.fit = fit; c.qty = fit.qty; c.locs = fit.locs; }
    if (bit >= 0 && (!row || !((row[5] >> bit) & 1))) return false;
    if (BROWSE.colors.size && (!row || ![...row[1]].every(ch => ch === "C" || BROWSE.colors.has(ch)))) return false;
    if (BROWSE.formats.size && !matchesFormats(c.name, BROWSE.fmtMode, [...BROWSE.formats])) return false;
    if (terms.length) { const w = cardWords(c); if (!terms.every(t => w.includes(t))) return false; }
    if (!quickMatch(c.name, BROWSE.quick, skip)) return false;   // the quick row is on every screen since 0.79.0
    return true;
  });
  return sortRows(list, sortOf("browse"), { qty: c => c.qty, price: rowPriceNum, rar: c => rowPrint(c).rar, set: c => rowPrint(c).set });
}
// For a sort by rarity or set (0.75.0): the rarest and the newest of the card's copies on this screen that fit.
function rowPrint(c) {
  if (c.print) return c.print;
  let rar = "", set = "", when = ""; const at = browseScope();
  for (const x of ownCopies(c.name)) {
    if ((at != null && x.e.loc !== at) || !copyFits(x.e)) continue;
    const p = copyPrint(x.e), s = setOf(p.set), w = s ? s.released || "" : "";
    if (p.rar && SORT_RARS.includes(p.rar) && (!rar || SORT_RARS.indexOf(p.rar) < SORT_RARS.indexOf(rar))) rar = p.rar;
    if (p.set && (!set || w > when)) { set = p.set; when = w; }
  }
  return (c.print = { rar, set });
}
function browseGroups(list) {
  const keyOf = c => {
    const row = cardOf(c.name);
    if (c.side && BROWSE.group) return [98, "Sideboard"];
    if (BROWSE.group === "type") { if (c.cmd) return [-2, "Commander"]; if (c.comp) return [-1, "Companion"]; const t = row ? row[2] : (isBasic(c.name) ? "L" : "O"); return [typeRank(t), TYPE_NAMES[t] || "Other"]; }
    if (BROWSE.group === "color") { const col = !row ? "?" : row[1].length > 1 ? "M" : row[1]; return ["WUBRGMC?".indexOf(col), COLOR_NAMES[col] || "Unknown"]; }
    if (BROWSE.group === "role") { const r = primaryRole(c.name); return r ? [ROLE_COUNTED.indexOf(r), r] : [99, "Other"]; }
    return [0, ""];
  };
  const groups = new Map();
  for (const c of list) { const [order, title] = keyOf(c); if (!groups.has(title)) groups.set(title, { order, title, items: [] }); groups.get(title).items.push(c); }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function renderBrowse() {
  const el = $("#view-browse"); if (!el) return;
  const saved = savedById(BROWSE.saved);
  if (BROWSE.saved && !saved) { showView("collection"); return; }
  const loc = BROWSE.loc, isDeck = !saved && !BROWSE.box && isDeckLoc(loc), deck = !!saved || isDeck;
  const holds = !saved && BROWSE.box && isDeckLoc(loc);   // the box of a deck, opened as the box
  const all = browseCards(), list = filteredBrowse();
  const pageSize = imageView() ? 60 : 150;
  if (!BROWSE.shown) BROWSE.shown = pageSize;
  const shown = list.slice(0, BROWSE.shown);
  const totalQty = all.reduce((n, c) => n + c.qty, 0);
  // A location's cards, or the whole collection's, are worth what those copies are; a saved decklist names cards, not copies.
  const at = browseScope(), counted = new Set();
  const value = all.reduce((n, c) => { const k = norm(c.name); if (!saved && counted.has(k)) return n; counted.add(k); return n + (saved ? priceNum(c.name) * c.qty : ownValue(c.name, at).sum); }, 0);
  const b = saved ? buildForSaved(saved.id) : isDeck ? buildForDeck(loc) : null;
  if (formatsOffered()) loadLegal();
  // A saved deck isn't tied to any cards, so each card shows where your copy is, or that it's missing.
  const status = c => saved ? statusItem(c.name, c.qty, null) : null;
  const pick = !!BSEL;   // selecting several cards (0.59.0): every card is a tick, in every view
  if (pick) bselPrune(all);
  const listRow = c => {
    const row = cardOf(c.name), st = status(c);
    const where = st ? (st.tone === "missing" ? `<span class="warn">missing</span>` : st.tone ? `<span class="warn">${st.sub}</span>` : st.sub) : loc == null ? esc([...c.locs].map(locName).join(", ")) : "";
    if (pick) return `<label class="bres sel-row" data-pick="browse" data-card="${esc(c.name)}"><input type="checkbox" data-sel-box aria-label="Select ${esc(c.name)}"><span><strong>${esc(c.name)}${c.qty > 1 ? ` <span class="muted num">×${c.qty}</span>` : ""}</strong>
      <small>${[row ? TYPE_SINGULAR[row[2]] : "", row && row[2] !== "L" ? (costOf(c.name) ? manaHTML(costOf(c.name)) : `mana value ${row[4] || 0}`) : "", where].filter(Boolean).join(" · ")}</small></span>
      <span class="price num">${rowPriceText(c)}</span></label>`;
    return `<button class="bres" data-sheet="browse" data-card="${esc(c.name)}"><span><strong>${esc(c.name)}${c.qty > 1 ? ` <span class="muted num">×${c.qty}</span>` : ""}</strong>
      <small>${[row ? TYPE_SINGULAR[row[2]] : "", row && row[2] !== "L" ? (costOf(c.name) ? manaHTML(costOf(c.name)) : `mana value ${row[4] || 0}`) : "", where].filter(Boolean).join(" · ")}</small></span>
      <span class="price num">${rowPriceText(c)}</span></button>`;
  };
  const groups = browseGroups(shown);
  const show = shownView(true);
  const results = show === "table" ? browseTableHTML(groups, { saved, loc })
    : show === "list"
    ? groups.map(g => { const html = `${g.title ? `<div class="loc-head">${pick ? grpTickHTML(g.title) : ""}<h3>${esc(g.title)}</h3><span class="muted small num">${g.items.reduce((n, c) => n + c.qty, 0)}</span></div>` : ""}<div class="results">${g.items.map(listRow).join("")}</div>`;
        return pick ? `<section class="bgroup">${html}</section>` : html; }).join("")
    : cardGroupsHTML(groups.map(g => ({ title: g.title, tick: pick && !!g.title, items: g.items.map(c => ({ ...(status(c) || { name: c.name, qty: c.qty, sub: loc == null ? esc(locName([...c.locs][0]) + (c.locs.size > 1 ? ` +${c.locs.size - 1}` : "")) : "", mv: (cardOf(c.name) || [])[4] }), ...(pick ? { pick: "browse" } : {}) })) })), "browse");
  const icon = saved ? neutralIconHTML("list") : loc != null ? `<button class="loc-ic-btn" data-loc-style="${esc(loc)}" aria-label="Options for ${esc(locName(loc))}">${locIconHTML(loc, isDeck || holds)}</button>` : "";
  const box = loc == null ? "" : locName(loc), title = saved ? saved.name : loc == null ? "All cards" : isDeck ? deckName(loc) : box;
  let headHTML, countHTML;
  if (deck) {
    // The deck screen: back, the deck's name and Actions; quick filters; a count in cards with Save and Clear.
    let line;
    const sideN = all.filter(c => c.side).reduce((n, c) => n + c.qty, 0), withSide = n => (sideN ? `${cardsWord(n)} + ${sideN} sideboard` : cardsWord(n));
    if (saved) { const st = savedStats(saved); line = `Saved ${shortDate(saved.saved)} · ${withSide(st.total)} · you own ${st.owned} (${st.pct}%)${st.cost ? ` · ${money(st.cost)} to finish` : ""}`; }
    else { const copy = SAVED.find(d => d.from === "deck:" + loc); const lead = deckLead(loc).join(" + "); line = `${title !== box ? `In ${esc(box)} · ` : ""}${lead && lead !== title ? esc(lead) + " · " : ""}${withSide(totalQty - sideN)}${DATA ? " · " + money(value) : ""}${copy ? ` · copy saved ${shortDate(copy.saved)}` : ""}`; }
    headHTML = `<div class="deck-head"><button class="btn back" data-go="collection" aria-label="Back to Collection">${MARK.back}</button><h2 class="title-ic">${icon}<span>${esc(title)}</span></h2><button class="btn" id="deck-menu" aria-haspopup="dialog">Actions</button></div>
      <p class="muted small">${line}</p>${listNoteHTML(saved || buildForDeck(loc), "deck-note-text")}`;
    const n = list.reduce((t, c) => t + c.qty, 0), on = quickOn(BROWSE.quick) || BROWSE.q.trim();
    countHTML = `<div class="chip-row" role="group" aria-label="Filters">${filterChipsHTML(true)}<p class="muted small ccount" id="browse-count">${n === totalQty ? cardsWord(n) : `${n} of ${totalQty}`}${viewSaveLinkHTML("browse")}${on ? ` · <button class="btn link small" data-qclear="browse">Clear</button>` : ""}</p></div>
      <div class="count-row">${viewToggleHTML(true)}</div>`;
  } else {
    headHTML = `<div class="actions"><button class="btn" data-go="collection">${MARK.back} Collection</button>${loc != null ? `<button class="btn" id="box-menu" data-loc-style="${esc(loc)}" aria-haspopup="dialog">Actions</button>` : ""}${canAddTo(loc) ? `<button class="btn" id="box-add" data-add-cards="${esc(loc)}" aria-haspopup="dialog">Add cards</button>` : ""}</div>
      <div class="section-head"><h2 class="title-ic">${icon}<span>${esc(title)}</span></h2></div>
      <p class="muted small">${cardsWord(totalQty)} · ${all.length.toLocaleString()} unique${DATA ? " · " + money(value) : ""}</p>
      ${loc != null ? locNoteHTML(loc, "box-note") : ""}
      ${loc != null && box !== loc ? `<p class="muted small" id="box-was">${esc(COLL && COLL.source && !COLL.example ? COLL.source : "Your import")} calls it ${esc(loc)}.</p>` : ""}
      ${holds ? `<p class="small" id="box-holds">Holds ${deckName(loc) !== box ? `your deck <strong>${esc(deckName(loc))}</strong>` : "a deck"}, so its cards count as in use. <button class="btn link" data-browse="${esc(loc)}">Open the deck</button></p>` : ""}`;
    countHTML = `<div class="chip-row" role="group" aria-label="Filters">${filterChipsHTML()}</div>
      <div class="count-row"><p class="muted small" id="browse-count">${list.length === all.length ? cardsWord(list.length) : `${list.length.toLocaleString()} of ${all.length.toLocaleString()} cards match`}${loc == null ? " · everywhere" : ""}${viewSaveLinkHTML("browse")}${quickOn(BROWSE.quick) || BROWSE.q.trim() ? ` · <button class="btn link small" data-qclear="browse">Clear</button>` : ""}</p>${viewToggleHTML(true)}</div>`;
  }
  const confirm = saved && BROWSE.confirmDel ? `<div class="banner"><span>Delete the saved deck “${esc(saved.name)}”? Builds made from it stay.</span><span class="actions"><button class="btn danger" id="saved-del-yes">Delete</button><button class="btn" id="saved-del-no">Keep it</button></span></div>` : "";
  el.innerHTML = `<div class="filters">
    ${headHTML}
    ${confirm}
    <div id="browse-out"></div>
    <div class="search-field">${SEARCH_ICON}<input type="search" id="bsq" value="${esc(BROWSE.q)}" aria-label="Search ${loc == null && !saved ? "your cards" : "these cards"}" placeholder="Name, type, creature type, keyword or artist" autocomplete="off"></div>
    ${quickHTML("browse", all, BROWSE.quick, skip => filteredBrowse(skip), viewChipsHTML("browse"))}
    ${countHTML}
    ${list.length || pick ? bselLineHTML(list.length) : ""}
    <div class="panel">${list.length ? results : !all.length && loc != null && !saved ? `<p class="muted" id="box-empty">Nothing is in ${esc(box)} yet. Cards go in from “${esc(PUT_AWAY)}”: pick it there, or let a filing rule send them.${canAddTo(loc) ? " “Add cards” above puts cards in by name." : ""}</p>` : `<p class="muted">No cards match these filters.</p>`}
      ${list.length > shown.length ? `<div class="actions center"><button class="btn" id="browse-more">Show more (${(list.length - shown.length).toLocaleString()} left)</button></div>` : ""}</div>
    ${deck ? tokensHostHTML("browse") : ""}
    ${loc != null && !saved ? tokensHostHTML("box") : ""}
  </div>`;
  if (pick) { el.firstElementChild.insertAdjacentHTML("beforeend", `<div class="selbar" id="bselbar" role="region" aria-label="Selected cards"></div>`); bselPaint(); }
  if (SELMENU_OPEN === "browse") renderSelMenu();
  if (imageView()) paintImgs();
  const f = $("#filters"); if (f && f.open) renderFilters();
  const m = $("#deckmenu"); if (m && m.open && !DECKMENU_KEEP) renderDeckMenu();
}

// ------------------------------------------------------------ quick filters (0.32.0; engine quickMatch)
// Chips for type, mana value (with Or less / Exactly / Or more) and colour, on every list of cards. They fold into one
// line saying what's on; the fold is remembered (bt.qopen), and taking a view that uses them folds them away, so a
// filtered list gets the screen. `scope` names whose filter a chip changes ("browse"); quickState/quickRender map it.
let QOPEN = store.get("bt.qopen") !== "0";
// Builds keep their quick filters per build for the visit (BUILD_QUICK), so switching builds starts clear.
const BUILD_QUICK = new Map();
const buildQuick = b => { if (!b) return quickBlank(); if (!BUILD_QUICK.has(b.id)) BUILD_QUICK.set(b.id, quickBlank()); return BUILD_QUICK.get(b.id); };
const quickState = scope => scope === "build" ? buildQuick(curBuild()) : BROWSE.quick;
const quickRender = scope => { if (scope === "build") renderBuild(); else { BROWSE.shown = 0; renderBrowse(); } };
const setQOpen = open => { QOPEN = open; store.set("bt.qopen", open ? "1" : "0"); };
function mvLabel(v, mode) {
  const top = v >= QUICK_MV_TOP;
  return mode === "le" ? `≤${v}` : mode === "ge" || top ? `${v}+` : `${v}`;
}
// "Instants · mana value ≤4 · white or red"
function quickSummary(f) {
  const parts = [];
  if (f.types.length) parts.push(QUICK_TYPES.filter(t => f.types.includes(t)).map(t => TYPE_NAMES[t]).join(" or "));
  if (f.mv != null) parts.push(`mana value ${mvLabel(f.mv, f.mode)}`);
  if (f.colors.length) parts.push([...COLORS, "C"].filter(c => f.colors.includes(c)).map(c => COLOR_NAMES[c]).join(" or ") + (f.by === "id" ? " identity" : ""));
  return parts.map((p, i) => i ? p.toLowerCase() : p).join(" · ");
}
// all: every card [{name, qty}]; without(skip): the cards passing every filter but that part (for its chips' counts);
// pinned: the chips of the views pinned to this screen (views.js), which sit above the row.
function quickHTML(scope, all, f, without, pinned = "") {
  const qty = l => l.reduce((n, c) => n + c.qty, 0);
  const byType = without("type");
  const types = QUICK_TYPES.filter(t => all.some(c => typeOf(c.name) === t)).map(t => {
    const n = qty(byType.filter(c => typeOf(c.name) === t)), on = f.types.includes(t);
    return `<button class="qchip" data-q="${scope}" data-qtype="${t}" aria-pressed="${on}"${!n && !on ? " disabled" : ""}>${TYPE_SINGULAR[t]} <span class="n num">${n}</span></button>`;
  }).join("");
  const mvs = Array.from({ length: QUICK_MV_TOP + 1 }, (_, v) => {
    const on = f.mv === v, inr = !on && f.mv != null && (f.mode === "le" ? v < f.mv : f.mode === "ge" ? v > f.mv : false);
    return `<button class="qchip${inr ? " inrange" : ""}" data-q="${scope}" data-qmv="${v}" aria-pressed="${on}" aria-label="Mana value ${v === QUICK_MV_TOP ? v + " or more" : v}">${v === QUICK_MV_TOP ? v + "+" : v}</button>`;
  }).join("");
  const mode = f.mv != null ? `<div class="seg seg-fill" role="group" aria-label="Mana value">${[["le", "Or less"], ["eq", "Exactly"], ["ge", "Or more"]]
    .map(([m, l]) => `<button data-q="${scope}" data-qmode="${m}" aria-pressed="${f.mode === m}">${l}</button>`).join("")}</div>` : "";
  // Colours the deck's cards have (by mana cost), and Colorless when a card other than a land has none. By colour
  // identity (0.80.0) a land has its colours too, and Colorless is offered when any card has none.
  const byId = f.by === "id", has = new Set(all.flatMap(c => [...quickColors(c.name, f)]));
  const cols = [...COLORS.filter(c => has.has(c) || f.colors.includes(c)), ...(all.some(c => (byId || typeOf(c.name) !== "L") && !quickColors(c.name, f)) || f.colors.includes("C") ? ["C"] : [])];
  const colors = cols.map(c => `<button class="qchip" data-q="${scope}" data-qcolor="${c}" aria-pressed="${f.colors.includes(c)}" aria-label="${COLOR_NAMES[c]}">${pip(c)}</button>`).join("");
  // Which colours a colour chip reads, offered once one is on (as the mana value's Or less / Exactly / Or more is).
  const by = f.colors.length ? `<div class="seg seg-fill" role="group" aria-label="Which colors">${[["", "Card's own color"], ["id", "Color identity"]]
    .map(([k, l]) => `<button data-q="${scope}" data-qby="${k}" aria-pressed="${(byId ? "id" : "") === k}">${l}</button>`).join("")}</div>` : "";
  const savedRow = pinned ? `<div class="chip-row qsaved" role="group" aria-label="Views pinned here">${pinned}</div>` : "";
  const sum = quickSummary(f);
  return `<div class="qfilters">${savedRow}
    <button class="qtoggle${sum ? " has-on" : ""}" data-qtoggle aria-expanded="${QOPEN}" aria-controls="qbody-${scope}"><span class="qsum">${QOPEN || !sum ? "Type, mana value and color" : esc(sum)}</span><span class="chev" aria-hidden="true">${MARK.open}</span></button>
    <div class="qbody" id="qbody-${scope}"${QOPEN ? "" : " hidden"}>
      <div class="qchips types" role="group" aria-label="Card type">${types}</div>
      <div class="qchips eq" role="group" aria-label="Mana value" style="--n:${QUICK_MV_TOP + 1}">${mvs}</div>${mode}
      ${cols.length ? `<div class="qchips eq" role="group" aria-label="Color" style="--n:${Math.max(cols.length, 4)}">${colors}</div>${by}` : ""}
    </div>
  </div>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-q], [data-qtoggle], [data-qclear]");
  if (!t) return;
  const d = t.dataset;
  if (d.qtoggle != null) { setQOpen(!QOPEN); rerenderCurrent(); return; }
  const f = quickState(d.q || d.qclear);
  const flip = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  if (d.qclear) { Object.assign(f, quickBlank()); delete f.by; if ((d.qclear) === "browse") BROWSE.q = ""; }
  else if (d.qtype) f.types = flip(f.types, d.qtype);
  else if (d.qmv != null) { const v = +d.qmv; f.mv = f.mv === v ? null : v; if (f.mv == null) f.mode = "le"; }
  else if (d.qmode) f.mode = d.qmode;
  else if (d.qcolor) { f.colors = flip(f.colors, d.qcolor); if (!f.colors.length) delete f.by; }
  else if (d.qby != null) { if (d.qby === "id") f.by = "id"; else delete f.by; }
  quickRender(d.q || d.qclear);
});

// ------------------------------------------------------------ the deck's Actions sheet (0.32.0)
// The buttons that sat under a deck's name, as a sheet like a build's Actions. Drawn only while open, so the action
// ids (#browse-copy…) exist once. (Saved filters were renamed and deleted here until 0.81.0: they are views now, in
// the Views sheet.)
let DECKMENU_PAGE = "main";
function openDeckMenu() { DECKMENU_PAGE = "main"; renderDeckMenu(); openDlg($("#deckmenu")); }
function renderDeckMenu() {
  const body = $("#deckmenu-body"); if (!body) return;
  const saved = savedById(BROWSE.saved), loc = BROWSE.loc;
  if (!browseIsDeck()) { closeDlg($("#deckmenu")); return; }
  const name = saved ? saved.name : deckName(loc);
  if (DECKMENU_PAGE === "apart" && !saved && canTakeApart(loc)) { body.innerHTML = apartPageHTML(loc); return; }
  DECKMENU_PAGE = "main";
  const b = saved ? buildForSaved(saved.id) : buildForDeck(loc);
  const item = (attr, label, sub = "", cls = "") => `<button class="menu-item${cls}" ${attr}><span class="mi-text"><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</span></button>`;
  const start = saved ? `data-saved="${esc(saved.id)}"` : `data-owned="${esc(loc)}"`;
  body.innerHTML = `<h2 id="deckmenu-title" tabindex="-1" autofocus>${esc(name)}</h2>
    <p class="muted small">${saved ? "A saved decklist. It doesn't claim any cards in your collection." : name !== locName(loc) ? `Your deck in <strong>${esc(locName(loc))}</strong>. Renaming it here leaves the box's name as it is.` : "The deck as imported. A build is a separate copy, so this stays as it is."}</p>
    <div class="field"><label for="deck-name">Name</label><input type="text" id="deck-name" value="${esc(name)}" maxlength="80" enterkeyhint="done"></div>
    ${noteField("deck-note", saved || buildForDeck(loc), NOTE_HINT)}
    <div class="menu-list">
      ${item(start, b ? "Open build" : "Start a build from this deck", b ? "" : "Tune it, swap cards, gather what's missing")}
      ${item(`id="browse-copy"`, "Copy decklist", "For Moxfield or Archidekt")}
      ${saved ? "" : item(`id="browse-save"`, "Save a copy", "Keep this list even if you take the deck apart")}
      ${item(`id="browse-template"`, "Use as template", "Shape new builds like this deck")}
      ${saved ? item(`id="saved-del"`, "Delete this saved deck", "", " danger") : ""}
      ${!saved && canTakeApart(loc) ? item("data-dm-apart", "Take this deck apart", `Its cards go to “${esc(PUT_AWAY)}”; the list is kept`, " danger") : ""}
    </div>
    <div class="sheet-pair"><button class="btn" data-dm-close>Close</button></div>`;
}
document.addEventListener("click", e => {
  if (e.target.id === "deck-menu") { openDeckMenu(); return; }
  const dlg = $("#deckmenu"); if (!dlg || !dlg.open) return;
  if (e.target === dlg) { closeDlg(dlg); return; }
  const t = e.target.closest && e.target.closest("#deckmenu button"); if (!t) return;
  const d = t.dataset;
  if (d.dmBack != null) { DECKMENU_PAGE = "main"; renderDeckMenu(); return; }
  if (d.dmApart != null) { DECKMENU_PAGE = "apart"; renderDeckMenu(); const h = $("#deckmenu-title"); if (h) h.focus(); return; }   // the question is read from its start
  if (d.dmApartYes != null) { const loc = BROWSE.loc; closeDlg(dlg); takeApart(loc); return; }
  closeDlg(dlg);   // every other item does its job (the handlers above) with the sheet closed
});
// Renaming, at the top of Actions: a saved deck's name, or a deck's own (kept by its build, made now if it has none).
// The sheet isn't redrawn: a tap on one of its buttons is what ended the typing, and must still land.
let DECKMENU_KEEP = false;
function renameDeck(to) {
  const saved = savedById(BROWSE.saved), loc = BROWSE.loc, name = to.trim(), was = saved ? saved.name : loc ? deckName(loc) : "";
  if (!name || name === was || (!saved && !isDeckLoc(loc))) return was;
  if (saved) { saved.name = name; saved.updated = Date.now(); saveSaved(); }
  else { const b = deckBuild(loc); b.name = name; b.updated = Date.now(); saveBuilds(); }
  DECKMENU_KEEP = true; try { renderBrowse(); } finally { DECKMENU_KEEP = false; }
  const h = $("#deckmenu-title"); if (h) h.textContent = name;
  return name;
}
document.addEventListener("change", e => { if (e.target.id === "deck-name") e.target.value = renameDeck(e.target.value); });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "deck-name") e.target.blur(); });

// ------------------------------------------------------------ table view (0.32.0)
// One line per card. Headers sort (Card, Cost and Type; Price high to low). Phones show the card, its cost, its type
// (unless grouped by type) and either the price or where it is; wider screens add mana value, role and price.
function whereHTML(st, name) {
  if (st.kind === "free" || st.kind === "indeck") return `<span class="where${st.kind === "indeck" ? " warn" : ""}">${locIconHTML(st.loc, st.kind === "indeck", null, "sm")}<span>${esc(stName(st))}</span></span>`;
  if (st.kind === "here") return "in this deck";
  if (st.kind === "basic") return "basic land";
  const r = name && cardOf(name);
  return `<span class="warn">missing${r && r[3] ? " · " + money(r[3]) : ""}</span>`;
}
// cols: [{label, cls, sort?, cell(item)}]; groups: [{title, items}]; rowAttr(item) makes a row open the card. The box around
// the table is what the stylesheet measures to show or hide the c-wide columns.
function cardTableHTML(groups, cols, rowAttr, sortKey) {
  const head = cols.map(c => {
    const first = sortParts(sortKey)[0], on = c.sort && first.k === c.sort, dir = (c.sort === "price") !== first.down ? "descending" : "ascending";
    return `<th class="${c.cls}"${on ? ` aria-sort="${dir}"` : ""}>${c.sort ? `<button data-tsort="${c.sort}">${c.label}${on ? (dir === "descending" ? " " + MARK.sortDown : " " + MARK.sortUp) : ""}</button>` : `<span>${c.label}</span>`}</th>`;
  }).join("");
  const qtyOf = g => g.items.reduce((n, x) => n + (x.qty || (x.c && x.c.qty) || 1), 0);
  return `<div class="ctable-box"><table class="ctable"><thead><tr>${head}</tr></thead>${groups.map(g => `<tbody>${g.title ? `<tr class="tgroup"><th colspan="${cols.length}">${g.tick ? grpTickHTML(g.title) : ""}${esc(g.title)}<span class="n">${qtyOf(g)}</span></th></tr>` : ""}${
    g.items.map(it => `<tr ${rowAttr(it)}>${cols.map(c => `<td class="${c.cls}">${c.cell(it)}</td>`).join("")}</tr>`).join("")}</tbody>`).join("")}</table></div>`;
}
const nameCell = (name, qty, attrs) => `<button ${attrs}>${qty > 1 ? `<span class="q">${qty}</span>` : ""}${esc(name)}</button>`;
const costCell = name => { const r = cardOf(name), cost = costOf(name); return r && r[2] !== "L" ? (cost ? manaHTML(cost) : `<span class="num">${r[4] || 0}</span>`) : ""; };
const mvCell = name => { const r = cardOf(name); return r && r[2] !== "L" ? String(r[4] || 0) : ""; };
const priceCell = (name, loc = null) => priceText(name, loc);
function browseTableHTML(groups, { saved, loc }) {
  const where = !!saved || loc == null;
  const cols = [
    { label: "Card", cls: "c-name", sort: "name", cell: c => { const name = nameCell(c.name, c.qty, `data-sheet="browse" data-card="${esc(c.name)}"`); return BSEL ? `<span class="pick-cell">${tickHTML()}${name}</span>` : name; } },
    { label: "Cost", cls: "c-cost", sort: "mv", cell: c => costCell(c.name) },
    { label: "MV", cls: "c-mv c-wide", cell: c => mvCell(c.name) },
    BROWSE.group !== "type" && !where && { label: "Type", cls: "c-type", sort: "type", cell: c => TYPE_SINGULAR[typeOf(c.name)] || "" },
    where && { label: "Where", cls: "c-where", cell: c => saved ? whereHTML(cardStatus(c.name, c.qty, null)) : esc([...c.locs].map(locName).join(", ")) },
    hasRoles() && { label: "Role", cls: "c-role c-wide", cell: c => esc(primaryRole(c.name) || "") },
    { label: "Price", cls: "c-price", sort: "price", cell: c => rowPriceText(c) },
  ].filter(Boolean);
  return cardTableHTML(groups.map(g => ({ ...g, tick: !!BSEL && !!g.title })), cols, c => `data-trow="${esc(c.name)}"` + (BSEL ? ` data-pick="browse" data-card="${esc(c.name)}" aria-selected="false"` : ""), BROWSE.sort);
}
// Builds (0.33.0): the same quick filters over the build's cards, and a table with Where (a location's icon and name,
// another deck in warning colour, or "missing · $price"); a row opens the card with its swaps.
function buildQuickHTML(b) {
  const f = buildQuick(b), all = b.cards.map(c => ({ name: c.name, qty: c.qty }));
  const without = skip => all.filter(c => quickMatch(c.name, f, skip));
  const n = without().reduce((t, c) => t + c.qty, 0), total = all.reduce((t, c) => t + c.qty, 0);
  return `${quickHTML("build", all, f, without, viewChipsHTML("build"))}
    <div class="chip-row" role="group" aria-label="Views">${viewsChipHTML("build")}${quickOn(f) ? `<p class="muted small ccount" id="build-qcount">${n} of ${total}${viewSaveLinkHTML("build")} · <button class="btn link small" data-qclear="build">Clear</button></p>` : ""}</div>`;
}
function buildTableHTML(b, groups, home) {
  const pick = selOn(b);   // selecting several cards: a row is a tick, not a way into the card
  const cols = [
    { label: "Card", cls: "c-name", sort: "name", cell: ({ c, i, side }) => { const name = nameCell(c.name, c.qty, `data-sheet="${side ? "side" : "build"}" data-card="${esc(c.name)}" data-i="${i}"`); return pick ? `<span class="pick-cell">${tickHTML()}${name}</span>` : name; } },
    { label: "Cost", cls: "c-cost", sort: "mv", cell: ({ c }) => costCell(c.name) },
    { label: "MV", cls: "c-mv c-wide", cell: ({ c }) => mvCell(c.name) },
    { label: "Where", cls: "c-where", cell: ({ c }) => whereHTML(cardStatus(c.name, c.qty, home), c.name) },
    hasRoles() && { label: "Role", cls: "c-role c-wide", cell: ({ c }) => esc(primaryRole(c.name) || "") },
    { label: "Price", cls: "c-price", sort: "price", cell: ({ c }) => priceCell(c.name) },
  ].filter(Boolean);
  return cardTableHTML(groups.map(g => ({ ...g, tick: pick })), cols, ({ c, i, side }) => (side ? `data-trow-s="${i}"` : `data-trow-b="${i}"`) + (pick ? ` data-pick="${side ? "side" : "deck"}" data-card="${esc(c.name)}" aria-selected="false"` : ""), buildSort)
    .replace(/data-tsort=/g, "data-tsort-b=");   // a sideboard's rows: i = the place in b.side
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-tsort-b], tr[data-trow-b], tr[data-trow-s]"); if (!t) return;
  if (t.dataset.tsortB) { setSort("build", headSort(buildSort, t.dataset.tsortB)); return; }
  const b = curBuild(), side = t.dataset.trowS != null, i = +(side ? t.dataset.trowS : t.dataset.trowB), c = b && (side ? sideOf(b) : b.cards)[i];
  if (c && !e.target.closest("button, a")) openSheet(side ? "side" : "build", c.name, i);
});
// A tap anywhere on a row opens the card (the name is the row's button, for keyboards); a header sorts.
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-tsort], tr[data-trow]"); if (!t) return;
  if (t.dataset.tsort) { setSort("browse", headSort(BROWSE.sort, t.dataset.tsort)); return; }
  if (!e.target.closest("button, a")) openSheet("browse", t.dataset.trow, null);
});

// ------------------------------------------------------------ collection filters (a sheet)
const groupChoices = () => [["", "None"], ["type", "Type"], ["color", "Color"], ...(hasRoles() ? [["role", "Role"]] : [])];
const fmtList = () => legalReady() ? shownFormats() : FORMAT_SHORTLIST;
const filterCount = () => [BROWSE.formats.size, BROWSE.role, BROWSE.colors.size].filter(Boolean).length;
function formatChipText() {
  const names = [...BROWSE.formats].map(f => FORMAT_NAMES[f] || f);
  return `${BROWSE.fmtMode === "banned" ? "Banned in" : "Legal in"} ${names.join(BROWSE.fmtMode === "banned" ? " or " : " and ")}`;
}
// The row under the search box: one chip per filter that's on (tap to remove it), then Filters and Sort.
function filterChipsHTML(deck) {
  const on = [];
  if (BROWSE.formats.size) on.push(["fmt", formatChipText()]);
  if (BROWSE.role) on.push(["role", BROWSE.role]);
  if (BROWSE.colors.size) on.push(["colors", `Within ${COLORS.filter(c => BROWSE.colors.has(c)).map(c => COLOR_NAMES[c]).join(", ")}`]);
  if (copyFiltersOffered()) {
    if (BROWSE.set) on.push(["set", setName(BROWSE.set)]);
    if (BROWSE.rar) on.push(["rar", RARITY_NAMES[BROWSE.rar] || BROWSE.rar]);
    if (BROWSE.foil) on.push(["foil", BROWSE.foil === "foil" ? "Foil" : "Not foil"]);
  }
  return on.map(([k, text]) => `<button class="fchip on" data-fclear="${k}" aria-label="Remove filter: ${esc(text)}"><span>${esc(text)}</span><span class="fchip-x" aria-hidden="true">${MARK.remove}</span></button>`).join("")
    + `<button class="fchip" data-filters-open>Filters${on.length ? ` · ${on.length}` : ""}</button><button class="fchip" data-sort-open="browse" aria-haspopup="dialog">Sort: ${sortShort(sortOf("browse"))}</button>${viewsChipHTML("browse")}`;
}
function openFilters(focus) {
  const dlg = $("#filters"); if (!dlg) return;
  if (formatsOffered()) loadLegal();
  renderFilters();
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
function closeFilters() { const dlg = $("#filters"); if (dlg && dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }
// Set, Rarity and Finish: about your copies, so each says so once ("Your copies").
function copyFiltersHTML(seg) {
  const ch = copyChoices(), code = s => s.toUpperCase();
  if (BROWSE.set && !ch.sets.includes(BROWSE.set)) ch.sets.unshift(BROWSE.set);
  return `${ch.sets.length ? `<section class="fgroup"><label class="flabel" for="bs-set">Set of your copy</label><select id="bs-set" class="fselect"><option value="">Any set</option>${ch.sets.map(s => `<option value="${esc(s)}"${BROWSE.set === s ? " selected" : ""}>${esc(setName(s))}${setName(s) !== code(s) ? ` (${esc(code(s))})` : ""}</option>`).join("")}</select></section>` : ""}
    ${ch.rars.length ? `<section class="fgroup"><label class="flabel" for="bs-rar">Rarity of your copy</label><select id="bs-rar" class="fselect"><option value="">Any rarity</option>${ch.rars.map(r => `<option value="${r}"${BROWSE.rar === r ? " selected" : ""}>${RARITY_NAMES[r]}</option>`).join("")}</select></section>` : ""}
    <section class="fgroup"><h3 class="flabel">Finish</h3>${seg("bfoil", [["", "Any"], ["foil", "Foil"], ["non", "Not foil"]], BROWSE.foil, "Finish")}</section>`;
}
function renderFilters() {
  const body = $("#filters-body"); if (!body) return;
  const n = filteredBrowse().length, fmts = formatsOffered() ? fmtList() : [], deck = browseIsDeck();
  const seg = (attr, choices, cur, label) => `<div class="seg seg-fill" role="group" aria-label="${label}">${choices.map(([v, name]) => `<button data-${attr}="${v}" aria-pressed="${cur === v}">${name}</button>`).join("")}</div>`;
  body.innerHTML = `<h2>Filters</h2>
    ${fmts.length ? `<section class="fgroup"><h3 class="flabel">Format</h3>
      ${seg("fmt-mode", [["legal", "Legal in"], ["banned", "Banned in"]], BROWSE.fmtMode, "Legal or banned")}
      <div class="opt-grid">${fmts.map(f => `<button class="opt" data-fmt="${f}" aria-pressed="${BROWSE.formats.has(f)}">${FORMAT_NAMES[f] || f}</button>`).join("")}</div>
      <p class="muted small">${BROWSE.fmtMode === "banned" ? "Cards banned in any format you pick." : "Cards legal in every format you pick."}${legalState === "loading" ? " Loading formats…" : ""}</p></section>` : ""}
    ${hasRoles() ? `<section class="fgroup"><label class="flabel" for="bs-role">Role</label><select id="bs-role" class="fselect"><option value="">Any role</option>${ROLE_COUNTED.map(r => `<option${BROWSE.role === r ? " selected" : ""}>${r}</option>`).join("")}</select></section>` : ""}
    <section class="fgroup"><h3 class="flabel">Within colors</h3>
      <div class="opt-grid five">${COLORS.map(c => `<button class="opt pip-opt" aria-pressed="${BROWSE.colors.has(c)}" data-bscolor="${c}" aria-label="${COLOR_NAMES[c]}">${pip(c)}</button>`).join("")}</div></section>
    ${copyFiltersOffered() ? copyFiltersHTML(seg) : ""}
    <section class="fgroup"><h3 class="flabel">Group by</h3>${seg("bgroup", groupChoices(), BROWSE.group, "Group by")}</section>
    <div class="sheet-pair fsheet-foot"><button class="btn" data-fclear="all">Clear filters</button><button class="btn primary" data-filters-close>Show ${cardsWord(n)}</button></div>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-filters-open], [data-filters-close], [data-fclear], [data-fmt], [data-fmt-mode], [data-bgroup], [data-bfoil]");
  if (!t) { if (e.target.id === "filters") closeFilters(); return; }
  const d = t.dataset;
  if (d.filtersOpen != null) { openFilters(d.filtersOpen); return; }
  if (d.filtersClose != null) { closeFilters(); return; }
  if (d.fclear) {
    const k = d.fclear;
    if (k === "fmt" || k === "all") BROWSE.formats.clear();
    if (k === "role" || k === "all") BROWSE.role = "";
    if (k === "colors" || k === "all") BROWSE.colors.clear();
    if (k === "set" || k === "all") BROWSE.set = "";
    if (k === "rar" || k === "all") BROWSE.rar = "";
    if (k === "foil" || k === "all") BROWSE.foil = "";
  }
  else if (d.fmt) BROWSE.formats.has(d.fmt) ? BROWSE.formats.delete(d.fmt) : BROWSE.formats.add(d.fmt);
  else if (d.fmtMode) BROWSE.fmtMode = d.fmtMode;
  else if (d.bgroup != null) BROWSE.group = d.bgroup;
  else if (d.bfoil != null) BROWSE.foil = d.bfoil;
  BROWSE.shown = 0; renderBrowse();
});

document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-browse], [data-browse-box], [data-browse-saved], [data-saved], [data-bscolor], #browse-more, #browse-copy, #browse-save, #browse-template, #saved-del, #saved-del-yes, #saved-del-no");
  if (!t) return;
  if (t.dataset.browseSaved) { openBrowse(null, t.dataset.browseSaved); return; }
  if (t.dataset.saved) { openSavedDeck(t.dataset.saved); return; }
  if (t.dataset.browseBox != null) { openBrowse(t.dataset.browseBox, null, true); return; }
  if (t.dataset.browse != null) { openBrowse(t.dataset.browse || null); return; }
  if (t.dataset.bscolor) { const c = t.dataset.bscolor; BROWSE.colors.has(c) ? BROWSE.colors.delete(c) : BROWSE.colors.add(c); BROWSE.shown = 0; renderBrowse(); return; }
  switch (t.id) {
    case "browse-more": BROWSE.shown += imageView() ? 120 : 300; renderBrowse(); break;
    case "browse-copy": {
      const deck = savedById(BROWSE.saved) || (BROWSE.loc ? deckListOf(BROWSE.loc) : null); if (!deck) break;
      copyText(buildDecklist(deck), "#browse-out", `Copied ${cardsWord(deck.cards.reduce((n, c) => n + c.qty, 0))}`); break;
    }
    case "browse-save": {
      if (!BROWSE.loc) break;
      const d = saveDeck({ ...deckListOf(BROWSE.loc), name: deckName(BROWSE.loc), note: deckNote(BROWSE.loc), from: "deck:" + BROWSE.loc });
      renderBrowse(); toast(`Saved a copy as “${d.name}”`, "View", () => openBrowse(null, d.id)); break;
    }
    case "browse-template": {
      const sd = savedById(BROWSE.saved);
      if (sd) useAsTemplate({ name: sd.name, cards: sd.cards, commanders: sd.commanders, companion: sd.companion, from: "saved:" + sd.id });
      else if (BROWSE.loc) { const d = deckListOf(BROWSE.loc); useAsTemplate({ ...d, name: deckName(BROWSE.loc), from: "deck:" + BROWSE.loc }); }
      break;
    }
    case "saved-del": BROWSE.confirmDel = true; renderBrowse(); break;
    case "saved-del-no": BROWSE.confirmDel = false; renderBrowse(); break;
    case "saved-del-yes": {
      const i = SAVED.findIndex(d => d.id === BROWSE.saved); if (i < 0) break;
      const [d] = SAVED.splice(i, 1); saveSaved(); showView("collection");
      toast(`Deleted “${d.name}”`, "Undo", () => { d.updated = Date.now(); SAVED.splice(i, 0, d); saveSaved(); if (view === "collection") renderCollection(); });
      break;
    }
  }
});
let bsqTimer = null;
document.addEventListener("input", e => {
  if (e.target.id !== "bsq") return;
  BROWSE.q = e.target.value; BROWSE.shown = 0;
  clearTimeout(bsqTimer);
  bsqTimer = setTimeout(() => { const pos = e.target.selectionStart; renderBrowse(); const box = $("#bsq"); if (box) { box.focus(); try { box.setSelectionRange(pos, pos); } catch {} } }, 150);
});
document.addEventListener("change", e => {
  const id = e.target.id;
  if (id === "bs-role") BROWSE.role = e.target.value;
  else if (id === "bs-set") BROWSE.set = e.target.value;
  else if (id === "bs-rar") BROWSE.rar = e.target.value;
  else return;
  BROWSE.shown = 0; renderBrowse();
});

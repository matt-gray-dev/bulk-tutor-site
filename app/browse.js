"use strict";
// Bulk Tutor, the page's script, part "browse": the collection browser and the deck screen: quick filters, the Actions sheet, the table view, the Filters sheet.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ collection: places, browser
// The browser shows one location (BROWSE.loc) or everything. **Since 0.97.0 (step 5, piece c2) a location always opens
// as the place it is**: the deck screen (a box opened as its deck, with its own Actions) went, and a box that holds a
// deck says which, with "Open the deck" (the Workbench). A deck is opened from the Decks tab.
// Formats: fmtMode "legal" (legal in every ticked format) or "banned" (banned in any), with the ticked formats.
// set, rar, foil (0.69.0): filters on your copies themselves (their set, rarity and finish), not on the card.
const BROWSE = { loc: null, q: "", role: "", colors: new Set(), fmtMode: "legal", formats: new Set(), set: "", rar: "", foil: "", sort: "name", group: "", shown: 0, confirmDel: false,
  quick: quickBlank() };   // the quick filters (engine quickMatch)
// Whose copies a price on this screen is about: the location's, or every copy you have (the whole collection).
const browseScope = () => BROWSE.loc;

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
  if (COLL) for (const loc of emptyPlaces()) if (!locs.has(loc)) locs.set(loc, { loc, qty: 0, value: 0, inDeck: false });   // places that hold nothing (collection.js)
  return [...locs.values()].sort((a, b) => locName(a.loc).localeCompare(locName(b.loc), undefined, { numeric: true }));   // by the names shown
}

// Which Collection boxes are folded, remembered in this browser (key → true when folded).
function foldState() { try { return JSON.parse(store.get("bt.fold") || "{}") || {}; } catch { return {}; } }
const foldOpen = (k, def) => { const f = foldState(); return k in f ? !f[k] : def; };
document.addEventListener("toggle", e => {
  const k = e.target.dataset && e.target.dataset.fold; if (!k) return;
  const f = foldState(); f[k] = !e.target.open; store.set("bt.fold", JSON.stringify(f));
}, true);

// **The order of the places** (0.105.0; step 6, piece 3; Matt, Nov 18, 14:06: "should be able to sort the collection
// list with a few basic controls. I think default to storage holding decks first, then alphabetical"): Decks first
// (a box that holds a deck), then by name, cards or value (most first), kept in this browser ("bt.placesort").
// Its sheet borrows #sortsheet (sorting.js: renderSort hands "places" to placesSortHTML).
const PLACE_BY = { name: "Name", qty: "Cards", value: "Value" };
let PLACESORT = (() => { try { const v = JSON.parse(store.get("bt.placesort") || "null"); return v && PLACE_BY[v.by] ? { decks: v.decks !== false, by: v.by } : { decks: true, by: "name" }; } catch { return { decks: true, by: "name" }; } })();
const placesSortWords = () => (PLACESORT.decks ? `Decks first, ${PLACE_BY[PLACESORT.by].toLowerCase()}` : PLACE_BY[PLACESORT.by]);
function placesOrder(list) {
  const by = PLACESORT.by, name = (a, b) => locName(a.loc).localeCompare(locName(b.loc), undefined, { numeric: true });
  return [...list].sort((a, b) => (PLACESORT.decks ? !!b.inDeck - !!a.inDeck : 0) || (by === "qty" ? b.qty - a.qty : by === "value" ? b.value - a.value : 0) || name(a, b));
}
function placesSortHTML() {
  return `<h2 id="sortsheet-title" tabindex="-1" autofocus>Sort places</h2>
    <div class="menu-list">${switchHTML("data-places-decks", PLACESORT.decks, "Decks first", "Boxes that hold a deck, above the rest")}</div>
    <section class="fgroup"><h3 class="flabel">Order by</h3><div class="seg seg-fill" role="group" aria-label="Order by">${Object.entries(PLACE_BY)
      .map(([k, w]) => `<button data-places-by="${k}" aria-pressed="${PLACESORT.by === k}">${w}</button>`).join("")}</div>
      <p class="muted small">Name A to Z; cards and value, most first.</p></section>
    <div class="sheet-pair"><button class="btn" data-places-reset${PLACESORT.decks && PLACESORT.by === "name" ? " disabled" : ""}>As it starts</button><button class="btn primary" data-sort-done>Done</button></div>`;
}
function setPlacesSort(next) { PLACESORT = { ...PLACESORT, ...next }; store.set("bt.placesort", JSON.stringify(PLACESORT)); renderCollectionDecks(); renderSort(); }
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("#places-sort, #sortsheet [data-places-by], #sortsheet [data-places-reset]"); if (!t) return;
  if (t.id === "places-sort") { openSort("places"); return; }
  if (t.dataset.placesBy) { setPlacesSort({ by: t.dataset.placesBy }); const a = $(`#sortsheet [data-places-by="${t.dataset.placesBy}"]`); if (a) a.focus(); }
  else setPlacesSort({ decks: true, by: "name" });
});
document.addEventListener("change", e => { if (e.target.matches && e.target.matches("#sortsheet [data-places-decks]")) setPlacesSort({ decks: e.target.checked }); });

// **The Collection lists places only** (0.97.0; step 5, piece c2; Matt, Nov 15, from the pictures): every box and
// binder under one fold, a box that holds a deck saying which ("Holds Yuriko · 99 cards"), a hot-swap's Swaps location
// under its deck's box, and an empty place "Empty". Decks are the Decks tab's (decks.js). Until 0.97.0 a Decks fold
// above listed them, and a box opened from it as the deck. (The container keeps its id, #coll-decks.)
function renderCollectionDecks() {
  const box = $("#coll-decks"); if (!box) return;
  const all = locationSummary(), isSw = l => swapsBase(l.loc) != null;
  // A hot-swap's Swaps binder is listed under its deck's box ("Deck – Marchesa" or "Marchesa" for "Marchesa · Swaps").
  const bare = loc => norm(loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, ""));
  const swapsOf = d => all.filter(l => isSw(l) && (norm(swapsBase(l.loc)) === norm(d.loc) || norm(swapsBase(l.loc)) === bare(d.loc)));
  // **Piles** (0.98.1; Matt, Nov 18, 14:06: "a section above 'binders and boxes' called 'piles'"): the put-away list
  // first (it isn't a place: putaway.js), then each deck's pile (collection.js isPileLoc), saying how it stands.
  const places = placesOrder(all.filter(l => !isSw(l) && l.loc !== PUT_AWAY && !isPileLoc(l.loc))), piles = all.filter(l => !isSw(l) && isPileLoc(l.loc));
  const attached = new Set(places.filter(l => l.inDeck).flatMap(d => swapsOf(d).map(l => l.loc)));
  const loose = all.filter(l => isSw(l) && !attached.has(l.loc));
  const total = all.reduce((n, l) => n + l.qty, 0), value = all.reduce((n, l) => n + l.value, 0);
  const listed = all.filter(l => l.loc !== PUT_AWAY && !isPileLoc(l.loc)), listedQty = listed.reduce((n, l) => n + l.qty, 0);
  // icon: a location's tile (a button that opens the picker) or a fixed symbol for All cards
  const row = (attr, name, sub, icon) => `<div class="loc-row">${icon}<button class="loc-main" ${attr}><span class="loc-text"><strong>${esc(name)}</strong><small>${sub}</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div>`;
  const icBtn = (loc, inDeck) => `<button class="loc-ic-btn" data-loc-style="${esc(loc)}" aria-label="Options for ${esc(locName(loc))}">${locIconHTML(loc, inDeck)}</button>`;
  const worth = l => `${cardsWord(l.qty)}${DATA ? " · " + money(l.value) : ""}`;
  const holds = l => { const name = deckName(l.loc); return `${boxGathers(l.loc) ? "Gathering" : "Holds"} ${name !== locName(l.loc) ? esc(name) : "a deck"} · ${worth(l)}`; };   // a deck at Building has its place from its first tick (0.98.0)
  // An empty place a deck still points at (its cards went out another way: the deck says "the box is empty") says whose it is.
  const emptyWords = loc => { const d = boxOfDeck(loc); return d ? `Empty · the box of ${esc(d.name)}` : "Empty"; };
  const swRow = (l, of) => row(`data-browse="${esc(l.loc)}"`, locName(l.loc), `Swaps for ${esc(of)} · ${worth(l)}`, icBtn(l.loc, true));
  // A pile's line: "Gathering · 34 of 100 cards" while its deck is being gathered, "Built" once it is (left as a pile),
  // the deck's name only when the pile's name doesn't say it (a deck renamed since).
  const pileSays = l => {
    const d = pileDeck(l.loc); if (!d) return l.qty ? worth(l) : "Empty";
    const named = norm(locName(l.loc)) !== norm(pileName(d)) ? ` ${esc(d.name)}` : "", n = d.cards.reduce((t, c) => t + c.qty, 0);
    return deckStatus(d) === "building" ? `Gathering${named} · ${deckGathered(d, l.loc)} of ${cardsWord(n)}${DATA && l.value ? " · " + money(l.value) : ""}` : `Built${named} · ${worth(l)}`;
  };
  const pa = putAwayRowHTML(), pileRows = piles.map(l => row(`data-browse="${esc(l.loc)}"`, locName(l.loc), pileSays(l), icBtn(l.loc, l.inDeck)));
  const pileCount = (pa ? 1 : 0) + piles.length, pileQty = putAwayQty() + piles.reduce((n, l) => n + l.qty, 0);
  const rows = [row(`data-browse=""`, "All cards", `${cardsWord(total)}${DATA ? " · " + money(value) : ""}`, neutralIconHTML("all")),
    ...places.map(l => l.inDeck
      ? row(`data-browse="${esc(l.loc)}"`, locName(l.loc), holds(l), icBtn(l.loc, true)) + swapsOf(l).map(s => `<div class="loc-sub">${swRow(s, deckName(l.loc))}</div>`).join("")
      : row(`data-browse="${esc(l.loc)}"`, locName(l.loc), l.qty ? worth(l) : emptyWords(l.loc), icBtn(l.loc, false))),
    ...loose.map(l => swRow(l, swapsBase(l.loc)))];
  box.innerHTML = `${pileCount ? `
    <details class="panel fold" data-fold="piles"${foldOpen("piles", true) ? " open" : ""}>
      <summary><h3>Piles</h3><span class="muted small">${pileCount} · ${cardsWord(pileQty)}</span></summary>
      <div class="loc-list">${pa}${pileRows.join("")}</div>
    </details>` : ""}
    <details class="panel fold" data-fold="binders"${foldOpen("binders", true) ? " open" : ""}>
      <summary><h3>Binders and boxes</h3><span class="muted small">${listed.length} · ${cardsWord(listedQty)}</span></summary>
      ${places.length > 1 ? `<div class="pa-ctl coll-sort"><button class="btn lctl-btn lctl-sort" id="places-sort" aria-haspopup="dialog" aria-label="Sort places. ${esc(placesSortWords())}">${icon("i-sort")}<span class="lctl-val">${esc(placesSortWords())}</span></button></div>` : ""}
      <div class="loc-list">${rows.join("")}</div>
    </details>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("#coll-search, [data-sync-goto]"); if (!t) return;
  if (t.id === "coll-search") { openBrowse(null); const q = $("#bsq"); if (q) q.focus(); return; }
  if (t.dataset.syncGoto != null) { showView("settings"); window.scrollTo({ top: 0 }); }
});

// One location's cards, or (loc null) every card.
function openBrowse(loc) {
  if (loc === PUT_AWAY) { openPutAway(); return; }   // the pile has a screen of its own (0.65.0)
  BSEL = null;   // a selection belongs to the screen it was made on
  Object.assign(BROWSE, { loc: loc || null, q: "", role: "", fmtMode: "legal", set: "", rar: "", foil: "", sort: (loc && locSort(loc)) || "name", group: "", shown: 0, quick: quickBlank() });
  BROWSE.colors.clear(); BROWSE.formats.clear();
  showView("browse"); window.scrollTo({ top: 0 });
}

// Cards in the current location, or everywhere, merged by name.
function browseCards() {
  const m = new Map();
  for (const e of COLL ? COLL.entries : []) {
    if (BROWSE.loc != null && e.loc !== BROWSE.loc) continue;
    const name = canonical(e.name), k = norm(name);
    const o = m.get(k) || { name, k, qty: 0, locs: new Set() };
    o.qty += e.qty; o.locs.add(e.loc); m.set(k, o);
  }
  return [...m.values()];
}
// ---- Selecting several cards here (0.59.0; Matt, Nov 11; the Workbench's is in builds.js and workbench.js). BSEL = a
// Set of normalized names, or null when not selecting; it lasts until Done or another screen. The ticks are drawn as in a
// build (paintTicks); "Select all" takes every card the search and filters match, shown yet or not. The group actions
// are the ones a card's details have here: add to the open build (its deck, or its sideboard) and your taste; and
// two about your copies themselves: move them to another box or binder (0.91.0), or out of your collection (0.83.0).
let BSEL = null;
let BSEL_RM = false;   // the selection's sheet is asking whether to remove the selected cards (0.83.0)
let BSEL_MV = null;    // the selection's sheet is asking where the selected cards go (0.91.0): {fresh (the new-box row is open), name, msg}
const BSEL_STAY = new Set(["rmask", "rmno", "mvask", "mvno", "mvfresh", "mvgo"]);   // taps that leave the sheet open: a question in the sheet itself
const bselCount = () => (BSEL ? BSEL.size : 0);
const bselHas = (_list, name) => !!BSEL && BSEL.has(norm(name));
function bselPrune(all) { const here = new Set(all.map(c => c.k)); for (const k of [...BSEL]) if (!here.has(k)) BSEL.delete(k); }
const bselNames = () => browseCards().filter(c => BSEL.has(c.k)).map(c => c.name);
function bselLineHTML(n) {
  if (!BSEL) return `<p class="sel-line"><button class="btn link small" data-bsel-mode="on">Select cards</button> <span class="muted small">to add several to a deck, or set your taste for them</span></p>`;
  return `<p class="sel-line"><button class="btn small" data-bsel-all>Select all ${n.toLocaleString()}</button><button class="btn small" data-bsel-none>Clear</button><span class="muted small">Tap cards${BROWSE.group ? ", or a group's box," : ""} to select them.</span></p>`;
}
function bselPaint() {
  const root = $("#view-browse"); if (!root || !BSEL) return;
  paintTicks(root, bselHas);
  const bar = $("#bselbar"); if (bar) bar.innerHTML = selBarHTML(BSEL.size).replace("data-sel-actions", "data-bsel-actions").replace('data-sel-mode="off"', 'data-bsel-mode="off"');
}
// What each action would touch: the open build takes cards while it isn't built, as a card's own details offer.
function bselActions() {
  const names = bselNames(), b = curBuild(), open = b && !b.built && DECK_SEEN === b.id ? b : null;   // the deck open in the Workbench on this visit (Matt, Nov 19: it offered the last deck he'd seen, even after a restart)
  return { names, build: open, add: open ? names.filter(n => canAdd(open, canonical(n), false)) : [], addside: open ? names.filter(n => canAdd(open, canonical(n), true)) : [], taste: names.filter(n => !isBasic(n) && cardOf(n)),
    mv: mvCopies(names),   // to another box or binder, or the put-away list (below): the copies in this box, or every copy that isn't in a deck
    rm: ownColl() ? names : [] };   // out of the collection (addcards.js): the copies in this box or deck, or every copy
}
// ---- Moving the selected cards (0.91.0; Matt, Nov 14, after his first pass on a phone: "I didn't see any option in
// the 'Actions' list to just move cards to a different box or even just to the put away list"; the model's
// Collection has "move" since Nov 13). The copies that move are the ones in the box or binder being looked at, or,
// from All cards, every copy that isn't in a deck (the put-away list's too: moving those files them). **Not from a
// deck's box:** a card leaves a deck through the deck's list (its copies count as part of the deck, and Assemble
// says what to take out). Where to: any box or binder that isn't a deck, a new one by name, or the put-away list
// ("decide later": it then says the box it came from). One change on the record ({by: "hand", act: "moved"}), one
// message with Undo, one row under Recent changes.
const mvScope = () => (view === "browse" ? BROWSE.loc : null);
const mvFromDeck = () => { const loc = mvScope(); return loc != null && (isDeckLoc(loc) || swapsBase(loc) != null); };
function mvCopies(names) {
  if (!ownColl() || mvFromDeck()) return [];
  const loc = mvScope(), ks = new Set(names.map(norm));
  return COLL.entries.filter(e => e.qty > 0 && ks.has(norm(e.name)) && (loc != null ? e.loc === loc : !e.inDeck && swapsBase(e.loc) == null));
}
// Where they can go: the put-away list, then every box and binder that isn't a deck (engine putAwayPlaces). One
// that every copy is already in isn't offered.
function mvPlaces(copies) {
  const at = new Set(copies.map(e => e.loc));
  return [{ loc: PUT_AWAY, pile: true }, ...putAwayPlaces()].filter(p => !(at.size === 1 && at.has(p.loc)));
}
function mvPageHTML(a) {
  const w = BSEL_MV, n = pendQty(a.mv), loc = mvScope(), one = a.names.length === 1 ? a.names[0] : null, from = new Set(a.mv.map(e => e.loc)).size;
  const pick = (attr, on, icon, title, sub) => `<button class="menu-item pick-row" ${attr} aria-pressed="${on}">${icon}<span class="mi-text"><strong>${title}</strong><small>${sub}</small></span></button>`;
  return `<h2 id="selmenu-title" tabindex="-1" autofocus>Move ${one ? esc(one) : cardsWord(n)}${one && n > 1 ? ` (${n} copies)` : ""} to…</h2>
    <p class="muted small">${loc != null ? `Out of <strong>${esc(locName(loc))}</strong>.` : `${n === 1 ? "The copy" : "Every copy"} that isn't in a deck${from > 1 ? `, from ${from} boxes and binders` : ""}.`} Bulk Tutor moves ${n === 1 ? "it" : "them"} now. A deck's box isn't offered: cards in one count as part of that deck.</p>
    <div class="menu-list" id="mv-places">${mvPlaces(a.mv).map(p => p.pile ? pick(`data-sel-do="mvto" data-to="${esc(p.loc)}"`, false, neutralIconHTML("pile"), `“${esc(PUT_AWAY)}”`, "Out of the box for now: choose a box later")
        : pick(`data-sel-do="mvto" data-to="${esc(p.loc)}"`, false, locIconHTML(p.loc, false), esc(locName(p.loc)), p.qty ? cardsWord(p.qty) : "Empty")).join("")}
      ${pick(`data-sel-do="mvfresh"`, w.fresh, neutralIconHTML("box"), "A new box or binder", "One that isn't in your collection yet")}</div>
    ${w.fresh ? `<div class="field"><label for="mv-name">Its name</label><input type="text" id="mv-name" value="${esc(w.name)}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>` : ""}
    <p class="small warn-text" id="mv-msg"${w.msg ? "" : " hidden"}>${esc(w.msg)}</p>
    <div class="sheet-pair"><button class="btn" data-sel-do="mvno">Back</button>${w.fresh ? `<button class="btn primary" data-sel-do="mvgo">${n === 1 ? "Move it there" : "Move them there"}</button>` : ""}</div>`;
}
// Move them: `to` is a location's name or PUT_AWAY; `alsoUndo` takes back a box made for this (collection.js makeBox).
function mvSelected(copies, to, alsoUndo = null) {
  const list = copies.filter(e => e.loc !== to).map(e => ({ ...e, from: e.loc, to }));
  if (!list.length || !ownColl()) return;
  const did = recDo(handChange(REC, list, { by: "hand", act: "moved" }).change), n = pendQty(did.made);
  if (!n) { if (alsoUndo) alsoUndo(); return; }
  const names = new Set(list.map(e => norm(e.name))), what = names.size === 1 ? `${n > 1 ? n + "× " : ""}${list[0].name.split(" // ")[0]}` : cardsWord(n);
  toast(`${what} moved to ${to === PUT_AWAY ? "your put-away list" : locName(to)}`, "Undo", () => { if (alsoUndo) alsoUndo(); recUndo(did.change.id); }, 10000);
}
document.addEventListener("input", e => { if (e.target.id === "mv-name" && BSEL_MV) BSEL_MV.name = e.target.value; });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "mv-name") { e.preventDefault(); const go = $('#selmenu [data-sel-do="mvgo"]'); if (go) go.click(); } });
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
  if (BSEL_MV && a.mv.length) { body.innerHTML = mvPageHTML(a); return; }
  BSEL_MV = null;
  const item = (act, label, list) => list.length ? `<button class="menu-item" data-sel-do="${act}"><span class="mi-text"><span>${label}</span><small>${cardsWord(list.length)}</small></span></button>` : "";
  const levels = new Set(a.taste.map(n => tasteOf(n))), same = levels.size === 1 ? [...levels][0] : null;
  const adds = b ? item("add", `Add to ${esc(b.name)}`, a.add) + item("addside", `Add to the sideboard of ${esc(b.name)}`, a.addside) : "";
  body.innerHTML = `<h2 id="selmenu-title" tabindex="-1" autofocus>${cardsWord(a.names.length)} selected</h2>
    ${adds ? `<div class="menu-list">${adds}</div>` : `<p class="muted small">${b ? `Every one of them is already in ${esc(b.name)}.` : curBuild() && DECK_SEEN === curBuild().id ? "The open deck is marked as built, so cards aren't added to it from here." : "Open a deck to add these cards to it."}</p>`}
    ${mvFromDeck() && ownColl() ? `<p class="small" id="bsel-fromdeck">These are in the box of your deck <strong>${esc(deckName(BROWSE.loc))}</strong>. Cards leave a deck through its list: take them out there, and Assemble lists them to put away. <button class="btn link" data-sel-do="opendeck">Open the deck</button></p>` : ""}
    ${a.taste.length ? `<div class="taste"><p class="small"><strong>Your taste</strong> <span class="muted">for ${a.taste.length === 1 ? "this card" : `these ${cardsWord(a.taste.length)}`}, everywhere</span></p>
      <div class="seg seg-fill" role="group" aria-label="Your taste for the selected cards">${TASTE.map(([v, label]) => `<button data-sel-do="taste" data-lv="${v}" aria-pressed="${same === v}">${label}</button>`).join("")}</div></div>` : ""}
    ${a.mv.length ? `<div class="menu-list"><button class="menu-item" data-sel-do="mvask"><span class="mi-text"><span>Move to another box or binder…</span><small>${cardsWord(pendQty(a.mv))}${mvScope() != null ? ` in ${esc(locName(mvScope()))}` : " · the copies that aren't in a deck"}</small></span></button></div>` : ""}
    ${a.rm.length ? `<div class="menu-list"><button class="menu-item danger" data-sel-do="rmask"><span class="mi-text"><span>Remove from your collection</span><small>${cardsWord(rmSelectedCount(a.rm))}${rmScope() != null ? ` in ${esc(locName(rmScope()))}` : ""} · sold, traded or lost</small></span></button></div>` : ""}
    <div class="sheet-pair"><button class="btn" data-sel-close>Close</button></div>`;
}
function bselDo(act, arg) {
  if (act === "opendeck") { const loc = BROWSE.loc; BSEL = null; openBoxDeck(loc); return; }
  if (!BSEL) return;
  const a = bselActions();
  if (act === "rmask" || act === "rmno") { BSEL_RM = act === "rmask"; BSEL_MV = null; renderSelMenu(); const h = $("#selmenu-title"); if (h) h.focus(); return; }
  BSEL_RM = false;
  if (act === "mvask" || act === "mvno") { BSEL_MV = act === "mvask" ? { fresh: false, name: "", msg: "" } : null; renderSelMenu(); const h = $("#selmenu-title"); if (h) h.focus(); return; }
  if (act === "mvfresh" && BSEL_MV) { BSEL_MV.fresh = !BSEL_MV.fresh; BSEL_MV.msg = ""; renderSelMenu(); const f = $("#mv-name"); if (f) f.focus(); return; }
  if (act === "mvgo" && BSEL_MV) {   // a new box by name: the sheet stays open while the name has a problem
    const r = newPlace(BSEL_MV.name.trim());
    if (r.problem) { BSEL_MV.msg = r.problem; renderSelMenu(); const f = $("#mv-name"); if (f) f.focus(); return; }
    BSEL_MV = null; closeSelMenu(); BSEL.clear();
    mvSelected(a.mv, r.loc, r.fresh ? makeBox(r) : null);
    return;
  }
  if (act === "mvto") { BSEL_MV = null; if (a.mv.length && arg) { BSEL.clear(); mvSelected(a.mv, arg); } return; }
  BSEL_MV = null;
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
  if (t.dataset.bselActions != null) { BSEL_RM = false; BSEL_MV = null; openSelMenu("browse"); return; }
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
// and its row then counts and prices only those copies (c.fit).
const RARITY_NAMES = { c: "Common", u: "Uncommon", r: "Rare", m: "Mythic", s: "Special", b: "Bonus" };
const copyFiltersOffered = () => !!COLL && COLL.entries.some(e => e.set || e.rar || e.foil);
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
  const terms = norm(BROWSE.q).split(/\s+/).filter(Boolean);
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
  const loc = BROWSE.loc, holds = loc != null && isDeckLoc(loc);   // a deck's box: it says which deck, and opens it
  const all = browseCards(), list = filteredBrowse();
  const pageSize = imageView() ? 60 : 150;
  if (!BROWSE.shown) BROWSE.shown = pageSize;
  const shown = list.slice(0, BROWSE.shown);
  const totalQty = all.reduce((n, c) => n + c.qty, 0);
  // A location's cards, or the whole collection's, are worth what those copies are.
  const at = browseScope(), counted = new Set();
  const value = all.reduce((n, c) => { const k = norm(c.name); if (counted.has(k)) return n; counted.add(k); return n + ownValue(c.name, at).sum; }, 0);
  if (formatsOffered()) loadLegal();
  const status = c => null;   // (a saved decklist's cards said where your copy is, until 0.95.0)
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
  const results = show === "table" ? browseTableHTML(groups, { loc })
    : show === "list"
    ? groups.map(g => { const html = `${g.title ? `<div class="loc-head">${pick ? grpTickHTML(g.title) : ""}<h3>${esc(g.title)}</h3><span class="muted small num">${g.items.reduce((n, c) => n + c.qty, 0)}</span></div>` : ""}<div class="results">${g.items.map(listRow).join("")}</div>`;
        return pick ? `<section class="bgroup">${html}</section>` : html; }).join("")
    : cardGroupsHTML(groups.map(g => ({ title: g.title, tick: pick && !!g.title, items: g.items.map(c => ({ ...(status(c) || { name: c.name, qty: c.qty, sub: loc == null ? esc(locName([...c.locs][0]) + (c.locs.size > 1 ? ` +${c.locs.size - 1}` : "")) : "", mv: (cardOf(c.name) || [])[4] }), ...(pick ? { pick: "browse" } : {}) })) })), "browse");
  const locIc = loc != null ? `<button class="loc-ic-btn" data-loc-style="${esc(loc)}" aria-label="Options for ${esc(locName(loc))}">${locIconHTML(loc, holds)}</button>` : "";
  const box = loc == null ? "" : locName(loc), title = loc == null ? "All cards" : box;
  const headHTML = `<div class="actions"><button class="btn" data-go="collection">${MARK.back} Collection</button>${loc != null ? `<button class="btn" id="box-menu" data-loc-style="${esc(loc)}" aria-haspopup="dialog">Actions</button>` : ""}${canAddTo(loc) ? `<button class="btn" id="box-add" data-add-cards="${esc(loc)}" aria-haspopup="dialog">Add cards</button>` : ""}</div>
      <div class="section-head"><h2 class="title-ic">${locIc}<span>${esc(title)}</span></h2></div>
      <p class="muted small">${cardsWord(totalQty)} · ${all.length.toLocaleString()} unique${DATA ? " · " + money(value) : ""}</p>
      ${loc != null ? locNoteHTML(loc, "box-note") : ""}
      ${loc != null && box !== loc ? `<p class="muted small" id="box-was">${esc(COLL && COLL.source && !COLL.example ? COLL.source : "Your import")} calls it ${esc(loc)}.</p>` : ""}
      ${holds ? `<p class="small" id="box-holds">${boxHoldsWords(loc)} <button class="btn link" data-box-deck="${esc(loc)}">Open the deck</button></p>` : ""}`;
  // The control row and the line under it (0.103.0): the line always says how many cards show, as the count did.
  const sheetOn = sheetFiltersOn(), on = quickOn(BROWSE.quick) || !!BROWSE.q.trim() || sheetOn.length > 0;
  const controls = listControlsHTML("browse", { all, f: BROWSE.quick, without: skip => filteredBrowse(skip), n: quickCount(BROWSE.quick) + sheetOn.length, more: moreFiltersBtnHTML(sheetOn), extra: moreFiltersHTML(sheetOn) });
  const countHTML = summaryLineHTML("browse", "browse-count", `${list.length === all.length ? cardsWord(list.length) : `${list.length.toLocaleString()} of ${all.length.toLocaleString()} cards match`}${loc == null ? " · everywhere" : ""}`, on);
  el.innerHTML = `<div class="filters">
    ${headHTML}
    <div id="browse-out"></div>
    <div class="search-field">${SEARCH_ICON}<input type="search" id="bsq" value="${esc(BROWSE.q)}" aria-label="Search ${loc == null ? "your cards" : "these cards"}" placeholder="Name, type, creature type, keyword or artist" autocomplete="off"></div>
    ${controls}
    ${countHTML}
    ${list.length || pick ? bselLineHTML(list.length) : ""}
    <div class="panel">${list.length ? results : !all.length && loc != null ? `<p class="muted" id="box-empty">Nothing is in ${esc(box)} yet. Cards go in from another box (select them there, then Actions and “Move”) or from “${esc(PUT_AWAY)}”, or a filing rule sends them.${canAddTo(loc) ? " “Add cards” above puts cards in by name." : ""}</p>` : `<p class="muted">No cards match these filters.</p>`}
      ${list.length > shown.length ? `<div class="actions center"><button class="btn" id="browse-more">Show more (${(list.length - shown.length).toLocaleString()} left)</button></div>` : ""}</div>
    ${loc != null ? tokensHostHTML("box") : ""}
  </div>`;
  if (pick) { el.firstElementChild.insertAdjacentHTML("beforeend", `<div class="selbar" id="bselbar" role="region" aria-label="Selected cards"></div>`); bselPaint(); }
  if (SELMENU_OPEN === "browse") renderSelMenu();
  if (imageView()) paintImgs();
  const f = $("#filters"); if (f && f.open) renderFilters();
}

// ------------------------------------------------------------ quick filters (0.32.0; engine quickMatch)
// Chips for type, mana value (with Or less / Exactly / Or more) and colour, on every list of cards. They fold into one
// line saying what's on, folded when the page opens (0.102.0; Matt, Nov 19: "should start collapsed"; it was remembered
// as bt.qopen), and taking a view that uses them folds them away, so a filtered list gets the screen. `scope` names
// whose filter a chip changes ("browse"); quickState/quickRender map it.
let QOPEN = false;
store.del("bt.qopen");
// Builds keep their quick filters per build for the visit (BUILD_QUICK), so switching builds starts clear.
const BUILD_QUICK = new Map();
const buildQuick = b => { if (!b) return quickBlank(); if (!BUILD_QUICK.has(b.id)) BUILD_QUICK.set(b.id, quickBlank()); return BUILD_QUICK.get(b.id); };
const quickState = scope => scope === "build" ? buildQuick(curBuild()) : BROWSE.quick;
const quickRender = scope => { if (scope === "build") renderBuild(); else { BROWSE.shown = 0; renderBrowse(); } };
const setQOpen = open => { QOPEN = open; };
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
// all: every card [{name, qty}]; without(skip): the cards passing every filter but that part (for its chips' counts).
function quickChipsHTML(scope, all, f, without) {
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
  return `<div class="qchips types" role="group" aria-label="Card type">${types}</div>
      <div class="qchips eq" role="group" aria-label="Mana value" style="--n:${QUICK_MV_TOP + 1}">${mvs}</div>${mode}
      ${cols.length ? `<div class="qchips eq qcolors" role="group" aria-label="Color" style="--n:${Math.max(cols.length, 4)}">${colors}</div>${by}` : ""}`;
}
// How many of the quick row's three parts are on (type, mana value, color), for the Filter button's count.
const quickCount = f => (f.types.length ? 1 : 0) + (f.mv != null ? 1 : 0) + (f.colors.length ? 1 : 0);
// "Name", or "Color +2" for a sort by three things: what the Sort button says.
const sortKeyText = spec => capFirst(sortShort(spec));

// ---- The control row (0.103.0; step 6, piece 2; Matt, Nov 19, 12:57: "Agreed, A"; 12:09: "reuse the UI appearance
// and controls wherever applicable"). A deck's list and a box's cards have one row, always there: **Filter**, which
// opens in place under it as one outline (the views: the Views sheet, the views pinned here and "Save these"; the
// quick chips; on a box, "More filters", the #filters sheet, with a chip for each of its filters that is on), **Sort**,
// saying its first key (Group by is at the top of its sheet: sorting.js), and **Show as** as icons. Under it the screen
// draws a line saying how many cards show and what is on, with Clear (summaryLineHTML). Filter stays open or folded
// for the visit (QOPEN), folded at first (0.102.0). Until 0.103.0 the quick row was a fold of its own ("Type, mana
// value and color"), with Views, Group by, Sort by and Show as each a control of its own around it.
// n: how many filters are on (the button's count, open or folded: the outline grows outward, so nothing moves); extra: what the fold holds after the quick chips; table: whether Table is offered.
// The fold's first row (0.105.3; Matt, Nov 19: "I did mean for Saved views and More filters to share a row at the
// top"): Saved views, and on a box More filters (`more`), in equal columns; under it the views pinned here and "Save
// these" when there are any, the quick chips, then `extra` (on a box, a chip for each of More filters' that is on).
function listControlsHTML(scope, { all, f, without, n = quickCount(f), more = "", extra = "", table = true }) {
  const spec = sortOf(scope);
  const save = viewCanSave(scope) ? `<button class="fchip" data-views-open="${scope}" data-views-save>Save these</button>` : "";
  const pins = viewChipsHTML(scope) + save;
  return `<div class="lctl${QOPEN ? " open" : ""}">
    <div class="lctl-row">
      <button class="btn lctl-btn lctl-filter${n ? " has-on" : ""}" id="${scope}-filter" data-qtoggle aria-expanded="${QOPEN}" aria-controls="qbody-${scope}">${icon("i-filter")}<span>Filter</span>${n ? `<span class="lctl-n num" aria-label="(${n} on)">${n}</span>` : ""}</button>
      <button class="btn lctl-btn lctl-sort" id="${scope}-sort" data-sort-open="${scope}" aria-haspopup="dialog" aria-label="Group and sort. Sorted by ${esc(sortText(spec).toLowerCase())}">${icon("i-sort")}<span class="lctl-val">${esc(sortKeyText(spec))}</span></button>
      ${viewToggleHTML(table)}
    </div>
    <div class="qbody" id="qbody-${scope}"${QOPEN ? "" : " hidden"}>
      <div class="qtop" role="group" aria-label="Saved views${more ? " and more filters" : ""}">${viewsChipHTML(scope)}${more}</div>
      ${pins ? `<div class="chip-row qviews" role="group" aria-label="Views">${pins}</div>` : ""}
      ${quickChipsHTML(scope, all, f, without)}
      ${extra}
    </div>
  </div>`;
}
// The line under the row: "24 of 120 · Creature · Clear". shown/total: the counts in words or numbers; on: whether
// anything is filtered (the line then names it and offers Clear).
function summaryLineHTML(scope, id, counts, on) {
  const what = on ? viewFilterText(viewNow(scope).f) : "", v = viewOn(scope);
  return `<p class="muted small lsum" id="${id}">${v ? `<strong class="lsum-view">${icon("i-bookmark")}${esc(v.name)}</strong> · ` : ""}<span class="lsum-n">${counts}</span>${what ? ` · ${esc(what)}` : ""}${on ? ` · <button class="btn link small" data-qclear="${scope}">Clear</button>` : ""}</p>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-q], [data-qtoggle], [data-qclear]");
  if (!t) return;
  const d = t.dataset;
  if (d.qtoggle != null) { setQOpen(!QOPEN); rerenderCurrent(); return; }
  const f = quickState(d.q || d.qclear);
  const flip = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  // Clear under the control row clears everything its line names (0.103.0): on a box, the search and More filters' too.
  if (d.qclear) { Object.assign(f, quickBlank()); delete f.by; if (d.qclear === "browse") { BROWSE.q = ""; clearSheetFilters(); } }
  else if (d.qtype) f.types = flip(f.types, d.qtype);
  else if (d.qmv != null) { const v = +d.qmv; f.mv = f.mv === v ? null : v; if (f.mv == null) f.mode = "le"; }
  else if (d.qmode) f.mode = d.qmode;
  else if (d.qcolor) { f.colors = flip(f.colors, d.qcolor); if (!f.colors.length) delete f.by; }
  else if (d.qby != null) { if (d.qby === "id") f.by = "id"; else delete f.by; }
  quickRender(d.q || d.qclear);
});

// ------------------------------------------------------------ table view (0.32.0)
// One line per card. Headers sort (Card, Cost and Type; Price high to low). Phones show the card, its cost, its type
// (unless grouped by type) and either the price or where it is; wider screens add mana value, role and price.
function whereHTML(st, name) {
  if (st.kind === "free" || st.kind === "indeck") return `<span class="where${st.kind === "indeck" ? " warn" : ""}">${locIconHTML(st.loc, st.kind === "indeck", null, "sm")}<span>${esc(stName(st))}</span></span>`;
  if (st.kind === "here") return "in this deck";
  if (st.kind === "basic") return "basic land";
  const r = name && cardOf(name);
  if (collEmpty()) return r && r[3] ? money(r[3]) : "";   // nothing says it's missing (builds.js, collEmpty)
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
function browseTableHTML(groups, { loc }) {
  const where = loc == null;
  const cols = [
    { label: "Card", cls: "c-name", sort: "name", cell: c => { const name = nameCell(c.name, c.qty, `data-sheet="browse" data-card="${esc(c.name)}"`); return BSEL ? `<span class="pick-cell">${tickHTML()}${name}</span>` : name; } },
    { label: "Cost", cls: "c-cost", sort: "mv", cell: c => costCell(c.name) },
    { label: "MV", cls: "c-mv c-wide", cell: c => mvCell(c.name) },
    BROWSE.group !== "type" && !where && { label: "Type", cls: "c-type", sort: "type", cell: c => TYPE_SINGULAR[typeOf(c.name)] || "" },
    where && { label: "Where", cls: "c-where", cell: c => esc([...c.locs].map(locName).join(", ")) },
    hasRoles() && { label: "Role", cls: "c-role c-wide", cell: c => esc(primaryRole(c.name) || "") },
    { label: "Price", cls: "c-price", sort: "price", cell: c => rowPriceText(c) },
  ].filter(Boolean);
  return cardTableHTML(groups.map(g => ({ ...g, tick: !!BSEL && !!g.title })), cols, c => `data-trow="${esc(c.name)}"` + (BSEL ? ` data-pick="browse" data-card="${esc(c.name)}" aria-selected="false"` : ""), BROWSE.sort);
}
// A deck's list (0.33.0; the control row since 0.103.0): the same quick filters over its cards, and a table with Where
// (a location's icon and name, another deck in warning colour, or "missing · $price"); a row opens the card with its
// swaps. The line under the row shows only while something is filtered or a view is on.
function buildControlsHTML(b) {
  const f = buildQuick(b), all = b.cards.map(c => ({ name: c.name, qty: c.qty }));
  const without = skip => all.filter(c => quickMatch(c.name, f, skip));
  const n = without().reduce((t, c) => t + c.qty, 0), total = all.reduce((t, c) => t + c.qty, 0), on = quickOn(f);
  return `${listControlsHTML("build", { all, f, without })}${on || viewOn("build") ? summaryLineHTML("build", "build-qcount", on ? `${n} of ${total}` : cardsWord(total), on) : ""}`;
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
function formatChipText() {
  const names = [...BROWSE.formats].map(f => FORMAT_NAMES[f] || f);
  return `${BROWSE.fmtMode === "banned" ? "Banned in" : "Legal in"} ${names.join(BROWSE.fmtMode === "banned" ? " or " : " and ")}`;
}
// What the Filter fold holds on a box, after the quick chips (0.103.0): a chip for each of the sheet's filters that is
// on (a tap takes it off), then "More filters", the sheet. Until 0.103.0 these sat under the search with Sort and Views.
function sheetFiltersOn() {
  const on = [];
  if (BROWSE.formats.size) on.push(["fmt", formatChipText()]);
  if (BROWSE.role) on.push(["role", BROWSE.role]);
  if (BROWSE.colors.size) on.push(["colors", `Within ${COLORS.filter(c => BROWSE.colors.has(c)).map(c => COLOR_NAMES[c]).join(", ")}`]);
  if (copyFiltersOffered()) {
    if (BROWSE.set) on.push(["set", setName(BROWSE.set)]);
    if (BROWSE.rar) on.push(["rar", RARITY_NAMES[BROWSE.rar] || BROWSE.rar]);
    if (BROWSE.foil) on.push(["foil", BROWSE.foil === "foil" ? "Foil" : "Not foil"]);
  }
  return on;
}
// The More filters button, at the top of the fold beside Saved views since 0.105.3, and the row of what is on (at its end).
const moreFiltersBtnHTML = (on = sheetFiltersOn()) => `<button class="fchip" data-filters-open aria-haspopup="dialog"><span>More filters${on.length ? ` · ${on.length}` : ""}</span></button>`;
function moreFiltersHTML(on = sheetFiltersOn()) {
  return on.length ? `<div class="chip-row qmore" role="group" aria-label="More filters on">${on.map(([k, text]) => `<button class="fchip on" data-fclear="${k}" aria-label="Remove filter: ${esc(text)}"><span>${esc(text)}</span><span class="fchip-x" aria-hidden="true">${MARK.remove}</span></button>`).join("")}</div>` : "";
}
const clearSheetFilters = () => { BROWSE.formats.clear(); BROWSE.role = ""; BROWSE.colors.clear(); BROWSE.set = ""; BROWSE.rar = ""; BROWSE.foil = ""; };
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
  const n = filteredBrowse().length, fmts = formatsOffered() ? fmtList() : [];
  const seg = (attr, choices, cur, label) => `<div class="seg seg-fill" role="group" aria-label="${label}">${choices.map(([v, name]) => `<button data-${attr}="${v}" aria-pressed="${cur === v}">${name}</button>`).join("")}</div>`;
  body.innerHTML = `<div class="sheet-bar"><h2 id="filters-title" tabindex="-1" autofocus>More filters</h2><button class="icon sheet-x" data-filters-close aria-label="Close">${MARK.remove}</button></div>
    ${fmts.length ? `<section class="fgroup"><h3 class="flabel">Format</h3>
      ${seg("fmt-mode", [["legal", "Legal in"], ["banned", "Banned in"]], BROWSE.fmtMode, "Legal or banned")}
      <div class="opt-grid">${fmts.map(f => `<button class="opt" data-fmt="${f}" aria-pressed="${BROWSE.formats.has(f)}">${FORMAT_NAMES[f] || f}</button>`).join("")}</div>
      <p class="muted small">${BROWSE.fmtMode === "banned" ? "Cards banned in any format you pick." : "Cards legal in every format you pick."}${legalState === "loading" ? " Loading formats…" : ""}</p></section>` : ""}
    ${hasRoles() ? `<section class="fgroup"><label class="flabel" for="bs-role">Role</label><select id="bs-role" class="fselect"><option value="">Any role</option>${ROLE_COUNTED.map(r => `<option${BROWSE.role === r ? " selected" : ""}>${r}</option>`).join("")}</select></section>` : ""}
    <section class="fgroup"><h3 class="flabel">Within colors</h3>
      <div class="opt-grid five">${COLORS.map(c => `<button class="opt pip-opt" aria-pressed="${BROWSE.colors.has(c)}" data-bscolor="${c}" aria-label="${COLOR_NAMES[c]}">${pip(c)}</button>`).join("")}</div></section>
    ${copyFiltersOffered() ? copyFiltersHTML(seg) : ""}
    <div class="sheet-pair fsheet-foot"><button class="btn" data-fclear="all">Clear filters</button><button class="btn primary" data-filters-close>Show ${cardsWord(n)}</button></div>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-filters-open], [data-filters-close], [data-fclear], [data-fmt], [data-fmt-mode], [data-bfoil]");
  if (!t) { if (e.target.id === "filters") closeFilters(); return; }
  const d = t.dataset;
  if (d.filtersOpen != null) { openFilters(d.filtersOpen); return; }
  if (d.filtersClose != null) { closeFilters(); return; }
  if (d.fclear) {
    const k = d.fclear;
    if (k === "all") clearSheetFilters();
    if (k === "fmt") BROWSE.formats.clear();
    if (k === "role") BROWSE.role = "";
    if (k === "colors") BROWSE.colors.clear();
    if (k === "set") BROWSE.set = "";
    if (k === "rar") BROWSE.rar = "";
    if (k === "foil") BROWSE.foil = "";
  }
  else if (d.fmt) BROWSE.formats.has(d.fmt) ? BROWSE.formats.delete(d.fmt) : BROWSE.formats.add(d.fmt);
  else if (d.fmtMode) BROWSE.fmtMode = d.fmtMode;
  else if (d.bfoil != null) BROWSE.foil = d.bfoil;
  BROWSE.shown = 0; renderBrowse();
});

document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-browse], [data-bscolor], #browse-more");
  if (!t) return;
  if (t.dataset.browse != null) { openBrowse(t.dataset.browse || null); return; }
  if (t.dataset.bscolor) { const c = t.dataset.bscolor; BROWSE.colors.has(c) ? BROWSE.colors.delete(c) : BROWSE.colors.add(c); BROWSE.shown = 0; renderBrowse(); return; }
  if (t.id === "browse-more") { BROWSE.shown += imageView() ? 120 : 300; renderBrowse(); }
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

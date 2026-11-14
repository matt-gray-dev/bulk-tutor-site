"use strict";
// Bulk Tutor, the page's script, part "buildsheets": the Your builds and Actions sheets, the sample hand, the buying panel, a build's history.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ build sheets: Your builds, and Actions
// Both are bottom sheets on phones. Their contents are drawn only while open, so the action ids exist once.
const openDlg = dlg => { if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", ""); };
const closeDlg = dlg => { if (dlg && dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } };
function openBuildPicker() {
  const dlg = $("#builds"), body = $("#builds-body"); if (!dlg || !body) return;
  const row = x => {
    const n = deckCards(x).reduce((t, c) => t + c.qty, 0), home = buildHome(x);
    const meta = [cardsWord(n) + (sideQty(x) ? ` + ${sideQty(x)} sideboard` : ""), x.commanders.length && x.commanders.join(" + ") !== x.name ? x.commanders.join(" + ") : "", x.built ? `built ${shortDate(Date.parse(x.built))}` : "", home && !x.built ? `${buildForDeck(home) === x ? "in" : "from"} ${locName(home)}` : ""].filter(Boolean);
    const cur = x.id === CUR && buildMode !== "new";
    return `<button class="menu-item pick-row" data-pick="${esc(x.id)}"${cur ? ` aria-current="true"` : ""}><span class="mi-text"><strong>${esc(x.name)}</strong><small>${esc(meta.join(" · "))}</small></span>${cur ? `<span class="mi-check" aria-hidden="true">${MARK.selected}</span>` : ""}</button>`;
  };
  const sets = [["From your decks", BUILDS.filter(x => buildHome(x) && !x.built)], ["New builds", BUILDS.filter(x => !buildHome(x) && !x.built)], ["Built", BUILDS.filter(x => x.built)]].filter(g => g[1].length);
  body.innerHTML = `<h2 id="builds-title" tabindex="-1" autofocus>Your builds</h2>
    <button class="btn primary" id="build-new">New build</button>
    ${sets.length > 1 ? sets.map(([label, xs]) => `<div class="menu-group"><h4 class="subhead">${label}</h4><div class="menu-list">${xs.map(row).join("")}</div></div>`).join("")
      : `<div class="menu-list">${BUILDS.map(row).join("")}</div>`}
    <div class="sheet-pair"><button class="btn" data-sheet-close>Close</button></div>`;
  openDlg(dlg);
}
let BUILDMENU_OPEN = false;
// A list's note (builds.js): typed in a build's Actions or a deck's, kept when the field is left and when the sheet
// closes. The sheet it was typed in isn't redrawn for it: a tap on one of its buttons is what ended the typing, and
// must still land.
const NOTE_HINT = "How it plays, what it still needs…";
function noteRedraw() {
  const open = BUILDMENU_OPEN; BUILDMENU_OPEN = false; DECKMENU_KEEP = true;
  try { if (view === "build") renderBuild(); else if (view === "browse") renderBrowse(); } finally { BUILDMENU_OPEN = open; DECKMENU_KEEP = false; }
}
document.addEventListener("input", e => {
  const id = e.target.id; if (id !== "build-note" && id !== "deck-note") return;
  const of = id === "build-note" ? { build: CUR } : BROWSE.saved ? { saved: BROWSE.saved } : { loc: BROWSE.loc };
  NOTE_TYPING = { field: id, of: NOTE_TYPING && NOTE_TYPING.field === id ? NOTE_TYPING.of : of, text: e.target.value };
});
document.addEventListener("change", e => { if (e.target.id === "build-note" || e.target.id === "deck-note") keepTypedNote(e.target.id); });
document.addEventListener("close", e => { if (e.target.id === "buildmenu") keepTypedNote("build-note"); else if (e.target.id === "deckmenu") keepTypedNote("deck-note"); }, true);
document.addEventListener("close", e => { if (e.target.id === "buildmenu") { BUILDMENU_OPEN = false; const body = $("#buildmenu-body"); if (body) body.innerHTML = ""; } }, true);
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "build-name") e.target.blur(); });
function openBuildMenu() { BUILDMENU_OPEN = true; renderBuildMenu(); openDlg($("#buildmenu")); }
function closeBuildMenu() { BUILDMENU_OPEN = false; closeDlg($("#buildmenu")); const body = $("#buildmenu-body"); if (body) body.innerHTML = ""; }
function renderBuildMenu() {
  const body = $("#buildmenu-body"), b = curBuild(); if (!body) return;
  if (!b) { closeBuildMenu(); return; }
  const sd = savedFor(b), miss = buildPullGroups(b).find(g => g.kind === "missing");
  const item = (id, label, sub = "", cls = "") => `<button class="menu-item${cls}" id="${id}"><span class="mi-text"><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</span></button>`;
  body.innerHTML = `<h2 id="buildmenu-title" tabindex="-1" autofocus>${esc(b.name)}</h2>
    <div class="field"><label for="build-name">Name</label><input type="text" id="build-name" value="${esc(b.name)}" enterkeyhint="done"></div>
    ${noteField("build-note", b, NOTE_HINT)}
    <div class="menu-group"><h4 class="subhead">Share and export</h4><div class="menu-list">
      ${item("build-share", "Share link", "A link that opens this build on another device")}
      ${item("build-copy-list", "Copy decklist", "For Moxfield or Archidekt")}
      ${hasPrintsOwned() ? item("build-copy-manabox", "Copy for ManaBox", "With the printing of each copy you own, so it takes the same cards") : ""}
      ${item("build-copy-pull", "Copy list by location", "Each card's box or binder, to gather it")}
      ${item("build-dl-pull", "Download list by location (CSV)")}
      ${miss ? item("build-copy-missing", "Copy buying list", `${cardsWord(groupQty(miss))} you don't own, for TCGplayer or Card Kingdom`) : ""}
    </div><div id="build-copy-out"></div></div>
    ${b.commanders.length && DATA && hasThemes() ? `<div class="menu-group"><h4 class="subhead">Change it</h4><div class="menu-list">
      ${item("build-overhaul", "Overhaul", "Keep most of the cards and lean into another theme, tribe or commander")}
    </div></div>` : ""}
    <div class="menu-group"><h4 class="subhead">Keep</h4><div class="menu-list">
      ${b.built ? "" : item("build-built", "Mark as built", "When the deck is together")}
      ${sd ? item("build-save-update", "Update saved deck", `Copy your changes to “${esc(sd.name)}”`) + item("build-save-new", "Save as new deck")
        : item("build-save-new", "Save as deck", "Keep this list in your decks, built or not")}
      ${item("build-template", "Use as template", "Shape new builds like this one")}
    </div></div>
    <div id="build-del-zone">${item("build-del", "Delete this build", "", " danger")}</div>
    <div class="sheet-pair"><button class="btn" data-sheet-close>Close</button></div>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("#build-switch, #build-menu, #builds button, #buildmenu button");
  if (!t) { if (e.target.id === "builds") closeDlg($("#builds")); else if (e.target.id === "buildmenu") closeBuildMenu(); return; }
  if (t.id === "build-switch") { openBuildPicker(); return; }
  if (t.id === "build-menu") { openBuildMenu(); return; }
  if (t.closest("#builds")) {
    closeDlg($("#builds"));
    if (t.id === "build-new") { buildMode = "new"; renderBuild(); window.scrollTo({ top: 0 }); }
    else if (t.dataset.pick) { CUR = t.dataset.pick; buildMode = "list"; buildQuery = ""; buildRole = null; saveBuilds(); renderBuild(); window.scrollTo({ top: 0 }); }
    return;
  }
  if (t.dataset.sheetClose != null) { closeBuildMenu(); return; }
  buildAction(t);
});

// ------------------------------------------------------------ actions for several selected cards (0.58.0)
// The sheet the selection bar opens: each action a card has on its own, with how many of the selected cards it applies
// to; one that applies to none isn't listed. builds.js: selActions, selDo.
let SELMENU_OPEN = false;   // false | "build" | "browse" (the Collection browser's selection: browse.js draws its own items)
function openSelMenu(from = "build") { if (!(from === "browse" ? bselCount() : selCount())) return; SELMENU_OPEN = from; renderSelMenu(); openDlg($("#selmenu")); }
function closeSelMenu() { SELMENU_OPEN = false; closeDlg($("#selmenu")); const body = $("#selmenu-body"); if (body) body.innerHTML = ""; }
function renderSelMenu() {
  const body = $("#selmenu-body"), b = curBuild(); if (!body) return;
  if (SELMENU_OPEN === "browse") { renderBselMenu(body); return; }
  if (!selOn(b) || !selCount()) { closeSelMenu(); return; }
  const a = selActions(b), n = a.deck.length + a.side.length;
  const item = (act, label, sub = "", cls = "") => a[act].length ? `<button class="menu-item${cls}" data-sel-do="${act}"><span class="mi-text"><span>${label}</span><small>${cardsWord(a[act].length)}${sub ? ` · ${sub}` : ""}</small></span></button>` : "";
  const levels = new Set(a.taste.map(c => tasteOf(c.name))), same = levels.size === 1 ? [...levels][0] : null;
  body.innerHTML = `<h2 id="selmenu-title" tabindex="-1" autofocus>${cardsWord(n)} selected</h2>
    <div class="menu-list">
      ${item("toside", "Move to sideboard", "kept with the deck, outside the 100")}
      ${item("todeck", "Move to deck")}
      ${item("keep", "Keep", "tuning and regenerating won't take them out")}
      ${item("unkeep", "Stop keeping")}
      ${item("dismiss", "Not for this build", "each makes way for a card that does the same job")}
      ${item("rm", "Remove from build", "", " danger")}
      ${item("siderm", "Remove from sideboard", "", " danger")}
    </div>
    ${a.taste.length ? `<div class="taste"><p class="small"><strong>Your taste</strong> <span class="muted">for ${a.taste.length === 1 ? "this card" : `these ${cardsWord(a.taste.length)}`}, everywhere</span></p>
      <div class="seg seg-fill" role="group" aria-label="Your taste for the selected cards">${TASTE.map(([v, label]) => `<button data-sel-do="taste" data-lv="${v}" aria-pressed="${same === v}">${label}</button>`).join("")}</div></div>` : ""}
    <div class="sheet-pair"><button class="btn" data-sel-close>Close</button></div>`;
}
document.addEventListener("close", e => { if (e.target.id === "selmenu") { SELMENU_OPEN = false; const body = $("#selmenu-body"); if (body) body.innerHTML = ""; } }, true);
document.addEventListener("click", e => {
  if (e.target.id === "selmenu") { closeSelMenu(); return; }   // a tap outside the sheet
  const t = e.target.closest && e.target.closest("#selmenu [data-sel-do], #selmenu [data-sel-close]"); if (!t) return;
  const act = t.dataset.selDo, lv = t.dataset.lv != null ? +t.dataset.lv : null, from = SELMENU_OPEN;
  if (from === "browse" && (act === "rmask" || act === "rmno")) { bselDo(act); return; }   // a question in the sheet itself (removing cards, browse.js): it stays open
  closeSelMenu();
  if (act) (from === "browse" ? bselDo : selDo)(act, lv);
});

// ------------------------------------------------------------ sample hand (engine: dealHand)
// Seven cards from the deck as it stands, to see how it opens. Draw, start over, or mulligan (London, with
// Commander's free first mulligan: from the second one, tap cards to put them on the bottom). Nothing is saved.
let HAND = null;
// The buying list (0.38.0) in Assemble's side column: what to buy, grouped by the person's price ranges, each group
// (or all of it) copied as "1 Sol Ring" lines for TCGplayer's Mass Entry, Card Kingdom's Deck Builder or ManaBox.
function buyPanelHTML(b) {
  const items = buyList(b, { inDecks: BUY_INDECKS }), bg = buyGroups(items, BUY.buckets);
  const canInDecks = BUY_INDECKS || buyList(b, { inDecks: true }).some(x => x.why === "indeck");
  const note = it => (it.why === "indeck" ? " <small class=\"muted\">another copy</small>" : it.why === "short" ? " <small class=\"muted\">more copies</small>" : "") + (it.side ? " <small class=\"muted\">sideboard</small>" : "");
  const row = it => `<li><span>${it.qty > 1 ? `<span class="num">${it.qty}</span> × ` : ""}${esc(it.name)}${note(it)}</span><span class="num">${it.price == null ? "—" : money(it.price * it.qty)}</span></li>`;
  const group = (g, key, range) => `<div class="buy-group" data-buy-group="${key}">
      <div class="buy-head"><h4>${esc(g.name)}${range ? ` <span class="muted small">· ${range}</span>` : ""}</h4><span class="num small">${g.total != null ? money(g.total) : ""}</span></div>
      <ul class="buy-items">${g.items.map(row).join("")}</ul>
      <button class="btn small" data-buy-copy="${key}" aria-label="Copy ${esc(g.name)}">Copy ${cardsWord(g.qty)}</button></div>`;
  const shown = bg.groups.map((g, i) => g.items.length ? group(g, i, rangeText(g)) : "").join("")
    + (bg.unpriced.length ? group({ name: "No price yet", items: bg.unpriced, qty: bg.unpriced.reduce((n, x) => n + x.qty, 0), total: null }, "unpriced", "") : "");
  return `<div class="panel buy-panel" id="buy-panel">
    <div class="section-head"><h3>Buying list</h3>${items.length ? `<span class="chip own num">${cardsWord(bg.qty)} · ${money(bg.total)}</span>` : ""}</div>
    ${items.length ? `${pricesOldHTML()}<p class="muted small">Each card at its cheapest printing, grouped by your price ranges. Copy a group or all of it, then paste into TCGplayer's Mass Entry, Card Kingdom's Deck Builder or ManaBox.</p>
      ${shown}
      <div class="buy-actions"><button class="btn" data-buy-copy="all">Copy all ${cardsWord(bg.qty)}</button><button class="btn link small" data-buy-edit>Edit price ranges</button></div>
      <div id="buy-copy-out"></div>` : `<p class="muted small">Nothing to buy: you have every card in this build.</p>`}
    ${canInDecks ? `<label class="check small"><input type="checkbox" id="buy-indecks"${BUY_INDECKS ? " checked" : ""}> Also cards that are only in your other decks, to buy another copy</label>` : ""}
  </div>`;
}

// Keep rates (0.37.0) above the sample hand: exact odds out of 100 opening sevens, then one hand to look at.
function keepRatesHTML(b) {
  const k = keepRates(b); if (!k) return "";
  const rows = k.rates.filter(r => hasRoles() || !["ramp", "start"].includes(r.id));
  const pct = p => Math.round(p * 100);
  return `<p class="muted small">Out of 100 opening sevens:</p>
    <div class="keep-rates">${rows.map(r => `<div class="keep-row${r.good ? "" : " bad"}" data-keep="${r.id}"><span>${esc(r.label)}</span><span class="keep-bar" aria-hidden="true"><span style="width:${pct(r.p)}%"></span></span><span class="num">${pct(r.p)}</span></div>`).join("")}</div>
    <p class="muted small">With the free mulligan, <strong class="num">${pct(k.freeMull)}</strong> in 100 find 2 to 4 lands. Exact odds from ${k.lands} land${k.lands === 1 ? "" : "s"}${hasRoles() ? ` and ${k.ramp} ramp card${k.ramp === 1 ? "" : "s"}` : ""} in ${k.cards} cards.</p>`;
}
function handPanelHTML(b) {
  const n = libraryOf(b).length;
  return `<div class="panel hand-panel"><h3>Opening hands</h3>
    ${keepRatesHTML(b)}
    <p class="muted small">Or deal seven cards from this deck to see how it opens.</p>
    <div class="actions"><button class="btn" data-hand="new"${n < 8 ? " disabled" : ""}>Draw a sample hand</button></div>
    ${n < 8 ? `<p class="muted small">Add at least 8 cards besides the commander first.</p>` : ""}</div>`;
}
function openHand(mulligans = 0) {
  const b = curBuild(); if (!b) return;
  HAND = { id: b.id, ...dealHand(b, mulligans), first: 7 };
  renderHand();
  const dlg = $("#hand");
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
function closeHand() { const dlg = $("#hand"); if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }
function renderHand() {
  if (!HAND) return;
  const c = handCounts(HAND.hand), picking = HAND.toBottom > 0;
  const tiles = HAND.hand.map((name, i) => tileCell(`<button class="ctile${picking ? " pick" : ""}${i >= HAND.first ? " new" : ""}" data-hand-card="${i}" aria-label="${esc(name)}${picking ? ", put on the bottom" : ""}">
      ${imgTag(name)}<span class="ccap">${esc(name)}${i >= HAND.first ? " · drawn" : ""}</span></button>`, name)).join("");
  const mullNote = HAND.mull === 0 ? "" : HAND.mull === 1 ? "Mulligan 1 (free in Commander)." : `Mulligan ${HAND.mull}.`;
  $("#hand-body").innerHTML = `<div class="section-head"><h2>Sample hand</h2><span class="muted small num">${HAND.lib.length} left in the library</span></div>
    <p class="small"><span class="num">${c.lands}</span> ${c.lands === 1 ? "land" : "lands"}, <span class="num">${c.spells}</span> ${c.spells === 1 ? "spell" : "spells"}${HAND.drawn ? ` · <span class="num">${HAND.drawn}</span> drawn` : ""}${mullNote ? ` · ${mullNote}` : ""}</p>
    ${picking ? `<p class="small"><strong>Tap ${HAND.toBottom === 1 ? "a card" : `${HAND.toBottom} cards`} to put on the bottom.</strong></p>` : ""}
    <div class="cgrid hand-grid">${tiles}</div>
    <div class="hand-actions">
      <button class="btn primary" data-hand="draw"${picking || !HAND.lib.length ? " disabled" : ""}>Draw a card</button>
      <button class="btn" data-hand="mull"${HAND.mull >= 6 ? " disabled" : ""}>Mulligan</button>
      <button class="btn" data-hand="new">New hand</button>
      <button class="btn" data-hand="close">Close</button>
    </div>`;
  paintImgs();
}
document.addEventListener("click", e => {
  if (e.target.id === "hand") { closeHand(); return; }   // tap outside the sheet
  const t = e.target.closest && e.target.closest("[data-hand], [data-hand-card]");
  if (!t) return;
  if (t.dataset.handCard != null) {
    const i = +t.dataset.handCard;
    if (HAND && HAND.toBottom > 0) { HAND.lib.push(...HAND.hand.splice(i, 1)); HAND.toBottom--; HAND.first = Math.min(HAND.first, HAND.hand.length); renderHand(); }
    else if (HAND) openSheet("hand", HAND.hand[i]);
    return;
  }
  const act = t.dataset.hand;
  if (act === "new") openHand(0);
  else if (act === "mull" && HAND) openHand(HAND.mull + 1);
  else if (act === "draw" && HAND && HAND.lib.length) { HAND.hand.push(HAND.lib.shift()); HAND.drawn++; renderHand(); }
  else if (act === "close") closeHand();
});

// ------------------------------------------------------------ build history (engine: recordChange)
function historyHTML(b) {
  const h = b.history || [];
  if (!h.length) return "";
  const shown = HIST_ALL ? h.length : Math.min(3, h.length);
  const list = n => n.slice(0, 6).map(([name, q]) => (q > 1 ? `${q} ` : "") + esc(name)).join(", ") + (n.length > 6 ? `, ${n.length - 6} more` : "");
  const rows = [];
  for (let j = h.length - 1; j >= h.length - shown; j--) {
    const d = h[j], parts = [];
    if (d.add.length) parts.push(`<span class="hist-add">+ ${list(d.add)}</span>`);
    if (d.cut.length) parts.push(`<span class="hist-cut">− ${list(d.cut)}</span>`);
    if (d.sadd && d.sadd.length) parts.push(`<span class="hist-add">+ sideboard: ${list(d.sadd)}</span>`);
    if (d.scut && d.scut.length) parts.push(`<span class="hist-cut">− sideboard: ${list(d.scut)}</span>`);
    rows.push(`<li><div><strong>${esc(changeLabel(d))}</strong> <span class="muted small">${esc(ago(d.at))}</span></div>
      ${parts.length ? `<div class="small">${parts.join("<br>")}</div>` : ""}
      <button class="btn link small" data-hist-back="${j}">Go back to before this</button></li>`);
  }
  return `<div class="panel"><div class="section-head"><h3>Changes</h3><span class="muted small num">${h.length}</span></div>
    <ul class="hist">${rows.join("")}</ul>
    ${h.length > 3 ? `<button class="btn link" data-hist-all>${HIST_ALL ? "Show fewer" : `Show all ${h.length}`}</button>` : ""}</div>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-hist-back], [data-hist-all]");
  if (!t) return;
  const b = curBuild(); if (!b) return;
  if (t.hasAttribute("data-hist-all")) { HIST_ALL = !HIST_ALL; renderBuild(); return; }
  const j = +t.dataset.histBack, entry = (b.history || [])[j]; if (!entry) return;
  restoreState(b, stateBefore(b, j));
  HISTORY_WHY = `Went back to before “${changeLabel(entry)}”`;
  TUNE_CACHE.clear(); saveBuilds(); renderBuild();
  toast("Went back to an earlier version", "Undo", () => { restoreState(b, stateBefore(b, b.history.length - 1)); TUNE_CACHE.clear(); saveBuilds(); renderBuild(); });
});

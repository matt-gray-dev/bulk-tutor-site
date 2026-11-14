"use strict";
// Bulk Tutor, the page's script, part "addcards": cards added and removed here (0.83.0): the Add cards sheet, the box a file with no boxes goes into, and removing cards from the collection.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ Add cards (0.83.0; the import that merges, calls 5 and 6)
// Matt, Nov 12, agreed: "Add cards" on a box's screen and on the Collection takes one name or a pasted list, as token
// lists do; the cards are "not in ManaBox yet" (what the collection has beyond the apps' last files: engine planAdd,
// recPending) until an export has more copies of the card than before. The same sheet asks which box a file with no boxes is in (import.js askWhere →
// "In a box or binder…"): there a tap on a box is the answer; with cards typed in, a tap chooses and "Add" adds.
// ADDC = {loc (the box whose screen opened it, else null), incoming (the file, else null), text, to (the place
// chosen: the pile to start with), fresh (the new-box row is open), name, msg}. The text and the name live here
// because the sheet is redrawn as places are tapped (notes/page.md, Mechanics).
let ADDC = null;
function openAddCards(loc, incoming = null) {
  if (!ownColl()) return;
  ADDC = { loc: loc || null, incoming, text: "", to: incoming ? null : PUT_AWAY, fresh: false, name: "", msg: "" };
  renderAddCards(); openDlg($("#addcards"));
  const f = $("#ac-text"); if (f) f.focus();
}
function closeAddCards() { closeDlg($("#addcards")); ADDC = null; const body = $("#addcards-body"); if (body) body.innerHTML = ""; }
function renderAddCards() {
  const body = $("#addcards-body"), w = ADDC; if (!body || !w) return;
  const file = w.incoming, n = file ? entryCount(file.entries) : 0, it = n === 1 ? "it" : "them";
  const pick = (attr, on, icon, title, sub) => `<button class="menu-item pick-row" ${attr} aria-pressed="${on}">${icon}<span class="mi-text"><strong>${title}</strong><small>${sub}</small></span></button>`;
  const where = `<div class="menu-list" role="group" aria-label="Where they are">
      ${file ? "" : pick(`data-ac-to="${esc(PUT_AWAY)}"`, !w.fresh && w.to === PUT_AWAY, neutralIconHTML("pile"), esc(PUT_AWAY), "The put-away list shows where each one goes")}
      ${putAwayPlaces().map(p => pick(`data-ac-to="${esc(p.loc)}"`, !w.fresh && w.to === p.loc, locIconHTML(p.loc, false), esc(locName(p.loc)), p.qty ? cardsWord(p.qty) : "Empty")).join("")}
      ${pick("data-ac-fresh", w.fresh, neutralIconHTML("box"), "A new box or binder", "One that isn't in your collection yet")}</div>
    ${w.fresh ? `<div class="field"><label for="ac-name">Its name</label><input type="text" id="ac-name" value="${esc(w.name)}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>` : ""}`;
  const msg = `<p class="small warn-text" id="ac-msg"${w.msg ? "" : " hidden"}>${esc(w.msg)}</p>`;
  body.innerHTML = file
    ? `<h2 id="addcards-title" tabindex="-1" autofocus>Which box ${n === 1 ? "is this card" : `are these ${cardsWord(n)}`} in?</h2>
      <p class="muted small">From ${esc(file.label)}. A deck's box isn't offered: cards in one count as part of that deck.</p>
      ${where}${msg}
      <div class="sheet-pair"><button class="btn" data-ac-cancel>Cancel</button>${w.fresh ? `<button class="btn primary" data-ac-go>Put ${it} there</button>` : ""}</div>`
    : `<h2 id="addcards-title" tabindex="-1">${w.loc ? `Add cards to ${esc(locName(w.loc))}` : "Add cards"}</h2>
      <div class="field"><label for="ac-text">One card, or a list with one per line</label>
        <textarea id="ac-text" placeholder="Sol Ring&#10;2 Arcane Signet&#10;1 Swords to Plowshares (CMM) 55 *F*" autocapitalize="off" autocomplete="off" spellcheck="false">${esc(w.text)}</textarea></div>
      <p class="muted small">For cards that aren't in your ManaBox export yet, or that it can't track. When a later export has more copies of a card than before, these are taken to be the same ones, so nothing counts twice.</p>
      ${w.loc ? "" : `<p class="flabel">Where are they?</p>${where}`}${msg}
      <div class="sheet-pair"><button class="btn" data-ac-cancel>Cancel</button><button class="btn primary" data-ac-go>Add ${w.loc ? "them" : w.fresh ? "them there" : w.to === PUT_AWAY ? "to put away" : "them there"}</button></div>`;
}
// The sheet's answer: the cards typed (or the file's) go to the place chosen, a new box made first when one is named.
function addCardsGo(to) {
  const w = ADDC; if (!w) return;
  const say = (m, sel) => { w.msg = m; renderAddCards(); const f = $(sel); if (f) f.focus(); };
  const cards = w.incoming ? null : parseCollection(w.text).entries.map(hereCard);
  if (cards && !cards.length) return say("No cards found. Write one per line, like “2 Sol Ring”.", "#ac-text");
  let fresh = null;
  to = to || w.loc || (w.fresh ? null : w.to);
  if (!to && w.fresh) {
    const r = newPlace(w.name.trim());
    if (r.problem) return say(r.problem, "#ac-name");
    to = r.loc; if (r.fresh) fresh = r;
  }
  if (!to) return say("Choose where they are.", "#addcards [data-ac-to]");
  const file = w.incoming;
  closeAddCards();
  const undo = fresh ? makeBox(fresh) : null;   // a box of the collection from now on; Undo takes it back
  if (file) importInto(to, undo); else addCardsHere(cards, to, undo);
}
// Cards added here by name: a change on the record (engine planAdd: a copy removed here from that box simply comes
// back, as the printing it was), one message, Undo.
function addCardsHere(cards, to, alsoUndo = null) {
  if (!ownColl()) return;
  const r = planAdd(REC, cards, to, { by: "hand", act: "added" }), n = r.added + r.back;
  if (!n) return;
  const did = recDo(r.change);
  const unknown = DATA && !DATA.demo ? cards.filter(c => !cardOf(c.name) && !isBasic(c.name)).length : 0;
  const what = cards.length === 1 ? `${cards[0].qty > 1 ? cards[0].qty + "× " : ""}${cards[0].name}` : cardsWord(n);
  toast(`${what} added to ${to === PUT_AWAY ? "your put-away list" : locName(to)}${unknown ? `. ${unknown === 1 ? "1 name isn't" : `${unknown} names aren't`} in the card data, so ${unknown === 1 ? "it" : "they"} can't be matched or priced` : ""}`, "Undo", () => {
    if (alsoUndo) alsoUndo();
    recUndo(did.change && did.change.id);
  }, 8000);
}
document.addEventListener("input", e => { if (!ADDC) return; if (e.target.id === "ac-text") ADDC.text = e.target.value; else if (e.target.id === "ac-name") ADDC.name = e.target.value; });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "ac-name") { e.preventDefault(); addCardsGo(); } });
document.addEventListener("close", e => { if (e.target.id === "addcards" && ADDC) closeAddCards(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "addcards") { closeAddCards(); return; }
  const t = e.target.closest && e.target.closest("[data-add-cards], [data-ac-to], [data-ac-fresh], [data-ac-cancel], [data-ac-go]"); if (!t) return;
  const d = t.dataset;
  if (d.addCards != null) { openAddCards(d.addCards || null); return; }
  const w = ADDC; if (!w) return;
  if (d.acCancel != null) { closeAddCards(); return; }
  if (d.acGo != null) { addCardsGo(); return; }
  if (d.acFresh != null) { w.fresh = !w.fresh; w.msg = ""; renderAddCards(); const f = $("#ac-name"); if (f) f.focus(); return; }
  if (w.incoming) { addCardsGo(d.acTo); return; }   // a file's cards: the box tapped is the answer
  w.to = d.acTo; w.fresh = false; w.msg = ""; renderAddCards();
  const again = $(`#addcards [data-ac-to="${CSS.escape(d.acTo)}"]`); if (again) again.focus({ preventScroll: true });
});

// ------------------------------------------------------------ removing cards here (0.83.0; call 7, Matt: "do the first and third ideas now")
// Sold, traded, lost: a copy leaves the collection here at once, with Undo (the message's, and afterwards its row
// under Recent changes: changes.js). A copy an app's last file has stays out through later imports until an export
// shows fewer copies of the card (engine recPending: "gone here, the app still has it"). A built build whose box this empties is a draft again, as after an
// import. picks = [{i (the entry's place in COLL.entries), qty}].
function removeHere(picks, what, loc) {
  if (!ownColl()) return;
  const built = BUILDS.filter(b => b.builtLoc).map(b => [b.id, b.builtLoc, b.built]);
  const list = picks.map(p => ({ e: COLL.entries[p.i], qty: p.qty })).filter(x => x.e && x.qty > 0).map(x => ({ ...x.e, qty: Math.min(x.qty, x.e.qty), from: x.e.loc, to: null }));
  const did = recDo(handChange(REC, list, { by: "hand", act: "removed" }).change);
  if (!did.made.length) return;
  checkBuiltLocs();
  if (BUILDS.filter(b => b.builtLoc).length !== built.length) renderAll();
  toast(`${what} removed from ${loc ? locName(loc) : "your collection"}`, "Undo", () => {
    recUndo(did.change.id);
    let changed = false;
    for (const [id, bl, at] of built) { const b = BUILDS.find(x => x.id === id); if (b && !b.builtLoc && locHasCards(bl)) { b.builtLoc = bl; b.built = at; b.updated = Date.now(); changed = true; } }
    if (changed) { saveBuilds(); renderAll(); }
  }, 10000);
}
// Your copies of a card that a removal on this screen is about: the box or deck being looked at, or every box.
const rmScope = () => (view === "browse" && !BROWSE.saved ? BROWSE.loc : null);
function rmCopies(name, loc = rmScope()) {
  const k = norm(name), out = [];
  (COLL ? COLL.entries : []).forEach((e, i) => { if (e.qty > 0 && norm(e.name) === k && (loc == null || e.loc === loc)) out.push({ i, e }); });
  return out.sort((a, b) => locName(a.e.loc).localeCompare(locName(b.e.loc), undefined, { numeric: true }));
}
const canRemoveHere = name => ownColl() && view === "browse" && !BROWSE.saved && rmCopies(name).length > 0;
// One copy in words: its box, and its printing when the collection names it.
function rmCopyWords(e) {
  const p = e.set ? copyPrint(e) : null;
  return [esc(locName(e.loc)), p ? `${esc(p.setName)}${p.cn ? ` #${esc(p.cn)}` : ""}` : "", e.foil === "etched" ? "etched foil" : e.foil ? "foil" : ""].filter(Boolean).join(" · ");
}
// In a card's details, in the collection browser: the button, and after a tap on it the copies to choose from
// (cardviews.js openSheet draws these in place of the other actions).
const rmButtonHTML = name => (canRemoveHere(name) ? `<div class="actions"><button class="btn danger" data-sheet-act="collrm" data-card="${esc(name)}">Remove from your collection</button></div>` : "");
function rmChooserHTML(name) {
  const loc = rmScope(), copies = rmCopies(name), n = copies.reduce((t, c) => t + c.e.qty, 0), k = esc(norm(name));
  return `<p class="small"><strong>Which copy?</strong> <span class="muted">It leaves your collection here, and a later import doesn't bring it back. Undo is under Recent changes on the Collection.</span></p>
    <div class="menu-list" id="rm-copies">${copies.map(c => `<button class="menu-item" data-coll-rm="${c.i}" data-k="${k}"><span class="mi-text"><span>${rmCopyWords(c.e)}${c.e.qty > 1 ? ` <span class="num">×${c.e.qty}</span>` : ""}</span><small>Remove one</small></span></button>`).join("")}
      ${n > 1 ? `<button class="menu-item danger" data-coll-rm="all" data-k="${k}" data-card="${esc(name)}"><span class="mi-text"><span>All ${n} copies${loc != null ? ` in ${esc(locName(loc))}` : ""}</span></span></button>` : ""}</div>
    <div class="actions"><button class="btn" data-sheet-act="collrm-no" data-card="${esc(name)}">Keep ${n === 1 ? "it" : "them"}</button></div>`;
}
// "Remove from your collection" in the card's details: the only copy goes at once; with several, which one is asked.
function rmFromSheet(name) {
  const copies = rmCopies(name), n = copies.reduce((t, c) => t + c.e.qty, 0);
  if (!n) return;
  if (n > 1) { openSheet("browse", name, null, "rm"); return; }
  closeSheet(); removeHere([{ i: copies[0].i, qty: 1 }], name, copies[0].e.loc);
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-coll-rm]"); if (!t || !ownColl()) return;
  const k = t.dataset.k;
  if (t.dataset.collRm === "all") {
    const copies = rmCopies(t.dataset.card).filter(c => norm(c.e.name) === k), n = copies.reduce((s, c) => s + c.e.qty, 0), loc = rmScope();
    closeSheet(); removeHere(copies.map(c => ({ i: c.i, qty: c.e.qty })), `${n}× ${canonical(t.dataset.card)}`, loc);
    return;
  }
  const i = +t.dataset.collRm, en = COLL.entries[i];
  closeSheet();
  if (!en || norm(en.name) !== k) { rerenderCurrent(); return; }   // the collection changed under the sheet (a sync)
  removeHere([{ i, qty: 1 }], en.name.split(" // ")[0], en.loc);
});
// Several selected cards (browse.js bselDo): every copy of each in the box or deck being looked at, or everywhere.
function rmSelected(names) {
  const loc = rmScope(), ks = new Set(names.map(norm)), picks = [];
  COLL.entries.forEach((e, i) => { if (e.qty > 0 && ks.has(norm(e.name)) && (loc == null || e.loc === loc)) picks.push({ i, qty: e.qty }); });
  const n = picks.reduce((t, p) => t + p.qty, 0);
  removeHere(picks, names.length === 1 && n === 1 ? names[0] : cardsWord(n), loc);
}
const rmSelectedCount = names => { const loc = rmScope(), ks = new Set(names.map(norm)); return COLL.entries.reduce((t, e) => t + (e.qty > 0 && ks.has(norm(e.name)) && (loc == null || e.loc === loc) ? e.qty : 0), 0); };

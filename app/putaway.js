"use strict";
// Bulk Tutor, the page's script, part "putaway": the put-away list ("To put away" as a screen of its own), the sheet that asks which box, taking a whole deck apart, and the Collection's line for the pile.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ the put-away list (0.65.0, the review's step 6)
// Cards a deck no longer uses wait in PUT_AWAY ("To put away"), free for any build, until they are filed. This screen
// is Assemble in reverse: the cards grouped by the box or binder they go to (engine putAwayPlan: where your filing
// rules send them (filing.js, 0.70.0), else back where they were taken from, else where another copy is), so it is one
// trip per box, and the rest under "Choose a box". Filing a card
// moves it there in Bulk Tutor at once (a change on the record that names the line's own copies: engine handChange),
// with Undo; there is no "planned" state in between.
// PUTAWAY.sel = the lines ticked under "Choose a box" (they have nowhere to go yet, so a tick selects);
// PUTAWAY.done = what was filed on this visit, newest first, so a card filed by mistake can be taken back after the
// message has gone: [{k, prints, name, qty, to, at, id (the change that filed it), added (it came to the list with no box)}].
let PUTAWAY = { sel: new Set(), done: [] };
const putAwayQty = () => (COLL ? COLL.entries : []).reduce((n, e) => n + (e.loc === PUT_AWAY ? e.qty : 0), 0);
function openPutAway() { PUTAWAY = { sel: new Set(), done: [] }; showView("putaway"); window.scrollTo({ top: 0 }); }
const paQty = ls => ls.reduce((n, l) => n + l.qty, 0);
const paCount = l => (l.qty > 1 ? `<span class="num">${l.qty}×</span> ` : "");
// The lines with what the screen shows of each card, and the groups: one per box or binder, by the names shown, then
// the cards with nowhere to go yet, dearest first (a binder for the valuable ones is the usual first sort).
// What one copy of a line is worth: the copies waiting in the pile from that origin, each by its own printing.
function paWorth(l) {
  let sum = 0, qty = 0;
  for (const c of ownCopies(l.name)) if (c.e.loc === PUT_AWAY && (c.e.from || c.e.loc) === l.origin && (!l.prints || l.prints.includes(printKey(c.e)))) { sum += c.price * c.e.qty; qty += c.e.qty; }
  return qty ? sum / qty : priceOf(l.name);
}
function putAwayGroups() {
  const plan = putAwayPlan();
  for (const l of plan.lines) { const c = DATA ? cardOf(l.name) : null; l.type = c ? c[2] : isBasic(l.name) ? "L" : "O"; l.price = paWorth(l); }
  const m = new Map();
  for (const l of plan.lines) { const key = l.to || ""; if (!m.has(key)) m.set(key, []); m.get(key).push(l); }
  const groups = [...m].map(([to, lines]) => ({ to, lines })).sort((a, b) => !a.to - !b.to || locName(a.to).localeCompare(locName(b.to), undefined, { numeric: true }));
  // Cards going to a box with an order of its own are listed in that order (0.76.0), so they are filed in one pass.
  for (const g of groups) g.lines.sort(g.to ? locSorter(g.to, PUT_AWAY) || ((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name)) : (a, b) => b.price - a.price || a.name.localeCompare(b.name));
  return { ...plan, groups };
}
const PA_WHY = { back: "came from here", copy: "another copy here" };
// Why a line goes where it does; a rule's line names the rule ("your rule: $2.00 or more").
const paWhy = l => (l.why === "rule" ? `your rule: ${esc(ruleText(ruleById(l.rule)).replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()))}` : PA_WHY[l.why] || "");
function paRowHTML(l, g) {
  const on = !g.to && PUTAWAY.sel.has(l.id), box = g.to ? locName(g.to) : "";
  const note = [TYPE_SINGULAR[l.type] || "", l.price ? `<span class="price num">${money(l.price * l.qty)}</span>` : "", paWhy(l)].filter(Boolean).join(" · ");
  return `<div class="pa-row${on ? " on" : ""}">
    <label class="pa-main"><input type="checkbox" data-pa-tick="${esc(l.id)}"${on ? " checked" : ""} aria-label="${g.to ? `Put ${esc(l.name)} in ${esc(box)}` : `Select ${esc(l.name)}`}">
      <span class="pa-text"><strong>${paCount(l)}${esc(l.name)}</strong>${note ? `<small>${note}</small>` : ""}</span></label>
    <button class="btn pa-else" data-pa-else="${esc(l.id)}" aria-label="${g.to ? `Put ${esc(l.name)} in another box` : `Choose a box for ${esc(l.name)}`}">${g.to ? "Other box" : "Choose"}</button></div>`;
}
function paGroupHTML(g) {
  const n = paQty(g.lines);
  if (g.to) return `<section class="pa-group" data-pa-group="${esc(g.to)}">
    <div class="loc-head"><h3>${locIconHTML(g.to, false, null, "sm")}${esc(locName(g.to))}</h3><button class="btn" data-pa-all="${esc(g.to)}">${n === 1 ? "Put it here" : `Put all ${n} here`}</button></div>
    ${locNoteHTML(g.to)}
    <div class="pa-list">${g.lines.map(l => paRowHTML(l, g)).join("")}</div></section>`;
  const ticked = g.lines.filter(l => PUTAWAY.sel.has(l.id)), tn = paQty(ticked);
  return `<section class="pa-group" data-pa-group="">
    <div class="loc-head"><h3>Choose a box</h3><button class="btn" data-pa-in="group">${tn ? `Put ${tn} ticked in…` : n === 1 ? "Put it in…" : `Put all ${n} in…`}</button></div>
    <p class="muted small">${rulesAny() ? "No rule fits" : "No box or binder holds another copy of"} ${n === 1 ? "this one" : "these"}${rulesAny() ? ", and no box or binder holds another copy" : ""}. ${n === 1 ? "Choose where it goes." : "Tick the ones that go together, or put them all in one place."}${rulesOffered() ? ` <button class="btn link" data-rules-open>${rulesAny() ? "Filing rules" : "Set up filing rules"}</button> can place cards like ${n === 1 ? "this" : "these"} for you.` : ""}</p>
    <div class="pa-list">${g.lines.map(l => paRowHTML(l, g)).join("")}</div></section>`;
}
// What was filed on this visit and is still where it was put (an import or an Undo may have moved it on).
const paDoneCopies = d => (COLL ? COLL.entries : []).filter(e => e.qty > 0 && e.loc === d.to && norm(e.name) === d.k && d.prints.includes(printKey(e)));
function paDoneNow() {
  PUTAWAY.done = PUTAWAY.done.filter(d => paDoneCopies(d).length > 0);
  return PUTAWAY.done;
}
function paDoneHTML() {
  const done = paDoneNow(); if (!done.length) return "";
  return `<details class="panel fold" id="pa-done" data-fold="padone"${foldOpen("padone", false) ? " open" : ""}>
    <summary><h3>Put away just now</h3><span class="muted small num">${paQty(done)}</span></summary>
    <div class="fold-body"><div class="list">${done.map((d, i) => `<div class="line pa-done-row"><span class="name">${paCount(d)}${esc(d.name)} <span class="muted small">· in ${esc(locName(d.to))}</span></span><button class="btn link small" data-pa-back="${i}" aria-label="Take ${esc(d.name)} back out of ${esc(locName(d.to))}">Take back</button></div>`).join("")}</div></div></details>`;
}
function renderPutAway() {
  const el = $("#view-putaway"); if (!el) return;
  const { lines, groups, places, skipped } = putAwayGroups(), n = paQty(lines), value = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const ruled = lines.filter(l => l.why === "rule"), rn = paQty(ruled), rboxes = new Set(ruled.map(l => l.to)).size;
  for (const id of [...PUTAWAY.sel]) if (!lines.some(l => l.id === id && !l.to)) PUTAWAY.sel.delete(id);
  const head = `<div class="actions"><button class="btn" data-go="collection">${MARK.back} Collection</button></div>
    <div class="section-head"><h2 class="title-ic">${neutralIconHTML("pile")}<span>${esc(PUT_AWAY)}</span></h2></div>`;
  if (!n) {
    el.innerHTML = `${head}<div class="panel empty" id="pa-empty"><p>${PUTAWAY.done.length ? "All put away." : "Nothing to put away."}</p>
      <p class="small">Cards a deck no longer uses, and cards you add with no box, wait here until you put them in a box or binder.</p></div>${paDoneHTML()}`;
    return;
  }
  el.innerHTML = `${head}
    <p class="muted small" id="pa-sum"><span class="num">${cardsWord(n)}${DATA && value ? ` · ${money(value)}` : ""}</span>. Cards your decks no longer use, and cards you add with no box, wait here, free for any build. Tick a card once it's in its box${groups.length > 1 || groups[0].to ? `, or <button class="btn link" data-pa-in="all">put them all in one place</button>` : ""}.</p>
    ${places.length ? "" : `<p class="note small">Every box and binder in your collection is a deck, so there is nowhere to suggest. Choose a new box or binder for these.</p>`}
    ${skipped.length ? `<p class="note small" id="pa-skipped">${skipped.length === 1 ? "A filing rule is" : `${skipped.length} filing rules are`} passed over: ${esc([...new Set(skipped.map(s => RULE_STATE[s.state](s.to)))].join(", "))}. <button class="btn link" data-rules-open>Filing rules</button></p>` : ""}
    ${rn ? `<div class="actions" id="pa-rules"><button class="btn primary" data-pa-rules>${rn === 1 ? "Put away the 1 card your rules place" : `Put away all ${rn} your rules place`}</button><span class="muted small">${rboxes === 1 ? `in ${esc(locName(ruled[0].to))}` : `in ${rboxes} boxes and binders`}</span></div>` : ""}
    <div class="panel pa-panel">${groups.map(paGroupHTML).join("")}</div>
    ${paDoneHTML()}`;
  const dlg = $("#putin"); if (dlg && dlg.open) renderPutIn();
}
// File lines in a box or binder (`to`), or each where the plan sends it (to = null: "Put away all N your rules
// place"): the cards move there now, the message says so, and Undo takes the change back.
function putAway(lines, to, alsoUndo = null) {
  lines = lines.filter(l => l && (to || l.to)); if (!lines.length || !COLL || !ownColl()) return;
  const dest = l => to || l.to;
  const at = Date.now(), boxes = new Set(lines.map(dest)), byRules = !to && lines.every(l => l.why === "rule");
  // Each line's own copies, the very printings (engine putAwayPlan: `copies`), from the list to where the line goes.
  const change = handChange(REC, lines.flatMap(l => l.copies.map(c => ({ ...c, from: PUT_AWAY, to: dest(l) }))), { by: byRules ? "rules" : "hand", act: "filed" }).change, id = change.id;
  if (!change.lines.length) return;
  for (const l of lines) PUTAWAY.sel.delete(l.id);
  PUTAWAY.done.unshift(...lines.map(l => ({ k: l.k, prints: l.prints, name: l.name, qty: l.qty, to: dest(l), at, id, added: l.origin === PUT_AWAY })));
  const moved = pendQty(recDo(change).made);
  if (!moved) { PUTAWAY.done = PUTAWAY.done.filter(d => d.at !== at); return; }   // the copies had left the list (it was drawn before another change): nothing to say
  const what = lines.length === 1 ? `${lines[0].qty > 1 ? lines[0].qty + "× " : ""}${lines[0].name}` : cardsWord(moved);
  toast(boxes.size === 1 ? `${what} put in ${locName(dest(lines[0]))}` : `${what} put away in ${boxes.size} boxes and binders`, "Undo", () => {
    PUTAWAY.done = PUTAWAY.done.filter(d => d.at !== at);
    if (alsoUndo) alsoUndo();
    recUndo(id);
  }, 8000);
}
// "Take back": the copies filed go back to the list, as a change that names the one it takes back, so each still says
// where it first came from (engine pileOrigins). A card that came to the list with no box (added here) has the box it
// was filed in as its own from then on (0.83.0): taken back, that box is where it came from.
function putAwayBack(i) {
  const d = paDoneNow()[i]; if (!d) { renderPutAway(); return; }
  let left = d.qty; const list = [];
  for (const e of paDoneCopies(d)) { if (left <= 0) break; const q = Math.min(left, e.qty); left -= q; list.push({ ...e, qty: q, from: d.to, to: PUT_AWAY }); }
  PUTAWAY.done.splice(i, 1);
  if (!list.length) { renderPutAway(); return; }
  recDo(handChange(REC, list, { by: "hand", act: "back", ...(d.id && !d.added ? { of: d.id } : {}) }).change);
  toast(`${d.name} is back in the list`);
}
document.addEventListener("change", e => {
  const id = e.target.dataset && e.target.dataset.paTick; if (id == null) return;
  const l = putAwayPlan().lines.find(x => x.id === id); if (!l) { renderPutAway(); return; }
  if (l.to) {   // filed: the row is gone, so the keyboard goes to the one that took its place
    const ticks = () => [...document.querySelectorAll("#view-putaway [data-pa-tick]")], i = ticks().indexOf(e.target);
    putAway([l], l.to);
    const after = ticks(), next = after[Math.min(Math.max(i, 0), after.length - 1)];
    if (next) try { next.focus({ preventScroll: true }); } catch {}
    return;
  }
  if (e.target.checked) PUTAWAY.sel.add(id); else PUTAWAY.sel.delete(id);
  renderPutAway();
});
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-putaway], [data-pa-all], [data-pa-in], [data-pa-else], [data-pa-back], [data-pa-rules]"); if (!t) return;
  const d = t.dataset;
  if (d.putaway != null) { openPutAway(); return; }
  if (d.paBack != null) { putAwayBack(+d.paBack); return; }
  const lines = putAwayPlan().lines;
  if (d.paRules != null) { putAway(lines.filter(l => l.why === "rule"), null); return; }
  if (d.paAll != null) { putAway(lines.filter(l => l.to === d.paAll), d.paAll); return; }
  if (d.paElse != null) { openPutIn([d.paElse]); return; }
  const loose = lines.filter(l => !l.to), ticked = loose.filter(l => PUTAWAY.sel.has(l.id));
  openPutIn((d.paIn === "all" ? lines : ticked.length ? ticked : loose).map(l => l.id));
});

// ---- "Put … in…": which box or binder. Any that isn't a deck (a card that isn't on a deck's list would show there as
// one to take out), or a new one by name. Tapping a box files the cards at once; a new one needs its name first.
// PUTIN = {ids: the lines, fresh: the new-box row is open, name, msg}.
let PUTIN = null;
function openPutIn(ids) { if (!ids.length) return; PUTIN = { ids, fresh: false, name: "", msg: "" }; renderPutIn(); openDlg($("#putin")); }
function closePutIn() { closeDlg($("#putin")); PUTIN = null; const body = $("#putin-body"); if (body) body.innerHTML = ""; }
function renderPutIn() {
  const body = $("#putin-body"), w = PUTIN; if (!body || !w) return;
  const plan = putAwayPlan(), lines = plan.lines.filter(l => w.ids.includes(l.id)), n = paQty(lines);
  if (!lines.length) { closePutIn(); return; }
  const one = lines.length === 1 ? lines[0] : null, here = one && one.to;
  const pick = (attr, on, icon, title, sub) => `<button class="menu-item pick-row" ${attr} aria-pressed="${on}">${icon}<span class="mi-text"><strong>${title}</strong><small>${sub}</small></span></button>`;
  body.innerHTML = `<h2 id="putin-title" tabindex="-1" autofocus>Put ${one ? esc(one.name) : cardsWord(n)} in…</h2>
    <p class="muted small">Bulk Tutor moves ${n === 1 ? "it" : "them"} there now. A deck's box isn't offered: cards in one count as part of that deck.</p>
    <div class="menu-list">${plan.places.map(p => pick(`data-pi-pick="${esc(p.loc)}"`, false, locIconHTML(p.loc, false), esc(locName(p.loc)), `${p.qty ? cardsWord(p.qty) : "Empty"}${here === p.loc ? " · where it is listed now" : ""}`)).join("")}
      ${pick("data-pi-fresh", w.fresh, neutralIconHTML("box"), "A new box or binder", "One that isn't in your collection yet")}</div>
    ${w.fresh ? `<div class="field"><label for="pi-name">Its name</label><input type="text" id="pi-name" value="${esc(w.name)}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>
      <p class="muted small">Give a binder the same name in ManaBox, and your next import finds ${n === 1 ? "the card" : "these cards"} there.</p>` : ""}
    <p class="small warn-text" id="pi-msg"${w.msg ? "" : " hidden"}>${esc(w.msg)}</p>
    <div class="sheet-pair"><button class="btn" data-pi-cancel>Cancel</button>${w.fresh ? `<button class="btn primary" data-pi-go>${n === 1 ? "Put it there" : "Put them there"}</button>` : ""}</div>`;
}
// A new box's name is read by newPlace (collection.js): a box that isn't in the collection yet becomes one made
// here (makeBox, 0.72.0), so it stays when its last card leaves; the message's Undo takes that back too.
document.addEventListener("input", e => { if (e.target.id === "pi-name" && PUTIN) PUTIN.name = e.target.value; });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "pi-name") { e.preventDefault(); const go = $("#putin [data-pi-go]"); if (go) go.click(); } });
document.addEventListener("close", e => { if (e.target.id === "putin" && PUTIN) closePutIn(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "putin") { closePutIn(); return; }
  const t = e.target.closest && e.target.closest("[data-pi-pick], [data-pi-fresh], [data-pi-cancel], [data-pi-go]"); if (!t || !PUTIN) return;
  const w = PUTIN, d = t.dataset;
  if (d.piCancel != null) { closePutIn(); return; }
  if (d.piFresh != null) { w.fresh = !w.fresh; w.msg = ""; renderPutIn(); const f = $("#pi-name"); if (f) f.focus(); return; }
  let to = d.piPick, undo = null;
  if (d.piGo != null) {
    const r = newPlace(w.name.trim());
    if (r.problem) { w.msg = r.problem; renderPutIn(); const f = $("#pi-name"); if (f) f.focus(); return; }
    to = r.loc;
    if (r.fresh) undo = makeBox(r);   // a box of the collection from now on (and a box, whatever its name says)
  }
  const lines = putAwayPlan().lines.filter(l => w.ids.includes(l.id));
  closePutIn();
  putAway(lines, to, undo);
});

// ---- Taking a whole deck apart (0.66.0; put to Matt on Nov 11 as call 5, and he agreed the tokens' default). From a
// deck's Actions, asked first: every card in its box (its sideboard too, and a hot-swap's Swaps location) goes to the
// pile, each still knowing where the import has it; the deck keeps its list as a build with no box (his Nov 9 "I
// don't think we should delete the list"); your mark on the box and who led it go, since both were about the deck;
// the tokens recorded in the box become "not in a box". One message, one Undo, and the put-away list opens.
const canTakeApart = loc => !!loc && ownColl() && isDeckLoc(loc) && swapsBase(loc) == null;
function apartCounts(loc) {
  const sw = swapsLocFor(loc), qty = l => COLL.entries.reduce((n, e) => n + (e.loc === l ? e.qty : 0), 0);
  const tokens = tokensReady() ? tokensIn(loc).filter(x => x.token && x.n > 0) : [];
  return { cards: qty(loc), swaps: qty(sw), tokens: tokens.reduce((n, x) => n + x.n, 0), tokenRows: tokens };
}
function takeApart(loc) {
  if (!canTakeApart(loc)) return;
  const marks = JSON.stringify(LOCSTYLE.decks), had = new Set(BUILDS.map(x => x.id)), curWas = CUR;
  const name = deckName(loc), c = apartCounts(loc), b = deckBuild(loc), was = { source: b.source, built: b.built, builtLoc: b.builtLoc, pulled: b.pulled };
  const how = { by: "deck", act: "apart", label: name, deck: b.id, box: loc, was: { built: b.built || null, builtLoc: b.builtLoc || null, mark: Object.hasOwn(LOCSTYLE.decks, loc) ? LOCSTYLE.decks[loc] : null } };   // for Recent changes' Undo (changes.js deckFollows)
  const r = settleDecks(REC, [{ loc, cards: [] }, ...(c.swaps ? [{ loc: swapsLocFor(loc), cards: [] }] : [])], how, deckLocs()), n = pendQty(r.moves);
  delete b.built; delete b.builtLoc; b.pulled = {}; b.updated = Date.now();
  if (b.source && b.source.kind === "owned") b.source = { kind: "kept", was: b.source };
  if (Object.hasOwn(LOCSTYLE.decks, loc)) { LOCSTYLE.decks[loc] = { at: Date.now() }; saveLocStyle(); }
  const tokWas = c.tokenRows.length ? tokenMovesApply(c.tokenRows.map(x => ({ token: x.token, from: loc, n: x.n })), "") : null;
  if (tokWas) saveTokOwn();
  saveBuilds();
  const did = recDo(r.change);
  openPutAway();
  toast(`${name} taken apart: ${cardsWord(n)} to put away${c.tokens ? `, ${tokensWord(c.tokens)} now not in a box` : ""}. Its list is kept as a build`, "Undo", () => {
    if (tokWas) { tokenCountsSet(tokWas); saveTokOwn(); }
    LOCSTYLE.decks = JSON.parse(marks); saveLocStyle();
    b.source = was.source; for (const k of ["built", "builtLoc"]) if (was[k]) b[k] = was[k]; else delete b[k];
    b.pulled = was.pulled || {}; b.updated = Date.now();
    if (!had.has(b.id) && !(b.history && b.history.length)) { BUILDS = BUILDS.filter(x => x.id !== b.id); CUR = curWas; }   // a list copied only for this
    saveBuilds();
    if (!recUndo(did.change && did.change.id)) setCollection();
    openBrowse(loc);
  }, 10000);
}
// The page of the deck's Actions sheet that asks first (browse.js draws the sheet: DECKMENU_PAGE "apart").
function apartPageHTML(loc) {
  const c = apartCounts(loc), name = deckName(loc), box = locName(loc);
  return `<h2 id="deckmenu-title" tabindex="-1" autofocus>Take ${esc(name)} apart?</h2>
    <p class="small">${c.cards === 1 ? "The 1 card" : `All ${c.cards} cards`} in <strong>${esc(box)}</strong>${c.swaps ? ` and the ${c.swaps} in its Swaps` : ""} go to “${esc(PUT_AWAY)}”, where each is listed with the box it goes back to.</p>
    <p class="muted small">The list is kept as a build, so the deck can be put together again.${c.tokens ? ` The ${tokensWord(c.tokens)} recorded in this box ${c.tokens === 1 ? "becomes" : "become"} “not in a box”.` : ""}</p>
    <div class="sheet-pair"><button class="btn" data-dm-back>Keep it</button><button class="btn danger" data-dm-apart-yes>Take it apart</button></div>`;
}

// ---- On the Collection screen: the pile leads while cards wait in it. (The fold "Not in ManaBox yet" that stood
// further down gave way to Recent changes in 0.89.0: changes.js.)
function putAwayLeadHTML() {
  const n = putAwayQty(); if (!n) return "";
  const value = DATA ? COLL.entries.reduce((s, e) => s + (e.loc === PUT_AWAY ? copyPrice(e) * e.qty : 0), 0) : 0;
  return `<div class="panel pa-lead"><div class="loc-row">${neutralIconHTML("pile")}<button class="loc-main" data-putaway><span class="loc-text"><strong>${esc(PUT_AWAY)}</strong><small>${cardsWord(n)}${value ? " · " + money(value) : ""} · waiting for a box</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div></div>`;
}

"use strict";
// Bulk Tutor, the page's script, part "putaway": the put-away list ("To put away" as a screen of its own), the sheet that asks which box, taking a whole deck apart, and the Collection's line for the pile.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ the put-away list (0.65.0, the review's step 6)
// Cards a deck no longer uses wait in PUT_AWAY ("To put away"), free for any build, until they are filed. This screen
// is Assemble in reverse: the cards grouped by the box or binder they go to (engine putAwayPlan: where your filing
// rules send them (filing.js, 0.70.0), else back where they were taken from), so it is one trip per box, and the
// rest under "Choose a box" (since 0.91.0 a box that holds another copy is no longer where a card goes by itself:
// Matt, Nov 14; the sheet that asks which box says it of that box). Filing a card
// moves it there in Bulk Tutor at once (a change on the record that names the line's own copies: engine handChange),
// with Undo; there is no "planned" state in between.
// **A card filed stays in the list where it stood, ticked, saying where it went, with "Undo"** (0.91.0; Matt,
// Nov 14: "one misclick and the card is gone before I had time to see which one I'd tapped"; the button's word is
// his: "'Take back' should just be 'undo', to keep it consistent"), until the screen is left. Until then the row
// left at once and what was filed sat in a fold under the whole list.
// **A row under "Choose a box" has no button of its own** (0.91.0, his too: "that 'choose' button seems redundant if
// it's just ticking the box"): a tick and the bar's "Put in…" do it. A row with a box keeps "Other box".
// PUTAWAY.sel = the lines ticked under "Choose a box" (they have nowhere to go yet, so a tick selects; while any is
// ticked a bar at the foot of the screen has "Put in…", since the group's own button may be a hundred rows up: 0.91.0);
// PUTAWAY.done = what was filed on this visit, newest first: [{key, k, prints, name, qty, to, at, id (the change
// that filed it), added (it came to the list with no box), grp (the group it stood in: a box, or "" for Choose a
// box), line (the row as it stood), copies (the very printings filed, for its Undo), which (the printing in words,
// when the row has to say it)}].
// **A count on a row with more than one copy** (0.92.0; Matt, Nov 14: "a quantity selector in cases where there's
// more than one of a card"): PUTAWAY.count = line id → how many go (none = all, where every row starts). It counts
// for that row's tick, its "Other box" and the bar's "Put in…"; a button that says "all" files whole lines. Fewer
// than all of a line that holds several printings takes them in the engine's order (takeCopies: plain before foil,
// then the printing with the most copies; agreed Nov 14) and the filed row says which printing went.
// **Printings together or apart** (0.92.0; his "group printings" toggle, Nov 14): PA_APART, kept on this device
// ("bt.paapart"). Together is the default: "when I'm taking apart a deck I'm probably putting all my basic lands in
// the same bulk box". Apart, every printing is a row of its own that names it, so a count is exact. The switch shows
// only while some card waits in more than one printing (engine putAwayPlan: `mixed`).
const newPutAway = () => ({ sel: new Set(), done: [], n: 0, count: new Map() });
let PUTAWAY = newPutAway();
let PA_APART = store.get("bt.paapart") === "1";
// The list's own sort and grouping (0.105.0; step 6, piece 3; Matt, Nov 14, 15:46: "Right now the order seems somewhat
// random, and it'd be useful to be able to sort by card type or color, or at least alphabetically"). The Sort sheet is
// every list's (sorting.js, target "putaway"); the sort orders "Choose a box" and any box with no order of its own (a
// box's own order is the order inside it, and stays); Group by puts headings by type or color in "Choose a box". It
// starts as his boxes are sorted: color, type, name. Until 0.105.0 "Choose a box" went dearest first.
const PA_SORT_START = "color type name";
let PA_SORT = store.get("bt.pasort") || PA_SORT_START, PA_GROUP = store.get("bt.pagroup") || "";
const paPlan = () => putAwayPlan(PA_APART);
// How many of a line go when it is filed by its own row, and the line as that part of it.
const paN = l => Math.min(l.qty, PUTAWAY.count.get(l.id) || l.qty);
function paPart(l) {
  const n = paN(l); if (n >= l.qty) return l;
  const copies = takeCopies(l.copies, n);
  return { ...l, qty: n, copies, prints: copies.map(printKey), part: l.copies.length > 1 };
}
// One printing in a row's words: **the set's code and the number, as they are printed at the foot of the card**
// ("LTR #271": what you look at with the card in your hand, and a set's whole name took three lines of a phone's row;
// a card's details still give the name), its finish when it is foil, and its condition or language where another
// row of the same card differs only by that (`tell`).
function paPrintWords(c, tell = {}) {
  return [c.set ? `${esc(String(c.set).toUpperCase())}${c.cn ? ` <span class="num">#${esc(c.cn)}</span>` : ""}` : "", c.foil === "etched" ? "etched foil" : c.foil ? "foil" : "",
    tell.cond && c.cond ? esc(condWords(c.cond)) : "", tell.lang && c.lang ? esc(c.lang.toUpperCase()) : ""].filter(Boolean).join(" · ");
}
// Apart, the rows of one card are in an order that stays put: by set, then number, plain before foil.
const paPrintOrder = (a, b) => { const x = a.copies[0], y = b.copies[0]; return (x.set || "").localeCompare(y.set || "") || (x.cn || "").localeCompare(y.cn || "", undefined, { numeric: true }) || !!x.foil - !!y.foil; };
const paPrintsWords = copies => copies.map(c => { const w = paPrintWords(c); return w && copies.length > 1 ? `${c.qty} of ${w}` : w; }).filter(Boolean).join(", ");
const putAwayQty = () => (COLL ? COLL.entries : []).reduce((n, e) => n + (e.loc === PUT_AWAY ? e.qty : 0), 0);
function openPutAway() { PUTAWAY = newPutAway(); showView("putaway"); window.scrollTo({ top: 0 }); }
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
// What the screen shows of a line besides its name: its type, and what one copy is worth.
function paDress(l) { const c = DATA ? cardOf(l.name) : null; l.type = c ? c[2] : isBasic(l.name) ? "L" : "O"; l.price = paWorth(l); return l; }
// → {lines (the cards still waiting), places, skipped, groups: [{to, lines}]}. A group's lines are the ones waiting
// and, among them where they stood, the ones filed on this visit (`done`: its entry in PUTAWAY.done).
function putAwayGroups() {
  const plan = paPlan();
  plan.lines.forEach(paDress);
  if (PA_APART) {   // rows of one card that the set, number and finish don't tell apart say their condition or language
    const by = new Map(), face = l => l.k + "|" + ["set", "cn", "foil"].map(f => l.copies[0][f] || "").join("~");
    for (const l of plan.lines) { const a = by.get(face(l)) || []; a.push(l); by.set(face(l), a); }
    for (const a of by.values()) { const differs = f => new Set(a.map(l => l.copies[0][f] || "")).size > 1; for (const l of a) l.tell = { cond: differs("cond"), lang: differs("lang") }; }
  }
  const m = new Map(), into = (key, l) => { if (!m.has(key)) m.set(key, []); m.get(key).push(l); };
  for (const l of plan.lines) into(l.to || "", l);
  for (const d of paDoneNow()) into(d.grp, { ...d.line, done: d });
  const groups = [...m].map(([to, lines]) => ({ to, lines })).sort((a, b) => !a.to - !b.to || locName(a.to).localeCompare(locName(b.to), undefined, { numeric: true }));
  // Cards going to a box with an order of its own are listed in that order (0.76.0), so they are filed in one pass
  // (a card filed is read where it now is, so it keeps its place in an order by set or rarity).
  const own = sortCmp(sortOf("putaway"), { qty: l => l.qty, price: l => l.price, rar: l => (l.copies && l.copies[0] ? copyPrint(l.copies[0]).rar : ""), set: l => (l.copies && l.copies[0] ? copyPrint(l.copies[0]).set : "") });
  for (const g of groups) {
    const order = (g.to && locSorter(g.to, l => (l.done ? l.done.to : PUT_AWAY))) || own;
    g.lines.sort((a, b) => order(a, b) || (PA_APART ? paPrintOrder(a, b) : 0));   // together, a row's filed parts follow it, newest first
  }
  return { ...plan, groups };
}
const PA_WHY = { back: "came from here" };
// Why a line goes where it does; a rule's line names the rule ("your rule: $2.00 or more").
const paWhy = l => (l.why === "rule" ? `your rule: ${esc(ruleText(ruleById(l.rule)).replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()))}` : PA_WHY[l.why] || "");
function paRowHTML(l, g) {
  if (l.done) {   // filed on this visit: it stays where it stood, saying where it went
    const d = l.done, box = locName(d.to);
    return `<div class="pa-row done" data-pa-done="${esc(d.key)}"><span class="pa-main"><span class="pa-ticked" aria-hidden="true">${MARK.pass}</span>
      <span class="pa-text"><strong>${paCount(d)}${esc(d.name)}</strong><small>Put in ${esc(box)}${d.which ? ` · ${d.which}` : ""}</small></span></span>
    <button class="btn pa-else" data-pa-back="${esc(d.key)}" aria-label="Undo: ${esc(d.name)} put in ${esc(box)}">Undo</button></div>`;
  }
  const on = !g.to && PUTAWAY.sel.has(l.id), box = g.to ? locName(g.to) : "", n = paN(l), some = n < l.qty ? `${n} of ${l.qty} ` : "";
  const note = [PA_APART ? paPrintWords(l.copies[0], l.tell) : "", TYPE_SINGULAR[l.type] || "", l.price ? `<span class="price num">${money(l.price * l.qty)}</span>` : "", paWhy(l)].filter(Boolean).join(" · ");
  return `<div class="pa-row${on ? " on" : ""}">
    <label class="pa-main"><input type="checkbox" data-pa-tick="${esc(l.id)}"${on ? " checked" : ""} aria-label="${g.to ? `Put ${some}${esc(l.name)} in ${esc(box)}` : `Select ${some}${esc(l.name)}`}">
      <span class="pa-text"><strong>${paCount(l)}${esc(l.name)}</strong>${note ? `<small>${note}</small>` : ""}</span></label>
    ${l.qty > 1 || g.to ? `<span class="pa-acts">${l.qty > 1 ? paCountHTML(l, n) : ""}${g.to ? `<button class="btn pa-else" data-pa-else="${esc(l.id)}" aria-label="Put ${some}${esc(l.name)} in another box">Other box</button>` : ""}</span>` : ""}</div>`;
}
// The count on a row that holds more than one copy: a list to pick from, which starts at all of them.
function paCountHTML(l, n) {
  let opts = "";
  for (let i = l.qty; i >= 1; i--) opts += `<option value="${i}"${i === n ? " selected" : ""}>${i === l.qty ? `All ${i}` : `${i} of ${l.qty}`}</option>`;
  return `<select class="pa-n" data-pa-n="${esc(l.id)}" aria-label="How many ${esc(l.name)} to put away">${opts}</select>`;
}
function paGroupHTML(g) {
  const todo = g.lines.filter(l => !l.done), n = paQty(todo), allDone = `<span class="muted small">All put away</span>`;
  if (g.to) return `<section class="pa-group" data-pa-group="${esc(g.to)}">
    <div class="loc-head"><h3>${locIconHTML(g.to, false, null, "sm")}${esc(locName(g.to))}</h3>${n ? `<button class="btn" data-pa-all="${esc(g.to)}">${n === 1 ? "Put it here" : `Put all ${n} here`}</button>` : allDone}</div>
    ${locNoteHTML(g.to)}
    <div class="pa-list">${g.lines.map(l => paRowHTML(l, g)).join("")}</div></section>`;
  const ticked = todo.filter(l => PUTAWAY.sel.has(l.id)), tn = paQty(ticked.map(paPart));
  // Headings by type or color (Group by), each over its cards in the list's order.
  const sub = PA_GROUP ? paSubgroups(g.lines) : null;
  const rows = sub ? sub.map(x => `<h4 class="pa-sub">${esc(x.title)} <span class="muted small num">${paQty(x.lines.filter(l => !l.done))}</span></h4>${x.lines.map(l => paRowHTML(l, g)).join("")}`).join("") : g.lines.map(l => paRowHTML(l, g)).join("");
  return `<section class="pa-group" data-pa-group="">
    <div class="loc-head"><h3>Choose a box</h3>${n ? `<button class="btn" data-pa-in="group">${tn ? `Put ${tn} ticked in…` : n === 1 ? "Put it in…" : `Put all ${n} in…`}</button>` : allDone}</div>
    ${n ? `<p class="muted small">${rulesAny() ? `No rule fits ${n === 1 ? "this one" : "these"}` : n === 1 ? "This one has no box to go back to" : "These have no box to go back to"}. ${n === 1 ? "Choose where it goes." : "Tick the ones that go together, or put them all in one place."}${rulesOffered() ? ` <button class="btn link" data-rules-open>${rulesAny() ? "Filing rules" : "Set up filing rules"}</button> can place cards like ${n === 1 ? "this" : "these"} for you.` : ""}</p>` : ""}
    <div class="pa-list">${rows}</div></section>`;
}
function paSubgroups(lines) {
  const key = l => {
    if (PA_GROUP === "type") return [typeRank(l.type), TYPE_NAMES[l.type] || "Other"];
    const c = DATA ? cardOf(l.name) : null, col = !c ? "?" : c[1].length > 1 ? "M" : c[1];
    return ["WUBRGMC?".indexOf(col), COLOR_NAMES[col] || "Unknown"];
  };
  const m = new Map();
  for (const l of lines) { const [order, title] = key(l); if (!m.has(title)) m.set(title, { order, title, lines: [] }); m.get(title).lines.push(l); }
  return [...m.values()].sort((a, b) => a.order - b.order);
}
// What was filed on this visit and is still where it was put (an import or an Undo may have moved it on).
// A copy is told by what makes a line of the record (engine kpOf: set, number, finish, condition, language), since the box's own line may know less of the printing than the list's did.
const paDoneCopies = d => (COLL ? COLL.entries : []).filter(e => e.qty > 0 && e.loc === d.to && norm(e.name) === d.k && d.copies.some(c => kpOf(d.k, c) === kpOf(d.k, e)));
function paDoneNow() {
  PUTAWAY.done = PUTAWAY.done.filter(d => paDoneCopies(d).length > 0);
  return PUTAWAY.done;
}
function renderPutAway() {
  const el = $("#view-putaway"); if (!el) return;
  const { lines, groups, places, skipped, mixed } = putAwayGroups(), n = paQty(lines), value = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const ruled = lines.filter(l => l.why === "rule"), rn = paQty(ruled), rboxes = new Set(ruled.map(l => l.to)).size;
  for (const id of [...PUTAWAY.sel]) if (!lines.some(l => l.id === id && !l.to)) PUTAWAY.sel.delete(id);
  for (const [id, c] of [...PUTAWAY.count]) if (!lines.some(l => l.id === id && c < l.qty)) PUTAWAY.count.delete(id);
  const head = `<div class="actions"><button class="btn" data-go="collection">${MARK.back} Collection</button></div>
    <div class="section-head"><h2 class="title-ic">${neutralIconHTML("pile")}<span>${esc(PUT_AWAY)}</span></h2></div>`;
  const waits = "Cards a deck no longer uses, and cards you add with no box, wait here until you put them in a box or binder.";
  const list = `<div class="panel pa-panel">${groups.map(paGroupHTML).join("")}</div>`;
  if (!n) {   // nothing waits: what was filed on this visit stays listed, each with its Undo
    el.innerHTML = `${head}<div class="panel empty" id="pa-empty"><p>${groups.length ? "All put away." : "Nothing to put away."}</p>
      <p class="small">${waits}</p></div>${groups.length ? list : ""}`;
    return;
  }
  // "Tick a card once it's in its box" is for the cards that have one to go to; the rest are explained under Choose a box.
  const boxed = groups.some(g => g.to && g.lines.some(l => !l.done)), tn = paQty(lines.filter(l => PUTAWAY.sel.has(l.id)).map(paPart));
  el.innerHTML = `${head}
    <p class="muted small" id="pa-sum"><span class="num">${cardsWord(n)}${DATA && value ? ` · ${money(value)}` : ""}</span>. Cards your decks no longer use, and cards you add with no box, wait here, free for any build.${boxed ? ` Tick a card once it's in its box, or <button class="btn link" data-pa-in="all">put them all in one place</button>.` : ""}</p>
    ${places.length ? "" : `<p class="note small">Every box and binder in your collection is a deck, so there is nowhere to suggest. Choose a new box or binder for these.</p>`}
    ${skipped.length ? `<p class="note small" id="pa-skipped">${skipped.length === 1 ? "A filing rule is" : `${skipped.length} filing rules are`} passed over: ${esc([...new Set(skipped.map(s => RULE_STATE[s.state](s.to)))].join(", "))}. <button class="btn link" data-rules-open>Filing rules</button></p>` : ""}
    ${rn ? `<div class="actions" id="pa-rules"><button class="btn primary" data-pa-rules>${rn === 1 ? "Put away the 1 card your rules place" : `Put away all ${rn} your rules place`}</button><span class="muted small">${rboxes === 1 ? `in ${esc(locName(ruled[0].to))}` : `in ${rboxes} boxes and binders`}</span></div>` : ""}
    <div class="pa-ctl"><button class="btn lctl-btn lctl-sort" id="putaway-sort" data-sort-open="putaway" aria-haspopup="dialog" aria-label="Group and sort. Sorted by ${esc(sortText(sortOf("putaway")).toLowerCase())}">${icon("i-sort")}<span class="lctl-val">${esc(sortKeyText(sortOf("putaway")))}</span></button></div>
    ${mixed ? `<div class="pa-opts" id="pa-prints">${switchHTML("data-pa-group", !PA_APART, "Group printings", PA_APART ? "Each printing of a card has its own row." : "Different printings of a card share one row.")}</div>` : ""}
    ${list}
    ${tn ? `<div class="selbar" id="paselbar" role="region" aria-label="Ticked cards"><span class="selbar-n" aria-live="polite"><strong class="num">${tn}</strong> ticked</span>
      <span class="selbar-act"><button class="btn primary" data-pa-in="group">Put in…</button><button class="btn" data-pa-clear>Clear</button></span></div>` : ""}`;
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
  for (const l of lines) { PUTAWAY.sel.delete(l.id); PUTAWAY.count.delete(l.id); }
  // A filed row says which printing went when the list is by printing, or when it took some of a line that holds several.
  PUTAWAY.done.unshift(...lines.map(l => ({ key: String(++PUTAWAY.n), k: l.k, prints: l.prints, name: l.name, qty: l.qty, to: dest(l), at, id, added: l.origin === PUT_AWAY, grp: l.to || "", line: paDress({ ...l }),
    copies: l.copies, which: PA_APART || l.part ? paPrintsWords(l.copies) : "" })));
  const moved = pendQty(recDo(change).made);
  if (!moved) { PUTAWAY.done = PUTAWAY.done.filter(d => d.at !== at); return; }   // the copies had left the list (it was drawn before another change): nothing to say
  const what = lines.length === 1 ? `${lines[0].qty > 1 ? lines[0].qty + "× " : ""}${lines[0].name}` : cardsWord(moved);
  toast(boxes.size === 1 ? `${what} put in ${locName(dest(lines[0]))}` : `${what} put away in ${boxes.size} boxes and binders`, "Undo", () => {
    PUTAWAY.done = PUTAWAY.done.filter(d => d.at !== at);
    if (alsoUndo) alsoUndo();
    recUndo(id);
  }, 8000);
}
// A filed row's "Undo" ("Take back" until Matt's word for it, Nov 14): the copies filed go back to the list, as a change that names the one it takes back, so each still says
// where it first came from (engine pileOrigins). A card that came to the list with no box (added here) has the box it
// was filed in as its own from then on (0.83.0): taken back, that box is where it came from.
// **Each printing comes back as itself** (0.92.0): the row remembers the copies it filed, so a box that already held
// one of a line's printings gives back what was put in it and not fifteen of the first printing it finds.
function putAwayBack(key) {
  const i = paDoneNow().findIndex(x => x.key === key), d = PUTAWAY.done[i]; if (!d) { renderPutAway(); return; }
  const list = [], there = paDoneCopies(d);
  for (const c of d.copies) {
    let left = c.qty; const kp = kpOf(d.k, c);
    for (const e of there) { if (left <= 0) break; if (kpOf(d.k, e) !== kp) continue; const q = Math.min(left, e.qty); left -= q; list.push({ ...e, qty: q, from: d.to, to: PUT_AWAY }); }
  }
  PUTAWAY.done.splice(i, 1);
  if (!list.length) { renderPutAway(); return; }
  recDo(handChange(REC, list, { by: "hand", act: "back", ...(d.id && !d.added ? { of: d.id } : {}) }).change);
  toast(`${d.name} is back in the list`);
}
document.addEventListener("change", e => {
  const ds = e.target.dataset; if (!ds) return;
  if (ds.paGroup != null) {   // printings together or apart: the rows are other rows, so nothing stays ticked or counted
    PA_APART = !e.target.checked; store.set("bt.paapart", PA_APART ? "1" : "0");
    PUTAWAY.sel.clear(); PUTAWAY.count.clear(); renderPutAway(); return;
  }
  if (ds.paN != null) {
    const x = paPlan().lines.find(y => y.id === ds.paN), c = Math.floor(+e.target.value);
    if (x && c >= 1 && c < x.qty) PUTAWAY.count.set(x.id, c); else PUTAWAY.count.delete(ds.paN);
    renderPutAway(); return;
  }
  const id = ds.paTick; if (id == null) return;
  const l = paPlan().lines.find(x => x.id === id); if (!l) { renderPutAway(); return; }
  if (l.to) {   // filed: the row stays, ticked, with no box of its own to tick, so the keyboard goes to the next card waiting
    const ticks = () => [...document.querySelectorAll("#view-putaway [data-pa-tick]")], i = ticks().indexOf(e.target);
    putAway([paPart(l)], l.to);
    const after = ticks(), next = after[Math.min(Math.max(i, 0), after.length - 1)];
    if (next) try { next.focus({ preventScroll: true }); } catch {}
    return;
  }
  if (e.target.checked) PUTAWAY.sel.add(id); else PUTAWAY.sel.delete(id);
  renderPutAway();
});
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-putaway], [data-pa-all], [data-pa-in], [data-pa-else], [data-pa-back], [data-pa-rules], [data-pa-clear]"); if (!t) return;
  const d = t.dataset;
  if (d.putaway != null) { openPutAway(); return; }
  if (d.paClear != null) { PUTAWAY.sel.clear(); renderPutAway(); return; }
  if (d.paBack != null) { putAwayBack(d.paBack); return; }
  const lines = paPlan().lines;
  if (d.paRules != null) { putAway(lines.filter(l => l.why === "rule"), null); return; }
  if (d.paAll != null) { putAway(lines.filter(l => l.to === d.paAll), d.paAll); return; }
  if (d.paElse != null) { openPutIn([d.paElse], true); return; }
  const loose = lines.filter(l => !l.to), ticked = loose.filter(l => PUTAWAY.sel.has(l.id));
  // Rows ticked go by their counts; "all" of a group or of the list is every copy.
  const some = d.paIn !== "all" && ticked.length > 0;
  openPutIn((d.paIn === "all" ? lines : some ? ticked : loose).map(l => l.id), some);
});

// ---- "Put … in…": which box or binder. Any that isn't a deck (a card that isn't on a deck's list would show there as
// one to take out), or a new one by name. Tapping a box files the cards at once; a new one needs its name first.
// PUTIN = {ids: the lines, counted: each goes by its row's count (a row's own "Other box", the ticked rows), fresh:
// the new-box row is open, name, msg}.
let PUTIN = null;
const putInLines = (plan, w) => plan.lines.filter(l => w.ids.includes(l.id)).map(l => (w.counted ? paPart(l) : l));
function openPutIn(ids, counted = false) { if (!ids.length) return; PUTIN = { ids, counted, fresh: false, name: "", msg: "" }; renderPutIn(); openDlg($("#putin")); }
function closePutIn() { closeDlg($("#putin")); PUTIN = null; const body = $("#putin-body"); if (body) body.innerHTML = ""; }
function renderPutIn() {
  const body = $("#putin-body"), w = PUTIN; if (!body || !w) return;
  const plan = paPlan(), lines = putInLines(plan, w), n = paQty(lines);
  if (!lines.length) { closePutIn(); return; }
  const one = lines.length === 1 ? lines[0] : null, here = one && one.to, also = one ? putAwayAlso(one.k, plan.places) : new Map();
  const pick = (attr, on, icon, title, sub) => `<button class="menu-item pick-row" ${attr} aria-pressed="${on}">${icon}<span class="mi-text"><strong>${title}</strong><small>${sub}</small></span></button>`;
  body.innerHTML = `<h2 id="putin-title" tabindex="-1" autofocus>Put ${one ? `${one.qty > 1 ? `${one.qty}× ` : ""}${esc(one.name)}` : cardsWord(n)} in…</h2>
    <p class="muted small">Bulk Tutor moves ${n === 1 ? "it" : "them"} there now. A deck's box isn't offered: cards in one count as part of that deck.</p>
    <div class="menu-list">${plan.places.map(p => pick(`data-pi-pick="${esc(p.loc)}"`, false, locIconHTML(p.loc, false), esc(locName(p.loc)), `${p.qty ? cardsWord(p.qty) : "Empty"}${here === p.loc ? " · where it is listed now" : ""}${also.has(p.loc) ? ` · ${also.get(p.loc) === 1 ? "another copy" : `${also.get(p.loc)} other copies`} here` : ""}`)).join("")}
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
  const lines = putInLines(paPlan(), w);
  closePutIn();
  putAway(lines, to, undo);
});

// ---- Taking a whole deck apart (0.66.0; put to Matt on Nov 11 as call 5, and he agreed the tokens' default). From a
// deck's Actions (since 0.97.0 the one sheet, in the Workbench: buildsheets.js deckEndHTML), asked first: every card in its box (its sideboard too, and a hot-swap's Swaps location) goes to the
// pile, each still knowing where the import has it; the deck keeps its list, with no box (his Nov 9 "I don't think
// we should delete the list"): since 0.95.0 it is Deconstructed and points at no location, which is what makes the
// box a plain box again (until then your mark on the box went); the tokens recorded in the box become "not in a
// box". One message, one Undo, and the put-away list opens.
const canTakeApart = loc => !!loc && ownColl() && isDeckLoc(loc) && swapsBase(loc) == null;
function apartCounts(loc) {
  const sw = swapsLocFor(loc), qty = l => COLL.entries.reduce((n, e) => n + (e.loc === l ? e.qty : 0), 0);
  const tokens = tokensReady() ? tokensIn(loc).filter(x => x.token && x.n > 0) : [];
  return { cards: qty(loc), swaps: qty(sw), tokens: tokens.reduce((n, x) => n + x.n, 0), tokenRows: tokens };
}
function takeApart(loc) {
  if (!canTakeApart(loc)) return;
  const had = new Set(BUILDS.map(x => x.id)), curWas = CUR;
  const name = deckName(loc), c = apartCounts(loc), b = deckBuild(loc), was = { source: b.source, stand: deckStand(b), pulled: b.pulled };
  const how = { by: "deck", act: "apart", label: name, deck: b.id, box: loc, was: deckStand(b) };   // for Recent changes' Undo (changes.js deckFollows)
  const r = settleDecks(REC, [{ loc, cards: [] }, ...(c.swaps ? [{ loc: swapsLocFor(loc), cards: [] }] : [])], how, deckLocs()), n = pendQty(r.moves);
  deckLeave(b); b.pulled = {}; b.updated = Date.now();
  if (b.source && b.source.kind === "owned") b.source = { kind: "kept", was: b.source };
  const tokWas = c.tokenRows.length ? tokenMovesApply(c.tokenRows.map(x => ({ token: x.token, from: loc, n: x.n })), "") : null;
  if (tokWas) saveTokOwn();
  saveBuilds();
  const did = recDo(r.change);
  openPutAway();
  toast(`${name} taken apart: ${cardsWord(n)} to put away${c.tokens ? `, ${tokensWord(c.tokens)} now not in a box` : ""}. Its list is kept`, "Undo", () => {
    if (tokWas) { tokenCountsSet(tokWas); saveTokOwn(); }
    b.source = was.source; deckStandSet(b, was.stand);
    b.pulled = was.pulled || {}; b.updated = Date.now();
    if (!had.has(b.id) && !(b.history && b.history.length)) { BUILDS = BUILDS.filter(x => x.id !== b.id); CUR = curWas; }   // a list copied only for this
    saveBuilds();
    if (!recUndo(did.change && did.change.id)) decksShown();
    if (BUILDS.some(x => x.id === b.id)) openYourDeck(b.id);   // back where it was taken apart from: the deck, in its box again
  }, 10000);
}
// What "Take this deck apart" asks, in its place at the end of the deck's Actions (buildsheets.js deckEndHTML).
function apartAskHTML(loc) {
  const c = apartCounts(loc), name = deckName(loc), box = locName(loc);
  return `<div class="del-confirm"><p><strong>Take ${esc(name)} apart?</strong> ${c.cards === 1 ? "The 1 card" : `All ${c.cards} cards`} in <strong>${esc(box)}</strong>${c.swaps ? ` and the ${c.swaps} in its Swaps` : ""} go to “${esc(PUT_AWAY)}”, where each is listed with the box it goes back to.</p>
    <p class="muted small">The list is kept, so the deck can be put together again.${c.tokens ? ` The ${tokensWord(c.tokens)} recorded in this box ${c.tokens === 1 ? "becomes" : "become"} “not in a box”.` : ""}</p>
    <div class="sheet-pair"><button class="btn" id="build-del-no">Keep it</button><button class="btn danger" id="build-takeapart-yes">Take it apart</button></div></div>`;
}

// ---- On the Collection screen: the first row under Piles while cards wait in it (0.98.1; until then a panel of its
// own above the search). (The fold "Not in ManaBox yet" that stood further down gave way to Recent changes in 0.89.0.)
function putAwayRowHTML() {
  const n = putAwayQty(); if (!n) return "";
  const value = DATA ? COLL.entries.reduce((s, e) => s + (e.loc === PUT_AWAY ? copyPrice(e) * e.qty : 0), 0) : 0;
  return `<div class="loc-row" id="coll-putaway">${neutralIconHTML("pile")}<button class="loc-main" data-putaway><span class="loc-text"><strong>${esc(PUT_AWAY)}</strong><small>${cardsWord(n)}${value ? " · " + money(value) : ""} · waiting for a box</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div>`;
}

"use strict";
// Bulk Tutor, the page's script, part "changes": "Recent changes" (0.89.0, step 4's piece c): every change to your collection as a list with its own Undo, the Collection's row that opens it, and how long changes are kept (Settings).
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ recent changes (Matt agreed, Nov 13: notes/model.md, "Step 4 as agreed")
// The record keeps every change to the collection (engine: REC.changes), and this screen lists them, newest first, by
// day. **A row is one thing you did**, however many cards it touched: a file imported, a deck built or taken apart,
// cards added, removed, put away. It says what was done, to how many cards and when; a tap unfolds the cards; **Undo
// takes that change back and leaves later ones alone** (engine undoChange: a card that has moved on since stays where
// it is, and the message names it).
//   An Undo is not a row of its own: the change it took back says "Undone" and offers Redo (undoing the Undo makes
//   the change again; engine undoneChanges).
//   Cards ticked off the put-away list one after another are one row with one Undo (each tick is a change of its
//   own; a deck taken apart is a hundred of them).
//   A row lists its cards in place only up to CH_NAMES different cards, a deck with its sideboard (Matt, Nov 13:
//   "I do think it's worth putting a cap on the row now"). A row with more (a first import) lists the places with
//   their counts; a place up to the cap opens to its cards, and a bigger one (a box, a binder) shows its count only,
//   until there is a view of its own for a whole change's cards ("view all X cards": notes/later.md).
// What the list can't say is the difference from an app's last file ("Not in ManaBox yet", which this took the place
// of): the import still says it, at the moment it matters.
// CHANGES.open = the rows unfolded (by the id of their first change); CHANGES.groups = the places opened in a big
// row ("<row id>|<n>"); CHANGES.shown = how many rows are drawn.
const CH_RUN_GAP = 10 * 60 * 1000;   // ticks this close together are one row
const CH_PAGE = 40;    // rows drawn before "Show older changes"
const CH_NAMES = 120;  // the most different cards listed in place: his deck boxes hold 77 to 101, his binder 130, a bulk box 1,401
const newChanges = () => ({ open: new Set(), groups: new Set(), shown: CH_PAGE });
let CHANGES = newChanges();

// → [{id, changes: [oldest first], at (ms, its latest), tick (cards ticked off the put-away list), undone}], newest first.
function changeRows() {
  if (!REC || !ownColl()) return [];
  const undone = undoneChanges(REC), ids = new Set(REC.changes.map(c => c.id)), rows = [];
  for (const c of REC.changes) {
    if (c.how.by === "undo" && ids.has(c.how.of)) continue;   // said on the change it took back
    const at = Date.parse(c.at) || 0, off = undone.has(c.id), tick = c.how.by === "hand" && c.how.act === "filed", last = rows[rows.length - 1];
    if (tick && last && last.tick && last.undone === off && at - last.at <= CH_RUN_GAP) { last.changes.push(c); last.at = at; continue; }
    rows.push({ id: c.id, changes: [c], at, tick, undone: off });
  }
  return rows.reverse();
}
// A row's cards, printings of a card that made the same move together: [{name, qty, from, to}] (location ids; null =
// nowhere: a card added or removed).
function rowLines(row) {
  const m = new Map();
  for (const c of row.changes) for (const l of c.lines) {
    const key = norm(l.name) + "\n" + l.from + "\n" + l.to, have = m.get(key);
    if (have) have.qty += l.qty; else m.set(key, { name: l.name.split(" // ")[0], qty: l.qty, from: l.from, to: l.to });
  }
  return [...m.values()];
}
// A location as this screen names it: the name you gave it, the put-away list in words.
const chPlace = id => (id === PILE ? "your put-away list" : locName(recLocName(REC, id)) || "a box that is gone");
const chPlaces = ids => (ids.length === 1 ? chPlace(ids[0]) : `${ids.length} boxes and binders`);
// What a row says: {title (what was done), sub (to how many cards, or where)}.
function rowWords(row) {
  const how = row.changes[0].how, ls = rowLines(row), qty = fits => ls.reduce((t, l) => t + (fits(l) ? l.qty : 0), 0), n = qty(() => true);
  const what = ls.length === 1 ? `${ls[0].qty > 1 ? ls[0].qty + "× " : ""}${ls[0].name}` : cardsWord(n);
  const uniq = xs => [...new Set(xs.filter(x => x != null))], tos = uniq(ls.map(l => l.to)), froms = uniq(ls.map(l => l.from));
  const added = qty(l => l.from == null), gone = qty(l => l.to == null), moved = n - added - gone;
  const parts = [added ? `${added.toLocaleString()} added` : "", gone ? `${gone.toLocaleString()} removed` : "", moved ? `${moved.toLocaleString()} moved` : ""].filter(Boolean).join(", ");
  if (how.by === "convert") return { title: "Your collection was brought over", sub: `${cardsWord(how.cards || 0)}, as they were` };
  if (how.by === "file") return { title: `Imported ${how.label || how.app || "a file"}`, sub: parts || "Nothing changed here" };
  if (how.by === "deck") return how.act === "apart" ? { title: `Took ${how.label || "a deck"} apart`, sub: `${cardsWord(n)} to put away` } : { title: `Built ${how.label || "a deck"}`, sub: `${cardsWord(n)} moved` };
  if (how.by === "rules") return { title: `Your filing rules put away ${cardsWord(n)}`, sub: `In ${chPlaces(tos)}` };
  if (how.by === "undo") return { title: "Took back an earlier change", sub: parts };
  if (how.act === "filed") return { title: `Put away ${what}`, sub: `In ${chPlaces(tos)}` };
  if (how.act === "added") return { title: `Added ${what}`, sub: `To ${chPlaces(tos)}` };
  if (how.act === "removed") return { title: `Removed ${what}`, sub: `From ${chPlaces(froms)}` };
  if (how.act === "back") return added ? { title: `Put ${what} back`, sub: `In ${chPlaces(tos)}` } : { title: `Took ${what} back out`, sub: `Of ${chPlaces(froms)}` };
  return { title: `Moved ${what}`, sub: parts };
}
const chDay = ms => { const d = new Date(ms).toDateString(), now = Date.now(); return d === new Date(now).toDateString() ? "Today" : d === new Date(now - 864e5).toDateString() ? "Yesterday" : shortDate(ms); };
const chTime = ms => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const canUndoRow = row => row.changes[0].how.by !== "convert";
// The cards of a row, by where they went: [{head, lines, qty}].
function rowGroups(row) {
  const groups = new Map();
  const head = l => (l.from == null ? `Added to ${chPlace(l.to)}` : l.to == null ? `Removed from ${chPlace(l.from)}` : l.to === PILE ? `Out of ${chPlace(l.from)}, to put away` : l.from === PILE ? `Put in ${chPlace(l.to)}` : `From ${chPlace(l.from)} to ${chPlace(l.to)}`);
  for (const l of rowLines(row)) { const h = head(l); if (!groups.has(h)) groups.set(h, { head: h, lines: [], qty: 0 }); const g = groups.get(h); g.lines.push(l); g.qty += l.qty; }
  return [...groups.values()];
}
function rowCardsHTML(row) {
  const groups = rowGroups(row);
  if (!groups.length) return `<p class="muted small">No card changed place. The file is what the next one from that app is compared with.</p>`;
  const list = g => `<div class="list">${g.lines.sort((x, y) => x.name.localeCompare(y.name)).map(moveLine).join("")}</div>`;
  if (groups.reduce((n, g) => n + g.lines.length, 0) <= CH_NAMES) return groups.map(g => `<div class="loc-head"><h3>${esc(g.head)}</h3><span class="muted small num">${g.qty.toLocaleString()}</span></div>${list(g)}`).join("");
  groups.sort((x, y) => x.head.localeCompare(y.head, undefined, { numeric: true }));   // many places: by name, so one can be found
  const count = g => `<span class="ch-group-name">${esc(g.head)}</span><span class="muted small num">${g.qty.toLocaleString()}</span>`;
  return groups.map((g, i) => {
    if (g.lines.length > CH_NAMES) return `<div class="ch-group ch-group-big">${count(g)}<span class="chev" aria-hidden="true">${MARK.open}</span></div>`;
    const key = `${row.id}|${i}`, open = CHANGES.groups.has(key);
    return `<button class="ch-group" data-ch-group="${esc(key)}" aria-expanded="${open}">${count(g)}<span class="chev" aria-hidden="true">${MARK.open}</span></button>${open ? list(g) : ""}`;
  }).join("") + (groups.some(g => g.lines.length > CH_NAMES) ? `<p class="muted small ch-cap">A place with more than ${CH_NAMES} different cards shows only its count here.</p>` : "");
}
function changeRowHTML(row) {
  const w = rowWords(row), open = CHANGES.open.has(row.id), id = esc(row.id);
  return `<div class="ch-item${row.undone ? " undone" : ""}"><div class="ch-row">
      <button class="ch-main" data-ch-open="${id}" aria-expanded="${open}"><span class="pa-text"><strong>${esc(w.title)}</strong><small>${row.undone ? "Undone · " : ""}${esc(w.sub)} · ${esc(chTime(row.at))}</small></span><span class="chev" aria-hidden="true">${MARK.open}</span></button>
      ${!canUndoRow(row) ? "" : row.undone ? `<button class="btn pa-else" data-ch-redo="${id}" aria-label="Redo: ${esc(w.title)}">Redo</button>` : `<button class="btn pa-else" data-ch-undo="${id}" aria-label="Undo: ${esc(w.title)}">Undo</button>`}</div>
    ${open ? `<div class="ch-cards">${rowCardsHTML(row)}</div>` : ""}</div>`;
}
function openChanges() { CHANGES = newChanges(); showView("changes"); window.scrollTo({ top: 0 }); }
function renderChanges() {
  const el = $("#view-changes"); if (!el) return;
  const rows = changeRows(), head = `<div class="actions"><button class="btn" data-go="collection">${MARK.back} Collection</button></div>
    <div class="section-head"><h2 class="title-ic">${neutralIconHTML("list")}<span>Recent changes</span></h2></div>`;
  if (!rows.length) { el.innerHTML = `${head}<div class="panel empty" id="ch-empty"><p>No changes yet.</p><p class="small">Everything that changes your collection is listed here, each with its own Undo.</p></div>`; return; }
  const days = new Map();
  for (const r of rows.slice(0, CHANGES.shown)) { const d = chDay(r.at); if (!days.has(d)) days.set(d, []); days.get(d).push(r); }
  el.innerHTML = `${head}
    <p class="muted small" id="ch-sum">Everything that changed your collection, newest first. Undo takes one change back and leaves the rest as they are. Changes are kept for ${chDaysWords()}: <button class="btn link" data-chdays-open>Settings</button>.</p>
    <div class="panel ch-panel">${[...days].map(([d, rs]) => `<section class="pa-group"><h4 class="subhead">${esc(d)}</h4><div class="ch-list">${rs.map(changeRowHTML).join("")}</div></section>`).join("")}</div>
    ${rows.length > CHANGES.shown ? `<div class="actions"><button class="btn" id="ch-more" data-ch-more>Show older changes</button></div>` : ""}`;
}
// **A deck built or taken apart** says which deck it was (`how.deck`: its build), which box (`how.box`) and how the
// deck stood before (`how.was`), so a row undone from this list gives the deck back as it was: the build is built or
// not as before, and a box that was a deck by your say is one again. (The message right after the action also puts
// back its tokens and the lists copied for it; step 5 gives a deck a status of its own, and this goes with it.)
// Called before the collection is drawn again, since the marks are read then.
function deckFollows(how, back) {
  if (how.by !== "deck" || !how.box) return;
  const b = BUILDS.find(x => x.id === how.deck), was = how.was || {}, box = how.box;
  if (how.act === "apart") {
    if (back) {
      if (was.mark) { LOCSTYLE.decks[box] = { ...was.mark, at: Date.now() }; saveLocStyle(); }
      if (b && !b.builtLoc && b.source && b.source.kind === "kept" && b.source.was && b.source.was.loc === box) b.source = b.source.was;
    } else {
      if (Object.hasOwn(LOCSTYLE.decks, box)) { LOCSTYLE.decks[box] = { at: Date.now() }; saveLocStyle(); }
      if (b && b.source && b.source.kind === "owned") b.source = { kind: "kept", was: b.source };
    }
  }
  if (!b) return;
  const want = back ? was : how.act === "apart" ? {} : { built: new Date().toISOString(), builtLoc: box };
  for (const k of ["built", "builtLoc"]) if (want[k]) b[k] = want[k]; else delete b[k];
  b.pulled = {}; b.updated = Date.now(); saveBuilds();
}
// Take a row back: its changes undone, the latest first, as one redraw. The message names the cards that have
// moved on since and stay where they are.
function undoRow(id) {
  const row = changeRows().find(r => r.id === id); if (!row || row.undone || !canUndoRow(row)) return;
  const w = rowWords(row), stay = []; let made = 0;
  for (const c of row.changes.slice().reverse()) { const r = undoChange(REC, c.id); if (r) { made += r.made.length; stay.push(...r.skipped); if (r.made.length) deckFollows(c.how, true); } }
  if (!made) { toast(`Nothing to undo: ${stay.length === 1 && stay[0].qty === 1 ? "that card has" : "those cards have"} moved since`); return; }
  recChanged(); checkBuiltLocs();
  const names = [...new Set(stay.map(l => l.name.split(" // ")[0]))], n = stay.reduce((t, l) => t + l.qty, 0);
  toast(`Undone: ${w.title}${n ? `. ${cardsWord(n)} moved since and stay${n === 1 ? "s" : ""} where ${n === 1 ? "it is" : "they are"}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : ""}`, "Redo", () => redoRow(id), 9000);
}
// Make an undone row again: the Undo of each of its changes is itself undone, the oldest first.
function redoRow(id) {
  const row = changeRows().find(r => r.id === id); if (!row || !row.undone) return;
  let made = 0;
  for (const c of row.changes) {
    const undone = undoneChanges(REC), u = REC.changes.slice().reverse().find(x => x.how.by === "undo" && x.how.of === c.id && !undone.has(x.id));
    const r = u ? undoChange(REC, u.id) : null; if (r && r.made.length) { made += r.made.length; deckFollows(c.how, false); }
  }
  if (!made) { toast("Nothing to redo: those cards have moved since"); return; }
  recChanged(); checkBuiltLocs();
  toast(`Done again: ${rowWords(row).title}`, "Undo", () => undoRow(id), 9000);
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-changes], [data-ch-open], [data-ch-group], [data-ch-undo], [data-ch-redo], [data-ch-more]"); if (!t) return;
  const d = t.dataset, again = sel => { const b = $(sel); if (b) b.focus({ preventScroll: true }); };
  if (d.changes != null) { openChanges(); return; }
  if (d.chMore != null) { CHANGES.shown += CH_PAGE; renderChanges(); return; }
  if (d.chUndo != null) { undoRow(d.chUndo); return; }
  if (d.chRedo != null) { redoRow(d.chRedo); return; }
  const set = d.chGroup != null ? CHANGES.groups : CHANGES.open, key = d.chGroup != null ? d.chGroup : d.chOpen;
  if (set.has(key)) set.delete(key); else set.add(key);
  renderChanges();
  again(d.chGroup != null ? `[data-ch-group="${CSS.escape(key)}"]` : `[data-ch-open="${CSS.escape(key)}"]`);
});

// ---- On the Collection screen: one row, where "Not in ManaBox yet" was, saying the latest change.
function changesLeadHTML() {
  const rows = changeRows(); if (!rows.length) return "";
  const r = rows[0], day = chDay(r.at);
  return `<div class="panel pa-lead" id="coll-changes"><div class="loc-row">${neutralIconHTML("list")}<button class="loc-main" data-changes><span class="loc-text"><strong>Recent changes</strong><small>${esc(rowWords(r).title)} · ${esc(day === "Today" ? chTime(r.at) : day)}</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div></div>`;
}

// ------------------------------------------------------------ how long changes are kept (Settings; Matt, Nov 13: "Could that 90 day number be user-configurable, within reason?")
// 30 days, 90 days (to start), 6 months or 1 year (engine HISTORY_DAYS): a preference that syncs, the newer choice
// winning. CHDAYS = {days, at}. A shorter time forgets the older changes for good, so it is asked first.
const CHDAYS_WORDS = { 30: "30 days", 90: "90 days", 183: "6 months", 365: "1 year" };
let CHDAYS = { days: HISTORY_DEFAULT, at: 0 }, CHDAYS_ASK = null;
const chDaysWords = () => CHDAYS_WORDS[CHDAYS.days] || `${CHDAYS.days} days`;
function chDaysPanelHTML() {
  const seg = HISTORY_DAYS.map(d => `<button data-chdays="${d}" aria-pressed="${CHDAYS.days === d}">${CHDAYS_WORDS[d]}</button>`).join("");
  const ask = CHDAYS_ASK ? `<div class="confirm-inline" id="chdays-ask"><p class="small">${CHDAYS_ASK.n === 1 ? "1 change is" : `${CHDAYS_ASK.n} changes are`} older than ${CHDAYS_WORDS[CHDAYS_ASK.days]} and would be forgotten for good. Your cards stay as they are.</p>
    <div class="sheet-pair"><button class="btn" data-chdays-no>Keep ${chDaysWords()}</button><button class="btn danger" data-chdays-yes>Forget ${CHDAYS_ASK.n === 1 ? "it" : "them"}</button></div></div>` : "";
  return `<p class="muted small">How long each change to your collection stays listed under Recent changes, with its Undo. After that it is forgotten; your cards stay as they are.</p>
    <div class="seg seg-fill" role="group" aria-label="Keep changes for" id="chdays-seg">${seg}</div>${ask}`;
}
// Forget what is older than the choice (engine trimChanges: from the front of the list, never the latest change, and
// each forgotten change's id is kept for as long again, for two devices). → whether any went.
// At the start the collection isn't drawn yet; later it is drawn again (a card waiting to be put away reads where
// it came from out of the changes).
function forgetOld(atStart = false) {
  if (!REC || !trimChanges(REC, CHDAYS.days)) return false;
  if (atStart) { REC_REV++; saveRecord(); } else recChanged();
  return true;
}
// The choice, kept (localStorage "bt.changedays") and sent with the other preferences; `at` is when it was made, and
// the newer choice wins between devices (sync.js applyDoc, which passes `quiet`).
function setChDays(days, at = Date.now(), quiet = false) {
  if (!HISTORY_DAYS.includes(days)) return false;
  CHDAYS = { days, at }; CHDAYS_ASK = null; store.set("bt.changedays", JSON.stringify(CHDAYS));
  forgetOld();
  if (!quiet) syncSoon();
  return true;
}
function loadChDays() { try { const h = JSON.parse(store.get("bt.changedays") || "null"); if (h && HISTORY_DAYS.includes(h.days)) CHDAYS = { days: h.days, at: +h.at || 0 }; } catch {} }
// How many changes a shorter time would forget (engine staleChanges: from the front of the list, never the latest).
const chDaysLoses = days => (!REC || !ownColl() ? 0 : staleChanges(REC, days).filter(c => c.how.by !== "undo").length);
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-chdays], [data-chdays-yes], [data-chdays-no], [data-chdays-open]"); if (!t) return;
  const d = t.dataset, redraw = () => { const p = $("#chdays-panel"); if (p) p.innerHTML = chDaysPanelHTML(); };
  if (d.chdaysOpen != null) { showView("settings"); const s = $("#chdays-set"); if (s) s.scrollIntoView({ block: "start" }); return; }
  if (d.chdaysNo != null) { CHDAYS_ASK = null; redraw(); return; }
  if (d.chdaysYes != null) { const days = CHDAYS_ASK && CHDAYS_ASK.days; if (days) setChDays(days); redraw(); return; }
  // A shorter time is asked first only when it would forget something (Matt, Nov 13).
  const days = +d.chdays, n = days < CHDAYS.days ? chDaysLoses(days) : 0;
  if (days === CHDAYS.days) { CHDAYS_ASK = null; redraw(); return; }
  if (n) { CHDAYS_ASK = { days, n }; redraw(); const a = $("#chdays-ask"); if (a) a.scrollIntoView({ block: "nearest" }); return; }
  setChDays(days); redraw();
  const on = $(`[data-chdays="${days}"]`); if (on) on.focus({ preventScroll: true });
});

"use strict";
// Bulk Tutor, the page's script, part "record": your collection in memory and in the browser (0.88.0, step 4 of the plan): the engine's record kept in IndexedDB, the collection every screen reads made from it, changes done and undone, the move of a collection kept before 0.88.0, and what the apps' last files don't show yet.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ the record
// Your own collection is the engine's record (lines with a count, locations with ids, changes, each app's last file:
// notes/model.md). It is the truth: every change to the collection is a change made on it (recDo), said outright by
// the screen that makes it (engine planFile, planAdd, handChange, settleDecks), and the screens read COLL, which is
// made from it each time (setCollection) and never written back.
let REC = null;       // null with the example or a link's collection showing and none of your own kept
let REC_REV = 0;      // bumped whenever REC changes: what is remembered about it (pending) is worked out again

// ------------------------------------------------------------ IndexedDB
// One database with one store of named values; "collection" holds {v, saved, rec (engine packRec)}. It is opened once,
// as this file loads, so the collection is being read while the card data downloads and a write is asked for as soon
// as a change is made. A browser that refuses the storage (or never answers) gives null: every read finds nothing
// and every write says it failed, so the app runs for the visit and says so.
const IDB_NAME = "bulk-tutor", IDB_STORE = "kv", IDB_WAIT = 8000;
const idbReady = new Promise(resolve => {
  let req; try { req = indexedDB.open(IDB_NAME, 1); } catch { resolve(null); return; }
  setTimeout(() => resolve(null), IDB_WAIT);
  req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch {} };
  req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
  req.onerror = () => resolve(null);
});
const idbReq = (mode, ask) => idbReady.then(db => new Promise(resolve => {
  if (!db) { resolve({ ok: false }); return; }
  try {
    const tx = db.transaction(IDB_STORE, mode), req = ask(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve({ ok: true, value: req.result });
    tx.onerror = tx.onabort = () => resolve({ ok: false });
  } catch { resolve({ ok: false }); }
}));
const idbGet = key => idbReq("readonly", s => s.get(key));
const idbPut = (key, value) => idbReq("readwrite", s => s.put(value, key)).then(r => r.ok);
const idbDel = key => idbReq("readwrite", s => s.delete(key)).then(r => r.ok);
// The collection as kept, read once: → {works (the storage answered), rec (the record, or null: none is kept)}.
const REC_BOOT = idbGet("collection").then(r => ({ works: r.ok, rec: r.ok && r.value && r.value.rec ? unpackRec(r.value.rec) : null })).catch(() => ({ works: false, rec: null }));

// Keep the record as it is now (or forget it, when there is none). One write at a time: a change made while one is
// under way is written right after it. → a promise of whether the browser kept it; a browser that won't is said once.
let REC_SAVING = null, REC_AGAIN = false, REC_KEPT = true, recWarned = false;
function saveRecord() {
  if (REC_SAVING) { REC_AGAIN = true; return REC_SAVING; }
  const write = () => (REC ? idbPut("collection", { v: 1, saved: new Date().toISOString(), rec: packRec(REC) }) : idbDel("collection"));
  const done = ok => {
    if (REC_AGAIN) { REC_AGAIN = false; return write().then(done); }
    REC_SAVING = null; REC_KEPT = ok;
    if (!ok && REC && !recWarned) { recWarned = true; toast("This browser won't keep your collection, so it will be gone after a reload. A backup file keeps it safe: Settings, Backups", null, null, 9000); }
    return ok;
  };
  return REC_SAVING = write().then(done);
}
const recSaved = () => REC_SAVING || Promise.resolve(REC_KEPT);   // settled once nothing is waiting to be written

// ------------------------------------------------------------ the collection every screen reads
// COLL keeps the shape the screens were written for until they are rebuilt: {entries, source, importedAt, parts} read
// from the record (engine recEntries, recAbout), or the example's or a link's own entries. Your marks on which
// locations are decks are applied on top, as before. With nothing given: your own collection, or the example. Given
// a collection: it is shown as it is (a link's collection at the start; COLL itself, to read your marks again).
// **Nothing changes your own collection through here** (until 0.90.0 entries handed over were made a change on the
// record): a change is recDo.
function collFromRec() { const a = recAbout(REC); return { entries: recEntries(REC), source: a.source, importedAt: a.importedAt, parts: a.parts }; }
function setCollection(c = null) {
  if (!c) c = REC ? collFromRec() : exampleCollection();
  applyDeckMarks(c.entries, LOCSTYLE.decks);   // your say on which locations are decks outlives a re-import
  COLL = c; CHANGE++;
  if (!c.example) store.del("bt.example");   // with cards of your own the example's choice is over: removing them leads back to the welcome
  aggregate();
  compute();
  renderAll();
  picsSoon();
}
// The record changed: keep it, and show it.
function recChanged() { REC_REV++; saveRecord(); setCollection(); }
// Make a change (engine doChange) → its answer: {change (as kept; null when it did nothing), made, skipped}.
function recDo(change) { const r = doChange(REC, change); recChanged(); return r; }
// Undo a change by its id (engine undoChange: its lines the other way round, as a new change; a card that has moved
// on since stays where it is). → doChange's answer, or null when there is nothing to undo.
function recUndo(id) { const r = id && REC ? undoChange(REC, id) : null; if (r) recChanged(); return r; }
// Your collection leaves this browser: the record, and the copy from before the move.
function removeCollection() {
  REC = null; REC_REV++; saveRecord();
  store.del("bt.collection"); store.del("bt.moved");
  setCollection();
}

// ------------------------------------------------------------ what the apps' last files don't show yet
// Moved, added and removed here: the collection against each app's last file (engine recPending), worked out once per
// change. Nothing marks a copy any more; these are differences.
const NO_PENDING = { moves: [], added: [], gone: [] };
let PEND = null;
function pending() {
  if (!REC || !ownColl()) return NO_PENDING;
  if (!PEND || PEND.rev !== REC_REV) PEND = { rev: REC_REV, v: recPending(REC) };
  return PEND.v;
}
const pendQty = list => list.reduce((t, x) => t + x.qty, 0);
// The moves the app doesn't know of yet, all of them or those into and out of one location: [{name, qty, from, to}],
// printings of a card that made the same move together.
function movesPending(loc = null) {
  const m = new Map();
  for (const x of pending().moves) {
    if (loc != null && x.from !== loc && x.to !== loc) continue;
    const key = norm(x.name) + "\n" + x.from + "\n" + x.to, have = m.get(key);
    if (have) have.qty += x.qty; else m.set(key, { name: x.name, qty: x.qty, from: x.from, to: x.to });
  }
  return [...m.values()].sort((a, b) => a.from.localeCompare(b.from, undefined, { numeric: true }) || a.to.localeCompare(b.to, undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------ the move (the first of two: notes/model.md)
// Before 0.88.0 the collection was kept in localStorage ("bt.collection") as the last import with marks on its
// copies. The first open of this version brings it over (engine convertCollection: every copy where it is now, the
// import's own picture as the first source), by itself, and says once how many cards and locations there were before
// and after (Matt agreed, Nov 13). The old copy is never changed: while it is there, Settings offers to download it
// and to start again from it (sync.js); a later release removes it on his word. "bt.moved" = {at, before: {cards,
// locs}, after: {cards, locs}, seen?}: written once the new form is kept, so a browser that won't keep it brings the
// old copy over again on each visit.
function oldCollection() { try { const c = JSON.parse(store.get("bt.collection") || "null"); return c && Array.isArray(c.entries) ? c : null; } catch { return null; } }
function movedInfo() { try { const m = JSON.parse(store.get("bt.moved") || "null"); return m && m.before && m.after ? m : null; } catch { return null; } }
const countsOf = entries => { const es = entries.filter(e => e && e.name && e.qty > 0); return { cards: es.reduce((n, e) => n + e.qty, 0), locs: new Set(es.filter(e => e.loc !== PUT_AWAY).map(e => e.loc)).size }; };   // as the conversion reads them: a row that isn't a card doesn't count
const countsWords = c => `${c.cards.toLocaleString()} card${c.cards === 1 ? "" : "s"} in ${c.locs.toLocaleString()} location${c.locs === 1 ? "" : "s"}`;
let MOVE_FAILED = false;   // the old copy couldn't be read into the new form: it stays as it is, the app opens without it and says so
async function bringOver() {
  const old = oldCollection(); if (!old || movedInfo()) return;
  let rec = null, note = null;
  try { rec = convertCollection(old, [...MADE]); note = { at: new Date().toISOString(), before: countsOf(old.entries), after: countsOf(recEntries(rec)) }; } catch { MOVE_FAILED = true; return; }
  REC = rec; REC_REV++;
  if (await saveRecord()) store.set("bt.moved", JSON.stringify(note));
}
// "Start again from it": the copy from before becomes the collection again, as it was brought over the first time.
function startAgain() {
  const old = oldCollection(), mv = movedInfo(); if (!old || !mv) return;
  REC = convertCollection(old, [...MADE]);
  store.set("bt.moved", JSON.stringify({ ...mv, after: countsOf(recEntries(REC)), seen: true, again: new Date().toISOString() }));
  recChanged();
  checkBuiltLocs();
  toast(`Your collection is the copy from before again: ${recCount(REC).toLocaleString()} cards`);
}
// At the start: the record as kept, else the old copy brought over. "Loading your collection…" shows only when the
// storage takes longer than a third of a second (Matt agreed, Nov 13); the header and the tabs are there meanwhile.
async function openRecord() {
  const note = $("#coll-loading"), wait = setTimeout(() => { if (note) note.hidden = false; }, 333);
  try {
    const boot = await REC_BOOT;
    REC = boot.rec; REC_REV++;
    if (!REC) await bringOver();
  } catch { if (!REC && oldCollection() && !movedInfo()) MOVE_FAILED = true; }   // whatever went wrong, the app opens
  clearTimeout(wait); if (note) note.hidden = true;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-moved-ok]"); if (!t) return;
  const mv = movedInfo(); if (mv) store.set("bt.moved", JSON.stringify({ ...mv, seen: true }));
  renderBanners();
});

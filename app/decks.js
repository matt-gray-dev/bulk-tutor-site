"use strict";
// Bulk Tutor, the page's script, part "decks": your decks in memory and in the browser (0.95.0, step 5 of the plan, piece b): one list of decks kept in IndexedDB beside the record, the move of the builds and saved decks kept before 0.95.0, the example's own decks and looking at the example as a visit (0.106.0), and the decks that boxes hold.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ the list
// Every list of cards you keep is a deck (notes/model.md): a name, a status, a format and, once its copies are
// gathered, the location they are in. BUILDS, the engine's name from when they were builds, is that list, and the
// screens read a deck as they read a build until each is rebuilt (builds.js: saveBuilds keeps it, curBuild reads
// it). Kept in IndexedDB beside the record, as "decks" = {v, saved, decks}, one write at a time (record.js). A
// browser that refuses the storage runs for the visit and says so once.
// **With the example on the screen BUILDS is the example's own list** (0.106.0, below) and yours are held aside:
// myDecks() is your list wherever it is, and saveDecks keeps the list on the screen where it belongs.
const DECKS_BOOT = idbGet("decks").then(r => ({ works: r.ok, decks: r.ok && r.value && Array.isArray(r.value.decks) ? r.value.decks : null })).catch(() => ({ works: false, decks: null }));
let DECKS_SAVING = null, DECKS_AGAIN = false, DECKS_KEPT = true, decksWarned = false;
let DECKS_HOLD = false;   // the lists from before couldn't be read into decks: nothing is written, so they stay as they are
let MINE = null;          // while the example is the collection on the screen: {decks (your own), cur, mode (the deck you had open, and how)}
const myDecks = () => (MINE ? MINE.decks : BUILDS);
function saveMyDecks() {
  if (DECKS_HOLD) return Promise.resolve(false);
  if (DECKS_SAVING) { DECKS_AGAIN = true; return DECKS_SAVING; }
  const write = () => idbPut("decks", { v: 1, saved: new Date().toISOString(), decks: JSON.parse(JSON.stringify(myDecks())) });
  const done = ok => {
    if (DECKS_AGAIN) { DECKS_AGAIN = false; return write().then(done); }
    DECKS_SAVING = null; DECKS_KEPT = ok;
    if (!ok && !decksWarned) { decksWarned = true; toast("This browser won't save your decks, so they'll be gone after a reload"); }
    return ok;
  };
  return DECKS_SAVING = write().then(done);
}
const saveDecks = () => (MINE ? saveExample() : saveMyDecks());
// Settled once nothing is waiting to be written, of your decks or the example's.
const decksSaved = () => Promise.all([DECKS_SAVING || Promise.resolve(DECKS_KEPT), EX_SAVING || Promise.resolve(EX_OK)]).then(r => r.every(Boolean));

// ------------------------------------------------------------ the example's own decks (0.106.0)
// Matt, Nov 20 (a friend "couldn't figure out how to get back to the example data"; his six calls are in
// notes/decisions.md): the example can be looked at from a collection of your own, as a visit, and **it keeps decks
// of its own**: in this browser only, never among yours, never synced or in a backup, there the next time. The
// welcome's example uses the same list, so a deck made on it stays with the example when you import.
// Kept under "example" in IndexedDB = {v, saved, decks, marks}. EX is that in memory: the decks, and the marks on the
// example's boxes (which of them hold a deck, who leads one: the page's LOCSTYLE.decks until 0.106.0, which syncs).
// **The swap.** While the example is the collection on the screen, BUILDS is the example's list and yours wait in
// MINE; setCollection makes it so each time (decksFor), so the two can't come apart, and every screen reads the
// example's decks as it reads yours. What that must never lead to, and what stops it:
//   the example's list written over yours            saveDecks keeps the list on the screen under its own name
//   its ids read as deletions of yours               saveBuilds stops before trackDeletions (sync.js), which would
//                                                    put a tombstone on every deck you have, on every device
//   it going to Dropbox or into a backup             fullDoc and applyDoc read and write myDecks() (sync.js)
//   a change to your record behind the example       recDo refuses (record.js), and the sync waits (sync.js dbxHold)
const EX_BOOT = idbGet("example").then(r => (r.ok && r.value && Array.isArray(r.value.decks) ? r.value : null)).catch(() => null);
let EX = { decks: [], marks: {} };
let EX_SAVING = null, EX_AGAIN = false, EX_OK = true;
const exDecks = () => (MINE ? BUILDS : EX.decks);   // the example's decks wherever they are
function saveExample() {
  if (EX_SAVING) { EX_AGAIN = true; return EX_SAVING; }
  const write = () => idbPut("example", { v: 1, saved: new Date().toISOString(), decks: JSON.parse(JSON.stringify(exDecks())), marks: EX.marks });
  const done = ok => {
    if (EX_AGAIN) { EX_AGAIN = false; return write().then(done); }
    EX_SAVING = null; EX_OK = ok;
    if (!ok && !decksWarned) { decksWarned = true; toast("This browser won't save the decks you make on the example, so they'll be gone after a reload"); }
    return ok;
  };
  return EX_SAVING = write().then(done);
}
// The decks on the screen follow the collection on it (record.js setCollection, before anything reads them): the
// example's with the example, else yours. The deck that was open comes back with its list ("bt.exbuild": the
// example's, kept apart from "bt.build"), and what the Workbench remembers about a list is started again, as at the
// start (builds.js startBuilds).
function decksFor(example) {
  if (example === !!MINE) return;
  if (example) {
    MINE = { decks: BUILDS, cur: CUR, mode: buildMode };
    BUILDS = EX.decks;
    const was = store.get("bt.exbuild"); CUR = BUILDS.some(d => d.id === was) ? was : null;
  } else {
    EX.decks = BUILDS; BUILDS = MINE.decks; CUR = BUILDS.some(d => d.id === MINE.cur) ? MINE.cur : null;
    if (CUR) buildMode = MINE.mode;
    MINE = null;
  }
  if (!CUR) buildMode = "list";
  buildSig.clear(); LAST_STATE.clear(); stampBuilds(false);
  GATHER = { id: null, done: [] }; TUNE_CACHE.clear();
  // A message with a button goes: its Undo is a closure over the list that was on the screen. (One without stays: the
  // first swap is at the start, where "Slow connection…" may have just been said.)
  const t = $(".toast"); if (t && t.querySelector(".toast-btn")) t.hidden = true;
}
// Your own decks as a sync or a backup leaves them (sync.js applyDoc): kept with no new time on any, and the deck
// that was open closed if it is gone. With the example on the screen they are the ones held aside.
function takeMyDecks(list) {
  if (!MINE) { BUILDS = list; if (!BUILDS.some(b => b.id === CUR)) CUR = null; saveBuilds(true); return; }
  for (const d of list) deckTidy(d);
  MINE.decks = list;
  if (!list.some(d => d.id === MINE.cur)) { MINE.cur = null; store.del("bt.build"); }
  saveMyDecks(); trackDeletions("b", list);
}
// A deck made on the example that is to be yours leaves the example's list for your own, open, before your own
// collection is shown: the deck whose cards start your collection (builds.js markBuilt, "Add N cards").
function exDeckHome(b) {
  if (!MINE || !BUILDS.includes(b)) return;
  BUILDS = BUILDS.filter(x => x !== b); saveExample();
  MINE.decks = [b, ...MINE.decks.filter(x => x.id !== b.id)]; MINE.cur = b.id; MINE.mode = buildMode;
}
// Your own decks on the screen, for a deck that is to be yours (a shared deck added: workbench.js): a visit to the
// example ends; with no collection of your own yet one starts with nothing in it, as "Start with a deck you've
// built" starts one (import.js), since a deck kept behind the example would not be seen again until an import.
function ownDecksNow() {
  if (!MINE) return;
  if (REC) leaveExample(false); else { REC = recNew(); recChanged(); }
}
// At the start, once your own decks are read: the example's as kept. **Decks made on the example before 0.106.0
// were kept among yours.** In a browser with no collection of its own where the example was chosen they become the
// example's, once, with the marks on its boxes and the deck that was open (Matt, Nov 20, 11:21: "whatever will be
// easiest to clean up/reset later": "Start the example over" clears them). No tombstone is written, so a deck that
// came from another device stays there and comes back as yours. With a collection of your own they stay yours
// (his call 6: which came from the example can't be told). **Only at the first open of this version** ("bt.exdecks"
// is written then, whatever was found): later, decks of yours with no collection are yours (Dropbox brought them
// with no record), though the example was chosen and has kept no deck yet.
async function openExample() {
  const kept = await EX_BOOT, first = !store.get("bt.exdecks");
  store.set("bt.exdecks", "1");
  if (kept) { EX = { decks: kept.decks.filter(d => d && d.id && Array.isArray(d.cards)), marks: kept.marks && typeof kept.marks === "object" ? kept.marks : {} }; return; }
  if (!first || REC || DECKS_HOLD || !BUILDS.length || store.get("bt.example") !== "1") return;
  const boxes = new Set([EXAMPLE, EXAMPLE_SMALL].flatMap(x => [...Object.keys(x.boxes), ...Object.keys(x.decks)]));
  EX = { decks: BUILDS, marks: Object.fromEntries(Object.entries(LOCSTYLE.decks).filter(([k]) => boxes.has(k))) };
  BUILDS = [];
  const cur = store.get("bt.build"); if (cur) { store.set("bt.exbuild", cur); store.del("bt.build"); }
  saveExample(); saveMyDecks();
}

// ---- Looking at the example as a visit (Matt's calls 2, 4 and 5). The example's switch (About and Settings, below),
// turned on with a collection of your own (one with nothing in it too), shows the example in place of your
// collection, as a link's collection is shown: your record stays in REC, hidden (record.js visiting). The header
// says "Example" the whole visit, and its marker leads to the switch, which is the way back (his banner of call 2
// gave way to it on Nov 20, 11:57). Import and Recent changes are about your own collection and end the visit first
// (main.js showView), and so does restoring a backup (sync.js). Reopening the page opens your own collection:
// nothing of the visit is kept.
// **The sync waits** (sync.js): a sync reads "no collection here" from the example on the screen, and would take
// Dropbox's record whole over yours, or a CSV in the folder as a first import. It catches up on the way back.
function lookAtExample() {
  if (!REC || !ownColl()) return;
  setCollection(exampleCollection());
  CUR = null; buildMode = "list";   // it opens on the list of its decks, whatever was open there last
  renderSyncAsk();                  // a question about your own collection (sync.js) waits until you are back
  showView("yourdecks"); window.scrollTo({ top: 0 });
}
// → whether a visit was ended. `go` false: the caller shows the screen it is on its way to.
function leaveExample(go = true) {
  if (!visiting()) return false;
  const was = view;
  setCollection();   // your own collection, and with it your own decks (decksFor)
  if (SETTINGS_FROM === "browse" || SETTINGS_FROM === "putaway") SETTINGS_FROM = "collection";   // Settings' Back was to a box of the example
  if (go) { showView(was === "browse" || was === "putaway" ? "collection" : was === "deck" ? "decks" : was); window.scrollTo({ top: 0 }); }
  syncSoon(300);
  return true;
}
// "Start the example over" (his call 3): the decks made on it and the marks on its boxes go. EX_ASK: asked first.
let EX_ASK = false;
const exMade = () => exDecks().length + Object.keys(EX.marks).length > 0;
function startExampleOver() {
  const was = { decks: exDecks(), marks: EX.marks, cur: MINE ? CUR : null };
  const set = (decks, marks, cur) => {
    if (MINE) { BUILDS = decks; CUR = cur; buildSig.clear(); LAST_STATE.clear(); stampBuilds(false); } else EX.decks = decks;
    EX.marks = marks;
    if (MINE && cur) store.set("bt.exbuild", cur); else if (!cur) store.del("bt.exbuild");
    saveExample();
    if (COLL && COLL.example) setCollection(COLL); else renderAll();   // its boxes are read again without the marks
  };
  set([], {}, null);
  toast("The example is as it started", "Undo", () => set(was.decks, was.marks, was.cur));
}
// ---- The example's switch, in About and in Settings, and its marker in the header (Matt, Nov 20, 11:57, from the
// pictures: "The button should be a switch if possible, which reads 'Example collection'. Switch should clearly
// indicate when it's on or off"; "instead of a banner I think we should just add a pill or marker to the header that
// just says 'EXAMPLE' when that data is showing. Clicking that pill will just bring a user to the settings page's
// Example Collection control"). The words under the heading are his. **On is whenever the example is on the screen**:
// turned on from your own collection it is a visit, and it opens on the example's decks; turned off it is your
// collection again, where you were. With no collection of your own (the example chosen at the welcome) it is on, and
// off leads back to the welcome, which is where "no example, no collection" lives. Nothing behind the welcome or
// over a link's collection. Settings adds what the example keeps and "Start the example over" while it keeps anything.
const EX_WORDS = "An example collection for trying things out. If you've loaded any of your own collection it won't be impacted in this mode.";
const exampleOn = () => !!(COLL && COLL.example);
const exampleOffered = () => !!COLL && !COLL.fromLink && !needsWelcome() && (exampleOn() || (!!REC && ownColl()));
const exSwitchHTML = id => switchHTML(`id="${id}" data-example-switch`, exampleOn(), "Example collection", exampleOn() ? "On" : "Off");
function exampleAboutHTML() { return exampleOffered() ? `<h3 id="about-example">Example collection</h3><p>${EX_WORDS}</p>${exSwitchHTML("ex-switch-about")}` : ""; }
function exampleSetHTML() {
  if (!exampleOffered()) return "";
  const n = exDecks().length, made = exMade();
  const kept = made ? `<p class="muted small" id="ex-kept">${n ? `${n === 1 ? "The deck" : `The ${n} decks`} you made on the example ${n === 1 ? "is" : "are"} kept in this browser only, apart from your own.` : "The example's boxes you made decks of are kept in this browser only."}</p>` : "";
  const over = !made ? "" : EX_ASK ? `<div class="actions" id="ex-over-zone"><span class="small">Start the example over? ${n ? `${n === 1 ? "The deck" : `The ${n} decks`} you made on it ${n === 1 ? "is" : "are"} removed.` : "Its boxes go back to how they started."}</span><button class="btn danger" data-example="over-yes">Start over</button><button class="btn" data-example="over-no">Keep ${n === 1 ? "it" : "them"}</button></div>`
    : `<div class="actions"><button class="btn" data-example="over">Start the example over</button></div>`;
  return `<section class="set-group" id="example-set"><h3 class="set-h">Example collection</h3><div class="panel"><p class="small">${EX_WORDS}</p>${exSwitchHTML("ex-switch")}${kept}${over}</div></section>`;
}
// The switch, turned. Off with no collection of your own un-chooses the example: the welcome again (import.js).
function exampleSwitch(on) {
  closeAbout();
  if (on === exampleOn()) { renderAll(); return; }
  if (on) { lookAtExample(); return; }
  if (leaveExample()) return;
  store.del("bt.example"); WELCOME_SKIP = false; renderAll(); showView("welcome"); window.scrollTo({ top: 0 });
}
document.addEventListener("change", e => { if (e.target.matches && e.target.matches("[data-example-switch]")) exampleSwitch(e.target.checked); });
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-example]"); if (!t) return;
  const act = t.dataset.example;
  if (act === "where") {   // the header's marker: to the switch
    closeAbout(); if (view !== "settings") showView("settings");
    const g = $("#example-set"); if (g) g.scrollIntoView({ block: "center" });
    return;
  }
  EX_ASK = act === "over";
  if (act === "over-yes") startExampleOver(); else renderSettings();
});

// ------------------------------------------------------------ the move (the second of two: notes/model.md)
// Before 0.95.0 there were three kinds of list: builds ("bt.builds"), saved decks ("bt.decks") and the locations that
// counted as decks (a file's word, or your mark in "bt.locstyle"). The first open of this version makes them one
// list (engine convertDecks, which touches nothing), by itself, and says once how many decks there are at each
// status (Matt agreed, Nov 15). The old lists are never changed: while they are there, Settings offers to download
// them and to start again from them (sync.js); a later release removes them on his word. "bt.decksmoved" = {at, n
// (convertDecks' counts), seen?}: written once the decks are kept, so a browser that won't keep them brings the old
// lists over again on each visit.
function oldLists() {
  const read = k => { try { const v = JSON.parse(store.get(k) || "null"); return Array.isArray(v) ? v.filter(x => x && x.id && Array.isArray(x.cards)) : null; } catch { return null; } };
  const builds = read("bt.builds"), saved = read("bt.decks");
  return builds || saved ? { builds: builds || [], saved: saved || [] } : null;
}
function decksMovedInfo() { try { const m = JSON.parse(store.get("bt.decksmoved") || "null"); return m && m.n ? m : null; } catch { return null; } }
// What the move reads, from the browser or from a backup of before 0.95.0 (sync.js: applyDoc).
function decksFrom(old, rec, marks) {
  return convertDecks({ builds: old.builds, saved: old.saved, rec, marks: marks || {}, prefix: deckPrefix(), shown: Object.fromEntries(LOCNAMES) });
}
const decksCount = n => n.built + n.building + n.idea + n.apart;
// "8 built, 1 building, 5 ideas and 2 deconstructed": the counts by status, leaving out a status that has none.
function decksWords(n) {
  const parts = [n.built ? `${n.built} built` : "", n.building ? `${n.building} building` : "", n.idea ? `${n.idea} idea${n.idea === 1 ? "" : "s"}` : "", n.apart ? `${n.apart} deconstructed` : ""].filter(Boolean);
  return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
}
async function bringDecksOver() {
  const old = oldLists() || { builds: [], saved: [] };
  // A collection that couldn't be brought over (record.js MOVE_FAILED) would make every deck's box look empty.
  if (MOVE_FAILED) { DECKS_HOLD = true; BUILDS = old.builds; return; }
  let r;
  try { r = decksFrom(old, REC, LOCSTYLE.decks); } catch { DECKS_HOLD = true; BUILDS = old.builds; return; }
  BUILDS = r.decks;
  // (A saved deck that became its build's deck leaves no tombstone: on a device whose copy of that build differs,
  // the saved deck is a list of its own and stays one, on both devices once they sync. A list twice, never a list lost.)
  if (!decksCount(r.n)) return;   // nothing was kept before: nothing to say, and nothing to keep yet
  if (await saveDecks()) store.set("bt.decksmoved", JSON.stringify({ at: new Date().toISOString(), n: r.n }));
}
// "Start again from them": the lists from before become your decks again, as they were brought over the first time.
function decksAgain() {
  leaveExample(false);   // they are made from your own collection
  const old = oldLists(), mv = decksMovedInfo(); if (!old || !mv) return;
  let r; try { r = decksFrom(old, ownRec(), LOCSTYLE.decks); } catch { toast("The lists from before couldn't be read"); return; }
  knownIds.b = new Set([...knownIds.b, ...r.decks.map(d => d.id)]);
  for (const d of r.decks) d.updated = Date.now();   // they stand over what your other devices have
  store.set("bt.decksmoved", JSON.stringify({ ...mv, n: r.n, seen: true, again: new Date().toISOString() }));
  if (MINE) { MINE.decks = r.decks; MINE.cur = null; saveMyDecks(); trackDeletions("b", r.decks); syncSoon(); }   // with no collection and the example showing, they are yours behind it (0.106.0)
  else { BUILDS = r.decks; startBuilds(); saveBuilds(); decksShown(); }
  toast(`Your decks are the lists from before again: ${decksWords(r.n)}`);
}
// At the start, after the record: the decks as kept, else the lists from before brought over.
async function openDecks() {
  try {
    const boot = await DECKS_BOOT;
    if (boot.decks) BUILDS = boot.decks; else await bringDecksOver();
  } catch { if (oldLists() && !decksMovedInfo()) { DECKS_HOLD = true; BUILDS = (oldLists() || { builds: [] }).builds; } }   // whatever went wrong, the app opens
  if (!Array.isArray(BUILDS)) BUILDS = [];
  try { await openExample(); } catch {}   // the example's own decks (below)
  startBuilds();
  knownIds.b = new Set(BUILDS.map(d => d.id));
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-decksmoved-ok]"); if (!t) return;
  const mv = decksMovedInfo(); if (mv) store.set("bt.decksmoved", JSON.stringify({ ...mv, seen: true }));
  renderBanners();
});

// ------------------------------------------------------------ the decks that boxes hold
// Your own record, when it is the collection on the screen (the example and a link's collection have none).
const ownRec = () => (REC && ownColl() ? REC : null);
// The decks' say on which locations are decks changed (a deck took a box or left one) and no change to the record
// drew it: the collection is read again, as it was after a mark before 0.95.0.
function decksShown() { if (ownColl()) setCollection(); else renderAll(); }
// A box's own deck, made from the cards in it (engine boxDeck): for a location a file brings as a deck, and for "This
// is a deck". Its `updated` is now, not 0 as at the move: a deck of the same id removed earlier stays removed on your
// other devices only until this one is newer. → the deck, in the list.
function addBoxDeck(loc) {
  const d = boxDeck(REC, loc, { imported: !!loc.deck, prefix: deckPrefix(), shown: locName(loc.name) !== loc.name ? locName(loc.name) : "" });
  for (let i = 2, base = d.id; BUILDS.some(x => x.id === d.id); i++) d.id = `${base}-${i}`;
  d.name = uniqueBuildName(d.name); d.updated = Date.now();
  BUILDS.push(d);
  return d;
}
// **A file that brings a new location as a deck gets a deck for it** (ManaBox's deck binders, a name that starts with
// the prefix), as the move made one for every such location: otherwise a first import would arrive with no decks.
// Only a location that is new with this file (`had`: the locations before it), holds cards and has no deck. → what
// was made, [{id, at}], for the import's Undo.
function fileDecks(change, had) {
  const made = [];
  for (const l of (change && change.locs) || []) {
    const loc = l.deck && !had.has(l.id) && swapsBase(l.name) == null ? REC.locs.get(l.id) : null;
    if (!loc || BUILDS.some(d => deckHolds(d) && d.loc === loc.id)) continue;
    let held = false; for (const x of REC.lines.values()) if (x.loc === loc.id) { held = true; break; }
    if (held) { const d = addBoxDeck(loc); made.push({ id: d.id, at: d.updated }); }
  }
  if (made.length) saveBuilds();   // none is opened: the Workbench stays on what it showed
  return made;
}
// The import was undone: the decks it made go with it, unless one has been worked on since.
function fileDecksBack(made) {
  const gone = new Set((made || []).filter(m => { const d = BUILDS.find(x => x.id === m.id); return d && d.updated === m.at && !(d.history && d.history.length); }).map(m => m.id));
  if (!gone.size) return;
  BUILDS = BUILDS.filter(d => !gone.has(d.id));
  if (!BUILDS.some(d => d.id === CUR)) CUR = null;
  saveBuilds();
}
// ---- A deck that points at a box, made or taken away: "Make a deck from this box" and "From a box of cards" (0.97.0;
// the switch "This is a deck" and "Choose your decks" until then), and that one's Undo. On: the list that was this
// box's deck before, when one is kept (taken off earlier), else a deck made from the cards in it. Off: a deck that is
// only the box's cards goes; one with a list of its own stays, as an Idea, and the cards stay where they are either way.
const fromBox = (d, box) => !!d.source && d.source.kind === "owned" && d.source.loc === box;
function boxOnly(d, loc) {
  return fromBox(d, loc.name) && !(d.history && d.history.length) && !listNote(d) && !d.hotswap && !d.overhaul && !(d.keep && d.keep.length)
    && sameDeckList({ ...d, commanders: [], companion: null }, { cards: locCards(REC, loc.id), commanders: [] });
}
function boxDeckOn(box) {
  const id = locIdOf(box), loc = id && ownRec() ? REC.locs.get(id) : null; if (!loc || buildForDeck(box)) return null;
  const was = BUILDS.filter(d => !d.loc && deckStatus(d) === "idea" && fromBox(d, box)).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  if (was) { was.loc = id; was.status = "built"; was.updated = Date.now(); return was; }
  return addBoxDeck(loc);
}
function boxDeckOff(box) {
  const d = ownRec() ? buildForDeck(box) : null, loc = d ? REC.locs.get(d.loc) : null; if (!d || !loc) return;
  if (boxOnly(d, loc)) { BUILDS = BUILDS.filter(x => x !== d); if (CUR === d.id) CUR = null; }
  else { delete d.loc; delete d.built; d.status = "idea"; d.updated = Date.now(); }
}

// ------------------------------------------------------------ the Decks tab: the list of your decks (0.96.0; step 5, piece c)
// Every deck once, in a fold per status, each row saying what matters at its status (Matt, Nov 15, from the pictures:
// "Agreed on all 5"). The list is the picker: a row opens its deck in the Workbench, whose head has the way back.
// **With the example or a link's collection showing** no deck points at a location (they have no record), so their
// deck boxes get rows of their own: a box whose list was opened shows as that deck, in its box; one not opened yet
// is a row that opens it, as "From one of your decks" did on the start screen until 0.96.0. Nothing is kept for a row.
const DECK_FOLDS = [["Built", "built"], ["Building", "building"], ["Ideas", "idea"], ["Deconstructed", "apart"]];
const shownBox = d => deckBox(d) || (COLL && !ownColl() && !d.loc && d.source && d.source.kind === "owned" && isDeckLoc(d.source.loc) && buildForDeck(d.source.loc) === d ? d.source.loc : null);
const shownStatus = d => (!deckBox(d) && shownBox(d) ? "built" : deckStatus(d));
// → [{d (a deck) | loc (a deck box of the example, not opened yet), status, name, n?}]
function listedDecks() {
  const rows = BUILDS.map(d => ({ d, status: shownStatus(d), name: d.name }));
  if (COLL && !ownColl()) for (const o of ownedDecks()) if (!buildForDeck(o.loc)) rows.push({ loc: o.loc, status: "built", name: deckName(o.loc), n: o.count });
  return rows;
}
// What matters at a deck's status, as HTML: under its name on the list, and beside its status when it is open.
// **A Built deck's warnings** (0.98.2; Matt's words, Nov 18, 15:42): "Not currently in <box>" when its box holds
// nothing, "No location saved in your collection" when it has none, and what its list and its box disagree on. With
// `tap` (its own line in the Workbench, your own collection) each is a button (`data-deck-warn`): the first asks
// whether to put it back (deckWarnAskHTML), the second asks which box (openWhichBox) and then, when the deck needs
// cards that aren't free, whether to add them (0.101.0: builds.js, a built deck you bring), the third opens Assemble.
function deckLineHTML(d, tap = false) {
  const s = shownStatus(d), n = d.cards.reduce((t, c) => t + c.qty, 0);
  // ("No location saved…" is a button with no collection of your own too: 0.101.0, a deck you bring starts one.)
  const warn = (kind, text) => (tap && (kind === "nobox" ? canBring() : ownColl()) ? `<button class="btn link small warn-text" data-deck-warn="${kind}">${text}</button>` : `<span class="warn-text">${text}</span>`);
  if (s === "built") {
    const box = shownBox(d); if (!box) return `${cardsWord(n)} · ${warn("nobox", "No location saved in your collection")}`;
    if (!locHasCards(box)) return warn("away", `Not currently in ${esc(locName(box))}`);
    const ch = deckChanges(d), diff = [ch.add ? `${ch.add} to put in` : "", ch.out ? `${ch.out} to take out` : ""].filter(Boolean).join(", ");
    return `In ${esc(locName(box))} · ${diff ? warn("changes", diff) : cardsWord(n)}`;
  }
  if (!n) return "No cards yet";
  if (s === "building") return `${deckGathered(d, deckBox(d))} of ${n} gathered`;   // the copies in its place (0.98.0: a tick moves the card), and ticks that are only ticks
  // With nothing in your collection a deck's cards aren't counted as owned or missing (builds.js, collEmpty).
  if (collEmpty() && (s === "idea" || s === "building")) return `${cardsWord(n)}${tap && canAddCards(d) ? ` · <button class="btn link small" data-deck-warn="nobox">${ADD_CARDS_WORDS}</button>` : ""}`;
  if (s === "idea") { const x = buildStats(d); return x.missing ? `You own ${n - x.missing} of ${n}${x.cost ? ` · ${money(x.cost)} to buy` : ""}` : `You own all ${n}`; }
  const when = d.apartAt || d.updated;
  return `${cardsWord(n)}${when ? ` · taken apart ${esc(shortDate(when))}` : ""}`;
}
const deckPips = names => { const b = { commanders: names || [] }, id = DATA ? buildIdentity(b) : null; return id ? " " + pips(["W", "U", "B", "R", "G"].filter(c => id.has(c)).join("") || "C") : ""; };
function deckRowHTML(r) {
  const row = (attr, name, lead, line) => `<div class="loc-row dk-row"><button class="loc-main" ${attr}><span class="loc-text"><strong><span class="dk-name">${esc(name)}</span>${deckPips(lead)}</strong><small>${line}</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div>`;
  return r.d ? row(`data-open-deck="${esc(r.d.id)}"`, r.d.name, r.d.commanders, deckLineHTML(r.d))
    : row(`data-open-box="${esc(r.loc)}"`, r.name, DATA ? deckListOf(r.loc).commanders : [], `In ${esc(locName(r.loc))} · ${cardsWord(r.n)}`);
}
// "Combos in your collection": the Combos screen has no tab since 0.96.0 (Matt, Nov 15), and is reached from here.
// The count is worked out once per collection and combo file.
let COMBOS_READY = null;
function combosReady() {
  if (!COMBOS_READY || COMBOS_READY.change !== CHANGE || COMBOS_READY.of !== COMBOS) {
    let n = 0; for (const c of COMBOS.combos) if (!comboStatus(c[1], false).length) n++;
    COMBOS_READY = { change: CHANGE, of: COMBOS, n };
  }
  return COMBOS_READY.n;
}
const combosSub = () => (COMBOS ? `${combosReady().toLocaleString()} you can make now` : DATA && combosState === "loading" ? "Loading…" : "From Commander Spellbook");
function combosRowHTML() {
  if (DATA && combosState === "idle") loadCombos();   // it fills the row's second line in once they are here (find.js)
  return `<div class="panel dk-foot"><div class="loc-row"><span class="loc-ic neutral" aria-hidden="true">${icon("i-combos", "ic-line")}</span><button class="loc-main" id="decks-combos" data-go="combos"><span class="loc-text"><strong>Combos in your collection</strong><small>${combosSub()}</small></span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div></div>`;
}
// A deck that arrived by a share link, offered wherever the Decks tab is showing.
const sharedDeckHTML = () => (SHARED_BUILD ? `<div class="banner info"><span><strong>Shared deck:</strong> ${esc(SHARED_BUILD.name)} (${cardsWord(entryCount(SHARED_BUILD.cards))})</span><span class="actions"><button class="btn primary" id="shared-add">Add to your decks</button><button class="btn" id="shared-dismiss">Dismiss</button></span></div>` : "");
function renderYourDecks() {
  const el = $("#view-yourdecks"); if (!el) return;
  const rows = listedDecks();
  const folds = DECK_FOLDS.map(([label, s]) => {
    const rs = rows.filter(r => r.status === s).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return rs.length ? `<details class="panel fold" data-fold="dk-${s}"${foldOpen("dk-" + s, s !== "apart") ? " open" : ""}><summary><h3>${label}</h3><span class="muted small num">${rs.length}</span></summary><div class="fold-body"><div class="loc-list">${rs.map(deckRowHTML).join("")}</div></div></details>` : "";
  }).join("");
  el.innerHTML = `<div class="fold-stack">${sharedDeckHTML()}<div class="panel dk-top"><div class="section-head"><h2>Your decks</h2><span class="muted small num">${rows.length}</span></div><button class="btn primary" id="deck-new">New deck</button></div>${folds}${combosRowHTML()}</div>`;
}
// Open a deck in the Workbench, on its list.
function openYourDeck(id) { CUR = id; buildMode = "list"; buildQuery = ""; buildRole = null; saveBuilds(); showView("build"); window.scrollTo({ top: 0 }); }

// ------------------------------------------------------------ a box and its deck (0.97.0; step 5, piece c2)
// The Collection lists places only: a box that holds a deck says which, on its row, its screen and its sheet, and
// "Open the deck" opens it in the Workbench. A box with cards and no deck can become one ("Make a deck from this
// box" on its sheet, "From a box of cards" on New deck: collection.js), which replaced the switch "This is a deck".
// "Holds your deck X, so its cards count as in use." (`why` false: without the second half, for a row.)
// **A deck being gathered** (0.98.0, piece d: Building holds its copies) has a place too, from its first tick: it
// says so, in place of "Holds" (Matt, Nov 18: no "pile" as a thing of its own; the place's own words do that job).
const boxGathers = loc => { const d = boxOfDeck(loc); return !!d && deckStatus(d) === "building"; };
function boxHoldsWords(loc, why = true) {
  const name = deckName(loc), named = name !== locName(loc), deck = named ? `your deck <strong>${esc(name)}</strong>` : "a deck";
  return `${boxGathers(loc) ? `Where ${deck} is being gathered` : `Holds ${deck}`}${why ? ", so its cards count as in use." : ""}`;
}
// The deck a box holds, in the Workbench (the example's deck box: its list, made now if it has none, as its row does).
function openBoxDeck(loc) {
  const d = buildForDeck(loc) || (isDeckLoc(loc) ? deckBuild(loc) : null); if (!d) return;
  closeLocPicker(); openYourDeck(d.id);
}
// A deck made from a box's cards, Built and kept there (your own collection: decks.js boxDeckOn; the example and a
// link's collection: a mark, as the switch made). → the deck, when one is made now. Its Undo takes it away again.
function makeBoxDeck(loc) {
  if (!COLL || isDeckLoc(loc)) return null;
  const box = locName(loc);
  if (!ownColl()) { setDeckMark(loc, true); toast(`${box} holds a deck now`, "Undo", () => setDeckMark(loc, false)); return null; }
  const before = new Map(BUILDS.map(x => [x.id, deckStand(x)]));
  const d = boxDeckOn(loc); if (!d) return null;
  const prev = before.get(d.id);   // a list kept from before that took the box again: its Undo puts it back as it stood
  saveBuilds(); decksShown();
  toast(`Made a deck from ${box}`, "Undo", () => {
    if (prev) deckStandSet(d, prev); else { BUILDS = BUILDS.filter(x => x !== d); if (CUR === d.id) CUR = null; }
    d.updated = Date.now(); saveBuilds(); decksShown();
  });
  return d;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-box-deck], [data-make-deck], [data-pile-box]"); if (!t) return;
  if (t.dataset.boxDeck != null) { openBoxDeck(t.dataset.boxDeck); return; }
  if (t.dataset.pileBox != null) { const d = pileDeck(t.dataset.pileBox); if (d) { closeLocPicker(); openWhichBox(d, "move"); } return; }   // a deck's pile, into a box (0.98.1)
  const loc = t.dataset.makeDeck;
  makeBoxDeck(loc);
  if (LOCPICK && LOCPICK.key === loc && isDeckLoc(loc) && deckLeaders(loc).length && !deckLead(loc).length) openLead(loc); else renderLocPicker();
});
// Leaving New deck for the list: the Workbench is a deck's again the next time it opens.
function leaveNewDeck(yes) { if (yes && buildMode === "new") buildMode = "list"; }
$("#view-yourdecks").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "deck-new") { buildMode = "new"; showView("build"); window.scrollTo({ top: 0 }); }
  else if (t.dataset.openDeck) { if (BUILDS.some(d => d.id === t.dataset.openDeck)) openYourDeck(t.dataset.openDeck); else renderYourDecks(); }
  else if (t.dataset.openBox) openYourDeck(deckBuild(t.dataset.openBox).id);   // the example's deck box: its list, made now if it has none
  else if (t.id === "shared-add" || t.id === "shared-dismiss") buildAction(t);
});

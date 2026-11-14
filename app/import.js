"use strict";
// Bulk Tutor, the page's script, part "import": reading a collection (the apps' CSV files and pasted lists), the collection in memory and in storage, the import screen, collection links.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ collection import
function deckPrefix() { return (store.get("bt.prefix") ?? "Deck").trim(); }
function looksLikeDeck(loc) {
  const p = deckPrefix().toLowerCase();
  return !!p && loc.toLowerCase().startsWith(p);
}

// Reading a collection file is the engine's (readCollection, so the apps' exports are checked without a browser);
// the page adds the person's deck prefix.
const parseCollection = text => readCollection(text, deckPrefix());

// A file taken into the collection (0.88.0: engine planFile, which touches nothing and gives the numbers for the
// question before the tap; its change is then made on the record). Which a file is, is the person's say: "update"
// (the file is the collection now: from an app already imported it is compared with that app's last file, so only
// what changed there comes over and what was done here stays), "add" (more cards with locations of their own),
// "wipe" (exactly the file), and for a file that names no locations "box" (the file is what the location `loc` holds
// now) or "here" (its cards are added here, to `loc`: a location or the put-away list). With no collection of your
// own the file is simply the collection.
const ownHere = () => !!(COLL && !COLL.example && !COLL.fromLink && REC && COLL.entries.length);
// A file's card as one added here: its name as the card data writes it, how many, and the printing if it names one.
const hereCard = e => { const { loc, inDeck, asImported, from, x, ...c } = e; return { ...c, name: canonical(e.name) }; };
// What doImport read, as the engine takes a file.
const asFile = inc => ({ app: inc.source, label: inc.label, at: inc.importedAt, entries: inc.entries, noLoc: !!inc.noLoc, sig: inc.sig });
// The locations you count as decks: a card the app has fewer of is taken from one last.
const deckLocs = () => [...new Set(COLL.entries.filter(e => e.inDeck).map(e => e.loc))];
// Where the new cards of a file that names no locations go when no place is given. **A first file** puts them into
// the location the reader names for them ("Collection"; a pasted list's "Pasted list"), as before, and so does a
// later file onto a collection that keeps no boxes of its own: with one pile there is nothing to ask. Onto a
// collection with boxes they wait on the put-away list (Matt agreed, Nov 13).
function noLocPlace(inc) {
  const own = ownHere();
  if (own && hasBoxes()) return PUT_AWAY;
  const pile = own ? COLL.entries.find(e => NO_BOX.has(e.loc)) : null;
  return pile ? pile.loc : (inc.entries[0] || {}).loc || "Collection";
}
// What a file would do → the engine's plan ({change, source, again, n, lists, boxesNew, boxesGone}), with `to` (the
// place given or worked out for cards with no location, else null) and `back` (the removals a "here" takes back).
// `source: null` compares the file with the collection itself, whatever app it is from.
function planImport(inc, mode, loc = null, source = undefined) {
  const own = ownHere(), rec = own ? REC : recNew(), to = loc != null ? loc : inc.noLoc ? noLocPlace(inc) : null;
  if (own && (mode === "here" || (mode === "add" && inc.noLoc))) {
    const r = planAdd(rec, inc.entries.map(hereCard), to || PUT_AWAY, { by: "file", app: inc.source, label: inc.label, sig: inc.sig }, inc.importedAt);
    return { mode: "here", to: to || PUT_AWAY, change: r.change, source: null, again: false, back: r.back, n: { cards: entryCount(inc.entries), added: r.added, gone: 0, moved: 0, same: 0 }, lists: { added: [], gone: [], moved: [] }, boxesNew: [], boxesGone: [] };
  }
  const opts = { mode: own ? mode : "update", decks: own ? deckLocs() : [] };
  if (to != null) opts.to = to;
  if (source !== undefined) opts.source = source;
  return { ...planFile(rec, asFile(inc), opts), to, back: 0 };
}
// Take the file in: the plan, made on the record (a new record when there was no collection of your own).
// → {plan, did (engine doChange's answer), own (there was a collection before)}.
function takeFile(inc, mode, loc = null) {
  const own = ownHere();
  if (!own) REC = recNew();
  const plan = planImport(inc, mode, loc), did = recDo(plan.change);
  return { plan, did, own };
}

// The example collection (example.js): the big one when the card data knows its cards, else the small one (the demo
// data's 141 cards, or no card data at all).
function exampleCollection() {
  const all = spec => [...exampleEntries(spec.boxes, false), ...exampleEntries(spec.decks, true)];
  const big = all(EXAMPLE), known = DATA ? big.filter(e => cardOf(e.name)).length : 0;
  return { example: true, source: "Example", importedAt: null, entries: known >= big.length * 0.9 ? big : all(EXAMPLE_SMALL) };
}
// A first open shows the welcome and no cards (0.85.0): until someone has a collection of their own or has chosen the
// example (`bt.example`, forgotten again once they have their own), every screen but the import and Settings leads
// back to it (showView). The example is still what COLL holds underneath, so nothing else needs to know. A shared
// build opened with no collection shows that build; the welcome waits for the next open (WELCOME_SKIP).
let WELCOME_SKIP = false;
const needsWelcome = () => !!(COLL && COLL.example) && !WELCOME_SKIP && store.get("bt.example") !== "1";
function chooseExample() { store.set("bt.example", "1"); renderAll(); showView("build"); window.scrollTo({ top: 0 }); }

// ------------------------------------------------------------ render: import
function renderImport() {
  $("#prefix").value = deckPrefix();
  $("#import-back").textContent = needsWelcome() ? "Back" : "Collection";
  const s = $("#import-summary");
  if (COLL && !COLL.example) {
    const when = COLL.importedAt ? new Date(COLL.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    const parts = COLL.parts && COLL.parts.length > 1 ? ` Made of ${COLL.parts.length} imports: ${COLL.parts.map(p => `${p.label} (${p.cards.toLocaleString()})`).join(", ")}.` : "";
    const hand = pendQty(pending().added), gone = pendQty(pending().gone);
    const here = [hand ? `${hand.toLocaleString()} added here` : "", gone ? `${gone.toLocaleString()} removed here` : ""].filter(Boolean).join(", ");
    s.textContent = `${COLL.source || "Your"} import${when ? " from " + when : ""}: ${entryCount(COLL.entries).toLocaleString()} cards${here ? ` (${here})` : ""}.${parts} Import again to update it or add to it.`;
  }
}

let LAST_IMPORT = null;   // reportImport's argument, to redraw the summary after "Choose your decks"
let IMPORT_UNDO = null;   // the last import here, until the next one or a reload: {id (its change), built, also}
// An update's numbers in words: "16 new cards, 3 gone, 40 in a different box, 1 new box" ("" when nothing changed).
function changeWords(d) {
  const boxes = n => `${n} ${n === 1 ? "box" : "boxes"}`;
  return [d.added ? `${d.added.toLocaleString()} new ${d.added === 1 ? "card" : "cards"}` : "", d.gone ? `${d.gone.toLocaleString()} gone` : "", d.moved ? `${d.moved.toLocaleString()} in a different box` : "",
    d.boxesNew.length ? `${boxes(d.boxesNew.length).replace(" ", " new ")}` : "", d.boxesGone.length ? `${boxes(d.boxesGone.length)} no longer there` : ""].filter(Boolean).join(", ");
}
// A file that changes nothing here because it only shows what was done here (cards added, removed or moved here).
const caughtUp = plan => !!(plan.n.absorbed || plan.n.settled || plan.n.shown);
// A plan's numbers as those words and lists read them: what it does to the collection as it is now.
const planDiff = plan => ({ added: plan.n.added || 0, gone: plan.n.gone || 0, moved: plan.n.moved || 0, boxesNew: plan.boxesNew, boxesGone: plan.boxesGone, lists: plan.lists });
// The lists behind those numbers, folded: new cards and gone ones by their box, moved ones by where from and to.
const CHANGE_MAX = 300;
function changeListsHTML(d) {
  if (!d || !(d.added + d.gone + d.moved)) return "";
  const line = (x, where) => `<div class="line"><span class="name">${x.qty > 1 ? `<span class="num">${x.qty}×</span> ` : ""}${esc(x.name)}</span><span class="muted small">${esc(where)}</span></div>`;
  const group = (title, n, rows, where) => !rows.length ? "" : `<div class="loc-head"><h3>${title}</h3><span class="muted small num">${n.toLocaleString()}</span></div><div class="list">${rows.slice(0, CHANGE_MAX).map(x => line(x, where(x))).join("")}</div>${rows.length > CHANGE_MAX ? `<p class="muted small">And ${(rows.length - CHANGE_MAX).toLocaleString()} more.</p>` : ""}`;
  return `<details class="panel" id="import-changes"><summary><h3>What changed</h3><span class="muted small">${esc(changeWords(d))}</span></summary>
    ${group("New", d.added, d.lists.added, x => locName(x.loc))}${group("Gone", d.gone, d.lists.gone, x => locName(x.loc))}${group("In a different box", d.moved, d.lists.moved, x => `${locName(x.from)} → ${locName(x.to)}`)}
    ${d.boxesGone.length ? `<p class="muted small">No longer there: ${d.boxesGone.map(l => esc(locName(l))).join(", ")}.</p>` : ""}</details>`;
}
// After a file is taken in. r = {mode ("replace": there was no collection before), plan, label, source, loc}.
function reportImport(r) {
  LAST_IMPORT = r;
  const { mode, plan, label, loc } = r, n = plan.n;
  let unknown = [];
  if (DATA && !DATA.demo) unknown = [...AGG.entries()].filter(([k]) => !LOOKUP.has(k) && !BASICS.has(k)).map(([, a]) => a.name);
  const cards = entryCount(COLL.entries);
  const decks = new Set(COLL.entries.filter(e => e.inDeck).map(e => e.loc));
  const d = planDiff(plan), now = `${cardsWord(cards)} (${AGG.size.toLocaleString()} unique)`, words = mode === "update" || mode === "box" ? changeWords(d) : "";
  const here = mode === "here" || mode === "box", pile = here && loc === PUT_AWAY, box = here && loc != null ? locName(loc) : "", back = plan.back || 0;
  const lead = mode === "add"
    ? `<strong>Added ${cardsWord(n.cards)}</strong> from ${esc(label)}. Your collection now has ${now}`
    : mode === "here"
      ? `<strong>Added ${cardsWord(n.cards)}</strong> from ${esc(label)} to ${pile ? "your put-away list" : `<strong>${esc(box)}</strong>`}${back ? ` (${back === n.cards ? (back === 1 ? "you had removed it" : "you had removed them") : `${back} of them you had removed`} from there here, so ${back === 1 ? "it is" : "they are"} simply back)` : ""}. Your collection now has ${now}`
    : mode === "box"
      ? (words ? `<strong>Updated ${esc(box)} from ${esc(label)}</strong>: ${words}. Your collection has ${now}` : `<strong>Nothing has changed</strong> in ${esc(box)}: your collection has ${now}`)
    : mode === "update"
      ? (words ? `<strong>Updated from ${esc(label)}</strong>: ${words}. Your collection has ${now}` : caughtUp(plan) ? `<strong>Updated from ${esc(label)}</strong>: it shows what you did here, and nothing else has changed. Your collection has ${now}` : `<strong>Nothing has changed</strong> since your last import: ${now}`)
      : `<strong>Imported ${cardsWord(cards)}</strong> (${AGG.size.toLocaleString()} unique) from ${esc(COLL.source || r.source || label)}`;
  // No decks, but some boxes are about a deck's size: offer to say which before anything is built from their cards.
  const likely = decks.size ? 0 : deckLocations().filter(l => l.likely).length, first = likely || pile ? "" : " primary";
  $("#import-result").innerHTML = `<div class="banner info"><span>${lead}${decks.size ? `, with ${decks.size} deck${decks.size > 1 ? "s" : ""}` : ""}.${unknown.length ? ` ${unknown.length} names weren't recognized.` : ""}${mode === "update" ? movesNote(plan) : ""}${likely ? ` ${likely === 1 ? "One of your locations is" : `${likely} of your locations are`} about the size of a deck. If ${likely === 1 ? "it is one" : "they are decks"}, say so, and ${likely === 1 ? "its" : "their"} cards count as in use.` : ""}</span><span class="actions">${pile ? `<button class="btn primary" data-putaway>Put them away</button>` : ""}${likely ? `<button class="btn primary" data-pick-decks>Choose your decks</button>` : ""}${DATA && hasFlags() && !here ? `<button class="btn${first}" data-what-can>See what you can build</button><button class="btn" data-go="collection">See your collection</button>` : `<button class="btn${first}" data-go="collection">See your collection</button>${here ? "" : `<button class="btn" data-go="build">Workbench</button>`}`}${IMPORT_UNDO ? `<button class="btn" id="import-undo">Undo</button>` : ""}</span></div>
    ${words ? changeListsHTML(d) : ""}
    ${unknown.length ? `<details class="panel"><summary><h3>Unrecognized names (${unknown.length})</h3></summary><p class="muted small">Usually tokens, art cards, or typos. They're kept, but can't be matched or priced.</p><p class="small">${unknown.slice(0, 200).map(esc).join(" · ")}</p></details>` : ""}`;
}

// What became of what was done here, when a file updates an app already imported (the plan's numbers; `will`: said
// before the tap, of the collection as it is, else after it, of the collection as it has become). The moves the file
// shows are done with and the rest are still moved; a card moved here to one place and in the app to another stays
// where it was put here, and the import says how many (Matt agreed, Nov 13); the same for cards added here (the file
// has them now, or not yet) and removed here.
function hereStill(plan, will = false) {
  const p = pending(), n = plan.n;
  return { shown: n.shown || 0, stay: n.stay || 0, handIn: n.absorbed || 0, goneSettled: n.settled || 0,
    kept: Math.max(0, pendQty(p.moves) - (will ? n.shown || 0 : 0)), handKept: Math.max(0, pendQty(p.added) - (will ? n.absorbed || 0 : 0)), goneKept: Math.max(0, pendQty(p.gone) - (will ? n.settled || 0 : 0)) };
}
function movesNote(plan) {
  if (!plan.source) return "";
  const c = hereStill(plan), s = c.shown, k = c.kept, out = [];
  if (s) out.push(`This import shows ${cardsWord(s)} you had moved here${k ? "" : ", so nothing is waiting on ManaBox"}.`);
  if (k) out.push(`${cardsWord(k)} you moved here ${k === 1 ? "isn't" : "aren't"} moved in ManaBox yet, so ${k === 1 ? "it stays" : "they stay"} moved.`);
  return out.concat(stayNote(c), hereNotes(c)).map(x => " " + x).join("");
}
// Moved here to one place, and in the app to another: here wins.
const stayNote = (c, will = false) => (c.stay ? [`${cardsWord(c.stay)} ${will ? "this file has" : "this import has"} in a different box ${c.stay === 1 ? "is" : "are"} somewhere else here already, so ${c.stay === 1 ? "it stays" : "they stay"} where you put ${c.stay === 1 ? "it" : "them"}.`] : []);
// The lines on cards added and removed here (said before an update, and after it).
function hereNotes(c, will = false) {
  const out = [], n = c.handIn || 0, h = c.handKept || 0, g = c.goneSettled || 0, r = c.goneKept || 0;
  if (n) out.push(`${cardsWord(n)} you added here ${n === 1 ? "is" : "are"} in this ${will ? "file" : "import"} now, so ${n === 1 ? "it isn't" : "they aren't"} counted twice.`);
  if (h) out.push(`${cardsWord(h)} you added here ${n ? (h === 1 ? "isn't in it yet and stays" : "aren't in it yet and stay") : (h === 1 ? `isn't in ${will ? "it" : "this import"} yet, so it stays` : `aren't in ${will ? "it" : "this import"} yet, so they stay`)}.`);
  if (g) out.push(`${cardsWord(g)} you removed here ${g === 1 ? "is" : "are"} gone from ${will ? "this file" : "this import"} too.`);
  if (r) out.push(`${cardsWord(r)} you removed here ${r === 1 ? "is" : "are"} still in ${g ? "it" : will ? "this file" : "this import"}, so ${r === 1 ? "it stays" : "they stay"} removed.`);
  return out;
}
let PENDING_IMPORT = null;
const entryCount = entries => entries.reduce((n, e) => n + e.qty, 0);
const cardsWord = n => `${n.toLocaleString()} card${n === 1 ? "" : "s"}`;

function doImport(text, label) {
  if (looksLikeBackup(text)) { restoreBackup(text, label); return; }
  const { entries, source, noLoc } = parseCollection(text);
  if (!entries.length) {
    $("#import-result").innerHTML = `<div class="banner"><span>No cards found in ${esc(label)}. Check that it's a CSV export or a list with one card per line.</span></div>`;
    return;
  }
  const incoming = { entries, source, label, importedAt: new Date().toISOString(), sig: entriesSig(entries), noLoc: !!noLoc };
  if (ownHere()) { if (incoming.noLoc && hasBoxes()) askWhere(incoming); else askImport(incoming); return; }
  applyImport(incoming, "wipe");
}
// Whether the collection keeps its cards in boxes of its own: a card is in one, or one was made here. A collection
// that names none (Moxfield's export, a first pasted list) is one pile, and a file with no boxes is read against it
// as before.
const hasBoxes = () => COLL.entries.some(e => !NO_BOX.has(e.loc) && e.loc !== PUT_AWAY) || MADE.size > 0;

// A file that names no boxes, onto a collection that has them (0.83.0; call 5 of the import that merges, Matt, Nov
// 12): where its cards are is asked. "To put away" comes first (his booster case: the put-away list then shows where
// each goes, by his filing rules when he has them); or a box or binder, an existing one or a new one (the sheet in
// addcards.js). Nothing is filed for the person. The file as the whole collection is still a tap away.
function askWhere(incoming) {
  PENDING_IMPORT = incoming;
  const n = entryCount(incoming.entries), have = new Map(), k = e => norm(e.name);
  for (const e of pending().added) have.set(k(e), (have.get(k(e)) || 0) + e.qty);
  let dup = 0; for (const e of incoming.entries) { const h = have.get(k(e)) || 0, q = Math.min(h, e.qty); dup += q; have.set(k(e), h - q); }
  $("#import-result").innerHTML = `<div class="panel import-choice import-where">
      <p><strong>${cardsWord(n)}</strong> found in ${esc(incoming.label)}, with no boxes named. Where ${n === 1 ? "is it" : "are they"}?</p>
      ${dup ? `<p class="small" id="import-where-dup"><strong>${dup === n ? (n === 1 ? "You have already added this card here" : `You have already added ${n === 2 ? "both" : `all ${n.toLocaleString()}`} of these here`) : `You have already added ${dup.toLocaleString()} of these here`}</strong>, and adding ${dup === 1 ? "it" : "them"} again counts ${dup === 1 ? "it" : "them"} twice.</p>` : ""}
      <div class="import-opt"><button class="btn primary" id="import-pile">To put away</button><p class="muted small" id="import-pile-says">${n === 1 ? "It joins" : "They join"} your put-away list, which shows where each card goes${rulesAny() ? " by your filing rules" : ""}. Nothing is filed until you tick it.</p></div>
      <div class="import-opt"><button class="btn" id="import-box">In a box or binder…</button><p class="muted small" id="import-box-says">Choose one of yours, or name a new one.</p></div>
      <div class="actions" id="import-other"><button class="btn link" id="import-whole">This is your whole collection</button><button class="btn link" id="import-cancel">Cancel</button></div>
    </div>`;
}
// The box is named and already holds some of the file's cards: which the file is, is the person's tap here too
// (call 2). "This is what's in <box> now" makes the file what that box holds (ManaBox's export of one binder has no
// binder column); "Add them" puts them in beside what is there. Each says what it would do, and the likelier one
// is the filled button: an update when the box holds at least half the file's cards.
function askBox(incoming, loc) {
  PENDING_IMPORT = incoming; PENDING_BOX = loc;
  const plan = planImport(incoming, "box", loc), box = esc(locName(loc)), n = plan.n.cards, same = plan.n.same;
  const held = entryCount(COLL.entries.filter(e => e.loc === loc)), words = changeWords(planDiff(plan));
  $("#import-result").innerHTML = `<div class="panel import-choice import-inbox">
      <p><strong>${box}</strong> already holds <strong>${same === n ? (n === 1 ? "this card" : n === 2 ? "both of these cards" : `all ${n.toLocaleString()} of these cards`) : `${same.toLocaleString()} of these ${cardsWord(n)}`}</strong>. Which is this?</p>
      <div class="import-opt"><button class="btn${same * 2 >= n ? " primary" : ""}" id="import-boxupdate">This is what's in ${box} now</button><p class="muted small" id="import-boxupdate-says">${words ? `${box} becomes this file: ${words}.` : `${box} becomes this file: nothing in it has changed.`}</p></div>
      <div class="import-opt"><button class="btn${same * 2 >= n ? "" : " primary"}" id="import-boxadd">Add ${n === 1 ? "it" : "them"} to ${box}</button><p class="muted small" id="import-boxadd-says">These are more cards for it: ${box} would hold ${cardsWord(held + n)}. <strong>${same === n ? (n === 1 ? "It is" : `All ${n.toLocaleString()} are`) : `${same.toLocaleString()} of them ${same === 1 ? "is" : "are"}`} already there and would be counted twice.</strong></p></div>
      <div class="actions" id="import-other"><button class="btn link" id="import-where-back">Somewhere else</button><button class="btn link" id="import-cancel">Cancel</button></div>
    </div>`;
}
// The box picked for a file with no boxes (addcards.js): asked about when it already holds some of these cards,
// otherwise they are added to it. `undo` takes back a box made for this.
let PENDING_BOX = null;
function importInto(loc, undo = null) {
  const incoming = PENDING_IMPORT; if (!incoming) return;
  if (!undo && COLL.entries.some(e => e.loc === loc) && planImport(incoming, "box", loc).n.same) { askBox(incoming, loc); return; }
  applyImport(incoming, "here", loc, undo);
}

// A file onto a collection: which it is, is asked (Matt, Nov 12: "I'd rather add a single click than get it all
// wrong"), with what each answer would do in numbers so the answer is easy. The likelier answer is the filled
// button: an update when at least half the file's cards are unchanged and it would take away no more than a tenth
// of the collection, an add when under half of them are here. "Replace everything" is offered when it would differ
// from an update: the file's app was imported before, and there are moves made here, cards from other files, or
// cards added or removed here to forget.
function askImport(incoming) {
  PENDING_IMPORT = incoming;
  const up = planImport(incoming, "update"), n = up.n.cards, d = planDiff(up), src = up.source ? REC.sources.find(s => s.id === up.source) : null;
  const have = entryCount(COLL.entries), p = pending(), moved = src ? pendQty(p.moves) : 0, hand = src ? pendQty(p.added) : 0, gone = src ? pendQty(p.gone) : 0;
  const extra = src ? COLL.parts.filter(x => x !== COLL.parts[REC.sources.indexOf(src)]).reduce((t, x) => t + x.cards, 0) : 0;
  const dup = src ? planImport(incoming, "update", null, null).n.same : up.n.same;   // the file's cards that are here already, in the same place
  const still = src ? hereStill(up, true) : null, notes = still ? [...stayNote(still, true), ...hereNotes(still, true)] : [], words = changeWords(d);
  const again = fileSeen(REC, incoming.sig);
  const big = d.gone * 10 > up.n.had, the = k => (k === 1 ? "The card" : `The ${k.toLocaleString()} cards`);
  const likeUpdate = !big && up.n.same * 2 >= n, likeAdd = !likeUpdate && dup * 2 < n && !again;
  const day = s => (s.at ? ` on ${new Date(s.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "");
  const upText = (words ? `This file is your collection now: ${words}.` : caughtUp(up) ? `This file is your collection now: it shows what you did here, and nothing else has changed.` : `This file is your collection now: nothing has changed since your last import.`)
    + (big ? ` <strong>That takes ${d.gone.toLocaleString()} of your ${cardsWord(have)} out of your collection.</strong>` : "")
    + (still && still.kept ? ` ${the(still.kept)} you have moved here ${still.kept === 1 ? "stays" : "stay"} moved until the export shows ${still.kept === 1 ? "it" : "them"}.` : "")
    + (extra ? ` ${the(extra)} you added from other files ${extra === 1 ? "stays" : "stay"}.` : "")
    + (notes.length ? " " + notes.join(" ") : "");
  const addText = `These are more cards, like one binder or cards tracked in another app: you would have ${cardsWord(have + n)}.`
    + (again ? ` <strong>You ${again.added ? "added" : "imported"} this same file${day(again)}.</strong>` : "")
    + (dup ? ` <strong>${dup === n ? (n === 1 ? "It is" : `All ${n.toLocaleString()} are`) : `${dup.toLocaleString()} of them are`} already here${incoming.noLoc ? "" : ` in the same ${dup === 1 ? "box" : "boxes"}`} and would be counted twice.</strong>` : "");
  $("#import-result").innerHTML = `<div class="panel import-choice" data-moved="${moved}" data-extra="${extra}" data-hand="${hand}" data-gone="${gone}">
      <p><strong>${cardsWord(n)}</strong> found in ${esc(incoming.label)}. You have <strong>${cardsWord(have)}</strong>${COLL.source ? ` from ${esc(COLL.source)}` : ""}. Which is this?</p>
      <div class="import-opt"><button class="btn${likeUpdate ? " primary" : ""}" id="import-update">Update your collection</button><p class="muted small" id="import-update-says">${upText}</p></div>
      <div class="import-opt"><button class="btn${likeAdd ? " primary" : ""}" id="import-add">Add these cards</button><p class="muted small" id="import-add-says">${addText}</p></div>
      <div class="actions" id="import-other">${moved || extra || hand || gone ? `<button class="btn link" id="import-wipe">Replace everything</button>` : ""}<button class="btn link" id="import-cancel">Cancel</button></div>
    </div>`;
}
// "Replace everything" confirms in place, saying what it forgets.
function askWipe(on) {
  const box = $("#import-result .import-choice"), row = $("#import-other");
  if (!box || !row || !PENDING_IMPORT) return;
  const moved = +box.dataset.moved || 0, extra = +box.dataset.extra || 0, hand = +box.dataset.hand || 0, gone = +box.dataset.gone || 0, the = k => (k === 1 ? "The card" : `The ${k.toLocaleString()} cards`);
  row.innerHTML = !on ? `<button class="btn link" id="import-wipe">Replace everything</button><button class="btn link" id="import-cancel">Cancel</button>`
    : `<span>Replace everything? Your collection becomes exactly this file.${moved ? ` ${the(moved)} you moved here ${moved === 1 ? "goes" : "go"} back to where the file has ${moved === 1 ? "it" : "them"}.` : ""}${extra ? ` ${the(extra)} you added from other files ${extra === 1 ? "is" : "are"} removed.` : ""}${hand ? ` ${the(hand)} you added here ${hand === 1 ? "is" : "are"} removed.` : ""}${gone ? ` ${the(gone)} you removed here ${gone === 1 ? "comes" : "come"} back if the file has ${gone === 1 ? "it" : "them"}.` : ""}</span><button class="btn danger" id="import-wipe-yes">Replace everything</button><button class="btn" id="import-wipe-no">Keep it</button>`;
}

function applyImport(incoming, mode, loc = null, alsoUndo = null) {
  PENDING_IMPORT = null; PENDING_BOX = null;
  const built = BUILDS.filter(b => b.builtLoc).map(b => [b.id, b.builtLoc, b.built]);
  const t = takeFile(incoming, mode, loc);
  IMPORT_UNDO = t.own && t.did.change ? { id: t.did.change.id, built, also: alsoUndo } : null;
  checkBuiltLocs();
  reportImport({ mode: t.own ? t.plan.mode : "replace", plan: t.plan, label: incoming.label, source: incoming.source, loc: t.own ? t.plan.to : null });
  recSaved().then(ok => { if (!ok && $("#import-result .banner.info")) $("#import-result").innerHTML = `<div class="banner"><span>Imported, but this browser won't let the page save it. Use “Copy collection link” below so you don't have to import again.</span></div>`; });
}
// Undo of the last import here: its change undone (the app's last file is what it was again, so the same file would
// bring the same changes), and the builds that import turned back into drafts (their box had emptied) are built again.
function undoImport() {
  const u = IMPORT_UNDO; if (!u) return;
  IMPORT_UNDO = null; LAST_IMPORT = null;
  if (u.also) u.also();   // a box made for the file's cards
  const r = recUndo(u.id), stay = r ? pendQty(r.skipped) : 0;
  let changed = false;
  for (const [id, loc, at] of u.built) { const b = BUILDS.find(x => x.id === id); if (b && !b.builtLoc && locHasCards(loc)) { b.builtLoc = loc; b.built = at; b.updated = Date.now(); changed = true; } }
  if (changed) { saveBuilds(); renderAll(); }
  $("#import-result").innerHTML = `<div class="banner info"><span>Your collection is back as it was before that import: ${cardsWord(entryCount(COLL.entries))}.${stay ? ` ${cardsWord(stay)} that ${stay === 1 ? "has" : "have"} moved since ${stay === 1 ? "stays where it is" : "stay where they are"}.` : ""}</span><span class="actions"><button class="btn" data-go="collection">See your collection</button></span></div>`;
}

// ------------------------------------------------------------ collection link
const b64url = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64url = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };

async function packCollection(c) {
  const text = c.entries.map(e => [e.qty, e.name, e.loc, e.inDeck ? 1 : 0].join("\t")).join("\n");
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(await new Response(stream).arrayBuffer());
}
async function unpackCollection(s) {
  const stream = new Blob([unb64url(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(stream).text();
  const entries = text.split("\n").filter(Boolean).map(l => { const [q, name, loc, d] = l.split("\t"); return { name, qty: +q || 1, loc: loc || "Collection", inDeck: d === "1" }; });
  return { entries, source: "Collection link", importedAt: new Date().toISOString(), fromLink: true };
}

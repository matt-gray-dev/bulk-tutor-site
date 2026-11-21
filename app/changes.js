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
//   own; a deck taken apart is a hundred of them). So are the cards ticked in Assemble for one deck (0.98.0:
//   builds.js, gathering): "Gathered 34 cards for Queen Marchesa", and the ones taken out of it another row.
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
// **Changes that reached this device by a sync** (0.93.0; the record itself says no "who"): their ids, kept on this
// device only ("bt.came"), so a row can say "On another device" (Matt agreed to the pictures, Nov 14). `fresh`
// counts the rows that came since Recent changes was last opened, and `at` is when the other side last changed:
// the Collection's row says so until the list is opened. **Which device** (0.94.0; Matt, Nov 15): a change says
// the device it was made on, as it was called then (engine `dev`), so the row says "On iPhone, Safari"; a change
// from before 0.94.0 has no name and stays "another device". `from` is the one name the fresh rows share, if they do.
let CAME = { ids: new Set(), fresh: 0, at: 0, from: "" };
function loadCame() { try { const c = JSON.parse(store.get("bt.came") || "null"); if (c && Array.isArray(c.ids)) CAME = { ids: new Set(c.ids), fresh: +c.fresh || 0, at: +c.at || 0, from: deviceClean(c.from) }; } catch {} }
// "on iPhone, Safari", or "on another device" for a change that names none.
const onDev = (c, cap = false) => `${cap ? "On" : "on"} ${changeDev(c) || "another device"}`;
// The one device a list of changes was made on → its name, or "" (several, or one that names none).
const oneDev = list => { const names = new Set((list || []).map(changeDev)); return names.size === 1 ? [...names][0] : ""; };
function saveCame() {
  const known = new Set(REC ? REC.changes.map(c => c.id) : []);
  for (const id of CAME.ids) if (!known.has(id)) CAME.ids.delete(id);   // forgotten with their changes
  store.set("bt.came", JSON.stringify({ ids: [...CAME.ids], fresh: CAME.fresh, at: CAME.at, from: CAME.from }));
}
// A sync brought these changes (`at`: when the other side last changed). With none, or a collection taken whole,
// nothing here is new "from another device". **But a collection taken from Dropbox (`whole === "dropbox"`) keeps which
// device made each change** (0.101.3; Matt, Nov 19: his computer's first connect listed the phone's import "as from
// ManaBox, which is the file I used but obviously doesn't signal the device I used"): a change that names a device
// other than this one is marked, so its row says "On iPhone, Home Screen app", with no notice (`fresh` stays 0). One
// that names none (before 0.94.0) or this device's own name stays unmarked; a restored backup (`true`) marks none.
function cameBy(list, at = 0, whole = false) {
  const other = c => { const d = changeDev(c); return !!d && d !== deviceName(); };
  if (whole) CAME = { ids: new Set(whole === "dropbox" && REC ? REC.changes.filter(other).map(c => c.id) : []), fresh: 0, at: 0, from: "" };
  else if (list.length) {
    const ids = new Set(list.map(c => c.id)), from = oneDev(list);
    CAME.from = CAME.fresh && CAME.from !== from ? "" : from;   // rows still unseen from somewhere else: no one name
    for (const id of ids) CAME.ids.add(id);
    CAME.fresh += changeRows().filter(r => r.changes.some(c => ids.has(c.id))).length;   // as rows: ticks together, silent marks not at all
    CAME.at = at || CAME.at;
  }
  saveCame();
  if (view === "collection") renderCollection();   // its Recent changes row was drawn as the record was taken, before this was known (0.94.0)
}
// A change the other side's version of the same cards kept from being made (engine makeAgain: a mark, `how.by:
// "left"`), where something was lost by it: the copies had been changed elsewhere (`moved`), or a later import
// became the collection (`import`). The same file taken on both devices, an Undo of what already stands undone and
// a second conversion lose nothing and say nothing (notes/decisions.md, Nov 14).
const LEFT_SAID = new Set(["moved", "import"]);
const isLeft = c => c.how.by === "left";
const leftSaid = c => isLeft(c) && LEFT_SAID.has(c.how.why);

// Made on the same device, as far as the list can say: ticks on two devices are two rows.
const sameSide = (a, b) => CAME.ids.has(a.id) === CAME.ids.has(b.id) && changeDev(a) === changeDev(b);
// The run a tick belongs to: cards ticked off the put-away list, or ticked in Assemble into one deck or out of it
// ("" = not a tick: a row of its own).
const GATHER_ACTS = new Set(["gathered", "takenout"]);
const isGather = how => how.by === "deck" && GATHER_ACTS.has(how.act);
const tickOf = how => (how.by === "hand" && how.act === "filed" ? "filed" : isGather(how) ? `${how.act}\n${how.deck || ""}` : "");
// → [{id, changes: [oldest first], at (ms, its latest), tick (the run it is: tickOf), undone}], newest first.
function changeRows() {
  if (!REC || !ownColl()) return [];
  const undone = undoneChanges(REC), ids = new Set(REC.changes.map(c => c.id)), rows = [];
  for (const c of REC.changes) {
    if (c.how.by === "undo" && ids.has(c.how.of)) continue;   // said on the change it took back
    if (isLeft(c)) { if (leftSaid(c)) rows.push({ id: c.id, changes: [c], at: Date.parse(c.at) || 0, tick: "", undone: false, left: true }); continue; }
    const at = Date.parse(c.at) || 0, off = undone.has(c.id), tick = tickOf(c.how), last = rows[rows.length - 1];
    if (tick && last && last.tick === tick && last.undone === off && at - last.at <= CH_RUN_GAP && sameSide(last.changes[0], c)) { last.changes.push(c); last.at = at; continue; }
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
  if (how.by === "restore") return { title: "Restored a backup", sub: `${cardsWord(how.cards || 0)}, as they were in it` };
  if (how.by === "file") return { title: `Imported ${how.label || how.app || "a file"}`, sub: parts || "Nothing changed here" };
  if (how.by === "deck" && how.act === "gathered") return { title: `Gathered ${what} for ${how.label || "a deck"}`, sub: `Into ${chPlaces(tos)}` };
  if (how.by === "deck" && how.act === "takenout") return { title: `Took ${what} out of ${how.label || "a deck"}`, sub: tos.every(t => t === PILE) ? "To put away" : `Into ${chPlaces(tos)}` };
  if (how.by === "deck" && how.act === "boxed") return { title: `Put ${how.label || "a deck"} in a box`, sub: `Into ${chPlaces(tos)}` };   // out of its pile (0.98.1)
  // (A built deck you bring, 0.101.0: its change also adds the copies no box could give, and says how many.)
  if (how.by === "deck") return how.act === "apart" ? { title: `Took ${how.label || "a deck"} apart`, sub: `${cardsWord(n)} to put away` } : { title: `Built ${how.label || "a deck"}`, sub: added ? parts : `${cardsWord(n)} moved` };
  if (how.by === "rules") return { title: `Your filing rules put away ${cardsWord(n)}`, sub: `In ${chPlaces(tos)}` };
  if (how.by === "undo") return { title: "Took back an earlier change", sub: parts };
  if (how.act === "filed") return { title: `Put away ${what}`, sub: `In ${chPlaces(tos)}` };
  if (how.act === "added") return { title: `Added ${what}`, sub: `To ${chPlaces(tos)}` };
  if (how.act === "removed") return { title: `Removed ${what}`, sub: `From ${chPlaces(froms)}` };
  if (how.act === "moved") return { title: `Moved ${what}`, sub: `To ${chPlaces(tos)}` };
  if (how.act === "back") return added ? { title: `Put ${what} back`, sub: `In ${chPlaces(tos)}` } : { title: `Took ${what} back out`, sub: `Of ${chPlaces(froms)}` };
  return { title: `Moved ${what}`, sub: parts };
}
const chDay = ms => { const d = new Date(ms).toDateString(), now = Date.now(); return d === new Date(now).toDateString() ? "Today" : d === new Date(now - 864e5).toDateString() ? "Yesterday" : shortDate(ms); };
const chTime = ms => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const canUndoRow = row => !["convert", "restore", "left"].includes(row.changes[0].how.by);
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
    if (g.lines.length > CH_NAMES) return `<div class="ch-group ch-group-big">${count(g)}<span class="fold-mark" aria-hidden="true"></span></div>`;
    const key = `${row.id}|${i}`, open = CHANGES.groups.has(key);
    return `<button class="ch-group" data-ch-group="${esc(key)}" aria-expanded="${open}">${count(g)}<span class="fold-mark" aria-hidden="true"></span></button>${open ? list(g) : ""}`;
  }).join("") + (groups.some(g => g.lines.length > CH_NAMES) ? `<p class="muted small ch-cap">A place with more than ${CH_NAMES} different cards shows only its count here.</p>` : "");
}
// ---- What wasn't made (0.93.0). Matt, Nov 14, on the pictures: a row where it happened is "the clearest concept",
// and "can we just say where the latest change has them located so the user can decide which is right?" So the row
// says what the change was, on which device, that the other device's change of the same cards is the one kept,
// and where those cards went instead (the engine keeps it with the mark: `not`, each line with `went`); and a
// button makes the change after all, from where the cards are (his "A2").
// A mark as the change it was, for the words every other row uses.
const leftAs = c => ({ changes: [{ how: { by: c.how.was, ...(c.how.act ? { act: c.how.act } : c.how.was === "hand" ? { act: "moved" } : {}), ...(c.how.label ? { label: c.how.label } : {}) }, lines: c.not || [] }] });
// "moved 4 cards to Binder", "removed Sol Ring from Box 1": a row's two lines as one phrase.
const rowPhrase = w => lower1(w.title) + (/^(To|In|From|Of) /.test(w.sub) ? " " + lower1(w.sub) : "");
const lower1 = t => t.charAt(0).toLowerCase() + t.slice(1);
// The cards that weren't moved, by where they went instead: [{head, lines, qty}].
function notGroups(not) {
  const groups = new Map();
  const head = l => (!("went" in l) ? `No longer in ${chPlace(l.from)}` : l.went == null ? "Removed instead" : `Went to ${chPlace(l.went)} instead`);
  for (const l of not || []) {
    const h = head(l); if (!groups.has(h)) groups.set(h, { head: h, lines: new Map(), qty: 0 });
    const g = groups.get(h), k = norm(l.name), have = g.lines.get(k);
    if (have) have.qty += l.qty; else g.lines.set(k, { name: l.name.split(" // ")[0], qty: l.qty });
    g.qty += l.qty;
  }
  return [...groups.values()].map(g => ({ ...g, lines: [...g.lines.values()].sort((x, y) => x.name.localeCompare(y.name)) }));
}
// The device whose change of the same cards is the one kept, when every line that says where the cards went names
// the same one (engine makeAgain: `by`) → its name, or "".
function notBy(not) {
  const said = (not || []).filter(l => "went" in l), names = new Set(said.map(l => deviceClean(l.by)));
  return said.length && names.size === 1 ? [...names][0] : "";
}
const notGroupsHTML = not => notGroups(not).map(g => `<div class="loc-head"><h3>${esc(g.head)}</h3><span class="muted small num">${g.qty.toLocaleString()}</span></div><div class="list">${g.lines.map(moveLine).join("")}</div>`).join("");
// The change made after all: each card from where the change that stands sent it to where this one wanted it, as
// far as the copies are still there. → the list for handChange (locations by name), and the place when it is one.
function leftAfterAll(c) {
  const name = id => (id === PILE ? PUT_AWAY : recLocName(REC, id)), have = new Map(), list = [];
  for (const l of REC.lines.values()) have.set(kpOf(l.k, l) + "\n" + l.loc, l.qty);
  for (const l of c.not || []) {
    if (l.went == null || l.to === l.went || (l.to != null && !name(l.to))) continue;
    const key = kpOf(norm(l.name), l) + "\n" + l.went, q = Math.min(l.qty, have.get(key) || 0); if (!q) continue;
    have.set(key, have.get(key) - q);
    const { went, by, from, to, ...card } = l;
    list.push({ ...card, qty: q, from: name(went), to: to == null ? null : name(to) });
  }
  const tos = [...new Set((c.not || []).map(l => l.to))];
  return { list, n: list.reduce((t, x) => t + x.qty, 0), to: tos.length === 1 ? tos[0] : undefined };
}
function leftRowHTML(row) {
  const c = row.changes[0], open = CHANGES.open.has(row.id), id = esc(row.id), other = CAME.ids.has(c.id), was = rowWords(leftAs(c));
  const what = c.how.why === "import" ? `imported ${c.how.label || "a file"}` : lower1(was.title);
  // Whose change stands: this device's when the one not made came from elsewhere; else the device the kept change
  // names (for an import, the latest one that came here), or "another device".
  const imp = !other && c.how.why === "import" ? REC.changes.slice().reverse().find(x => !isLeft(x) && srcImport(x) && CAME.ids.has(x.id)) : null;
  const who = other ? "" : c.how.why === "import" ? changeDev(imp) : notBy(c.not);
  const sub = c.how.why === "import" ? `A later import ${other ? "here" : `on ${who || "another device"}`} is your collection now` : other ? "This device's change is the one kept" : who ? `The change on ${who} is the one kept` : "Another device's change is the one kept";
  let body = "";
  if (open && c.how.why === "import") body = `<p class="small ch-why">${other ? esc(changeDev(c) || "Another device") : "This device"} imported ${esc(c.how.label || "a file")} on ${esc(whenWords(row.at))}, and ${other ? "this device" : esc(who || "another device")} took a later import, which is your collection now. Import that file again to bring in what it changed.</p>`;
  else if (open) {
    const after = leftAfterAll(c), it = after.n === 1 ? "it" : "them";
    const label = after.to === undefined ? "Make this change after all" : after.to == null ? `Remove ${it} after all` : `Move ${it} to ${chPlace(after.to)}`;
    body = `<p class="small ch-why">${esc(whenWords(row.at))} ${other ? esc(onDev(c)) : "on this device"}: ${esc(rowPhrase(was))}. ${other ? "This device" : esc(who || "Another device")} changed the same cards, and ${other ? "this device's" : "its"} change is the one kept.</p>
      ${notGroupsHTML(c.not)}
      ${after.n ? `<div class="actions ch-left-act"><button class="btn" data-ch-after="${id}">${esc(label)}</button></div>` : ""}`;
  }
  return `<div class="ch-item left" data-ch-left="${id}"><div class="ch-row">
      <button class="ch-main" data-ch-open="${id}" aria-expanded="${open}"><span class="pa-text"><strong><span class="ch-not">Not made:</span> ${esc(what)}</strong><small>${esc(sub)} · ${esc(chTime(row.at))}</small></span><span class="fold-mark" aria-hidden="true"></span></button></div>
    ${open ? `<div class="ch-cards">${body}</div>` : ""}</div>`;
}
function afterAll(id) {
  const c = REC && REC.changes.find(x => x.id === id && isLeft(x)); if (!c) return;
  const after = leftAfterAll(c); if (!after.n) { toast("Nothing to move: those cards have moved since"); renderChanges(); return; }
  const did = recDo(handChange(REC, after.list, { by: "hand", act: after.to === null ? "removed" : "moved" }).change), n = pendQty(did.made);
  toast(after.to === null ? `Removed ${cardsWord(n)}` : `Moved ${cardsWord(n)}${after.to !== undefined ? ` to ${chPlace(after.to)}` : ""}`, "Undo", () => { recUndo(did.change && did.change.id); }, 9000);
}
function changeRowHTML(row) {
  if (row.left) return leftRowHTML(row);
  const w = rowWords(row), open = CHANGES.open.has(row.id), id = esc(row.id);
  const not = row.changes.flatMap(c => c.not || []), left = row.changes.reduce((n, c) => n + (c.how.left || 0), 0);
  const came = row.changes.some(c => CAME.ids.has(c.id));
  return `<div class="ch-item${row.undone ? " undone" : ""}"><div class="ch-row">
      <button class="ch-main" data-ch-open="${id}" aria-expanded="${open}"><span class="pa-text"><strong>${esc(w.title)}</strong><small>${row.undone ? "Undone · " : ""}${esc(w.sub)}${left ? ` · ${left.toLocaleString()} not made` : ""} · ${esc(chTime(row.at))}</small>${came ? `<small class="ch-dev">${esc(onDev(row.changes.find(c => CAME.ids.has(c.id)), true))}</small>` : ""}</span><span class="fold-mark" aria-hidden="true"></span></button>
      ${!canUndoRow(row) ? "" : row.undone ? `<button class="btn pa-else" data-ch-redo="${id}" aria-label="Redo: ${esc(w.title)}">Redo</button>` : `<button class="btn pa-else" data-ch-undo="${id}" aria-label="Undo: ${esc(w.title)}">Undo</button>`}</div>
    ${open ? `<div class="ch-cards">${rowCardsHTML(row)}${not.length ? `<p class="small ch-why ch-part">${left === 1 ? "1 card wasn't" : `${left.toLocaleString()} cards weren't`} moved: ${came ? "this device" : esc(notBy(not) || "another device")} changed ${left === 1 ? "it" : "them"} too, and ${came ? "this device's" : "its"} change is the one kept.</p>${notGroupsHTML(not)}` : ""}</div>` : ""}</div>`;
}
function openChanges() { CHANGES = newChanges(); if (CAME.fresh) { CAME.fresh = 0; CAME.from = ""; saveCame(); } showView("changes"); window.scrollTo({ top: 0 }); }
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
// **A deck built or taken apart** says which deck it was (`how.deck`), which box (`how.box`) and how the deck stood
// before (`how.was`: engine deckStand since 0.95.0, {built, builtLoc} before; standOf reads both), so a row undone
// from this list gives the deck back as it was, and done again puts it where the change had it. (The message right
// after the action also puts back its tokens and the lists copied for it.) Called before the collection is drawn
// again, since which locations are decks is read from the decks then.
function deckFollows(how, back) {
  if (how.by !== "deck" || !how.box) return;
  const b = BUILDS.find(x => x.id === how.deck), box = how.box; if (!b) return;
  // **A card gathered or taken out by a tick** (0.98.0): the deck follows only the tick that gave it its place.
  // Taken back with no other tick of this deck standing there, a deck still Building stands as it did before its
  // first tick (and the deck an overhaul took the box from has it again); made again, a deck with no place is
  // gathered there once more. A deck marked built since stays where it is.
  if (isGather(how)) {
    const id = locIdOf(box) || [...REC.locs.values()].filter(l => l.name === box).map(l => l.id)[0] || null; if (!id) return;
    if (back) {
      if (b.loc !== id || deckStatus(b) !== "building") return;
      const undone = undoneChanges(REC), mine = REC.changes.filter(c => isGather(c.how) && c.how.deck === b.id && c.how.box === box);
      if (mine.some(c => !undone.has(c.id))) return;
      const first = mine.find(c => standOf(c.how.was).loc !== id); if (!first) return;
      deckStandSet(b, standOf(first.how.was));
      const took = first.how.took, p = took && BUILDS.find(x => x.id === took.deck);
      if (p && !p.loc && !BUILDS.some(x => x !== p && x.loc === id && deckHolds(x))) {
        deckStandSet(p, standOf(took.was)); delete p.apartAt;
        if (p.source && p.source.kind === "kept" && p.source.was) p.source = p.source.was;
        p.updated = Date.now();
      }
    } else {
      if (b.loc || deckStatus(b) === "built") return;
      for (const x of BUILDS) if (x !== b && x.loc === id && deckHolds(x)) { deckLeave(x); if (x.source && x.source.kind === "owned") x.source = { kind: "kept", was: x.source }; x.updated = Date.now(); }
      deckStandSet(b, { status: "building", loc: id });
    }
    b.updated = Date.now(); saveBuilds();
    return;
  }
  if (how.act === "apart") {
    if (back) { if (!b.loc && b.source && b.source.kind === "kept" && b.source.was && b.source.was.loc === box) b.source = b.source.was; }
    else if (b.source && b.source.kind === "owned") b.source = { kind: "kept", was: b.source };
  }
  if (back) deckStandSet(b, standOf(how.was));
  else if (how.act === "apart") deckLeave(b);
  else {
    // Made again: built in that box, or (a pile put in a box, 0.98.1) in that box at the status it had.
    const id = locIdOf(box) || [...REC.locs.values()].filter(l => l.name === box).map(l => l.id)[0] || null;
    deckStandSet(b, how.act === "boxed" ? { ...standOf(how.was), loc: id } : { status: "built", loc: id, built: new Date().toISOString() });
  }
  // Another deck that points at the same box gives way: the row's deck is the one this change is about.
  if (b.loc) for (const x of BUILDS) if (x !== b && x.loc === b.loc && deckHolds(x)) { deckLeave(x); x.updated = Date.now(); }
  if (how.act !== "boxed") b.pulled = {};   // a pile moved keeps the ticks that are only ticks
  b.updated = Date.now(); saveBuilds();
}
// Take a row back: its changes undone, the latest first, as one redraw. The message names the cards that have
// moved on since and stay where they are.
function undoRow(id) {
  const row = changeRows().find(r => r.id === id); if (!row || row.undone || !canUndoRow(row)) return;
  const w = rowWords(row), stay = []; let made = 0;
  for (const c of row.changes.slice().reverse()) { const r = undoChange(REC, c.id); if (r) { made += r.made.length; stay.push(...r.skipped); if (r.made.length) deckFollows(c.how, true); } }
  if (!made) { toast(`Nothing to undo: ${stay.length === 1 && stay[0].qty === 1 ? "that card has" : "those cards have"} moved since`); return; }
  recChanged();
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
  recChanged();
  toast(`Done again: ${rowWords(row).title}`, "Undo", () => undoRow(id), 9000);
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-changes], [data-ch-open], [data-ch-group], [data-ch-undo], [data-ch-redo], [data-ch-more], [data-ch-after]"); if (!t) return;
  const d = t.dataset, again = sel => { const b = $(sel); if (b) b.focus({ preventScroll: true }); };
  if (d.changes != null) { openChanges(); return; }
  if (d.chMore != null) { CHANGES.shown += CH_PAGE; renderChanges(); return; }
  if (d.chAfter != null) { afterAll(d.chAfter); return; }
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
  const r = rows[0], day = chDay(r.at), when = ms => { const d = chDay(ms); return d === "Today" ? chTime(ms) : d; };
  const says = CAME.fresh ? `<small class="ch-dev" id="coll-came">${CAME.fresh.toLocaleString()} new from ${esc(CAME.from || "another device")}${CAME.at ? ` · ${esc(when(CAME.at))}` : ""}</small>` : `<small>${esc(r.left ? `Not made: ${lower1(rowWords(leftAs(r.changes[0])).title)}` : rowWords(r).title)} · ${esc(when(r.at))}</small>`;
  return `<div class="panel pa-lead" id="coll-changes"><div class="loc-row">${neutralIconHTML("list")}<button class="loc-main" data-changes><span class="loc-text"><strong>Recent changes</strong>${says}</span><span class="chev" aria-hidden="true">${MARK.go}</span></button></div></div>`;
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

"use strict";
// Bulk Tutor's engine: the card data model and the deck logic (matching your collection, roles,
// substitutes, your taste, the generator, tuning, deck numbers, templates, the deck check). No DOM,
// no storage, no network. index.html loads it first, as a plain script, and shares its top-level
// state (DATA, LOOKUP, COLL, AGG, PREFS, TEMPLATES, COMBOS, BUILDS); the page fills that state and
// draws the screens. tests/test_engine.py runs it under Node against demo data and, once the fetcher
// has written it, a sample of real Scryfall data (tests/fixtures/real-sample.json).

// The card table: DATA plus a name index. Call setData when new card data arrives.
let COMBOS = null;        // Commander Spellbook combos (combos.json), loaded on demand by the page
let BUILDS = [];          // the person's builds (the page loads and saves them)
// The names you gave boxes and binders here (0.55.0): location (as the import names it) → the name to show. The
// collection's entries always keep the import's name, so imports, deck marks and moves match; the page fills this.
let LOCNAMES = new Map();
const locName = loc => LOCNAMES.get(loc) || loc;
// Boxes and binders made here (0.72.0; Matt, Nov 12: "In general we should allow users to create empty boxes/binders
// in their collection"): locations that are part of the collection whether or not a card is in them, so an empty one
// can be listed, chosen for a card being put away and named by a filing rule. The page fills this from what it keeps
// (LOCSTYLE.locs[loc].made).
let MADE = new Set();
function setMadeLocs(list) {
  const next = new Set((list || []).filter(l => typeof l === "string" && l));
  if (next.size !== MADE.size || [...next].some(l => !MADE.has(l))) { MADE = next; CHANGE++; }
}
function setData(d) {
  DATA = d;
  KEY = d ? d.cards.map(c => norm(c[0])) : [];
  LOOKUP = new Map(KEY.map((k, i) => [k, i]));
}

const COLORS = ["W", "U", "B", "R", "G"];
const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", M: "Multicolor", C: "Colorless" };
const BASICS = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes", "snow-covered plains", "snow-covered island", "snow-covered swamp", "snow-covered mountain", "snow-covered forest", "snow-covered wastes"]);

const norm = s => String(s).split(" // ")[0].normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").trim().toLowerCase();
// ------------------------------------------------------------ state
// Bumped whenever something a remembered result depends on changes (collection, card preferences,
// templates), so cached plans and ideas never outlive it.
let CHANGE = 0;
let DATA = null;          // { version, demo, cards: [[name, colors, type, price]], decks: [...] }
let KEY = [];             // DATA.cards index -> normalized name
let LOOKUP = new Map();   // normalized name -> DATA.cards index
let COLL = null;          // { entries: [{name, qty, loc, inDeck, sid?, set?, cn?, foil?, rar?, cond?, lang?, from? (a copy waiting to be put away: where it goes back to)}], source, importedAt, example, parts? }: what the screens read; your own is made from the record (recEntries)
let AGG = new Map();      // normalized name -> { name, qty, free, locs: Map(loc -> {qty, inDeck}) }
const cardOf = name => { const i = LOOKUP.get(norm(name)); return i == null ? null : DATA.cards[i]; };
function aggregate() {
  AGG = new Map();
  if (!COLL) return;
  for (const e of COLL.entries) {
    const k = norm(e.name);
    let a = AGG.get(k);
    if (!a) { a = { name: e.name.split(" // ")[0], qty: 0, free: 0, locs: new Map() }; AGG.set(k, a); }
    a.qty += e.qty;
    if (!a.sid && e.sid) a.sid = e.sid;
    const inDeck = e.inDeck || swapsBase(e.loc) != null;    // a hot-swap's Swaps location holds cards in use
    if (!inDeck) a.free += e.qty;
    const l = a.locs.get(e.loc) || { qty: 0, inDeck };
    l.qty += e.qty;
    a.locs.set(e.loc, l);
  }
}

// Which locations are decks (0.47.0). The import has a say (ManaBox's deck binders, a name starting with the prefix) and
// so do you: marks = {loc: {deck: true|false, at}} (the page's LOCSTYLE.decks, kept apart from the collection because a
// re-import replaces its entries). applyDeckMarks writes the answer into each entry's inDeck, which everything else
// reads; an entry whose mark overrides the import keeps the import's word in asImported, so a mark can be taken back.
const importedDeck = e => e.asImported ?? !!e.inDeck;
const markOf = (marks, loc) => { const m = marks && Object.hasOwn(marks, loc) ? marks[loc] : null; return m && typeof m.deck === "boolean" ? m.deck : null; };
function applyDeckMarks(entries, marks) {
  let changed = 0;
  for (const e of entries) {
    const was = importedDeck(e), mark = markOf(marks, e.loc), want = mark == null ? was : mark;
    if (!!e.inDeck !== want) changed++;
    e.inDeck = want;
    if (want !== was) e.asImported = was; else delete e.asImported;
  }
  return changed;
}
// Every location for the "Choose your decks" list: {loc, qty, deck, imported, swaps (its deck, for a hot-swap's Swaps
// location, which is never a deck itself), likely}. `likely` = not a deck yet but about a deck's size (DECK_SIZE, wide
// enough for a sideboard kept in the box or a few cards out on loan) and, when the card data can tell, holding a card
// that can be a commander. It only orders the list: nothing is marked without you.
const DECK_SIZE = [90, 130];
function deckLocations() {
  const m = new Map(), tell = hasFlags() && !DATA.demo;
  for (const e of COLL ? COLL.entries : []) {
    if (e.loc === PUT_AWAY) continue;   // the pile of cards waiting to be filed is never a deck to choose
    const o = m.get(e.loc) || { loc: e.loc, qty: 0, deck: false, imported: false, swaps: swapsBase(e.loc), cmd: false };
    o.qty += e.qty; if (e.inDeck) o.deck = true; if (importedDeck(e)) o.imported = true;
    if (tell && !o.cmd && (flagsOf(e.name) & 4)) o.cmd = true;
    m.set(e.loc, o);
  }
  return [...m.values()].map(({ cmd, ...o }) => ({ ...o, likely: !o.deck && o.swaps == null && o.qty >= DECK_SIZE[0] && o.qty <= DECK_SIZE[1] && (!tell || cmd) }))
    .sort((a, b) => a.loc.localeCompare(b.loc, undefined, { numeric: true }));
}
// ---- A copy's printing (0.67.0; Matt, Nov 11: "Set data will need to come first… Probably worth adding condition as
// well"). An entry keeps what the import says of the copy itself, each field only when the import gives it: `sid`
// (Scryfall's ID of the printing), `set` (set code, lower case), `cn` (collector number), `foil` ("foil" | "etched";
// absent = not foil), `rar` (c u r m s b: the printing's rarity), `cond` (the import's own word in one form:
// near_mint, lightly_played…; scales differ between apps and are not merged here), `lang` (absent = English).
// Prices read set, cn and foil since 0.68.0 (printings and prices, below); rules will read the rest.
const PRINT_FIELDS = ["sid", "set", "cn", "foil", "cond", "lang"];   // what makes two copies of a card differ (rar follows set and cn)
const samePrint = (a, b) => PRINT_FIELDS.every(f => (a[f] || "") === (b[f] || ""));
const printKey = e => PRINT_FIELDS.map(f => e[f] || "").join("\u001f");   // one string per printing, finish, condition and language
const RARITIES = { common: "c", uncommon: "u", rare: "r", mythic: "m", "mythic rare": "m", special: "s", bonus: "b", c: "c", u: "u", r: "r", m: "m", s: "s", b: "b" };
const COND_SHORT = { m: "mint", nm: "near_mint", lp: "lightly_played", mp: "moderately_played", hp: "heavily_played", dmg: "damaged", ex: "excellent", gd: "good", pl: "played", po: "poor" };
// What an import's columns say of one copy → the fields to keep ({} when none is usable). Values that don't look like
// what the field holds are dropped, never guessed (a set's name in a "set" column is not a code).
function printFields(raw) {
  const v = x => String(x == null ? "" : x).trim(), o = {};
  const sid = v(raw.sid).toLowerCase(); if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(sid)) o.sid = sid;
  const set = v(raw.set).toLowerCase(); if (/^[a-z0-9]{2,6}$/.test(set)) o.set = set;
  const cn = v(raw.cn); if (/^[A-Za-z0-9★†*-]{1,12}$/.test(cn)) o.cn = cn;
  const foil = v(raw.foil).toLowerCase(); if (/etched/.test(foil)) o.foil = "etched"; else if (/^(foil|true|yes|1|f)$/.test(foil)) o.foil = "foil";
  const rar = RARITIES[v(raw.rar).toLowerCase()]; if (rar) o.rar = rar;
  let cond = v(raw.cond).toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim().replace(/[\s-]+/g, "_"); cond = COND_SHORT[cond] || cond;
  if (/^[a-z_]{3,20}$/.test(cond)) o.cond = cond;
  const lang = v(raw.lang).toLowerCase(); if (/^[a-z_-]{2,12}$/.test(lang) && lang !== "en" && lang !== "english") o.lang = lang;
  return o;
}

// ------------------------------------------------------------ the put-away list's name, and files with no boxes
// Cards in no box or binder wait on the put-away list: a deck's cards once it no longer uses them, cards added with no
// place. The screens speak of it as a location of this name; in the record it is the id PILE (below).
const PUT_AWAY = "To put away";
const NO_BOX = new Set(["Collection", "Pasted list"]);   // where readCollection puts the cards of a file that names no boxes
// A fingerprint of a file's cards, whatever order its rows are in: the same file again is known by it (planFile,
// fileSeen).
function entriesSig(entries) {
  const lines = entries.map(e => [e.qty, norm(e.name), e.loc, printKey(e)].join("\u001e")).sort();
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const l of lines) for (let i = 0; i <= l.length; i++) {
    const ch = i < l.length ? l.charCodeAt(i) : 10;
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return lines.length + "." + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ------------------------------------------------------------ the collection as Bulk Tutor's own record (step 4 of the plan)
// (Matt, Nov 13: Bulk Tutor is "the record of the collection"; notes/model.md has what was agreed.) What you own is
// kept as **lines with a count**: a line is one card in one printing, finish, condition and language, in one
// location. Identical copies share a line, because they can't be told apart. **Locations have ids.** Every add, move
// and removal is a **change**, written down in order, and a file from an app is one more source of changes: an
// import, an Undo and (later) two devices all go through doChange, so nothing is invented.
//   rec    = {v: 1, lines: Map(lineKey → line), locs: Map(id → {id, name, deck?, kind?}), changes: [change], sources: [source], forgot}
//   line   = {k (norm(name)), name, set?, cn?, foil?, cond?, lang?, sid?, rar?, loc (a location's id, or PILE), qty}
//   change = {id, at (UTC), how: {by: "hand" | "file" | "deck" | "rules" | "convert" | "undo" | "left" (a mark: another
//            device's change that couldn't be made here, makeAgain), …}, lines: [{name,
//            …printing, qty, from, to}] (null = nowhere: a card added or removed), locs?: [the locations it brought,
//            or the file's new word on one], src?: what it did to a source (sourceApply)}
//   source = {id, app, label, at, sig, lines: Map}: an app's last file as lines, to compare its next one with
//   forgot = [[id, when (ms)]]: the changes forgotten of late, by id only and in the order they were kept, so another
//            device's record can still be told "you had this one" from "you never did" (two devices, at the end)
// Nothing else is kept. A copy "added here", one "removed here" and a move "ManaBox doesn't know yet" are no longer
// marks on the copies (`x`, `gone` and `from`, as versions before 0.88.0 kept them: convertCollection reads those):
// they are the difference between the lines and the sources' lines, worked out when it is needed (recPending; the
// hand balance in opsToLines).
// **A location's deck word** (`deck`: what a file said of it) is kept only until step 5 makes decks point at
// locations. Until the screens are rebuilt they read today's shapes, filled from the lines (recEntries), and speak
// of locations by name; ids stay in here.
const PILE = "pile";                                          // where a copy is when it is in no location: the put-away list
const LINE_FIELDS = ["set", "cn", "foil", "cond", "lang"];    // with the card and the location, what makes a line
const LINE_KEEPS = ["sid", "rar"];                            // what a line also remembers of its printing (they follow set and number)
const LINE_SEP = "\u001f";
const HISTORY_DAYS = [30, 90, 183, 365], HISTORY_DEFAULT = 90;   // how long a change is kept: the person's choice (Matt, Nov 13)
// A card in one printing, finish, condition and language (a printing known only by its Scryfall ID is told by it).
const kpOf = (k, p) => k + LINE_SEP + (p.set || (p.sid && !p.cn ? "#" + p.sid : "")) + LINE_SEP + (p.cn || "") + LINE_SEP + (p.foil || "") + LINE_SEP + (p.cond || "") + LINE_SEP + (p.lang || "");
const lineKey = (k, p, loc) => kpOf(k, p) + LINE_SEP + loc;
const printOnly = p => { const o = {}; for (const f of LINE_FIELDS) if (p[f]) o[f] = p[f]; for (const f of LINE_KEEPS) if (p[f]) o[f] = p[f]; return o; };
const keyOnly = p => { const o = {}; for (const f of LINE_FIELDS) if (p[f]) o[f] = p[f]; if (p.sid && !p.set && !p.cn) o.sid = p.sid; return o; };   // what tells a line apart, and no more: a source's lines
const fieldsOf = p => LINE_FIELDS.reduce((n, f) => n + (p[f] ? 1 : 0), 0);
const chLine = (p, qty, from, to) => ({ name: p.name, ...printOnly(p), qty, from, to });
// Could two descriptions be of the same copy? → how many of set, number and condition both give and agree on, or −1
// when they can't be (a field both give differs). Finish and language must match: a file that leaves them out means
// not foil, and English.
function agree(a, b) {
  if ((a.foil || "") !== (b.foil || "") || (a.lang || "") !== (b.lang || "") || (a.sid && b.sid && a.sid !== b.sid)) return -1;
  let n = 0;
  for (const f of ["set", "cn", "cond"]) if (a[f] && b[f]) { if (a[f] !== b[f]) return -1; n++; }
  return n;
}
function textHash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// More copies on a Map of lines (changed in place): the same card, printing and location share a line. `bare`: a
// source's lines, which are only compared with, keep nothing beyond what tells a line apart.
function lineAdd(map, k, p, loc, qty, bare = false) {
  const key = lineKey(k, p, loc), have = map.get(key);
  if (have) { have.qty += qty; if (!bare) for (const f of LINE_KEEPS) if (!have[f] && p[f]) have[f] = p[f]; }
  else map.set(key, { k, name: p.name, ...(bare ? keyOnly(p) : printOnly(p)), loc, qty });
}
// Up to qty copies off a line → how many there were to take.
function lineTake(map, key, qty) {
  const have = map.get(key), q = Math.min(qty, have ? have.qty : 0);
  if (q) { if (have.qty === q) map.delete(key); else have.qty -= q; }
  return q;
}
function recNew() { return { v: 1, lines: new Map(), locs: new Map(), changes: [], sources: [], forgot: [] }; }
function recCount(rec) { let n = 0; for (const l of rec.lines.values()) n += l.qty; return n; }
const recLocName = (rec, id) => (id === PILE ? PUT_AWAY : id == null ? "" : (rec.locs.get(id) || { name: "" }).name);
const newChangeId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const changeOf = (how, lines, at = null) => ({ id: newChangeId(), at: at || new Date().toISOString(), how, lines });

// Names → ids, for a plan that must not touch the record: the locations it would bring are collected, and so is what
// a file says of each (a deck or not). **An id is made from the name a location first had**, so two devices that
// bring over the same collection, or each make a box of the same name, mean the same location without having met.
// It is still only an id: a location shown under another name keeps it.
function locNamer(rec) {
  const byName = new Map([[PUT_AWAY, PILE]]), ids = new Set([PILE, ...rec.locs.keys()]), fresh = [], words = new Map();
  for (const l of rec.locs.values()) byName.set(l.name, l.id);
  const find = name => byName.get(String(name == null ? "" : name).trim()) || null;
  const id = (name, deck = null) => {
    name = String(name == null ? "" : name).trim() || "Collection";
    let i = byName.get(name);
    if (!i) {
      i = "L" + textHash(name);
      for (let n = 1; ids.has(i); n++) i = "L" + textHash(name + LINE_SEP + n);
      ids.add(i); byName.set(name, i); fresh.push({ id: i, name });
    }
    if (deck != null && i !== PILE) words.set(i, words.get(i) || !!deck);
    return i;
  };
  const name = i => (i === PILE ? PUT_AWAY : i ? (rec.locs.get(i) || fresh.find(l => l.id === i) || { name: "" }).name : "");
  // What a change has to carry: the new locations, and an old one whose file says something new of it.
  const locs = () => {
    const out = fresh.map(l => (words.get(l.id) ? { ...l, deck: true } : l));
    for (const [i, deck] of words) { const have = rec.locs.get(i); if (have && !!have.deck !== deck) out.push({ id: i, name: have.name, deck }); }
    return out;
  };
  return { id, find, name, locs, fresh };
}

// **Make a change happen**: each line's copies leave `from` and arrive at `to`. A line whose copies aren't where the
// change needs them is skipped, in whole or in part, and handed back (`skipped`), never made up from other copies.
// The change is written down as what was done. → {change (as kept; null when it did nothing), made, skipped}.
function doChange(rec, ch) {
  for (const l of ch.locs || []) {
    if (!l || !l.id || l.id === PILE) continue;
    const have = rec.locs.get(l.id), o = have ? { ...have } : { id: l.id, name: l.name };
    if ("deck" in l) { if (l.deck) o.deck = true; else delete o.deck; }
    if (l.kind) o.kind = l.kind;
    rec.locs.set(l.id, o);
  }
  const made = [], skipped = [], known = loc => loc === PILE || rec.locs.has(loc);
  for (const ln of ch.lines || []) {
    const k = norm(ln.name); let n = Math.floor(ln.qty) || 0;
    if (n <= 0 || !k || (ln.from == null && ln.to == null) || ln.from === ln.to) continue;
    if (ln.to != null && !known(ln.to)) { skipped.push({ ...ln, qty: n }); continue; }
    if (ln.from != null) {
      const q = lineTake(rec.lines, lineKey(k, ln, ln.from), n);
      if (q < n) skipped.push({ ...ln, qty: n - q });
      if (!q) continue;
      n = q;
    }
    if (ln.to != null) lineAdd(rec.lines, k, ln, ln.to, n);
    made.push(n === ln.qty ? ln : { ...ln, qty: n });
  }
  const done = { ...ch, lines: made };
  if (ch.src) sourceApply(rec, ch.src, done);
  const kept = made.length > 0 || !!(ch.src && (!ch.src.d || ch.src.d.length)) || ch.how.by === "convert";
  if (kept) rec.changes.push(done);
  return { change: kept ? done : null, made, skipped };
}
// **Undo a change**, however old: its lines made the other way round, as a new change. Later changes are left
// alone: a copy that has moved on since stays where it is and comes back in `skipped`, for the message to name.
// Undoing an Undo makes the change again. The conversion can't be undone. → doChange's answer, or null.
function undoChange(rec, id, at = null) {
  const ch = rec.changes.find(c => c.id === id);
  if (!ch || ch.how.by === "convert") return null;
  const back = changeOf({ by: "undo", of: id, what: ch.how.by, ...(ch.how.label ? { label: ch.how.label } : {}) }, ch.lines.slice().reverse().map(l => ({ ...l, from: l.to, to: l.from })), at);
  if (ch.src) back.src = srcBack(ch.src);
  return doChange(rec, back);
}
// The changes that stand undone: Set of ids (an Undo that was itself undone no longer counts).
function undoneChanges(rec) {
  const out = new Set();
  for (let i = rec.changes.length - 1; i >= 0; i--) { const c = rec.changes[i]; if (c.how.by === "undo" && !out.has(c.id)) out.add(c.how.of); }
  return out;
}
// **Forgetting.** The changes older than the person's choice of days go, **from the front of the list only**: a
// change is forgotten once it and every change kept before it are that old. The list is kept in the order the
// changes reached this collection, so a change made long ago on another device and only now arrived stays until
// the ones before it have gone (a little longer than the choice, never shorter). **The latest change is never
// forgotten**, however old: its time is when the collection last changed (recStamp), which a backup file's
// collection and another device's are compared by. Why from the front: what a record knows of is then always
// everything since some point, which is what lets two devices tell what the other never had (mergeRecs).
// → the changes a trim would forget now.
function staleChanges(rec, days, now = Date.now()) {
  const cut = now - days * 864e5, last = recStamp(rec); let n = 0;
  while (n < rec.changes.length && (Date.parse(rec.changes[n].at) || 0) < cut && (Date.parse(rec.changes[n].at) || 0) !== last) n++;
  return rec.changes.slice(0, n);
}
// Forget them → how many went. The collection itself is untouched. A forgotten change leaves its id behind
// (`forgot`) for as long again, then that goes too: a device away longer than that no longer merges change by
// change (Matt, Nov 13: "the collection changed most recently wins whole").
function trimChanges(rec, days, now = Date.now()) {
  const gone = staleChanges(rec, days, now), keep = now - days * 864e5;
  if (gone.length) { rec.changes = rec.changes.slice(gone.length); for (const c of gone) rec.forgot.push([c.id, now]); }
  let d = 0; while (d < rec.forgot.length && rec.forgot[d][1] < keep) d++;
  if (d) rec.forgot = rec.forgot.slice(d);
  return gone.length;
}

// What a change did to a source, `s` = {id, app, from, to, d? | take?, others?} (`from` and `to` are the source's
// {label, at, sig} before and after; null = it didn't exist):
//   an update (both set)   the source's lines take `d`, the lines its new file added (+) and took away (−)
//   a beginning (no from)  the source starts as the change's own added lines (`take: "lines"`), or as the whole
//                          collection as it stood after the change (`take: "all"`: a first file taken as the
//                          collection); the sources in `others` end (Replace everything)
//   an end (no to)         the source goes and `others` come back: a beginning undone
// srcBack turns one into the other, so undoing an import also puts back what the app's next file is compared with.
const packLine = l => { const { k, ...o } = l; return o; };
const packSource = s => ({ ...s, lines: [...s.lines.values()].map(packLine) });
const srcBack = s => ({ id: s.id, app: s.app, from: s.to || null, to: s.from || null, ...(s.d ? { d: s.d.map(x => ({ ...x, qty: -x.qty })) } : {}), ...(s.take ? { take: s.take } : {}), ...(s.others ? { others: s.others } : {}) });
function sourceApply(rec, s, ch) {
  const i = rec.sources.findIndex(x => x.id === s.id);
  if (!s.to) {
    if (i >= 0) rec.sources.splice(i, 1);
    for (const o of s.others || []) if (!rec.sources.some(x => x.id === o.id)) rec.sources.push({ ...o, lines: unpackLines(o.lines, undefined, true) });
  } else if (!s.from) {
    const drop = new Set([s.id, ...(s.others || []).map(o => o.id)]), lines = new Map();
    rec.sources = rec.sources.filter(x => !drop.has(x.id));
    if (s.take === "all") for (const l of rec.lines.values()) lineAdd(lines, l.k, l, l.loc, l.qty, true);
    else for (const ln of ch.lines) if (ln.from == null && ln.to != null) lineAdd(lines, norm(ln.name), ln, ln.to, ln.qty, true);
    rec.sources.push({ id: s.id, app: s.app, ...s.to, lines });
  } else if (i >= 0) {
    const src = rec.sources[i];
    for (const d of s.d || []) { const k = norm(d.name); if (d.qty > 0) lineAdd(src.lines, k, d, d.loc, d.qty, true); else lineTake(src.lines, lineKey(k, d, d.loc), -d.qty); }
    Object.assign(src, s.to);
  }
}
// The source a file from this app would update: its latest. A file that names no app ("CSV", a pasted list) is
// never taken for the next file of the last one.
const NO_APP = new Set(["", "CSV", "Pasted list"]);
const sourceOf = (rec, app) => (NO_APP.has(app) ? null : rec.sources.filter(s => s.app === app).pop() || null);
function newSourceId(rec, app) {
  const base = app || "File"; let id = base;
  for (let n = 2; rec.sources.some(s => s.id === id); n++) id = base + " " + n;
  return id;
}

// **What turns one set of lines into another**, card by card: the fewest moves, adds and removals, pairing the
// copies of a card in this order: the same printing in the same location (nothing to do); the same printing in
// another location (a move; no move when either side names no location, `located` false or a line with loc ""); and
// with `loose` (a file's lines): descriptions that can be of the same copy (agree: one of them says more), the
// most exact first, which makes the printing fuller ("re"); then, for a file that names no locations, any copy of
// the card ("A file that gives less (names only) matches the most exact line first, then by name"): a line with no
// printing at all leaves the copy as it is, another printing replaces it. A file that names locations never takes
// one printing for another: that is one card gone and one new.
// → {ops: [{op: "mv" | "add" | "rm" | "re", k, p (the line to go by), was? (re: the line before), qty, from, to}], same}.
function diffLines(base, file, located = true, loose = true) {
  const group = lines => { const m = new Map(); for (const l of lines) { if (!(l.qty > 0)) continue; let a = m.get(l.k); if (!a) m.set(l.k, a = []); a.push({ l, kp: kpOf(l.k, l), left: l.qty }); } return m; };
  const A = group(base), B = group(file), ops = []; let same = 0;
  for (const [k, b] of B) {
    const a = A.get(k);
    if (a) {
      for (const y of b) for (const x of a) { if (!y.left) break; if (!x.left || x.kp !== y.kp || x.l.loc !== y.l.loc) continue; const q = Math.min(x.left, y.left); x.left -= q; y.left -= q; same += q; }
      for (const y of b) for (const x of a) {
        if (!y.left) break; if (!x.left || x.kp !== y.kp) continue;
        const q = Math.min(x.left, y.left); x.left -= q; y.left -= q;
        if (located && x.l.loc && y.l.loc) ops.push({ op: "mv", k, p: y.l, qty: q, from: x.l.loc, to: y.l.loc }); else same += q;
      }
      if (loose) for (const y of b.filter(y => y.left).sort((y1, y2) => fieldsOf(y2.l) - fieldsOf(y1.l))) while (y.left) {
        let best = null, score = -1;
        for (const x of a) {
          if (!x.left) continue;
          const s = agree(x.l, y.l); if (s < 0 && located) continue;
          const sc = (s < 0 ? 0 : 2 + 2 * s) + (x.l.loc === y.l.loc ? 1 : 0);
          if (sc > score) { score = sc; best = x; }
        }
        if (!best) break;
        const x = best, q = Math.min(x.left, y.left), fits = agree(x.l, y.l) >= 0, moves = located && x.l.loc && y.l.loc && x.l.loc !== y.l.loc;
        x.left -= q; y.left -= q;
        const p = fits ? { ...x.l, ...printOnly(y.l) } : fieldsOf(y.l) ? { name: x.l.name, ...printOnly(y.l) } : x.l;
        if (kpOf(k, p) !== x.kp) ops.push({ op: "re", k, was: x.l, p, qty: q, from: x.l.loc, to: moves ? y.l.loc : x.l.loc });
        else if (moves) ops.push({ op: "mv", k, p: x.l, qty: q, from: x.l.loc, to: y.l.loc });
        else same += q;
      }
    }
    for (const y of b) if (y.left) ops.push({ op: "add", k, p: y.l, qty: y.left, to: y.l.loc });
  }
  for (const [k, a] of A) for (const x of a) if (x.left) ops.push({ op: "rm", k, p: x.l, qty: x.left, from: x.l.loc });
  return { ops, same };
}
// Those ops as what they do to the lines of the file before: the source's `d`.
function opsDelta(ops) {
  const d = [], put = (p, loc, qty) => d.push({ name: p.name, ...keyOnly(p), loc: loc || "", qty });
  for (const o of ops) {
    if (o.op === "add") put(o.p, o.to, o.qty);
    else if (o.op === "rm") put(o.p, o.from, -o.qty);
    else if (o.op === "mv") { put(o.p, o.from, -o.qty); put(o.p, o.to, o.qty); }
    else { put(o.was, o.from, -o.qty); put(o.p, o.to, o.qty); }
  }
  return d;
}
// **Ops made on the collection as it is now** → the lines of a change that doChange can make one after another,
// with the numbers for the message. o = {three, to (where a card with no location goes: an id), decks (ids the
// person counts as decks, taken from last), name (id → the name to list it by)}.
// Plainly (the ops were worked out against the collection itself), or with `three`: **the ops are what an app's
// file changed since its last one, and the collection has moved on since** (Matt, Nov 10: "ManaBox is the scanner,
// Bulk Tutor is where the collection is put to use"). Then counts are the app's to say and places are yours:
//   a card the app has more of    is one you added here, if there is one (the same printing first, then any printing
//     of the card: "taken to be the export's when a later export has more copies", Nov 12): it isn't counted twice.
//     It takes the file's printing; it goes where the file has it only if it was still waiting to be put away
//   a card the app has fewer of   is one you removed here, if there is one: nothing more goes. Else the copy goes
//     from where the app had it, and if you moved it since, from where you put it
//   a card the app moved          is the very move you made here, if you made it (out of the one place and into the
//     other: the file shows your move, and it isn't made twice); else it moves if a copy is still where the app
//     had it, and if you moved it somewhere else since, it stays
// What was added or removed here is the hand balance: for each printing, the copies the collection has beyond (+) or
// short of (−) what all the sources' last files have. → {lines, n: {added, gone, moved, reprinted, absorbed (added
// here, now the file's), settled (removed here, gone from the file too), shown (moved here, and the file shows it),
// stay (moved by the app but elsewhere here), missing (not found to take)}, lists: {added, gone, moved}}.
function opsToLines(rec, ops, o = {}) {
  const NONE = new Map(), at = new Map(), at0 = new Map(), ofName = new Map(), sample = new Map(), srcAt = new Map(), hand = new Map();
  const see = (kp, k, l) => { if (sample.has(kp)) return; sample.set(kp, l); let s = ofName.get(k); if (!s) ofName.set(k, s = []); s.push(kp); };
  for (const l of rec.lines.values()) { const kp = kpOf(l.k, l); see(kp, l.k, l); let m = at.get(kp); if (!m) at.set(kp, m = new Map()); m.set(l.loc, (m.get(l.loc) || 0) + l.qty); at0.set(kp + LINE_SEP + l.loc, l.qty); }
  const have = (kp, loc) => (at.get(kp) || NONE).get(loc) || 0;
  if (o.three) {
    const srcKp = new Map();
    for (const s of rec.sources) for (const l of s.lines.values()) {
      const kp = kpOf(l.k, l), key = kp + LINE_SEP + l.loc; see(kp, l.k, l);
      srcKp.set(kp, (srcKp.get(kp) || 0) + l.qty); srcAt.set(key, (srcAt.get(key) || 0) + l.qty);
    }
    for (const kp of sample.keys()) { let n = -(srcKp.get(kp) || 0); for (const q of (at.get(kp) || NONE).values()) n += q; if (n) hand.set(kp, n); }
  }
  const lines = [], n = { added: 0, gone: 0, moved: 0, reprinted: 0, absorbed: 0, settled: 0, shown: 0, stay: 0, missing: 0 }, lists = { added: [], gone: [], moved: [] };
  const name = o.name || (id => recLocName(rec, id)), front = p => p.name.split(" // ")[0], decks = o.decks || new Set();
  const emit = (k, p, qty, from, to) => {
    const kp = kpOf(k, p);
    if (from != null) { const m = at.get(kp), real = rec.lines.get(kp + LINE_SEP + from); m.set(from, m.get(from) - qty); if (real) p = { ...p, ...printOnly(real) }; }   // a source's line says less than the copy itself
    if (to != null) { see(kp, k, p); let m = at.get(kp); if (!m) at.set(kp, m = new Map()); m.set(to, (m.get(to) || 0) + qty); }
    lines.push(chLine(p, qty, from, to));
  };
  // Where the copies of a printing are, in the order to take them: where they were expected, the put-away list,
  // where the sources don't have them (put there here), then the rest, a deck last.
  const extra = (kp, loc) => have(kp, loc) - (srcAt.get(kp + LINE_SEP + loc) || 0);
  const rank = (kp, loc, first) => (loc === first ? 0 : loc === PILE ? 1 : o.three && extra(kp, loc) > 0 ? 2 : decks.has(loc) || (rec.locs.get(loc) || {}).deck ? 4 : 3);
  const spots = (kp, first) => [...(at.get(kp) || NONE)].filter(([, q]) => q > 0).map(([loc]) => loc)
    .sort((x, y) => rank(kp, x, first) - rank(kp, y, first) || name(x).localeCompare(name(y), undefined, { numeric: true }));
  // Up to `a` copies of printing kp that were added here are the file's copies of op (a card it has at `to`): they
  // take the file's printing, and its place if they were still waiting to be put away. op.qty falls by as many.
  const takeHand = (op, kp, a) => {
    const p = sample.get(kp), fits = agree(p, op.p) >= 0, np = fits ? { ...p, ...printOnly(op.p) } : { name: p.name, ...printOnly(op.p) }, re = kpOf(op.k, np) !== kp;
    let left = a;
    for (const loc of spots(kp, op.to)) {
      if (!left) break;
      const q = Math.min(left, have(kp, loc)), to = loc === PILE && op.to ? op.to : loc; if (!q) continue;
      if (re) { emit(op.k, p, q, loc, null); emit(op.k, np, q, null, to); } else if (to !== loc) emit(op.k, p, q, loc, to);
      left -= q;
    }
    op.qty -= a - left; hand.set(kp, hand.get(kp) - (a - left)); n.absorbed += a - left;
  };
  // The same by name: any printing of the card added here, the ones that could be the file's copy first.
  const takeHandByName = op => {
    const cands = (ofName.get(op.k) || []).filter(kp => (hand.get(kp) || 0) > 0)
      .sort((x, y) => (agree(sample.get(y), op.p) >= 0) - (agree(sample.get(x), op.p) >= 0) || fieldsOf(sample.get(x)) - fieldsOf(sample.get(y)));
    for (const kp of cands) { if (!op.qty) break; takeHand(op, kp, Math.min(op.qty, hand.get(kp))); }
  };
  // A copy the file describes differently now takes the new printing where it is (and the file's place, if it is
  // still where it was expected). With `three`, a copy that isn't here any more needs nothing: it was removed here
  // (and still is, under its new printing), or was given that printing here already, which the balance then shows.
  for (const op of ops) if (op.op === "re") {
    const kp = kpOf(op.k, op.was); let left = op.qty;
    for (const loc of spots(kp, op.from)) {
      if (!left) break;
      const q = Math.min(left, have(kp, loc)); if (!q) continue;
      emit(op.k, op.was, q, loc, null); emit(op.k, op.p, q, null, loc === op.from && op.to ? op.to : loc);
      left -= q; n.reprinted += q;
    }
    if (!left) continue;
    if (!o.three) { n.missing += left; continue; }
    const now = kpOf(op.k, op.p); see(now, op.k, op.p);
    hand.set(kp, (hand.get(kp) || 0) + left); hand.set(now, (hand.get(now) || 0) - left);
  }
  if (o.three) {
    // Removed here, and the file has fewer too.
    for (const op of ops) if (op.op === "rm") { const kp = kpOf(op.k, op.p), h = hand.get(kp) || 0, s = Math.min(op.qty, Math.max(0, -h)); if (s) { op.qty -= s; hand.set(kp, h + s); n.settled += s; } }
    for (const op of ops) if (op.op === "rm" && op.qty > 0) for (const kp of ofName.get(op.k) || []) {
      const h = hand.get(kp) || 0; if (h >= 0) continue;
      const s = Math.min(op.qty, -h); op.qty -= s; hand.set(kp, h + s); n.settled += s;
      if (!op.qty) break;
    }
    // Added here, and the file has more too.
    for (const op of ops) if (op.op === "add") { const kp = kpOf(op.k, op.p), a = Math.min(op.qty, Math.max(0, hand.get(kp) || 0)); if (a) takeHand(op, kp, a); }
    for (const op of ops) if (op.op === "add" && op.qty > 0) takeHandByName(op);
  }
  // A move the file shows. First the part that is the very move made here: the collection, as it was before this
  // file, has that many fewer copies in `from` and that many more in `to` than the sources' last files (each such
  // copy is matched once). The rest moves if a copy is still in `from`, and otherwise stays where it was put.
  const out = new Map(), into = new Map();
  for (const op of ops) if (op.op === "mv") {
    const kp = kpOf(op.k, op.p), k1 = kp + LINE_SEP + op.from, k2 = kp + LINE_SEP + op.to;
    const shown = !o.three ? 0 : Math.min(op.qty, Math.max(0, (srcAt.get(k1) || 0) - (at0.get(k1) || 0) - (out.get(k1) || 0)), Math.max(0, (at0.get(k2) || 0) - (srcAt.get(k2) || 0) - (into.get(k2) || 0)));
    if (shown) { out.set(k1, (out.get(k1) || 0) + shown); into.set(k2, (into.get(k2) || 0) + shown); n.shown += shown; }
    const q = Math.min(op.qty - shown, have(kp, op.from));
    if (q) { emit(op.k, op.p, q, op.from, op.to); n.moved += q; lists.moved.push({ name: front(op.p), qty: q, from: name(op.from), to: name(op.to) }); }
    let rest = op.qty - shown - q;
    // Not in `from` any more because it was removed here: then a copy of the card added here under another
    // printing is the one the file has in `to` now (a move is a card gone from one place and come to another).
    const gone = o.three ? Math.min(rest, Math.max(0, -(hand.get(kp) || 0))) : 0;
    if (gone) {
      const came = { k: op.k, p: op.p, to: op.to, qty: gone }, was = n.absorbed; takeHandByName(came);
      const a = gone - came.qty; n.absorbed = was; n.shown += a; rest -= a; hand.set(kp, hand.get(kp) + a);
    }
    n.stay += rest;
  }
  for (const op of ops) if (op.op === "rm" && op.qty > 0) {
    const kp = kpOf(op.k, op.p); let left = op.qty;
    for (const loc of spots(kp, op.from)) {
      if (!left) break;
      const q = Math.min(left, have(kp, loc)); if (!q) continue;
      emit(op.k, op.p, q, loc, null); left -= q; n.gone += q; lists.gone.push({ name: front(op.p), qty: q, loc: name(loc) });
    }
    n.missing += left;
  }
  for (const op of ops) if (op.op === "add" && op.qty > 0) {
    const to = op.to || o.to || PILE;
    emit(op.k, op.p, op.qty, null, to); n.added += op.qty; lists.added.push({ name: front(op.p), qty: op.qty, loc: name(to) });
  }
  const byName = (x, y) => x.name.localeCompare(y.name);
  lists.added.sort(byName); lists.gone.sort(byName); lists.moved.sort(byName);
  return { lines, n, lists };
}

// **A file as a change.** file = {app, label, at, entries (as the reader gives them), noLoc, sig?}; opts = {mode,
// to (a location's name, for cards with none; the put-away list when absent), source (the id of the source the file
// is the next one of; left out = its app's latest, null = none), decks (names the person counts as decks)}.
// Nothing is touched: the answer says what the file would do, for the question before the tap, and doChange(rec,
// plan.change) does it. Which mode a file is, is the person's say (Nov 12):
//   update  the file is the collection now. From an app already imported it is compared with that app's last file,
//           so only what changed there comes over and what was done here stays (opsToLines, `three`). A first file
//           is compared with the collection itself, which becomes the file: its app is the source from now on and
//           the sources before it end. A first file from no app (a pasted list, a CSV nobody's) begins no source
//           and ends none: what it changes was changed here
//   add     more cards, with locations of their own: a source of its own begins
//   wipe    Replace everything: the collection becomes exactly the file, also from an app already imported (what
//           was done here is not kept), and every other source ends
//   here    more cards with no locations named: they go to `to`. No source: they are cards added here
//   box     the file is what the location `to` holds now: only that location changes. No source either
// **A file that names no locations changes counts only** (Nov 13; Moxfield's and Archidekt's collection exports):
// as an update, cards it lacks go from where they are, cards it adds go to `to`, and nothing moves.
// → {mode, change, source (the id compared with, or null), again (a source's last file was this very file), n:
//    {cards (in the file), had (in what it was compared with), same (the file's cards already there in the same
//    place), total (the collection after), …opsToLines' numbers}, lists, boxesNew (the locations it fills that
//    held no card), boxesGone (the ones it empties) (names)}.
function planFile(rec, file, opts = {}) {
  const N = locNamer(rec), app = file.app || "", how = { by: "file", app, label: file.label || "" }, located = !file.noLoc;
  let mode = opts.mode || "update"; if (mode === "add" && !located) mode = "here";
  const toId = N.id(opts.to || PUT_AWAY), oneLoc = mode === "box" || mode === "here", F = new Map(); let cards = 0;
  for (const e of file.entries || []) {
    if (!e || !e.name || !(e.qty > 0)) continue;
    lineAdd(F, norm(e.name), e, oneLoc ? toId : located ? N.id(e.loc, importedDeck(e)) : "", e.qty); cards += e.qty;
  }
  const sig = file.sig || entriesSig(file.entries || []), at = file.at || new Date().toISOString(), meta = { label: how.label, at, sig };
  how.sig = sig;   // so the same file given again is known even when it began no source (fileSeen)
  const decks = new Set([...(opts.decks || [])].map(N.find).filter(Boolean));
  let ops = [], same = 0, had = 0, src = null, base = null, adj = null;
  if (mode === "here" || mode === "add") {
    for (const l of F.values()) ops.push({ op: "add", k: l.k, p: l, qty: l.qty, to: l.loc });
    if (mode === "add") adj = { id: newSourceId(rec, app), app, from: null, to: meta, take: "lines" };
  } else {
    if (mode === "update") src = opts.source === undefined ? sourceOf(rec, app) : rec.sources.find(s => s.id === opts.source) || null;
    base = src ? [...src.lines.values()] : [...rec.lines.values()].filter(l => mode !== "box" || l.loc === toId);
    const d = diffLines(base, F.values(), located || mode === "box", true); ops = d.ops; same = d.same;
    for (const l of base) had += l.qty;
    if (src) adj = { id: src.id, app: src.app, from: { label: src.label, at: src.at, sig: src.sig }, to: meta, d: opsDelta(ops) };
    else if (mode === "wipe" || (mode === "update" && !NO_APP.has(app))) adj = { id: (sourceOf(rec, app) || { id: newSourceId(rec, app) }).id, app, from: null, to: meta, take: "all", others: rec.sources.map(packSource) };
  }
  const r = opsToLines(rec, ops, { three: !!src, to: toId, decks, name: N.name }), locs = N.locs();
  const change = { id: newChangeId(), at, how, lines: r.lines };
  if (locs.length) change.locs = locs;
  if (adj) change.src = adj;
  let total = recCount(rec); for (const l of r.lines) total += l.from == null ? l.qty : l.to == null ? -l.qty : 0;
  // The locations it fills and empties, by what it does to the collection as it is now (as the other numbers are):
  // one that holds no card before and some after is new, even one the record knew (an import undone and given
  // again); one a card moved here stays in is still there, whatever the file says.
  const cardsAt = new Map(); for (const l of rec.lines.values()) cardsAt.set(l.loc, (cardsAt.get(l.loc) || 0) + l.qty);
  const after = new Map(cardsAt); for (const l of r.lines) { if (l.from != null) after.set(l.from, (after.get(l.from) || 0) - l.qty); if (l.to != null) after.set(l.to, (after.get(l.to) || 0) + l.qty); }
  const locsWhere = fits => [...after.keys()].filter(id => id !== PILE && fits(cardsAt.get(id) || 0, after.get(id))).map(N.name).sort();
  return { mode, change, source: src ? src.id : null, again: rec.sources.some(s => s.sig === sig), n: { cards, had, same, total, ...r.n }, lists: r.lists,
    boxesNew: locsWhere((was, is) => !was && is > 0), boxesGone: locsWhere((was, is) => was > 0 && !is) };
}

// **Locations made to hold their lists** (0.53.0; on the record's lines since 0.90.0): a deck marked built, a
// hot-swap switched to another version, a deck taken apart. lists = [{loc (a location's name), cards: [{name, qty}],
// deck? (the word a file would have for a location that holds nothing yet)}]: a built deck's location, then a
// hot-swap's Swaps location. What a location holds beyond its list goes to another of the lists that wants it, else
// to the put-away list; what it lacks comes from the locations that aren't decks first (the put-away list is one),
// then from other decks, in the order Assemble names them (cardStatus). `decks` = the names of the locations the
// person counts as decks; a Swaps location always counts, since its cards are in use. Nothing is invented: cards you
// don't own are `lacking`. A list goes by card names and a location holds printings: the copies that move are taken
// in the order the lines are kept, and each is named in the change as the very printing it is.
// Nothing is touched. → {change (doChange makes it), moves: [{name, qty, from, to}] (location names; printings of a
// card that made the same move together), lacking: [{name, qty, loc}]}.
function settleDecks(rec, lists, how, decks = [], at = null) {
  const N = locNamer(rec), deckSet = new Set(decks), isDeck = loc => deckSet.has(loc) || swapsBase(loc) != null;
  const wants = lists.map(l => { const m = new Map(); for (const c of l.cards || []) { const k = norm(c.name), x = m.get(k); if (x) x.qty += c.qty; else m.set(k, { name: c.name, qty: c.qty }); } return m; });
  const wantOf = (li, k) => (wants[li].get(k) || { qty: 0 }).qty, listLocs = new Set(lists.map(l => l.loc));
  // The copies of the cards in question (the ones a list names or its location holds) as they will be: card → [{p
  // (the line: its printing), kp, loc (a name), qty}], in the order the lines are kept; copies that arrive in a
  // location come after the ones that were there.
  const cards = new Set(wants.flatMap(m => [...m.keys()])), held = new Set(), byK = new Map();
  for (const l of rec.lines.values()) { const loc = recLocName(rec, l.loc); held.add(loc); if (listLocs.has(loc)) cards.add(l.k); }
  for (const l of rec.lines.values()) if (cards.has(l.k)) { let a = byK.get(l.k); if (!a) byK.set(l.k, a = []); a.push({ p: l, kp: kpOf(l.k, l), loc: recLocName(rec, l.loc), qty: l.qty }); }
  const of = k => byK.get(k) || [], count = (k, loc) => of(k).reduce((n, c) => n + (c.loc === loc ? c.qty : 0), 0);
  // A location that holds nothing yet is a deck or not by its list's word; one that holds cards keeps the word it has.
  const word = new Map(lists.filter(l => !held.has(l.loc)).map(l => [l.loc, !!l.deck]));
  const lines = new Map(), moves = new Map(), lacking = [];
  const move = (k, n, from, to) => {
    const all = of(k); let left = n;
    for (let i = 0, len = all.length; i < len && left > 0; i++) {
      const c = all[i]; if (c.loc !== from || c.qty <= 0) continue;
      const q = Math.min(left, c.qty); c.qty -= q; left -= q;
      const there = all.find(x => x.loc === to && x.kp === c.kp); if (there) there.qty += q; else all.push({ ...c, loc: to, qty: q });
      const fromId = N.find(from), toId = N.id(to, word.has(to) ? word.get(to) : null), key = c.kp + LINE_SEP + fromId + LINE_SEP + toId, ln = lines.get(key);
      if (ln) ln.qty += q; else lines.set(key, chLine(c.p, q, fromId, toId));
      const mk = k + LINE_SEP + from + LINE_SEP + to, m = moves.get(mk);
      if (m) m.qty += q; else moves.set(mk, { name: c.p.name.split(" // ")[0], qty: q, from, to });
    }
    return n - left;
  };
  lists.forEach((l, li) => {
    for (const k of [...byK.keys()].filter(k => count(k, l.loc) > 0)) {
      let extra = count(k, l.loc) - wantOf(li, k);
      lists.forEach((o, oi) => { if (oi === li || extra <= 0) return; const need = wantOf(oi, k) - count(k, o.loc); if (need > 0) extra -= move(k, Math.min(extra, need), l.loc, o.loc); });
      if (extra > 0) move(k, extra, l.loc, PUT_AWAY);
    }
  });
  lists.forEach((l, li) => {
    for (const [k, w] of wants[li]) {
      let need = w.qty - count(k, l.loc); if (need <= 0) continue;
      const src = new Map(); for (const c of of(k)) if (c.qty > 0 && !listLocs.has(c.loc)) src.set(c.loc, isDeck(c.loc));
      const order = [...src].sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0], undefined, { numeric: true }));
      for (const [loc] of order) { if (need <= 0) break; need -= move(k, need, loc, l.loc); }
      if (need > 0) lacking.push({ name: w.name, qty: need, loc: l.loc });
    }
  });
  const change = changeOf(how, [...lines.values()], at), locs = N.locs();
  if (locs.length) change.locs = locs;
  return { change, moves: [...moves.values()], lacking };
}

// **The lines as entries**, the shape the screens read until step 5 rebuilds them: {name, qty, loc (the location's
// name), inDeck (what a file said of it: the person's own marks are applied on top, as before), …printing}. A copy waiting
// to be put away says where it goes back to (`from`), so the put-away list can still offer "back where it was":
// **the location an app's last file has it in** (pileHomes: going there undoes the move, and the app never hears of
// it; a card that went from its box into a deck built here and out again still knows its box, as before 0.88.0), and
// for a copy no file has (added here), the location it was taken from, read from the changes (pileOrigins).
function recEntries(rec) {
  const out = [], origins = pileOrigins(rec), homes = pileHomes(rec);
  const entry = (l, qty, from) => {
    const loc = rec.locs.get(l.loc), e = { name: l.name, qty, loc: l.loc === PILE ? PUT_AWAY : loc ? loc.name : l.loc, inDeck: !!(loc && loc.deck) };
    for (const f of ["sid", "set", "cn", "foil", "rar", "cond", "lang"]) if (l[f]) e[f] = l[f];
    if (from) e.from = from;
    out.push(e);
  };
  for (const l of rec.lines.values()) {
    if (l.loc !== PILE) { entry(l, l.qty, ""); continue; }
    const kp = kpOf(l.k, l), told = new Map(); let left = l.qty;
    for (const h of homes.get(kp) || []) { const q = Math.min(left, h.qty); if (q > 0 && rec.locs.has(h.loc)) { entry(l, q, rec.locs.get(h.loc).name); left -= q; told.set(h.loc, (told.get(h.loc) || 0) + q); } }
    for (const o of origins.get(kp) || []) {
      const dup = Math.min(o.qty, told.get(o.loc) || 0); if (dup) told.set(o.loc, told.get(o.loc) - dup);   // the copy a file has there, said already
      const q = Math.min(left, o.qty - dup); if (q > 0 && rec.locs.has(o.loc)) { entry(l, q, rec.locs.get(o.loc).name); left -= q; }
    }
    if (left > 0) entry(l, left, "");
  }
  return out;
}
// Where the apps' last files have the copies that are on the put-away list: Map(card and printing → [{loc, qty}]).
// The collection against the sources (as pendingOps), for the cards on the list only.
function pileHomes(rec) {
  const ks = new Set(), out = new Map(); for (const l of rec.lines.values()) if (l.loc === PILE) ks.add(l.k);
  if (!ks.size) return out;
  const all = new Map(), mine = [];
  for (const s of rec.sources) for (const l of s.lines.values()) if (ks.has(l.k)) lineAdd(all, l.k, l, l.loc, l.qty, true);
  for (const l of rec.lines.values()) if (ks.has(l.k)) mine.push(l);
  for (const o of diffLines(all.values(), mine, true, false).ops) if (o.op === "mv" && o.to === PILE) { const kp = kpOf(o.k, o.p); let a = out.get(kp); if (!a) out.set(kp, a = []); a.push({ loc: o.from, qty: o.qty }); }
  return out;
}
// Where the copies on the put-away list were taken from: Map(card and printing → [{loc, qty}]), the latest first.
// Read backwards through the changes: a copy that left the list later is taken to be the one that came last. **A
// change that takes another back** (`how.of`: an Undo, a card taken back out of the box it was filed in) puts on the
// list the very copies that change took off it, so the two cancel and the copy still says where it first came from.
function pileOrigins(rec) {
  const need = new Map(), owed = new Map(), out = new Map(), back = new Map(), ids = new Set(rec.changes.map(c => c.id));
  for (const l of rec.lines.values()) if (l.loc === PILE) need.set(kpOf(l.k, l), l.qty);
  for (let i = rec.changes.length - 1; i >= 0 && need.size; i--) {
    const c = rec.changes[i], of = c.how.of && ids.has(c.how.of) ? c.how.of : null;
    for (let j = c.lines.length - 1; j >= 0; j--) {
      const ln = c.lines[j], kp = kpOf(norm(ln.name), ln);
      if (!need.has(kp)) continue;
      if (ln.from === PILE) {
        const key = c.id + LINE_SEP + kp, undone = Math.min(ln.qty, back.get(key) || 0);
        if (undone) back.set(key, back.get(key) - undone);
        if (ln.qty > undone) owed.set(kp, (owed.get(kp) || 0) + ln.qty - undone);
        continue;
      }
      if (ln.to !== PILE) continue;
      if (of && ln.from != null) { const key = of + LINE_SEP + kp; back.set(key, (back.get(key) || 0) + ln.qty); continue; }
      const paid = Math.min(ln.qty, owed.get(kp) || 0), q = Math.min(ln.qty - paid, need.get(kp));
      if (paid) owed.set(kp, owed.get(kp) - paid);
      if (!q) continue;
      if (ln.from != null) { let a = out.get(kp); if (!a) out.set(kp, a = []); const same = a.find(x => x.loc === ln.from); if (same) same.qty += q; else a.push({ loc: ln.from, qty: q }); }
      if (need.get(kp) === q) need.delete(kp); else need.set(kp, need.get(kp) - q);
    }
  }
  return out;
}
// What has been done here that the sources' last files don't show: the collection against all of them together,
// as diffLines gives it (ids, not names).
function pendingOps(rec) {
  const all = new Map();
  for (const s of rec.sources) for (const l of s.lines.values()) lineAdd(all, l.k, l, l.loc, l.qty, true);
  return diffLines(all.values(), rec.lines.values(), true, false).ops;
}
// → {moves: [{name, qty, from, to}], added: [{name, qty, loc}], gone: [{name, qty, loc}]}, locations by name; each
// also carries `p`, the line it is about (a removed copy's is its source's line: what tells it apart, and no more).
function recPending(rec) {
  const out = { moves: [], added: [], gone: [] }, front = p => p.name.split(" // ")[0];
  for (const o of pendingOps(rec)) {
    if (o.op === "mv") out.moves.push({ name: front(o.p), qty: o.qty, from: recLocName(rec, o.from), to: recLocName(rec, o.to), p: o.p });
    else if (o.op === "add") out.added.push({ name: front(o.p), qty: o.qty, loc: recLocName(rec, o.to), p: o.p });
    else out.gone.push({ name: front(o.p), qty: o.qty, loc: recLocName(rec, o.from), p: o.p });
  }
  const by = (x, y) => x.name.localeCompare(y.name);
  out.moves.sort(by); out.added.sort(by); out.gone.sort(by);
  return out;
}

// ---- What the screens ask of the record while they still speak of locations by name (pieces b and c).
// When a record last changed, in ms: its latest change (0 = it has none). A backup file's collection is compared by it.
function recStamp(rec) { let t = 0; for (const c of rec.changes) { const a = Date.parse(c.at) || 0; if (a > t) t = a; } return t; }
// What a screen says of where a collection came from: {source (its apps' names; with none, the kind of file it last
// took), importedAt (its latest file), parts: [{app, label, cards, at}] (each app's last file)}.
function recAbout(rec) {
  const parts = rec.sources.map(s => { let n = 0; for (const l of s.lines.values()) n += l.qty; return { app: s.app || "", label: s.label || s.app || "a file", cards: n, at: s.at || null }; });
  let last = null; for (let i = rec.changes.length - 1; i >= 0 && !last; i--) if (rec.changes[i].how.by === "file") last = rec.changes[i];
  const apps = [...new Set(parts.map(p => p.app).filter(Boolean))];
  let at = last ? Date.parse(last.at) || 0 : 0; for (const p of parts) at = Math.max(at, Date.parse(p.at) || 0);
  return { source: apps.length ? apps.join(" + ") : last ? last.how.app || "" : "", importedAt: at ? new Date(at).toISOString() : null, parts };
}
// Was this very file taken in before? → {at, added (as more cards: it wasn't the collection itself)}, or null. By
// the latest change a file with that fingerprint made and that still stands, else by an app's last file.
function fileSeen(rec, sig) {
  if (!sig) return null;
  const undone = undoneChanges(rec);
  for (let i = rec.changes.length - 1; i >= 0; i--) { const c = rec.changes[i]; if (c.how.by === "file" && c.how.sig === sig && !undone.has(c.id)) return { at: c.at, added: !c.src || c.src.take === "lines" }; }
  const s = rec.sources.find(x => x.sig === sig);
  return s ? { at: s.at || null, added: false } : null;
}
// What a line remembers of its printing beyond what tells it apart (the Scryfall ID, the rarity), for a copy known
// only by a source's line: read from another copy of that printing, else from the change that last named one.
function recKeeps(rec, k, p) {
  const kp = kpOf(k, p), out = {};
  const take = l => { for (const f of LINE_KEEPS) if (!out[f] && l[f]) out[f] = l[f]; return LINE_KEEPS.every(f => out[f]); };
  for (const l of rec.lines.values()) if (l.k === k && kpOf(k, l) === kp && take(l)) return out;
  for (let i = rec.changes.length - 1; i >= 0; i--) for (const ln of rec.changes[i].lines) if (norm(ln.name) === k && kpOf(k, ln) === kp && take(ln)) return out;
  return out;
}
// **A change said outright**, by a screen that knows exactly which copies it means (a card removed, filed, taken
// back): list = [{name, …printing, qty, from, to}], locations by name (PUT_AWAY = the put-away list, null = nowhere:
// a card added or removed). A location it names as `to` and the record doesn't know comes with the change; one it
// names as `from` and the record doesn't know has no copies to give, so doChange hands the line back.
// → {change} for doChange.
function handChange(rec, list, how, at = null) {
  const N = locNamer(rec), lines = [];
  for (const x of list || []) {
    if (!x || !x.name || !(x.qty > 0)) continue;
    lines.push(chLine(x, Math.floor(x.qty), x.from == null ? null : N.find(x.from) || "\u0000", x.to == null ? null : N.id(x.to)));
  }
  const change = changeOf(how, lines, at), locs = N.locs();
  if (locs.length) change.locs = locs;
  return { change };
}
// **Cards added here** (typed in by name, or a file's cards said to be in one place): cards = [{name, qty,
// …printing}] into the location named `to` (PUT_AWAY = the put-away list). A copy removed here from that location
// comes back first, as the printing it was (the same printing before another): the app's last file still has it
// there, so it is that copy back and not a new card (Nov 12, call 7; as 0.83.0 did it, asked of the sources).
// → {change, added (new copies), back (removals taken back)}.
function planAdd(rec, cards, to, how, at = null) {
  const N = locNamer(rec), toId = N.id(to), lines = []; let added = 0, back = 0;
  const gone = toId === PILE ? [] : pendingOps(rec).filter(o => o.op === "rm" && o.from === toId).map(o => ({ k: o.k, p: o.p, left: o.qty }));
  for (const c of cards || []) {
    if (!c || !c.name || !(c.qty > 0)) continue;
    const k = norm(c.name); let left = Math.floor(c.qty);
    for (const fits of [g => kpOf(k, g.p) === kpOf(k, c), () => true]) for (const g of gone) {
      if (!left) break;
      if (!g.left || g.k !== k || !fits(g)) continue;
      const q = Math.min(left, g.left); g.left -= q; left -= q; back += q;
      lines.push(chLine({ ...g.p, ...recKeeps(rec, k, g.p) }, q, null, toId));
    }
    if (left) { lines.push(chLine(c, left, null, toId)); added += left; }
  }
  const change = changeOf(how, lines, at), locs = N.locs();
  if (locs.length) change.locs = locs;
  return { change, added, back };
}

// **A collection from before 0.88.0, converted** (the first of the two moves of his data; an old backup file is
// read this way too): coll as those versions kept it ({entries, gone?, parts?, source, importedAt, changedAt?,
// recAt?}), `made` the boxes made here (they hold no card, so only the page knows them). **Its marks:** a copy that
// wasn't where the last import had it carried `from` (the location the import has it in); a copy added beside the
// import carried `x` (BY_HAND: added here by name; else the id of the file it came with, one of `parts`); a copy of
// the import removed here was a line in `gone`, by the location the import has it in; `asImported` held the
// import's word on a location while the person's mark said otherwise. Every copy becomes a line where it is now. What the import said becomes the first source:
// each record copy in the location its import has it in (`from`, else where it is) and the copies removed here
// counted back in; a file added beside the record is a source of its own; a copy added here is in no source. So
// "moved here", "added here" and "removed here" still read the same, as differences. The conversion is the first
// change: it lists those differences (for the put-away list's "back where it was"), keeps the collection's own stamp
// as its time (two devices that both convert: the one changed most recently wins, once) and can't be undone.
const BY_HAND = "hand";
// What the import said of each location, a deck or not: by the copies it has there (one only reached by moves made
// here reads as not a deck).
function importWords(entries) {
  const words = new Map();
  for (const e of entries) if (!e.from && !words.has(e.loc)) words.set(e.loc, importedDeck(e));
  return words;
}
function convertCollection(coll, made = [], now = null) {
  const rec = recNew(), N = locNamer(rec), lines = [];
  const entries = (coll.entries || []).filter(e => e && e.name && e.qty > 0), gone = (coll.gone || []).filter(g => g && g.name && g.qty > 0);
  const words = importWords(entries), id = loc => N.id(loc, !!words.get(loc));
  const parts = (coll.parts || []).filter(p => p && p.extra && p.id), main = new Map(), beside = new Map(parts.map(p => [p.id, new Map()]));
  for (const e of entries) {
    const k = norm(e.name), loc = id(e.loc), was = e.from ? id(e.from) : loc;
    lineAdd(rec.lines, k, e, loc, e.qty);
    if (e.x === BY_HAND) { lines.push(chLine(e, e.qty, null, loc)); continue; }
    lineAdd(beside.get(e.x) || main, k, e, was, e.qty, true);
    if (was !== loc) lines.push(chLine(e, e.qty, was, loc));
  }
  for (const g of gone) { const loc = id(g.loc); lineAdd(main, norm(g.name), g, loc, g.qty, true); lines.push(chLine(g, g.qty, loc, null)); }
  for (const m of made || []) id(m);
  for (const l of N.locs()) rec.locs.set(l.id, l);
  const first = (coll.parts || [])[0] || {}, stamp = Math.max(Date.parse(coll.importedAt) || 0, Date.parse(coll.changedAt) || 0);
  const source = (p, lines, at) => { const app = p.source || coll.source || ""; rec.sources.push({ id: newSourceId(rec, app), app, label: p.label || app, at: at || null, sig: p.sig || "", lines }); };
  if (main.size || !parts.length) source(first, main, coll.recAt || first.importedAt || coll.importedAt);
  for (const p of parts) source(p, beside.get(p.id), p.importedAt);
  const on = now || new Date().toISOString();
  rec.changes.push({ id: newChangeId(), at: stamp ? new Date(stamp).toISOString() : on, how: { by: "convert", on, cards: recCount(rec), lines: rec.lines.size, locs: rec.locs.size }, lines });
  return rec;
}

// The record as plain data, to keep and to send, and back. What can't be read is dropped, never guessed, except a
// copy whose location is unknown: it is a card you own, so it waits on the put-away list.
function packRec(rec) { return { v: 1, lines: [...rec.lines.values()].map(packLine), locs: [...rec.locs.values()], changes: rec.changes, sources: rec.sources.map(packSource), ...(rec.forgot.length ? { forgot: rec.forgot } : {}) }; }
function unpackLines(list, loc = l => l, bare = false) {
  const m = new Map();
  for (const l of Array.isArray(list) ? list : []) if (l && typeof l.name === "string" && norm(l.name) && l.qty >= 1 && typeof l.loc === "string") lineAdd(m, norm(l.name), l, loc(l.loc), Math.floor(l.qty), bare);
  return m;
}
function unpackRec(j) {
  const rec = recNew(); if (!j || typeof j !== "object") return rec;
  for (const l of Array.isArray(j.locs) ? j.locs : []) if (l && typeof l.id === "string" && l.id && l.id !== PILE && typeof l.name === "string" && l.name) rec.locs.set(l.id, { id: l.id, name: l.name, ...(l.deck ? { deck: true } : {}), ...(l.kind ? { kind: String(l.kind) } : {}) });
  rec.lines = unpackLines(j.lines, loc => (rec.locs.has(loc) ? loc : PILE));
  rec.changes = (Array.isArray(j.changes) ? j.changes : []).filter(c => c && typeof c.id === "string" && c.how && typeof c.how.by === "string" && Array.isArray(c.lines));
  rec.sources = (Array.isArray(j.sources) ? j.sources : []).filter(s => s && typeof s.id === "string" && s.id).map(s => ({ ...s, lines: unpackLines(s.lines, undefined, true) }));
  rec.forgot = (Array.isArray(j.forgot) ? j.forgot : []).filter(f => Array.isArray(f) && typeof f[0] === "string" && f[0] && f[1] >= 0).map(f => [f[0], +f[1]]);
  return rec;
}

// ---- Collections changed on two devices (step 4, piece d). Matt's six calls of Nov 12 stand: both devices'
// changes are kept; where both touched the same copies the later one stands; something undone on one device stays
// undone; an import in between becomes the record and the other side's changes are made again on it; a merged sync
// says what came in. And Nov 13: when two devices first meet, or one has been away longer than changes are kept,
// "the collection changed most recently wins whole".
// **`theirs` is the shared file** (Dropbox's: one device at a time writes it, each after merging with what was
// there) and `mine` is this device's record. A record knows of its changes by id, in the order they reached it:
// the ids of the ones forgotten of late, then the ones kept (recKnown). That order is the shared file's own, with
// what was done here since at the end, and because forgetting only ever takes from the front, what a record knows
// of is everything since some point. So from the first change both know of, a change one side knows of and the
// other doesn't is one the other never had (recNews), and no memory of the last sync is needed.
//   no change in common          can't be merged: the collection changed most recently wins whole (`whole`)
//   only one side has new ones   that side is taken as it is
//   both have                    one side is taken whole (`base`) and the other's new changes are made again on it,
//                                in their own order, through doChange (makeAgain): nothing is invented. Which side:
//                                the one that took an import (it "becomes the record"; both did: the later import),
//                                else the one changed later
// A change one side made and has since forgotten can't be made again. The shared file may have forgotten changes
// this device never had (a change took longer than changes are kept to get from one device to the other): then it
// is the base whatever else holds, and an import made here meanwhile is left out, to be taken again. This device
// may not (its forgotten ids can't take their place in the shared file's order): then the collection changed most
// recently wins whole, as for a device away too long.
// **The result keeps the shared file's order**, then what was done here: [theirs' changes][mine since]. With mine
// as the base that isn't the order the changes were made in on these lines, which only what reads the list
// backwards for a hint notices (pileOrigins).
const recKnown = rec => [...rec.forgot.map(f => f[0]), ...rec.changes.map(c => c.id)];
// What `a` has that `b` never had → {news: [changes, in a's order], lost (how many more a has forgotten since)}, or
// null when the two know of no change in common.
function recNews(a, b) {
  const ka = recKnown(a), kb = new Set(recKnown(b)), first = ka.findIndex(id => kb.has(id));
  if (first < 0) return null;
  const news = []; let lost = 0;
  for (let i = first + 1; i < ka.length; i++) if (!kb.has(ka[i])) { if (i < a.forgot.length) lost++; else news.push(a.changes[i - a.forgot.length]); }
  return { news, lost };
}
// The same cards in the same places?
function recSame(a, b) {
  if (a.lines.size !== b.lines.size) return false;
  for (const [key, l] of a.lines) { const o = b.lines.get(key); if (!o || o.qty !== l.qty) return false; }
  return true;
}
const cloneRec = rec => unpackRec(JSON.parse(JSON.stringify(packRec(rec))));
const linesQty = lines => lines.reduce((n, l) => n + l.qty, 0);
// A change that makes a file the record or takes that back (an app's next file, a first file taken as the
// collection, Replace everything, the Undo of one): it can't be made again on another collection line by line.
// More cards from a file (a source of their own, `take: "lines"`) can.
const srcImport = c => !!(c.src && c.src.take !== "lines");
// **The other side's new changes, made again on `rec`** (changed in place), in their order. Each keeps its id and
// its time, so both devices end up knowing of the same changes; it is kept as what was made here, and when not
// all of it could be, says how many cards weren't (`how.left`). A change of which nothing could be made is still
// kept, as a mark with no lines (`how.by: "left"`, with what it was, why and how many cards): the device that
// made it then finds it known here and doesn't bring it again. What can't be made, and why:
//   moved    the copies aren't where the change needs them: this side did something else with them (doChange)
//   import   an import (srcImport): this side's later import is the record
//   seen     a file this side took in too: the same file on both devices isn't made twice
//   undone   an Undo of a change that already stands undone here, or of which nothing was made here. An Undo takes
//            back no more than was made here of the change it undoes
//   convert  a collection brought over from before 0.88.0 is never made twice
// More cards from a file begin a source of their own, under another id if this side has one of that name.
// → {made: [the changes as kept, marks too], left (cards)}.
function makeAgain(rec, list) {
  const out = { made: [], left: 0 }, names = new Map(), SEP = LINE_SEP;
  const mark = (c, why) => {
    const m = c.how.by === "left" ? { ...c } : { id: c.id, at: c.at, how: { by: "left", was: c.how.by, why, n: linesQty(c.lines) + (c.how.left || 0), ...(c.how.label ? { label: c.how.label } : {}) }, lines: [] };
    rec.changes.push(m); out.made.push(m); out.left += c.how.by === "left" ? 0 : linesQty(c.lines);
  };
  for (const c of list) {
    let lines = c.lines, src = c.src || null;
    if (c.how.by === "left") { mark(c); continue; }
    if (c.how.by === "convert") { mark(c, "convert"); continue; }
    if (srcImport(c)) { mark(c, "import"); continue; }
    if (c.how.by === "undo") {
      const of = rec.changes.find(x => x.id === c.how.of);
      if (of && undoneChanges(rec).has(of.id)) { mark(c, "undone"); continue; }
      if (of) {
        const room = new Map();
        for (const l of of.lines) { const key = kpOf(norm(l.name), l) + SEP + l.to + SEP + l.from; room.set(key, (room.get(key) || 0) + l.qty); }
        lines = [];
        for (const l of c.lines) { const key = kpOf(norm(l.name), l) + SEP + l.from + SEP + l.to, q = Math.min(l.qty, room.get(key) || 0); if (q) { room.set(key, room.get(key) - q); lines.push(q === l.qty ? l : { ...l, qty: q }); } }
        if (!lines.length) { mark(c, "undone"); continue; }
      }
    } else if (c.how.by === "file" && fileSeen(rec, c.how.sig)) { mark(c, "seen"); continue; }
    if (src) {
      let id = names.get(src.id) || src.id;
      if (!src.from && rec.sources.some(s => s.id === id)) { id = newSourceId(rec, src.app); names.set(src.id, id); }
      if (id !== src.id) src = { ...src, id };
    }
    const { src: _s, ...rest } = c, r = doChange(rec, { ...rest, lines, ...(src ? { src } : {}) });
    if (!r.change || (!r.made.length && c.lines.length)) {
      if (r.change) { rec.changes.pop(); if (src && !src.from) rec.sources = rec.sources.filter(x => x.id !== src.id); }   // a source begun with no card
      mark(c, "moved"); continue;
    }
    const left = linesQty(c.lines) - linesQty(r.made);
    if (left > 0) r.change.how = { ...r.change.how, left: left + (c.how.left || 0) };
    out.made.push(r.change); out.left += left;
  }
  return out;
}
// **A sync's answer for the collection.** → {take, rec, …}:
//   take: "mine"     keep this device's record (`rec` is `mine` itself); the shared file has nothing it lacks
//   take: "theirs"   take the shared file's (`rec` is `theirs` itself); `came`: its changes that are new here
//   take: "merged"   `rec` is a new record: `base` ("mine" | "theirs", the side taken whole), `came` (their new
//                    changes as they stand in it), `sent` (this device's), `left` (cards of the other side's changes
//                    that couldn't be made), `theirsAt` (when their side last changed, ms)
//   whole: true      with take "mine" or "theirs": the two can't be merged and the collection changed most recently
//                    wins whole; `same`: both hold the same cards in the same places, so nothing is lost by it
// Nothing is touched. Merging the answer with either side again changes nothing, and with no forgotten changes in
// play the cards end up the same whichever of the two is called mine.
function mergeRecs(mine, theirs) {
  const empty = r => !r || !(r.lines.size || r.changes.length || r.sources.length);
  if (empty(theirs)) return { take: "mine", rec: mine };
  if (empty(mine)) return { take: "theirs", rec: theirs, came: theirs.changes };
  const lastAt = list => list.reduce((t, c) => Math.max(t, Date.parse(c.at) || 0), 0), lastId = list => list.reduce((m, c) => (c.id > m ? c.id : m), "");
  const later = (a, b) => { const ta = lastAt(a), tb = lastAt(b); return ta !== tb ? (ta > tb ? "mine" : "theirs") : lastId(a) > lastId(b) ? "mine" : "theirs"; };
  const whole = () => { const take = later(mine.changes, theirs.changes); return { take, rec: take === "mine" ? mine : theirs, whole: true, same: recSame(mine, theirs) }; };
  const U = recNews(mine, theirs), V = recNews(theirs, mine);
  if (!U || !V) return whole();
  if (!U.news.length && !U.lost) return { take: "theirs", rec: theirs, came: V.news };
  if (!V.news.length && !V.lost) return { take: "mine", rec: mine, sent: U.news };
  const mi = U.news.filter(srcImport), ti = V.news.filter(srcImport);
  if (U.lost) return whole();
  const base = V.lost ? "theirs" : mi.length && !ti.length ? "mine" : ti.length && !mi.length ? "theirs" : mi.length ? later(mi, ti) : later(U.news, V.news);
  const rec = cloneRec(base === "mine" ? mine : theirs), r = makeAgain(rec, base === "mine" ? V.news : U.news);
  if (base === "mine") {
    const by = new Map(rec.changes.map(c => [c.id, c])), own = new Set(U.news.map(c => c.id));
    rec.changes = [...theirs.changes.map(c => by.get(c.id) || JSON.parse(JSON.stringify(c))), ...rec.changes.filter(c => own.has(c.id))];
    rec.forgot = theirs.forgot.map(f => [f[0], f[1]]);
  }
  const sent = new Set(U.news.map(c => c.id)), came = new Set(V.news.map(c => c.id));
  return { take: "merged", rec, base, came: rec.changes.filter(c => came.has(c.id)), sent: rec.changes.filter(c => sent.has(c.id)), left: r.left, theirsAt: lastAt(V.news) };
}

// ------------------------------------------------------------ reading a collection file (the engine's since 0.87.2)
// An app's CSV export or a pasted list → {entries, source (the app, by the columns only it has), noLoc (the file
// names no locations)}. Here, and not with the import screen, so the apps' real exports are checked without a
// browser. `prefix` = the person's deck prefix: a location whose name starts with it is a deck by the file's word.
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
// Which app a CSV came from, by the columns only it has (checked Nov 7 2026). Only the name is used: it's shown as
// the collection's source. Locations come from whichever column names one (ManaBox binders, Dragon Shield folders).
// Archidekt's default export has no "oracle id" (Matt's, Nov 13: it read as Cardsphere): "multiverse id" beside
// "edition code" is its mark there.
const CSV_SOURCES = [["ManaBox", ["binder name"]], ["Dragon Shield", ["folder name"]], ["Deckbox", ["tradelist count", "signed"]],
  ["Moxfield", ["tradelist count"]], ["TCGplayer", ["simple name"]], ["Archidekt", ["oracle id"]], ["Archidekt", ["edition code", "multiverse id"]], ["Helvault", ["oracle_id"]],
  ["Cardsphere", ["edition code"]], ["MTGGoldfish", ["variation"]], ["Deckstats", ["card_name"]]];
function readCollection(text, prefix = "") {
  const deck = loc => !!prefix && loc.toLowerCase().startsWith(prefix.toLowerCase());
  text = text.replace(/^\ufeff/, "").replace(/^"?sep=.?"?\r?\n/i, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  if (firstLine.includes(",")) {
    const rows = parseCSV(text);
    const head = rows[0].map(h => h.trim().toLowerCase());
    const find = names => head.findIndex(h => names.includes(h));
    const nameCol = find(["name", "card name", "card", "cardname", "card_name"]);
    if (nameCol >= 0) {
      const qtyCol = find(["quantity", "count", "qty", "amount", "total quantity"]);
      const locCol = find(["binder name", "folder name", "binder", "location", "list", "folder", "collection", "category"]);
      const typeCol = find(["binder type"]);
      const sidCol = find(["scryfall id", "scryfall_id", "scryfallid"]);
      const source = (CSV_SOURCES.find(([, cols]) => cols.every(c => head.includes(c))) || ["CSV"])[0];
      // The copy's own printing and condition (0.67.0; engine printFields keeps what is usable). A set's code only from
      // a column that holds codes: "edition" is the code in Moxfield's export and the set's name in others.
      const print = { set: find(["set code", "edition code", "set_code", "setcode"]), cn: find(["collector number", "collector_number", "card number", "collector #"]),
        foil: find(["foil", "finish", "printing"]), rar: find(["rarity"]), cond: find(["condition"]), lang: find(["language", "lang"]) };
      if (print.set < 0 && source === "Moxfield") print.set = find(["edition"]);
      const cell = (r, col) => (col >= 0 ? r[col] || "" : "");
      const entries = [];
      for (const r of rows.slice(1)) {
        const name = (r[nameCol] || "").trim();
        if (!name) continue;
        const qty = Math.max(1, parseInt(r[qtyCol], 10) || 1);
        const loc = (locCol >= 0 && r[locCol] || "").trim() || "Collection";
        const btype = typeCol >= 0 ? (r[typeCol] || "").trim().toLowerCase() : "";
        entries.push({ name, qty, loc, inDeck: btype === "deck" || deck(loc),
          ...printFields({ sid: cell(r, sidCol), set: cell(r, print.set), cn: cell(r, print.cn), foil: cell(r, print.foil), rar: cell(r, print.rar), cond: cell(r, print.cond), lang: cell(r, print.lang) }) });
      }
      return { entries, source, noLoc: locCol < 0 };
    }
  }
  const entries = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("//") || line.startsWith("#") || /:$/.test(line)) continue;
    let qty = 1;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (m) { qty = parseInt(m[1], 10); line = m[2]; }
    // A line may name the printing as the deck sites write it: "Sol Ring (C21) 263 *F*" (*F* foil, *E* etched).
    const mark = (line.match(/\*([A-Z]+)\*/) || [])[1] || "";
    line = line.replace(/\s*\*[A-Z]+\*\s*/g, " ")
      .replace(/\s+\[[^\]]*\]\s*$/, "").trim();
    const pr = line.match(/\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w★-]+))?\s*$/);
    if (pr) line = line.slice(0, pr.index).trim();
    if (line) entries.push({ name: line, qty, loc: "Pasted list", inDeck: false,
      ...printFields({ set: pr ? pr[1] : "", cn: pr && pr[2] || "", foil: mark === "F" ? "foil" : mark === "E" ? "etched" : "" }) });
  }
  return { entries, source: "Pasted list", noLoc: true };
}

// ---- Filing rules (0.70.0, the review's step 6; Matt, Nov 11: "something like email apps sorting rules… Maybe just a
// sequential style, 'if a card has x characteristic, put it in this spot'"). RULES = {list: [{id, f, op?, v, to}], rest,
// at}: read top to bottom, and the first rule that fits a copy and whose place can take cards decides where the copy
// goes; `rest` ("Everything else") is a last rule that fits every card ("" = none). A rule reads one thing, `f`:
//   price  op ge | lt     v a number: the copy's own printing and finish in the currency in use (copyPrice); a copy with
//                         no price fits no price rule
//   type   v a type code (C I S A E P B L) or "basic" (a basic land, which is also a Land)
//   color  v W U B R G (that colour alone), M (two or more), C (none): the card's own colours, as the quick filters
//          read them (cardColors), so a land is colourless; with `by: "id"` (0.71.0; Matt, Nov 12: lands "are
//          restricted by the commander's color identity") its colour identity, as Commander counts it (the card
//          table's colours: a Mountain is red, Command Tower has none)
//   mv     op ge | le | eq   v a whole number; lands are left out, as in the quick filters
//   name   op starts | has   v text, compared the way names are matched (norm); "has" looks at every face
//   set    v a set code;  rar  v c u r m s b;  foil  v "foil" (foil or etched) | "non": the copy's own
// Type, colour and mana value need the card data to know the card (a basic land is known without it); a card the data
// doesn't know fits none of them. Rules apply to the cards in the put-away pile only (Matt, Nov 12): nothing asks you
// to move a card that is already filed.
let RULES = { list: [], rest: "", at: 0 };
const RULE_TYPES = ["C", "I", "S", "A", "E", "P", "B", "L", "basic"];
const RULE_MAX = 60;
function canonRule(r) {
  if (!r || typeof r !== "object" || typeof r.to !== "string" || !r.to || typeof r.id !== "string" || !r.id || r.id === "rest") return null;
  const f = r.f; let op = "", v;
  if (f === "price") { v = Math.round(+r.v * 100) / 100; if (!(v > 0)) return null; op = r.op === "lt" ? "lt" : "ge"; }
  else if (f === "type") { v = String(r.v); if (!RULE_TYPES.includes(v)) return null; }
  else if (f === "color") { v = String(r.v); if (v.length !== 1 || !"WUBRGMC".includes(v)) return null; if (r.by === "id") return { id: r.id, f, v, by: "id", to: r.to }; }
  else if (f === "mv") { v = Math.round(+r.v); if (!(v >= 0 && v <= 99)) return null; op = ["ge", "le", "eq"].includes(r.op) ? r.op : "ge"; }
  else if (f === "name") { v = String(r.v == null ? "" : r.v).trim().slice(0, 60); if (!norm(v)) return null; op = r.op === "has" ? "has" : "starts"; }
  else if (f === "set") { v = String(r.v || "").toLowerCase(); if (!/^[a-z0-9]{2,6}$/.test(v)) return null; }
  else if (f === "rar") { v = String(r.v); if (v.length !== 1 || !"curmsb".includes(v)) return null; }
  else if (f === "foil") { v = r.v === "foil" ? "foil" : r.v === "non" ? "non" : ""; if (!v) return null; }
  else return null;
  return op ? { id: r.id, f, op, v, to: r.to } : { id: r.id, f, v, to: r.to };
}
// Whatever was stored or synced → rules that can be read: a rule that isn't one is dropped, never guessed.
function canonRules(j) {
  const list = [], seen = new Set();
  for (const r of j && Array.isArray(j.list) ? j.list : []) { const c = canonRule(r); if (c && !seen.has(c.id) && list.length < RULE_MAX) { seen.add(c.id); list.push(c); } }
  return { list, rest: j && typeof j.rest === "string" ? j.rest : "", at: (j && +j.at) || 0 };
}
function setRules(j) { RULES = canonRules(j); CHANGE++; return RULES; }
// Does one copy (a collection entry) fit a rule?
function ruleFits(r, e) {
  if (r.f === "price") { const p = copyPrice(e); return p > 0 && (r.op === "lt" ? p < r.v : p >= r.v); }
  if (r.f === "name") { const faces = String(e.name).split(" // ").map(norm), v = norm(r.v); return !!v && (r.op === "has" ? faces.some(n => n.includes(v)) : faces[0].startsWith(v)); }
  if (r.f === "set") return (e.set || "") === r.v;
  if (r.f === "rar") return copyPrint(e).rar === r.v;
  if (r.f === "foil") return r.v === "foil" ? !!e.foil : !e.foil;
  if (r.f === "type" && r.v === "basic") return isBasic(e.name);
  const c = DATA ? cardOf(e.name) : null, basic = !c && isBasic(e.name);   // a basic land is known even when the card table lacks it
  if (r.f === "color") {
    if (!c && !basic) return false;
    const cs = r.by === "id" ? (c ? c[1] : basicColor(e.name) || "").replace("C", "") : c ? cardColors(e.name) : "";
    return r.v === "M" ? cs.length > 1 : r.v === "C" ? !cs : cs === r.v;
  }
  if (!c) return r.f === "type" && r.v === "L" && basic;
  if (r.f === "type") return c[2] === r.v;
  if (r.f === "mv") { if (c[2] === "L") return false; const mv = c[4] || 0; return r.op === "le" ? mv <= r.v : r.op === "eq" ? mv === r.v : mv >= r.v; }
  return false;
}
// The rule that files a copy → {id, to} ("rest" = Everything else) or null. `ok` = the places that can take cards.
function ruleFor(e, ok) {
  for (const r of RULES.list) if (ok.has(r.to) && ruleFits(r, e)) return { id: r.id, to: r.to };
  return RULES.rest && ok.has(RULES.rest) ? { id: "rest", to: RULES.rest } : null;
}
// Why a rule's place can't take cards: "" (it can), "deck" (it holds a deck now: cards put there would count as part
// of it) or "gone" (no card of the collection is there and it isn't a box made here, so nothing says it exists).
function rulePlaceState(to, ok = null) {
  if (!ok) ok = new Set(putAwayPlaces().map(p => p.loc));
  if (ok.has(to)) return "";
  return (COLL ? COLL.entries : []).some(e => e.loc === to && e.qty > 0) ? "deck" : "gone";
}
// The rules that are passed over for now, "Everything else" included: [{id, to, state}].
function rulesSkipped(ok = null) {
  if (!ok) ok = new Set(putAwayPlaces().map(p => p.loc));
  const out = [];
  for (const r of RULES.list) if (!ok.has(r.to)) out.push({ id: r.id, to: r.to, state: rulePlaceState(r.to, ok) });
  if (RULES.rest && !ok.has(RULES.rest)) out.push({ id: "rest", to: RULES.rest, state: rulePlaceState(RULES.rest, ok) });
  return out;
}
// Where the rules would send every copy of the collection that isn't in a deck, were it in the pile: for trying rules
// out on what is already filed. → {total, placed, same, by: Map(to → cards), none} (cards, not rows; `same` = sent to
// the place they are already in).
function rulesTrial() {
  const ok = new Set(putAwayPlaces().map(p => p.loc)), by = new Map();
  let total = 0, placed = 0, same = 0, none = 0;
  for (const e of COLL ? COLL.entries : []) {
    if (e.qty <= 0 || e.inDeck || swapsBase(e.loc) != null) continue;
    total += e.qty;
    const f = ruleFor(e, ok);
    if (!f) { none += e.qty; continue; }
    placed += e.qty; by.set(f.to, (by.get(f.to) || 0) + e.qty);
    if (f.to === e.loc) same += e.qty;
  }
  return { total, placed, same, by, none };
}

// ---- The put-away list (0.65.0, the review's step 6). Cards a deck no longer uses wait in PUT_AWAY until they are filed.
// A place to file a card: any location that isn't a deck, a hot-swap's Swaps location or the pile itself, and since
// 0.72.0 a box or binder made here that holds nothing yet (qty 0). → [{loc, qty}] by the names shown.
function putAwayPlaces() {
  const m = new Map();
  for (const e of COLL ? COLL.entries : []) {
    if (e.loc === PUT_AWAY || swapsBase(e.loc) != null) continue;
    const o = m.get(e.loc) || { loc: e.loc, qty: 0, deck: false };
    o.qty += e.qty; if (e.inDeck) o.deck = true; m.set(e.loc, o);
  }
  if (COLL) for (const loc of MADE) if (!m.has(loc) && loc !== PUT_AWAY && swapsBase(loc) == null) m.set(loc, { loc, qty: 0, deck: false });
  return [...m.values()].filter(o => !o.deck).map(({ deck, ...o }) => o).sort((a, b) => locName(a.loc).localeCompare(locName(b.loc), undefined, { numeric: true }));
}
// Each card waiting in the pile and where it goes: {id, k, name, qty, origin, sid, to, why, rule, prints, copies}. A
// line is one card and one origin (where those copies go back to: an entry's `from`, engine recEntries), so filing a
// line moves exactly them; since 0.70.0 the copies a filing rule places are lines of their own (`rule` = the rule's
// id, "rest" for Everything else; `id` ends in it), because two printings of a card can go to two places. `prints`
// names the printings a line holds (printKey) and **`copies` is the line's cards as the very printings they are**
// ([{name, …printing, qty}], 0.90.0): what the screen hands to handChange to file them, as a change said outright.
// `to`, in this order: where the first filing rule that fits sends the copy (why "rule": a rule beats "came from
// here", Matt, Nov 11 and 12); else the place it was taken from here (why "back": going there undoes the move, and
// ManaBox never hears of it); else the place holding the most other copies (why "copy"); else null: the person picks.
// A deck is never a place, so a card that left a deck the import has it in gets no "back", and a rule that points at
// one is passed over (`skipped`: rulesSkipped).
function putAwayPlan() {
  const places = putAwayPlaces(), ok = new Set(places.map(p => p.loc)), lines = new Map();
  for (const e of COLL ? COLL.entries : []) {
    if (e.loc !== PUT_AWAY || e.qty <= 0) continue;
    const k = norm(e.name), origin = e.from || e.loc, f = ruleFor(e, ok), id = k + "|" + origin + (f ? "|" + f.id : ""), pk = printKey(e);
    let x = lines.get(id);
    if (x) { x.qty += e.qty; if (!x.sid && e.sid) x.sid = e.sid; if (!x.prints.includes(pk)) x.prints.push(pk); }
    else lines.set(id, x = { id, k, name: e.name.split(" // ")[0], qty: e.qty, origin, sid: e.sid || null, to: f ? f.to : null, why: f ? "rule" : "", rule: f ? f.id : null, prints: [pk], copies: [] });
    const same = x.copies.find(c => c.name === e.name && printKey(c) === pk);
    if (same) same.qty += e.qty; else x.copies.push({ name: e.name, ...printOnly(e), qty: e.qty });
  }
  for (const l of lines.values()) {
    if (l.rule) continue;
    if (ok.has(l.origin)) { l.to = l.origin; l.why = "back"; continue; }
    const a = AGG.get(l.k), held = a ? [...a.locs].filter(([loc]) => ok.has(loc)) : [];
    if (!held.length) continue;
    held.sort((x, y) => y[1].qty - x[1].qty || locName(x[0]).localeCompare(locName(y[0]), undefined, { numeric: true }));
    l.to = held[0][0]; l.why = "copy";
  }
  return { lines: [...lines.values()], places, skipped: rulesSkipped(ok) };
}

const isBasic = name => BASICS.has(norm(name));
// Where to pull a card from: a free copy if there is one, otherwise the deck it's in.
// For a build made from one of your decks (home), cards already in that deck need no pulling.
function cardStatus(name, qty = 1, home = null) {
  const a = AGG.get(norm(name));
  if (!a) return { kind: isBasic(name) ? "basic" : "missing", also: [] };
  if (home && a.locs.has(home)) return { kind: "here", loc: home, also: [] };
  const locs = [...a.locs.entries()].sort((x, y) => (x[1].inDeck - y[1].inDeck) || x[0].localeCompare(y[0], undefined, { numeric: true }));
  const free = locs.filter(l => !l[1].inDeck);
  if (free.length) return { kind: "free", loc: free[0][0], also: locs.slice(1).map(l => locName(l[0]) + (l[1].inDeck ? " (deck)" : "")), short: Math.max(0, qty - a.free) };
  return { kind: "indeck", loc: locs[0][0], also: locs.slice(1).map(l => locName(l[0])), short: Math.max(0, qty - a.qty) };
}

// ------------------------------------------------------------ owned substitutes
// Each card in the card table carries role bits (ramp, removal, ...) from Scryfall Tagger.
// A substitute is a card you own that shares a role, fits the colors, and isn't already in the list.
const ROLE_COUNTED = ["Ramp", "Card draw", "Removal", "Board wipe", "Counterspell", "Tutor", "Recursion", "Protection", "Sac outlet", "Tokens", "Lifegain"];
const ROLE_CORE = new Set(["Ramp", "Card draw", "Removal", "Board wipe"]);
// How much a shared role counts toward a swap. Mana rock/dork refine Ramp; tokens and lifegain are often side effects.
const ROLE_WEIGHT = { "Ramp": 10, "Card draw": 10, "Removal": 10, "Board wipe": 10, "Counterspell": 10, "Tutor": 10,
  "Recursion": 8, "Protection": 8, "Sac outlet": 6, "Tokens": 4, "Lifegain": 3, "Mana rock": 3, "Mana dork": 3 };
const hasRoles = () => !!(DATA && Array.isArray(DATA.roles));
const roleBits = name => { const c = DATA && cardOf(name); return c && c.length > 5 ? c[5] || 0 : 0; };
const popcount = n => { let c = 0; while (n) { n &= n - 1; c++; } return c; };
const roleList = bits => (hasRoles() ? DATA.roles.filter((_, i) => (bits >> i) & 1) : []);

function substitutes(name, { identity = null, exclude = new Set(), limit = 3 } = {}) {
  const target = DATA && cardOf(name), mask = roleBits(name);
  if (!target || !mask) return [];
  const weightOf = bits => Math.max(0, ...DATA.roles.map((r, bit) => ((bits >> bit) & 1 ? ROLE_WEIGHT[r] ?? 5 : 0)));
  const mainJob = Math.min(weightOf(mask), 8);   // a swap must share the card's main job, not just a side effect
  const out = [];
  for (const [k, a] of AGG) {
    if (exclude.has(k) || k === norm(name) || BASICS.has(k) || isBlocked(a.name)) continue;
    const c = cardOf(a.name);
    if (!c || c.length < 6) continue;
    const shared = c[5] & mask;
    if (!shared || weightOf(shared) < mainJob) continue;
    if (identity && [...c[1]].some(ch => ch !== "C" && !identity.has(ch))) continue;
    let score = 0;                                                        // shared jobs, weighted by how central they are
    for (let bit = 0; bit < DATA.roles.length; bit++) {
      const w = ROLE_WEIGHT[DATA.roles[bit]] ?? 5;
      if ((shared >> bit) & 1) score += w;
      else if (((c[5] & ~mask) >> bit) & 1 && w >= 5) score -= 1;          // a little less for unrelated main jobs
    }
    if (c[2] === target[2]) score += 4;                                   // same card type
    score -= Math.min(Math.abs((c[4] || 0) - (target[4] || 0)), 4);       // similar mana value
    if (a.free > 0) score += 6;                                           // free beats pulling from a deck
    if (c[6]) score += Math.max(0, 4 - Math.log10(c[6]));                 // widely played
    out.push({ name: c[0], score, shared, st: cardStatus(c[0]) });
  }
  return out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).slice(0, limit);
}
// ------------------------------------------------------------ preferences: your taste in cards
// Two kinds of signal, kept apart:
// - Taste (`level`), set only by you in the card sheet: Never (−2) · Less (−1) · Neutral (0) · More (1) ·
//   Always (2). Never keeps a card out of the generator, tuning and substitutes; Less and More move its
//   score; Always puts it in every generated deck it fits (when a copy is free to use).
// - Dismissals (`dismissed`), counted by "Not for this build": each lowers the score a little, so one
//   dismissal is a nudge and a card you keep dismissing sinks. The app never turns these into a taste.
// Kept in bt.prefs and synced with builds; each card's entry carries `at`, and the newer entry wins when
// devices merge. `blocked` (0.16.0) is still written as level === −2 so older versions read it.
const TASTE = [[-2, "Never"], [-1, "Less"], [0, "Neutral"], [1, "More"], [2, "Always"]];
let PREFS = { cards: {} };
const prefOf = name => PREFS.cards[norm(name)] || null;
const tasteOf = name => { const p = prefOf(name); return p ? (p.level != null ? p.level : p.blocked ? -2 : 0) : 0; };
const isBlocked = name => tasteOf(name) === -2;
const dismissCount = name => { const p = prefOf(name); return (p && p.dismissed) || 0; };
const tasteName = level => (TASTE.find(t => t[0] === level) || TASTE[2])[1];
// Cards with a taste set or dismissals counted, strongest feelings first.
const markedCards = () => Object.values(PREFS.cards).filter(p => (p.level || 0) !== 0 || p.blocked || p.dismissed > 0)
  .sort((a, b) => Math.abs(b.level || 0) - Math.abs(a.level || 0) || (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
const hiddenCards = markedCards;
// ------------------------------------------------------------ generator: a build from cards you own
// Pick a commander; its rules text suggests themes (fetcher THEME_SPECS → DATA.wants), which the person
// can switch on and off. Every deck gets the usual jobs (GEN_SLOTS) filled first, themed cards first;
// the rest goes to cards that fit the themes or tribe, complete combos, or are simply strong; then
// nonbasic lands that make the right colours and basics in proportion. Scores also lean on popularity
// (Scryfall's EDHREC rank), the mana curve, and the person's own habits (cards they play, cards they
// dismiss). No deck data from any site is needed; an EDHREC average or other source could later add
// one more scoring signal.
const hasThemes = () => !!(DATA && Array.isArray(DATA.themes) && Array.isArray(DATA.cardThemes));
const GEN_SLOTS = [["Ramp", 10], ["Card draw", 10], ["Removal", 8], ["Board wipe", 3], ["Protection", 2]];
const JOB_SLACK = 2, JOB_OVER = 2;   // free fill: past quota + 2, each more card for a job costs 2 more
// Mana first (Matt, Nov 9: "Can't play the game if you aren't generating mana reliably"): before anything themed, half the
// ramp quota goes to reliable mana: a mana rock, a mana dork or a land-fetching spell of mana value 3 or less. They are ranked
// without the themes or the playstyle (a Treasure maker that happens to be on plan used to beat Sol Ring to the slot), so the
// dial still picks which mana, and Jank gets obscure rocks. opts.mana "best" ranks them by plain popularity whatever the dial
// says ("best you own"; the page offers it at Unusual and Jank, where it changes anything).
const MANA_FIRST = 0.5, MANA_MV = 3;
function reliableMana(i, c) {
  if (!c || c[2] === "L" || (c[4] || 0) > MANA_MV || !hasRoles()) return false;
  const has = r => { const b = DATA.roles.indexOf(r); return b >= 0 && !!(((c[5] || 0) >> b) & 1); };
  if (!has("Ramp")) return false;
  if (has("Mana rock") || has("Mana dork")) return true;
  const lb = hasThemes() ? DATA.themes.indexOf("Lands") : -1;
  return lb >= 0 && "SIE".includes(c[2]) && !!(((DATA.cardThemes[i] || 0) >> lb) & 1);
}
const BASIC_FOR = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
const themeNames = bits => (hasThemes() ? DATA.themes.filter((_, i) => (bits >> i) & 1) : []);
function commanderWants(names) {
  let themes = 0; const tribes = [], counted = [];
  for (const n of names) {
    const i = LOOKUP.get(norm(n)), w = DATA && DATA.wants && i != null ? DATA.wants[String(i)] : null;
    if (!w) continue;
    themes |= w[0] || 0;
    for (const t of w[1] || []) if (!tribes.includes(t)) tribes.push(t);
    for (const t of w[2] || []) if (!counted.includes(t)) counted.push(t);
  }
  return { themes, tribes, counted };
}
// Tribes and tokens (format 10, DATA.makes: card index → [1 if it makes several or keeps making them, subtype…]). A card fits
// a tribe as a card of the type (or a Changeling), or by making tokens of the type: Matt, Nov 9, a commander that counts
// Humans "just wants a bunch of humans, token or permanent". Levels set the weight beside a theme hit: 1 = a card of the
// type (one above a theme hit), 0 = makes the type's tokens (a theme hit: a body, without the card's own tribal text),
// 2 = makes several for a commander that counts the tribe (DATA.wants' third list; "tribal decks that go wide, like
// goblins"): three Goblins outrank one.
const makesOf = i => (DATA && DATA.makes && DATA.makes[i]) || null;
const isChangeling = c => !!(DATA.keywords && c.length > 9 && c[9].some(k => DATA.keywords[k] === "Changeling"));
const inTribe = (i, c, t) => (c.length > 8 && c[8].includes(t)) || isChangeling(c) || !!(makesOf(i) && makesOf(i).indexOf(t, 1) > 0);
function tribeFit(i, c, tribes, counted, had = tribes) {
  if (!tribes || !tribes.length) return null;
  const subs = c.length > 8 ? c[8] : [], m = makesOf(i);
  const own = subs.find(x => tribes.includes(x)), made = m ? m.slice(1).find(x => tribes.includes(x)) : undefined;
  const wide = made != null && m[0] && (counted || []).some(t => m.indexOf(t, 1) > 0);
  if (own != null) return { name: DATA.subtypes[own], level: wide ? 2 : 1 };
  if (isChangeling(c)) return { name: "Changeling", level: wide ? 2 : 1 };
  if (made != null) return { name: DATA.subtypes[wide ? m.slice(1).find(t => counted.includes(t)) : made] + " tokens", level: wide ? 2 : 0 };
  // A card that pays off for the tribe without being one (Door of Destinies in a Vampire deck): a theme hit.
  const nd = needOf(i), t = nd ? (nd[0] === -2 ? (had.cast || had)[0] : nd[0] < 0 ? had[0] : nd.find(x => had.includes(x))) : null;
  return t != null ? { name: DATA.subtypes[t], level: 0 } : null;
}
// ------------------------------------------------------------ what a card needs (format 11; the Nov 10 review, step 2)
// The generator scored a card for fitting the plan and took nothing off for needing a plan the deck isn't on: Herald's Horn
// filled a Card draw slot and Secluded Courtyard "made W/B/R" in 152 of the 173 decks generated from Matt's collection.
// DATA.needs (fetcher card_needs): card index → [-1], creatures of a type you choose; [-2], spells or cards of a type you
// choose; or the creature types it names (any one will do). Two questions, because cards are picked before the deck exists
// and lands after:
// - A plan has a creature type (tribesHad) when it's one of its tribes (the chips in the generator) and you can field it:
//   NEED.tribe cards you can use in the commander's colours that are creatures of the type or make its tokens, or a
//   commander that keeps making them. A commander's text naming Spiders isn't a Spider deck when you own none. For [-2]
//   only the creature cards count (.cast): Toxrill's Slug tokens work with Vanquisher's Banner, not with Herald's Horn.
// - A deck has a creature type (deckHas) when it holds NEED.tribe creatures of it: that's what a land's mana can cast,
//   whatever the plan says, and it's all there is to go on for a deck that wasn't generated. Tuning and a card's reasons
//   count both (deckOpts): the plan's types you can field, and the types the deck already holds.
// A card whose need the plan doesn't meet: out of the generator's pool (genPool's spare, used only to fill a deck that would
// otherwise come up short, its row saying so), NEED.pen off its score (tuning cuts it first), no theme or tribe credit.
// One that needs the tribe and gets it is on the plan (tribeFit).
// NEED: tribe = the creatures of a type that make it one a deck has (about one creature in three); cards = the nonland cards
// of a card type before a land for that type counts (landMakes); legends = the legendary nonland cards before a land for
// legendary spells counts; yard = the cards on the Graveyard plan a deck needs as well before a land that reads your
// graveyard's legendary creatures counts; pen = off the score of a card whose need isn't met. One object so tests can
// loosen it for the small demo pool. **legends and yard are placeholders** (Matt, Nov 10: "It might work for my
// collection, but I want to compare against some real player decks on this theme. I have a feeling the number will be
// higher"): set them again from real decks built around legendary cards. Today they sit just above what a deck holds
// without trying: of 173 decks
// generated from Matt's collection (Nov 10), nine in ten held 11 or fewer legendary nonland cards (median 5) and, when the
// commander didn't ask for the graveyard, 8 or fewer cards on that plan (median 5); the seven decks whose commander asks
// for legendary cards held 10 to 35, and every one that asks for the graveyard 12 to 51.
const NEED = { tribe: 10, cards: 25, legends: 12, yard: 12, pen: 8 };
// ------------------------------------------------------------ legendary cards (format 12; Matt, Nov 10)
// Three facts from the fetcher: the card flag (a legendary front face, any card type; DATA.facts lists "legendary"), the
// Legendaries theme (DATA.cardThemes: a card whose text cares about legendary or historic cards of yours), and
// DATA.legendsOf (commander index → the card-type bits of the legendary cards its text is about: Frodo Baggins'
// "another legendary creature you control" is creatures; left out when any legendary card will do; 1 when it asks for
// historic cards). Put together here: on a plan with Legendaries, a legendary card of a kind the commanders ask for is
// on the plan as well as the cards that care (planThemes), so Frodo's deck counts legendary creatures and Jodah's every
// legendary card. A commander that doesn't ask (you switched the chip on yourself) takes any. Everything that matches a
// card to a plan's themes reads planThemes; rawThemes is only what the card's own text does.
// Historic is Magic's word for artifacts, legendaries and Sagas (Matt, Nov 10: "should be searchable and understood by
// Bulk Tutor. Doesn't need a separate tag so long as the app understands the meaning"): isHistoric says so from the card
// row, the search finds "historic" and "legendary" (the page's cardWords), and for a commander that asks for historic
// cards a Saga is on the plan with the legendaries (its artifacts come with the Artifacts theme, which it wants too).
const FLAG_LEGENDARY = 1048576;
const hasLegendary = () => !!(DATA && Array.isArray(DATA.facts) && DATA.facts.includes("legendary"));
const isLegendary = c => !!c && hasLegendary() && !!(c[7] & FLAG_LEGENDARY);
const legendsBit = () => (hasLegendary() && hasThemes() ? DATA.themes.indexOf("Legendaries") : -1);
let SAGA_IDX = { of: null, i: -1 };
const isSaga = c => { if (!c || !DATA || !DATA.subtypes) return false; if (SAGA_IDX.of !== DATA) SAGA_IDX = { of: DATA, i: DATA.subtypes.indexOf("Saga") };
  return SAGA_IDX.i >= 0 && c.length > 8 && c[8].includes(SAGA_IDX.i); };
const isHistoric = c => !!c && (isLegendary(c) || isSaga(c) || (hasFacts() ? !!(c[7] & 512) : c[2] === "A"));
const HISTORIC = 1;
// The kinds of legendary card these commanders ask for: card-type bits, none = any; bit 1 (HISTORIC) when one asks for
// historic cards, so Sagas count too; -1 = data without legendary cards.
let KINDS_CACHE = { key: "", kinds: -1 };
function legendKinds(commanders) {
  const lb = legendsBit(); if (lb < 0) return -1;
  const key = DATA.version + "~" + (commanders || []).join("|");
  if (KINDS_CACHE.key !== key) {
    let bits = 0, any = false, asked = false, historic = false;
    for (const n of commanders || []) {
      const i = LOOKUP.get(norm(canonical(n))), w = i == null || !DATA.wants ? null : DATA.wants[i];
      if (!w || !((w[0] >> lb) & 1)) continue;
      asked = true; const k = (DATA.legendsOf && DATA.legendsOf[i]) || 0;
      if (k & HISTORIC) historic = true;
      if (k & ~HISTORIC) bits |= k & ~HISTORIC; else any = true;
    }
    KINDS_CACHE = { key, kinds: (!asked || any ? 0 : bits) | (historic ? HISTORIC : 0) };
  }
  return KINDS_CACHE.kinds;
}
const legendFits = (c, kinds) => kinds >= 0 && ((isLegendary(c) && (!(kinds & ~HISTORIC) || !!(c[7] & kinds & ~HISTORIC))) || (!!(kinds & HISTORIC) && isSaga(c)));
// A card's themes on a plan: what its text does, plus Legendaries for a legendary card of a kind the plan's commanders ask for.
const planThemes = (i, c, kinds) => (hasThemes() && i != null ? DATA.cardThemes[i] || 0 : 0) | (legendFits(c, kinds) ? 1 << legendsBit() : 0);
const needOf = i => (DATA && DATA.needs && i != null && DATA.needs[i]) || null;
const needLabel = nd => { if (nd[0] < 0) return nd[0] === -2 ? "spells of one creature type" : "a creature type to build around";
  const names = nd.map(t => tribePlural(DATA.subtypes[t]));
  return names.length < 2 ? names[0] : names.length < 4 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : `${names.slice(0, 2).join(", ")} or the like`; };
const needMet = (nd, had) => (nd[0] === -2 ? (had.cast || had).length > 0 : nd[0] < 0 ? had.length > 0 : nd.some(t => had.includes(t)));
const ofType = (c, t) => !!c && c[2] === "C" && ((c.length > 8 && c[8].includes(t)) || isChangeling(c));
// The plan's tribes you can field (an array; its .cast lists those you own NEED.tribe creature cards of). opts as the
// generator's: commanders, tribes, useDecks, home; and inDeck, for a deck that exists (deckOpts): the creature types it
// already holds enough of count too, whatever the plan and whatever you own (an EDHREC list full of Vampires).
let HAD_CACHE = { key: "", list: [] };
function tribesHad(opts) {
  const tribes = opts.tribes || [], inDeck = opts.inDeck || [];
  if ((!tribes.length && !inDeck.length) || !DATA || !DATA.needs) return tribes;       // data without needs: nothing depends on this
  const cmds = (opts.commanders || []).map(canonical);
  const key = [CHANGE, DATA.version, cmds.join("|"), tribes.join(","), !!opts.useDecks, opts.home || "", inDeck.join(",")].join("~");
  if (HAD_CACHE.key !== key) {
    const ident = identityOf(cmds), cmdKeys = new Set(cmds.map(norm)), n = new Map(tribes.map(t => [t, 0])), cards = new Map(tribes.map(t => [t, 0]));
    const makes = (i, t, several) => { const m = makesOf(i); return !!m && (!several || !!m[0]) && m.indexOf(t, 1) > 0; };
    for (const name of cmds) for (const t of tribes) if (makes(LOOKUP.get(norm(name)), t, true)) n.set(t, NEED.tribe);
    for (const [k, a] of AGG) {
      if (cmdKeys.has(k) || BASICS.has(k) || isBlocked(a.name)) continue;
      const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
      if (!c || c[2] === "L" || !legalCard(c) || !fitsIdentity(c, ident)) continue;
      if (!(a.free > 0 || (opts.useDecks && a.qty > 0) || (opts.home && a.locs.has(opts.home)))) continue;
      for (const t of tribes) { if (ofType(c, t)) cards.set(t, cards.get(t) + 1); if (ofType(c, t) || makes(i, t, false)) n.set(t, n.get(t) + 1); }
    }
    const list = [...new Set([...tribes.filter(t => n.get(t) >= NEED.tribe), ...inDeck])];
    list.cast = [...new Set([...tribes.filter(t => cards.get(t) >= NEED.tribe), ...inDeck])];
    HAD_CACHE = { key, list };
  }
  return HAD_CACHE.list;
}
// What a card needs that this plan lacks, in words ("Dragons"), or null.
function needMissing(i, opts) { const nd = needOf(i); return nd && !needMet(nd, tribesHad(opts)) ? needLabel(nd) : null; }
// The creature types a deck holds enough of: items are {c: card row, qty}. → { any, types }.
function deckHas(items) {
  const n = new Map(); let all = 0;
  for (const x of items) { const c = x.c; if (!c || c[2] !== "C") continue;
    if (isChangeling(c)) all += x.qty || 1; else for (const t of c[8] || []) n.set(t, (n.get(t) || 0) + (x.qty || 1)); }
  const types = new Set([...n].filter(([, q]) => q + all >= NEED.tribe).map(([t]) => t));
  return { any: types.size > 0, types };
}
// Lands whose colours have strings (DATA.landIf: card index → [colours, kind, …]; fetcher land_mana). landColors holds only
// what a land makes freely; the rest counts when the deck meets the condition (has = deckHas(…)): "tribe" a creature type,
// "types" one of the creature types it names, "cards" NEED.cards nonland cards of a card type (creature spells for
// Ancient Ziggurat; `count(bits)` says how many the deck has), "legends" NEED.legends legendary nonland cards (Plaza of
// Heroes, Great Hall of the Citadel), or with "yard" (The Grey Havens, colours among the legendary creature cards in your
// graveyard) that many legendary creatures and NEED.yard cards on the Graveyard plan, "other" never (kicked spells).
// → { colors: what it makes here (null = no data), held: the colours left out, "" when none }.
function landMakes(i, has, count) {
  const lc = DATA.landColors ? DATA.landColors[String(i)] : undefined, li = DATA.landIf ? DATA.landIf[String(i)] : null;
  if (!li) return { colors: lc == null ? null : lc, held: "" };
  const met = li[1] === "tribe" ? has.any : li[1] === "types" ? li.slice(2).some(t => has.types.has(t)) : li[1] === "cards" ? count(li[2]) >= NEED.cards
    : li[1] !== "legends" ? false : li[2] === "yard" ? count(FLAG_LEGENDARY, FLAG_LEGENDARY | T.creature) >= NEED.legends && count.theme("Graveyard") >= NEED.yard
    : count(FLAG_LEGENDARY) >= NEED.legends;
  return met ? { colors: [..."WUBRGC"].filter(ch => (lc || "").includes(ch) || li[0].includes(ch)).join(""), held: "" } : { colors: lc || "", held: li[0] };
}
// How many of these cards ({c, i, qty}) are nonland cards with a flag in bits (T.creature…, FLAG_LEGENDARY), and with every
// flag in `all` when given (legendary creatures); count.theme(name): how many are on a theme's plan.
const typeCount = items => {
  const fl = c => (hasFacts() ? c[7] : CODE_BITS[c[2]] || 0), sum = ok => items.reduce((n, x) => n + (x.c && x.c[2] !== "L" && ok(x) ? x.qty || 1 : 0), 0);
  const count = (bits, all = 0) => sum(x => (fl(x.c) & bits) && (fl(x.c) & all) === all);
  count.theme = name => { const bit = hasThemes() ? DATA.themes.indexOf(name) : -1; return bit < 0 ? 0 : sum(x => x.i != null && ((DATA.cardThemes[x.i] || 0) >> bit) & 1); };
  return count;
};
// The tribes these options' commanders count, limited to the tribes in play.
let COUNTED_CACHE = { key: "", list: [] };
function countedOf(opts) {
  const key = [DATA && DATA.version, (opts.commanders || []).join("|"), (opts.tribes || []).join(",")].join("~");
  if (COUNTED_CACHE.key !== key) COUNTED_CACHE = { key, list: commanderWants((opts.commanders || []).map(canonical)).counted.filter(t => (opts.tribes || []).includes(t)) };
  return COUNTED_CACHE.list;
}
// Cards the person chose to play: in their decks or in their builds. A small nudge toward their taste.
function playedCounts() {
  const n = new Map(), bump = k => n.set(k, (n.get(k) || 0) + 1);
  for (const e of COLL && !COLL.example ? COLL.entries : []) if (e.inDeck) bump(norm(e.name));
  for (const b of BUILDS) for (const c of b.cards) bump(norm(c.name));
  return n;
}
function identityOf(names) {
  const s = new Set();
  for (const n of names) { const c = cardOf(n); if (c) for (const ch of c[1]) if (ch !== "C") s.add(ch); }
  return s;
}
const fitsIdentity = (c, ident) => [...c[1]].every(ch => ch === "C" || ident.has(ch));
const legalCard = c => !hasFlags() || ((c[7] & FLAG_LEGAL) && !(c[7] & FLAG_BANNED));
// ------------------------------------------------------------ the Meta-to-Jank dial (Matt, Nov 9)
// Four notches, Matt's words: Meta, cards with essentially no reason not to run them if the colours allow; Popular, a lot
// of play but not every deck; Unusual, occasional play, not unheard of; Jank, cards most players have never heard of.
// The fetcher bands each card against cards of its own colour identity (decks.json "pop"; "n" = too new to rank). The dial
// changes which cards fill a job, never whether it's filled, so a Jank deck keeps its ramp, draw, removal, curve and mana:
// - Popular (the default) scores popularity as before. Meta leans on it harder. Unusual and Jank instead reward cards
//   whose band is near the notch, and weigh fitting the commander (themes, tribe) more.
// - Obscure is never a reason on its own: below Popular, a card that fits nothing (no theme, tribe or job) gets no
//   credit for its band.
// - Lands that only make mana ignore the dial (a mana base is pass/fail); utility lands follow it.
const POP_NOTCHES = ["Meta", "Popular", "Unusual", "Jank"], POP_DEFAULT = 1;
const POP_CLOSE = [1, 0.5, 0.15, 0];         // credit by distance between a card's band and the notch
const FLAG_UTILITY_LAND = 524288;
const hasPop = () => !!(DATA && typeof DATA.pop === "string" && DATA.pop.length === DATA.cards.length);
const hasUtilityLands = () => !!(DATA && Array.isArray(DATA.facts) && DATA.facts.includes("utility-lands"));
// A card's band: 0 Meta … 3 Jank, "new" for a card too new to rank, null without band data.
function popBand(i) {
  if (!hasPop() || i == null) return null;
  const ch = DATA.pop[i];
  return ch === "n" ? "new" : ch >= "0" && ch <= "3" ? +ch : 3;
}
const popName = band => (band === "new" ? "New" : band == null ? "" : POP_NOTCHES[band]);
// A land whose only job is mana; without the utility-land fact every land counts as one.
const manaOnlyLand = c => c[2] === "L" && !(hasUtilityLands() && c[7] & FLAG_UTILITY_LAND);
let JOB_MASK = null, JOB_MASK_DATA = null;
function jobMask() {
  if (JOB_MASK_DATA !== DATA) { JOB_MASK_DATA = DATA; JOB_MASK = hasRoles() ? JOB_ROLES.reduce((m, r) => m | (DATA.roles.includes(r) ? 1 << DATA.roles.indexOf(r) : 0), 0) : 0; }
  return JOB_MASK;
}
function popScore(i, c, notch, fits) {
  const plain = c[6] ? Math.max(0, 5 - Math.log10(c[6])) : 0;          // widely played (the score before the dial)
  if (notch === POP_DEFAULT || !hasPop() || manaOnlyLand(c)) return plain;
  const band = popBand(i);
  if (notch === 0) return plain * 1.5 + (band === 0 ? 2 : 0);
  if (band === "new") return fits ? 2.5 : 0;
  if (band >= 2 && !fits) return 0;
  return 5 * POP_CLOSE[Math.abs(band - notch)];
}
// ------------------------------------------------------------ playstyles (Matt, Nov 9)
// Theme is what the deck does; playstyle is how it treats the table. Each playstyle leans on some of the fetcher's playstyle
// tags (decks.json styleTags/cardStyles, STYLE_SPECS) and roles, and shifts the usual job quotas. Balanced (no playstyle)
// changes nothing. To add one: an entry here (tags must be names in DATA.styleTags; roles names in DATA.roles), plus a
// fetcher tag only when it needs a new kind of card. Scoring: whichever of theme (and tribe) or playstyle the person leans
// into gets the full weight, the other a little less (Matt's idea): theme first by default, and a playstyle on its own leads.
// slots: quotas that replace GEN_SLOTS' (a role GEN_SLOTS lacks is added); blue: more, only when the commander is blue;
// big: the cap on cards of mana value 6+; creatures: added to every creature's score; combo: × the combo bonus.
const PLAYSTYLES = [
  { id: "aggressive", name: "Aggressive", tags: ["Evasion", "Haste", "Extra combat", "Combat trigger", "Anthem"], roles: [],
    slots: { Ramp: 9, Removal: 7, "Board wipe": 1 }, big: 5, creatures: 1.5 },
  { id: "political", name: "Political", tags: ["Goad", "Vote", "Monarch", "Gift", "Deal", "Forced attack", "Rewards attacks"], roles: [], slots: {} },
  { id: "defensive", name: "Defensive", tags: ["Fog", "Attack tax", "Deterrent"], roles: ["Protection", "Lifegain"],
    slots: { Removal: 7, "Board wipe": 4, Protection: 4 } },
  { id: "control", name: "Control", tags: [], roles: ["Removal", "Counterspell", "Board wipe"],
    slots: { "Card draw": 12, Removal: 10, "Board wipe": 5 }, blue: { Counterspell: 6 }, creatures: -1.5 },
  { id: "combo", name: "Combo", tags: [], roles: ["Tutor"], slots: { Protection: 4, Tutor: 5 }, blue: { Counterspell: 2 }, combo: 2 },
];
const STYLE_WEIGHT = 3, STYLE_SECOND = 2;    // the lead's weight per hit, and the other's
// A playstyle's own jobs (its roles: control's removal, counterspells, wipes) can run further past their quota before the
// overshoot penalty starts; otherwise giving Counterspell a quota of 6 would cap a spells deck's counterspells at 8 (Nov 9).
const STYLE_SLACK = 6;
const hasStyles = () => !!(DATA && Array.isArray(DATA.styleTags) && Array.isArray(DATA.cardStyles) && DATA.cardStyles.length === DATA.cards.length);
const styleOf = id => PLAYSTYLES.find(x => x.id === id) || null;
let STYLE_MASKS = new Map(), STYLE_MASKS_DATA = null;
// A playstyle's tags and roles as bit masks over this data's tag and role lists.
function styleMasks(st) {
  if (STYLE_MASKS_DATA !== DATA) { STYLE_MASKS_DATA = DATA; STYLE_MASKS = new Map(); }
  if (!STYLE_MASKS.has(st.id)) {
    const tags = hasStyles() ? st.tags.reduce((m, t) => m | (DATA.styleTags.includes(t) ? 1 << DATA.styleTags.indexOf(t) : 0), 0) : 0;
    const roles = hasRoles() ? st.roles.reduce((m, r) => m | (DATA.roles.includes(r) ? 1 << DATA.roles.indexOf(r) : 0), 0) : 0;
    STYLE_MASKS.set(st.id, { tags, roles });
  }
  return STYLE_MASKS.get(st.id);
}
// How many of the playstyle's tags and roles a card has.
function styleHits(i, c, st) {
  if (!st || i == null) return 0;
  const m = styleMasks(st);
  return popcount((hasStyles() ? DATA.cardStyles[i] || 0 : 0) & m.tags) + popcount((c[5] || 0) & m.roles);
}
// The job quotas a playstyle starts from (tuning's targets still take over, see slotsFor).
function styleSlots(st, ident) {
  if (!st) return GEN_SLOTS;
  const out = new Map(GEN_SLOTS), extra = { ...st.slots, ...(ident && ident.has("U") ? st.blue || {} : {}) };
  for (const [r, n] of Object.entries(extra)) out.set(r, n);
  return [...out];
}
// Theme and tribe lead unless the person leans into the playstyle, or there's no theme or tribe to lead.
function styleLeads(opts) {
  return !!styleOf(opts.style) && (opts.lean === "style" || !(opts.themes || (opts.tribes || []).length));
}
function genScore(i, c, opts, played) {
  const need = needMissing(i, opts);                                    // it needs a creature type this plan lacks
  const hits = need ? 0 : planThemes(i, c, legendKinds(opts.commanders)) & opts.themes;
  const tf = need ? null : tribeFit(i, c, opts.tribes, countedOf(opts), tribesHad(opts)), tribe = tf ? tf.name : null;
  const notch = opts.pop != null ? opts.pop : POP_DEFAULT, lean = Math.max(0, notch - 1);
  const st = styleOf(opts.style), style = styleHits(i, c, st);
  const fits = !!(hits || tribe || style || ((c[5] || 0) & jobMask()));
  let score = popScore(i, c, notch, fits);                              // popularity, as the dial asks
  // Fits what the commander wants (more so toward Jank) and the playstyle; whichever leads weighs more.
  const leads = styleLeads(opts), themeW = st && opts.lean === "style" ? STYLE_SECOND : STYLE_WEIGHT;
  score += popcount(hits) * (themeW + lean) + (tf ? themeW + tf.level + lean : 0);
  if (st) { score += Math.min(style, 2) * (leads ? STYLE_WEIGHT : STYLE_SECOND); if (st.creatures && c[2] === "C") score += st.creatures; }
  const mv = c[4] || 0;
  if (mv >= 7) score -= 2; else if (mv === 6) score -= 1;              // keep the curve playable
  score -= Math.min(dismissCount(c[0]) * 1.5, 6);                       // dismissed before
  const lv = tasteOf(c[0]); if (lv === 1) score += 3; else if (lv === -1) score -= 3;   // your taste
  if (played.get(norm(c[0]))) score += 0.75;                            // you play it elsewhere
  if (need) score -= NEED.pen;
  return { score, hits, tribe, style, styleName: style && st ? st.name : "", need };
}
// What a card fits, for its row: the tribe or a theme, then the playstyle if it fits that too.
const genLabel = it => { const plan = [it.tribe, ...themeNames(it.hits)].filter(Boolean);
  return (it.styleName ? [plan[0], it.styleName] : plan.slice(0, 2)).filter(Boolean).join(", "); };
// The cards you own that could go in: nonlands and nonbasic lands, scored. opts.home: a deck whose cards count as usable
// (an overhaul of that deck); opts.stick + stickBonus: names that score stickBonus more (an overhaul's current cards).
function genPool(opts, exclude = new Set()) {
  const cmds = opts.commanders.map(canonical), cmdKeys = new Set(cmds.map(norm));
  const ident = identityOf(cmds), played = playedCounts(), pool = [], lands = [], spare = [];   // spare: cards that need what the plan lacks
  const stick = opts.stick && opts.stickBonus ? new Set(opts.stick.map(norm)) : null;
  for (const [k, a] of AGG) {
    if (BASICS.has(k) || cmdKeys.has(k) || exclude.has(k) || isBlocked(a.name)) continue;
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || !legalCard(c) || !fitsIdentity(c, ident)) continue;
    const free = a.free > 0;
    if (!free && !(opts.useDecks && a.qty > 0) && !(opts.home && a.locs.has(opts.home))) continue;
    const g = genScore(i, c, opts, played);
    const it = { i, c, name: c[0], free, roles: c[5] || 0, hits: g.hits, tribe: g.tribe, style: g.style, styleName: g.styleName, need: g.need,
      score: g.score + (free ? 1 : 0) + (stick && stick.has(k) ? opts.stickBonus : 0) };
    (g.need ? spare : c[2] === "L" ? lands : pool).push(it);
  }
  return { cmds, ident, pool, lands, spare };
}
// The jobs to fill first: GEN_SLOTS, with a build's tuned targets (b.targets.roles) taking over, and any
// other role a tune asked for (say, Counterspell 3) added at the end.
function slotsFor(targets, base = GEN_SLOTS) {
  const roles = (targets && targets.roles) || {};
  const slots = base.map(([r, n]) => [r, roles[r] != null ? roles[r] : n]);
  for (const [r, n] of Object.entries(roles)) if (!slots.some(s => s[0] === r)) slots.push([r, n]);
  return slots;
}
// opts: commanders, themes, tribes, useDecks, lands, and optionally keep (names that stay: cards you
// pinned or added by hand), exclude (names never to use: dropped from this build), targets (from tuning).
function generateBuild(opts) {
  const targets = opts.targets || {}, exclude = new Set((opts.exclude || []).map(norm));
  const keepKeys = new Set((opts.keep || []).map(norm).filter(k => !BASICS.has(k)));
  const { cmds, ident, pool, lands, spare } = genPool(opts, new Set([...exclude, ...keepKeys]));
  const tpl = opts.template || null;                       // a template's shape (deckShape), if one was chosen
  const landsTarget = Math.max(28, Math.min(42, targets.lands || opts.lands || (tpl && tpl.lands) || 36));
  const nonlandSlots = 100 - cmds.length - landsTarget, sf = tpl ? nonlandSlots / Math.max(1, tpl.nonland) : 1;
  const st = styleOf(opts.style);                          // a playstyle (none = Balanced)
  const bigCap = targets.big != null ? targets.big : tpl ? Math.max(1, Math.round((tpl.curve[6] + tpl.curve[7]) * sf)) : st && st.big != null ? st.big : 8;
  // With a template, each mana value gets about as many cards as the template had (scaled).
  const curveWant = tpl ? tpl.curve.map(n => Math.round(n * sf)) : null, curveHave = new Array(8).fill(0);
  const curvePen = it => (curveWant && curveHave[Math.min(it.c[4] || 0, 7)] >= curveWant[Math.min(it.c[4] || 0, 7)] ? 3 : 0);
  const played = playedCounts();
  // Cards you kept go in first, whether or not they'd be picked, and count toward every job they do.
  const kept = [];
  for (const k of keepKeys) {
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || cmds.some(n => norm(n) === k)) continue;
    const g = genScore(i, c, opts, played);
    kept.push({ i, c, name: c[0], free: true, roles: c[5] || 0, hits: g.hits, tribe: g.tribe, style: g.style, styleName: g.styleName, score: g.score, need: g.need });
  }
  // Always-include cards that fit, if a copy is free to use (or in another deck, when that's allowed).
  const always = [], alwaysMissing = [];
  for (const p of Object.values(PREFS.cards)) {
    if ((p.level || 0) !== 2) continue;
    const k = norm(p.name); if (keepKeys.has(k) || exclude.has(k) || cmds.some(n => norm(n) === k)) continue;
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || !legalCard(c) || !fitsIdentity(c, ident)) continue;
    const it = pool.find(x => x.i === i) || lands.find(x => x.i === i) || spare.find(x => x.i === i);   // Always is your say, whatever it needs
    if (it) always.push(it);
    else { const a = AGG.get(k); alwaysMissing.push({ name: c[0], where: a && a.qty > 0 ? [...a.locs.keys()].find(l => a.locs.get(l).inDeck) || "" : "" }); }
  }
  // Combos you could assemble from cards you own plus the commander(s).
  const cmdIdx = new Set(cmds.map(n => LOOKUP.get(norm(n))).filter(x => x != null));
  const comboOf = new Map();
  if (COMBOS && COMBOS.combos) {
    const have = new Set([...pool.map(p => p.i), ...cmdIdx]);
    for (const cb of COMBOS.combos) {
      const cs = cb[1];
      if (cs.length > 4 || !cs.every(x => have.has(x))) continue;
      for (const x of cs) { if (!comboOf.has(x)) comboOf.set(x, []); comboOf.get(x).push(cs); }
    }
  }
  const picked = new Map(), why = {};
  let big = 0;
  const okBig = it => (it.c[4] || 0) < 6 || big < bigCap;
  // The jobs, with how many cards in the deck do each so far (kept and Always cards count too).
  const jobs = slotsFor(targets, tpl ? templateSlots(tpl, ident, sf) : styleSlots(st, ident))
    .map(([role, quota]) => ({ role, quota, bit: hasRoles() ? DATA.roles.indexOf(role) : -1, have: 0 })).filter(j => j.bit >= 0);
  const take = (it, reason) => {
    picked.set(it.i, it); why[it.name] = reason; if ((it.c[4] || 0) >= 6) big++;
    if (it.c[2] !== "L") { curveHave[Math.min(it.c[4] || 0, 7)]++; for (const j of jobs) if ((it.roles >> j.bit) & 1) j.have++; }
  };
  // In the free fill, a card doing a job that already has its quota + JOB_SLACK pays JOB_OVER for each card
  // past that, so popular Treasure makers don't pile up as ramp 23 (Nov 7).
  const own = new Set(st ? st.roles : []), slackOf = j => (own.has(j.role) ? STYLE_SLACK : JOB_SLACK);
  const overPen = it => { let p = 0; for (const j of jobs) if ((it.roles >> j.bit) & 1) { const over = j.have - (j.quota + slackOf(j)); if (over >= 0) p += JOB_OVER * (over + 1); } return p; };
  for (const it of kept) if (it.c[2] !== "L") take(it, (opts.whyKept && opts.whyKept[it.name]) || "You kept it");
  for (const it of always) if (it.c[2] !== "L" && picked.size < nonlandSlots) { const r = primaryRole(it.name); take(it, "Always include" + (r ? ` · ${r}` : "")); }
  const comboBonus = it => {
    let best = 0;
    for (const combo of comboOf.get(it.i) || []) {
      const others = combo.filter(x => x !== it.i), got = others.filter(x => picked.has(x) || cmdIdx.has(x)).length;
      best = Math.max(best, got === others.length ? 6 : got ? 2 : 0);
    }
    return best * (st && st.combo || 1);
  };
  // 0. Mana first: reliable mana for half the ramp quota (kept and Always cards that are reliable mana count).
  const rampJob = jobs.find(j => j.role === "Ramp");
  if (rampJob) {
    const want = Math.ceil(rampJob.quota * MANA_FIRST);
    let have = [...picked.values()].filter(it => reliableMana(it.i, it.c)).length;
    const plain = { ...opts, themes: 0, style: "", lean: "", ...(opts.mana === "best" && (opts.pop != null ? opts.pop : POP_DEFAULT) > POP_DEFAULT ? { pop: POP_DEFAULT } : {}) };
    // The pool's score also holds what isn't the plan (a free copy, an overhaul's current cards): keep that part.
    const cands = pool.filter(p => !picked.has(p.i) && reliableMana(p.i, p.c))
      .map(p => ({ it: p, s: genScore(p.i, p.c, plain, played).score + p.score - genScore(p.i, p.c, opts, played).score }))
      .sort((x, y) => y.s - x.s || x.it.name.localeCompare(y.it.name));
    for (const { it } of cands) {
      if (have >= want || rampJob.have >= rampJob.quota || picked.size >= nonlandSlots) break;
      take(it, "Ramp · mana first"); have++;
    }
  }
  // 1. The jobs every deck needs, themed cards first. A card that would push another job past its quota and slack waits
  // (a removal spell that also makes a Treasure used to add to ramp unseen: ramp 18 from the Card draw and Removal slots);
  // it's taken only if the job can't be filled otherwise.
  for (const j of jobs) {
    const { role, quota, bit } = j;
    const cands = pool.filter(p => !picked.has(p.i) && (p.roles >> bit) & 1)
      .sort((x, y) => (y.score + popcount(y.hits)) - (x.score + popcount(x.hits)) || x.name.localeCompare(y.name));
    const crowds = it => jobs.some(o => o !== j && (it.roles >> o.bit) & 1 && o.have >= o.quota + slackOf(o));
    for (const pass of [0, 1]) for (const it of cands) {
      if (j.have >= quota || picked.size >= nonlandSlots) break;
      if (picked.has(it.i) || !okBig(it) || (!pass && crowds(it))) continue;
      const l = genLabel(it); take(it, role + (l ? ` · ${l}` : ""));
    }
  }
  // 1b. With a template: its total interaction, then as many cards on plan (themes or tribe) as it had.
  const fillTo = (want, test, reason) => {
    let have = [...picked.values()].filter(test).length;
    while (have < want && picked.size < nonlandSlots) {
      let best = null, bs = -Infinity;
      for (const it of pool) { if (picked.has(it.i) || !okBig(it) || !test(it)) continue; const v = it.score + comboBonus(it) - curvePen(it); if (v > bs) { best = it; bs = v; } }
      if (!best) break;
      take(best, reason(best)); have++;
    }
  };
  if (tpl) {
    fillTo(Math.round(tpl.interaction * sf), isInteraction, it => `Interaction · ${primaryRole(it.name) || "removal"}`);
    if (opts.themes || (opts.tribes || []).length) fillTo(Math.round(tpl.onPlan * sf), it => it.hits || it.tribe, it => `Fits ${genLabel(it)}`);
  }
  // 2. The rest: what fits the themes and tribe, combos, then the strongest cards left.
  while (picked.size < nonlandSlots) {
    let best = null, bestScore = -Infinity;
    for (const it of pool) {
      if (picked.has(it.i) || !okBig(it)) continue;
      const s = it.score + comboBonus(it) - curvePen(it) - overPen(it);
      if (s > bestScore || (s === bestScore && best && it.name < best.name)) { best = it; bestScore = s; }
    }
    if (!best) break;
    const cb = comboBonus(best), l = genLabel(best);
    take(best, cb >= 6 ? "Completes a combo" : l ? `Fits ${l}` : "Strong card");
  }
  // 2b. Only if the deck would come up short: cards that need a creature type the plan lacks, best first. The row says so.
  if (picked.size < nonlandSlots) for (const it of spare.filter(x => x.c[2] !== "L" && !picked.has(x.i)).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))) {
    if (picked.size >= nonlandSlots) break;
    if (okBig(it)) take(it, `Fills the deck · needs ${it.need}`);
  }
  const nonlands = picked.size;
  // 3. Lands: nonbasics you own that make the right colours, then basics by how much each colour is used. A land counts
  // for the colours it makes in this deck (landMakes): one whose colours have strings the deck doesn't meet is left out,
  // unless it does something besides make mana (a utility land, taken for what it makes freely).
  const has = deckHas([...picked.values()]), count = typeCount([...picked.values()]);
  const landOf = it => landMakes(it.i, has, count), makes = it => landOf(it).colors;
  const dead = it => { const m = landOf(it); return !!m.held && manaOnlyLand(it.c) && ![...m.colors].some(ch => ident.has(ch)); };
  const landScore = it => { const lc = makes(it); return (lc == null ? ident.size : [...lc].filter(ch => ident.has(ch)).length) * 2 + it.score - (lc === "" ? 1 : 0); };
  const maxNonbasic = Math.round(landsTarget * (ident.size <= 1 ? 0.3 : 0.6));
  const firstLands = [...kept.filter(it => it.c[2] === "L"), ...always.filter(it => it.c[2] === "L")];
  const firstSet = new Set(firstLands.map(it => it.i));
  const landPicks = [...firstLands, ...lands.filter(it => { if (firstSet.has(it.i) || dead(it)) return false; const lc = makes(it); return lc == null || lc === "" || [...lc].some(ch => ident.has(ch) || ch === "C"); })
    .sort((x, y) => landScore(y) - landScore(x) || x.name.localeCompare(y.name))].slice(0, Math.max(maxNonbasic, firstLands.length));
  for (const it of landPicks) {
    const lc = makes(it), colors = lc ? [...lc].filter(ch => ident.has(ch)) : [];
    take(it, keepKeys.has(norm(it.name)) ? (opts.whyKept && opts.whyKept[it.name]) || "You kept it"
      : (tasteOf(it.name) === 2 ? "Always include · " : "") + (colors.length ? `Land · makes ${colors.join("/")}` : "Land"));
  }
  const basicsN = landsTarget - landPicks.length, basics = [];
  if (basicsN > 0) {
    if (!ident.size) basics.push({ name: "Wastes", qty: basicsN });
    else {
      const w = {}; for (const ch of ident) w[ch] = 1;            // every colour gets at least a little
      for (const it of picked.values()) if (it.c[2] !== "L") for (const ch of it.c[1]) if (ch in w) w[ch]++;
      const total = Object.values(w).reduce((a, b) => a + b, 0), share = Object.entries(w).map(([ch, n]) => [ch, n * basicsN / total]);
      const counts = share.map(([ch, x]) => [ch, Math.floor(x), x - Math.floor(x)]);
      let left = basicsN - counts.reduce((a, c) => a + c[1], 0);
      for (const c of [...counts].sort((a, b) => b[2] - a[2])) { if (left <= 0) break; c[1]++; left--; }
      for (const [ch, n] of counts) if (n > 0) basics.push({ name: BASIC_FOR[ch], qty: n });
    }
    for (const x of basics) why[x.name] = "Basic land";
  }
  const cards = [...cmds.map(n => ({ name: n, qty: 1 })), ...[...picked.values()].map(it => ({ name: it.name, qty: 1 })), ...basics];
  // Away from Popular, each row says the card's band, so the dial's effect (and any fallback to a popular card) shows.
  if (opts.pop != null && opts.pop !== POP_DEFAULT && hasPop())
    for (const it of picked.values()) if (!manaOnlyLand(it.c) && !keepKeys.has(norm(it.name))) why[it.name] += ` · ${popName(popBand(it.i))}`;
  for (const n of cmds) why[n] = "Commander";
  return { cards, why, short: Math.max(0, nonlandSlots - nonlands), nonlandSlots, alwaysMissing };
}
// One card to replace a dropped one: the same job if it filled one of the required jobs, otherwise
// something that shares its theme or creature type, otherwise the best fit left. Never a card that
// was already dropped from this build (b.notHere).
// What the generator and tuning need to know about any build: its commander(s), what they want, and
// whether cards from your other decks may be used. A generated build remembers its own choices.
// deckOpts(b) adds what the deck as it stands holds (inDeck: the creature types it has NEED.tribe creatures of), for
// judging and tuning the deck in front of you; regenerating starts from the plan alone, so it uses buildOpts.
function deckOpts(b) {
  const o = buildOpts(b), cmdKeys = new Set(o.commanders.map(norm));
  return { ...o, inDeck: [...deckHas(b.cards.filter(c => !cmdKeys.has(norm(c.name))).map(c => ({ c: cardOf(c.name), qty: c.qty }))).types] };
}
function buildOpts(b) {
  const src = b.source || {}, gen = src.kind === "generated", t = b.tuneOpts || {};
  const cmds = ((gen && src.commanders) || b.commanders).map(canonical);
  const w = gen ? { themes: src.themes || 0, tribes: src.tribes || [] } : commanderWants(cmds);
  return { commanders: cmds, themes: w.themes, tribes: w.tribes, useDecks: t.useDecks != null ? !!t.useDecks : !!src.useDecks, lands: src.lands || 36,
    pop: gen && src.pop != null ? src.pop : POP_DEFAULT, style: gen && styleOf(src.style) ? src.style : "", lean: gen && src.lean === "style" ? "style" : "",
    ...(gen && src.mana === "best" ? { mana: "best" } : {}),
    ...(gen && src.home ? { home: src.home } : {}) };
}
// A build's job quotas: its playstyle's, with its tuned targets taking over.
function buildSlots(b) {
  const o = buildOpts(b);
  return slotsFor(b.targets, styleSlots(styleOf(o.style), identityOf(o.commanders)));
}

// ------------------------------------------------------------ which playstyles your cards can play
// Matt's rule (Nov 9): offer only what's realistic. A playstyle is offered when leaning into it gives at least STYLE_MIN of
// its own cards and its deck is at least STYLE_APART cards different from every other offered playstyle's (of a pair too
// close, the one that adds more of its cards over Balanced stays). Balanced is offered only when it's a real middle, not one
// playstyle in disguise (holding BALANCED_DISGUISE of that playstyle's cards, or within STYLE_APART cards of its deck), and
// always when no playstyle qualifies. Every choice that isn't offered says why. Real sample, 64 commanders on a 45%
// collection: political offered for 14, Balanced left out for 12 (mostly red aggro), 4–6 choices each.
const STYLE_MIN = 5, STYLE_APART = 5, BALANCED_DISGUISE = 0.85;
const COLOUR_WORD = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const nCards = n => `${n} ${n === 1 ? "card" : "cards"}`;
// Card names hold commas ("Glóin, Dwarf Emissary"), so lists in reasons use " · ".
const listNames = (names, max = 3) => names.slice(0, max).join(" · ") + (names.length > max ? ` · ${names.length - max} more` : "");
// "in red", "in white and black", "in these colours", for reasons.
function inColours(ident) {
  const cs = "WUBRG".split("").filter(ch => ident.has(ch));
  return !cs.length ? "that are colourless" : cs.length <= 2 ? `in ${cs.map(ch => COLOUR_WORD[ch]).join(" and ")}` : "in these colours";
}
// A deck as name → copies, without its commanders (basics included: swapping a Mountain for a Plains is a swap).
function deckMap(cards, cmds = []) {
  const skip = new Set(cmds.map(norm)), m = new Map();
  for (const c of cards) if (!skip.has(norm(c.name))) m.set(c.name, (m.get(c.name) || 0) + c.qty);
  return m;
}
// How many cards come out of a to make b (the size of a swap from a to b).
const deckDiff = (a, b) => { let n = 0; for (const [k, q] of a) n += Math.max(0, q - (b.get(k) || 0)); return n; };
function onStyleNames(m, st) {
  const out = [];
  for (const name of m.keys()) { const k = norm(name), i = LOOKUP.get(k); if (i != null && !BASICS.has(k) && styleHits(i, DATA.cards[i], st) > 0) out.push(name); }
  return out;
}
const styleBase = o => ({ commanders: o.commanders.map(canonical), themes: o.themes || 0, tribes: o.tribes || [], useDecks: !!o.useDecks,
  lands: o.lands || 36, pop: o.pop != null ? o.pop : POP_DEFAULT, lean: o.lean === "style" ? "style" : "", ...(o.mana === "best" ? { mana: "best" } : {}), ...(o.home ? { home: o.home } : {}) });
let STYLE_OPT_CACHE = new Map();
// opts: the generator's (commanders, themes, tribes, useDecks, lands, pop). → { balanced: {ok, why, like}, styles: [{id, name,
// ok, why, own, usable}] } in PLAYSTYLES order. `like` is the playstyle Balanced turned out to be, the default when it's left out.
function styleOptions(opts) {
  const base = styleBase(opts); delete base.lean;
  const key = `${CHANGE}|${DATA && DATA.version}|${JSON.stringify(base)}`;
  if (STYLE_OPT_CACHE.has(key)) return STYLE_OPT_CACHE.get(key);
  if (STYLE_OPT_CACHE.size > 40) STYLE_OPT_CACHE = new Map();
  const res = { balanced: { ok: true, why: "", like: null }, styles: PLAYSTYLES.map(st => ({ id: st.id, name: st.name, ok: true, why: "", own: 0, usable: 0 })) };
  if (!hasStyles() || !base.commanders.length) return res;
  const cmds = base.commanders, ident = identityOf(cmds), bal = deckMap(generateBuild(base).cards, cmds);
  const { pool, lands } = genPool(base);
  const rows = PLAYSTYLES.map(st => {
    const deck = deckMap(generateBuild({ ...base, style: st.id, lean: "style" }).cards, cmds);
    const usable = [...pool, ...lands].filter(it => styleHits(it.i, it.c, st) > 0).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).map(it => it.name);
    return { st, deck, own: onStyleNames(deck, st).length, inBal: onStyleNames(bal, st).length, usable };
  });
  const kept = [];
  rows.forEach((r, k) => {
    const out = res.styles[k], kind = r.st.name.toLowerCase();
    out.own = r.own; out.usable = r.usable.length;
    if (r.own >= STYLE_MIN) return;
    out.ok = false;
    out.why = r.usable.length >= STYLE_MIN ? `Only ${r.own} of your ${r.usable.length} ${kind} cards make the deck`
      : r.usable.length ? `Only ${r.usable.length === 1 ? "1 " + kind + " card" : r.usable.length + " " + kind + " cards"} you could use ${inColours(ident)} (${listNames(r.usable)})`
      : `No ${kind} cards you could use ${inColours(ident)}`;
  });
  const cands = rows.map((r, k) => ({ r, k })).filter(x => res.styles[x.k].ok).sort((x, y) => (y.r.own - y.r.inBal) - (x.r.own - x.r.inBal) || y.r.own - x.r.own);
  for (const { r, k } of cands) {
    const close = kept.find(x => deckDiff(r.deck, x.deck) < STYLE_APART);
    if (close) { const d = deckDiff(r.deck, close.deck); Object.assign(res.styles[k], { ok: false, why: `Too close to ${close.st.name} (${d ? nCards(d) + " different" : "the same deck"})` }); }
    else kept.push(r);
  }
  const like = kept.find(r => deckDiff(bal, r.deck) < STYLE_APART || r.inBal >= BALANCED_DISGUISE * r.own);
  if (like) {
    const kind = like.st.name.toLowerCase(), d = deckDiff(bal, like.deck);
    res.balanced = { ok: false, like: like.st.id, why: `Your cards already make ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} deck: Balanced would `
      + (d === 0 ? "be the same deck" : d < STYLE_APART ? `be within ${nCards(d)} of it` : `hold ${like.inBal} of its ${like.own} ${kind} cards`) };
  }
  STYLE_OPT_CACHE.set(key, res);
  return res;
}

// ------------------------------------------------------------ hot-swaps
// A hot-swap (Matt, Nov 9) is one build in two or three playstyles: a shared core plus one package per playstyle, kept
// together in one swap location ("<deck> · Swaps"), switched in Assemble. The core is computed: cards every version picked,
// cards that define none of the playstyles, and for a job a playstyle reshapes (wipes, removal, ramp…) as many as the leanest
// version runs; then each playstyle is generated again around it (the core kept), so every version keeps its own quotas. If
// switching would still take more than HOTSWAP_MAX cards, the core grows by neutral cards. Offered at HOTSWAP_MIN–HOTSWAP_MAX
// swaps per switch (real sample: 7–23 for aggressive / political / defensive, against 23–30 for separate decks).
const HOTSWAP_MIN = 5, HOTSWAP_MAX = 25;
const hsKey = id => id || "";
// Cards as a list, in the order they first appear in `order` (commanders first, as the generator lists them).
function cardList(m, order) {
  const out = [], seen = new Set();
  for (const c of order) if (m.get(c.name) > 0 && !seen.has(c.name)) { out.push({ name: c.name, qty: m.get(c.name) }); seen.add(c.name); }
  for (const [name, qty] of m) if (qty > 0 && !seen.has(name)) out.push({ name, qty });
  return out;
}
const swapsOf = maps => { let n = 0; for (let i = 0; i < maps.length; i++) for (let j = 0; j < maps.length; j++) if (i !== j) n = Math.max(n, deckDiff(maps[i], maps[j])); return n; };
const hotSwapWhy = n => n < HOTSWAP_MIN ? `These would be nearly the same deck (${n ? nCards(n) + " different" : "no cards different"})`
  : n > HOTSWAP_MAX ? `Too different to swap quickly (${nCards(n)} per switch)` : "";
// opts: the generator's, plus optional keep, exclude, targets, whyKept (as for generateBuild); ids: two or three playstyle
// ids, "" for Balanced. → { ok, swaps, why, ids, core, packages: {id: cards}, whys: {id: why}, short: {id: n}, alwaysMissing }.
function hotSwapGenerate(opts, ids) {
  ids = ids.map(hsKey);
  const cmds = opts.commanders.map(canonical), ident = identityOf(cmds), N = ids.length;
  const gen = (id, extra = {}) => generateBuild({ ...opts, commanders: cmds, style: id, lean: id ? (opts.lean === "style" ? "style" : "") : "", ...extra });
  const first = ids.map(id => gen(id));
  const sts = ids.map(styleOf).filter(Boolean), usual = new Map(GEN_SLOTS), reshaped = new Set();
  for (const st of sts) { for (const [r, q] of styleSlots(st, ident)) if (usual.get(r) !== q) reshaped.add(r); for (const r of st.roles) reshaped.add(r); }
  const bits = hasRoles() ? [...reshaped].map(r => DATA.roles.indexOf(r)).filter(x => x >= 0) : [];
  const info = name => { const i = LOOKUP.get(norm(name)); return i == null ? null : { i, c: DATA.cards[i] }; };
  const styled = name => { const x = info(name); return !!x && sts.some(st => styleHits(x.i, x.c, st) > 0); };
  const reshapes = name => { const x = info(name); return !!x && bits.some(b => ((x.c[5] || 0) >> b) & 1); };
  const rank = name => { const x = info(name); return (x && x.c[6]) || 1e9; };
  const share = maps => { const n = new Map(); for (const m of maps) for (const k of m.keys()) if (!BASICS.has(norm(k))) n.set(k, (n.get(k) || 0) + 1); return n; };
  const firstMaps = first.map(r => deckMap(r.cards, cmds)), counts = share(firstMaps);
  const keep = [...counts].filter(([n, k]) => k === N || (k >= 2 && !styled(n) && !reshapes(n))).map(([n]) => n);
  for (const b of bits) {
    const has = n => { const x = info(n); return !!x && x.c[2] !== "L" && ((x.c[5] || 0) >> b) & 1; };
    const room = Math.min(...firstMaps.map(m => [...m.keys()].filter(has).length)) - keep.filter(has).length;
    if (room <= 0) continue;
    const more = [...counts].filter(([n, k]) => k >= 2 && !keep.includes(n) && has(n) && !styled(n)).sort((x, y) => y[1] - x[1] || rank(x[0]) - rank(y[0]));
    for (const [n] of more.slice(0, room)) keep.push(n);
  }
  const whyAll = {}; for (const r of first) for (const [n, w] of Object.entries(r.why)) if (!(n in whyAll)) whyAll[n] = w;
  const userKeep = opts.keep || [];
  const build = core => ids.map((id, v) => gen(id, { keep: [...userKeep, ...core], whyKept: { ...whyAll, ...first[v].why, ...(opts.whyKept || {}) } }));
  let vers = build(keep), maps = vers.map(r => deckMap(r.cards, cmds)), sw = swapsOf(maps);
  // Still too many swaps: grow the core by cards that define none of the playstyles, most shared first.
  for (let round = 0; sw > HOTSWAP_MAX && round < 4; round++) {
    const n = share(maps);
    const add = [...n].filter(([name, k]) => k < N && !keep.includes(name) && !styled(name) && !reshapes(name) && info(name))
      .sort((x, y) => y[1] - x[1] || rank(x[0]) - rank(y[0])).slice(0, sw - HOTSWAP_MAX + 2);
    if (!add.length) break;
    keep.push(...add.map(x => x[0]));
    vers = build(keep); maps = vers.map(r => deckMap(r.cards, cmds)); sw = swapsOf(maps);
  }
  const full = vers.map(r => deckMap(r.cards)), core = new Map();
  for (const [name, q] of full[0]) { const m = Math.min(...full.map(f => f.get(name) || 0)); if (m) core.set(name, m); }
  const packages = {}, whys = {}, short = {};
  ids.forEach((id, v) => {
    const p = new Map(); for (const [name, q] of full[v]) { const x = q - (core.get(name) || 0); if (x > 0) p.set(name, x); }
    packages[id] = cardList(p, vers[v].cards); whys[id] = vers[v].why; short[id] = vers[v].short;
  });
  const why = hotSwapWhy(sw);
  return { ok: !why, swaps: sw, why, ids, core: cardList(core, vers[0].cards), packages, whys, short, alwaysMissing: vers[0].alwaysMissing };
}
let HOTSWAP_CACHE = new Map();
// Whether these playstyles make a hot-swap, for the generator's picker: { ok, swaps, why }.
function hotSwapCheck(opts, ids) {
  const base = styleBase(opts), key = `${CHANGE}|${DATA && DATA.version}|${JSON.stringify(base)}|${ids.map(hsKey).join(",")}`;
  if (HOTSWAP_CACHE.has(key)) return HOTSWAP_CACHE.get(key);
  if (HOTSWAP_CACHE.size > 60) HOTSWAP_CACHE = new Map();
  const r = hotSwapGenerate(base, ids), out = { ok: r.ok, swaps: r.swaps, why: r.why };
  HOTSWAP_CACHE.set(key, out);
  return out;
}
// A hot-swap build carries b.hotswap = { styles: [ids], active: id, core: cards, packages: {id: cards}, whys: {id: why} };
// b.cards is always the core plus the active package.
function hotSwapCards(hs, id) {
  const m = new Map(), out = [];
  for (const c of [...hs.core, ...(hs.packages[hsKey(id)] || [])]) {
    if (m.has(c.name)) m.get(c.name).qty += c.qty; else { const x = { name: c.name, qty: c.qty }; m.set(c.name, x); out.push(x); }
  }
  return out;
}
const hsName = id => { const st = styleOf(id); return st ? st.name : "Balanced"; };
// A version's name: an overhaul's versions carry their own (hs.versions, below); a playstyle hot-swap's are its playstyles.
const hsLabel = (hs, id) => (hs && hs.versions && hs.versions[id] && hs.versions[id].name) || hsName(id);
// Plan names hold commas ("+1/+1 counters", "Elves, Tokens"), so an overhaul's versions are listed with " / ".
const hsLabels = (hs, ids) => hs && hs.versions ? ids.map(id => hsLabel(hs, id)).join(" / ") : ids.map(id => hsLabel(hs, id)).join(", ").replace(/, ([^,]*)$/, " and $1");
// Playing a version sets what the build is about: its playstyle, or (an overhaul's version) its themes and tribes.
function hsSetSource(b, id) {
  const hs = b.hotswap, v = hs && hs.versions && hs.versions[id];
  if (!b.source) return;
  if (v) { b.source.themes = v.themes || 0; b.source.tribes = [...(v.tribes || [])]; }
  else if (id) b.source.style = id; else delete b.source.style;
}
function hotSwapSwitch(b, id) {
  const hs = b.hotswap; id = hsKey(id);
  if (!hs || !(id in hs.packages) || hs.active === id) return false;
  hs.whys[hs.active] = { ...(b.why || {}) };
  hs.active = id; b.cards = hotSwapCards(hs, id); b.why = { ...(hs.whys[id] || {}) }; b.pulled = {};
  hsSetSource(b, id);
  return true;
}
// What a switch from the version being played to `to` takes: { out: cards, in: cards } (out goes into Swaps, in comes from it).
function swapPlan(b, to) {
  const hs = b.hotswap; if (!hs) return { out: [], in: [] };
  const from = hotSwapCards(hs, hs.active), target = hotSwapCards(hs, hsKey(to));
  const a = deckMap(from), t = deckMap(target), out = new Map(), inn = new Map();
  for (const [n, q] of a) { const d = q - (t.get(n) || 0); if (d > 0) out.set(n, d); }
  for (const [n, q] of t) { const d = q - (a.get(n) || 0); if (d > 0) inn.set(n, d); }
  return { out: cardList(out, from), in: cardList(inn, target) };
}
// The cards that live in Swaps while a version is played: every package card the active version doesn't use.
function swapsCards(b) {
  const hs = b.hotswap; if (!hs) return [];
  const playing = deckMap(b.cards), need = new Map();
  for (const id of Object.keys(hs.packages)) for (const c of hs.packages[id]) need.set(c.name, Math.max(need.get(c.name) || 0, c.qty + (deckMap(hs.core).get(c.name) || 0)));
  const out = new Map(); for (const [n, q] of need) { const d = q - (playing.get(n) || 0); if (d > 0) out.set(n, d); }
  return cardList(out, Object.values(hs.packages).flat());
}
// After an edit, put the change where it belongs: a card cut from the core leaves every version, and whatever replaces it joins
// the core; a card cut from the active package, and anything else added, stays in that version. If the cards now match another
// version exactly (going back in a build's history past a switch), that version is the one being played.
function hotSwapSync(b) {
  const hs = b.hotswap; if (!hs) return false;
  const now = deckMap(b.cards), same = id => { const m = deckMap(hotSwapCards(hs, id)); return m.size === now.size && [...m].every(([k, q]) => now.get(k) === q); };
  if (same(hs.active)) return false;
  const other = Object.keys(hs.packages).find(id => id !== hs.active && same(id));
  if (other != null) {
    hs.whys[hs.active] = { ...(b.why || {}) }; hs.active = other; b.why = { ...(hs.whys[other] || b.why || {}) };
    hsSetSource(b, other);
    return true;
  }
  const was = deckMap(hotSwapCards(hs, hs.active)), core = hs.core.map(c => ({ ...c })), pkg = (hs.packages[hs.active] || []).map(c => ({ ...c }));
  const take = (list, name, n) => { const x = list.find(c => c.name === name); if (!x) return n; const t = Math.min(x.qty, n); x.qty -= t; if (!x.qty) list.splice(list.indexOf(x), 1); return n - t; };
  const put = (list, name, n) => { const x = list.find(c => c.name === name); if (x) x.qty += n; else list.push({ name, qty: n }); };
  let fromCore = 0;
  for (const [name, q] of was) { const d = q - (now.get(name) || 0); if (d > 0) { const left = take(pkg, name, d); if (left) { take(core, name, left); fromCore += left; } } }
  for (const [name, q] of now) { const d = q - (was.get(name) || 0); if (d > 0) { const c = Math.min(d, fromCore); fromCore -= c; if (c) put(core, name, c); if (d - c) put(pkg, name, d - c); } }
  hs.core = core; hs.packages[hs.active] = pkg;
  return true;
}
// A swap location: "<deck> · Swaps" (also "<deck> Swaps", "<deck> - Swaps"…, since a middle dot is hard to type on a phone).
// Its cards count as in use, like a deck's, and the Collection shows it with its deck.
const SWAPS_RX = /^(.*?\S)[\s·•\-–—:|]+swaps$/i;
const swapsBase = loc => { const m = SWAPS_RX.exec(String(loc || "").trim()); return m ? m[1] : null; };
const swapsLocFor = name => `${name} · Swaps`;
function genReplacement(b, removed) {
  if (!b.commanders.length && !(b.source && b.source.commanders)) return null;
  const opts = deckOpts(b);
  const skip = new Set([...b.cards.map(c => norm(c.name)), norm(removed), ...(b.notHere || []).map(norm), ...sideKeys(b)]);
  const { pool, lands } = genPool(opts, skip);
  const old = cardOf(removed); if (!old) return null;
  const list = old[2] === "L" ? lands : pool;
  const reason = (b.why || {})[removed] || "", role = slotsFor(b.targets, styleSlots(styleOf(opts.style), identityOf(opts.commanders))).map(x => x[0]).find(r => reason.startsWith(r)) || (old[2] !== "L" ? primaryRole(removed) : null);
  const bit = role && hasRoles() ? DATA.roles.indexOf(role) : -1;
  const was = genScore(LOOKUP.get(norm(removed)), old, opts, playedCounts());
  const kin = it => (it.hits & was.hits ? 1 : 0) + (was.tribe && it.tribe === was.tribe ? 1 : 0);
  const cands = list.filter(it => bit < 0 || (it.roles >> bit) & 1).sort((x, y) => kin(y) - kin(x) || y.score - x.score || x.name.localeCompare(y.name));
  const it = cands[0]; if (!it) return null;
  const l = genLabel(it);
  return { name: it.name, why: role ? role + (l ? ` · ${l}` : "") : old[2] === "L" ? "Land" : l ? `Fits ${l}` : "Strong card" };
}
// Cards you don't own that would fit best: an optional shopping list for a generated build.
const GEN_IDEAS = new Map();
function genIdeas(b, limit = 12) {
  const src = b.source || {}; if (src.kind !== "generated" || !DATA) return [];
  const key = b.id + "|" + b.updated + "|" + CHANGE;
  if (GEN_IDEAS.has(key)) return GEN_IDEAS.get(key);
  const cmds = (src.commanders || b.commanders).map(canonical);
  const opts = { commanders: cmds, themes: src.themes || 0, tribes: src.tribes || [], pop: src.pop != null ? src.pop : POP_DEFAULT, style: src.style || "", lean: src.lean || "" };
  const ident = identityOf(cmds), played = playedCounts(), inBuild = new Set([...b.cards.map(c => norm(c.name)), ...sideKeys(b)]), out = [];
  DATA.cards.forEach((c, i) => {
    if (c[2] === "L" || !legalCard(c) || !fitsIdentity(c, ident) || (hasFlags() && c[7] & FLAG_COMMANDER && cmds.some(n => norm(n) === norm(c[0])))) return;
    const k = norm(c[0]), a = AGG.get(k);
    if (inBuild.has(k) || (a && a.qty > 0) || isBlocked(c[0])) return;
    const g = genScore(i, c, opts, played);
    if (g.need || (!g.hits && !g.tribe && !g.style)) return;
    out.push({ name: c[0], why: genLabel(g), price: c[3] || 0, score: g.score });
  });
  const res = out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).slice(0, limit);
  GEN_IDEAS.clear(); GEN_IDEAS.set(key, res);
  return res;
}

// ------------------------------------------------------------ rapid overhauls (Matt, Nov 9)
// A rapid overhaul keeps many of a build's cards but leans into another theme, tribe or commander. The generator builds the new
// plan with a bonus for every card already in the deck (genPool's stick), set by bisection so the result lands on the number of
// swaps the person picks (OVERHAUL.steps, default 20, or Fresh); every job keeps its quota at each step, so a 20-swap overhaul is
// a whole deck. Real sample (Nov 9, 45% collection): a fresh build for a new theme changes ~49 cards, but most of that churn has
// nothing to do with the plan: ~27 swaps reach 75% of its on-plan cards, ~32 reach 90%. Rhys the Redeemed (Elves, Warriors,
// Tokens) to +1/+1 counters: 11 cards on plan → 19 at 10 swaps, 27 at 20, 38 at 30, 42 fresh (47 swaps).
// Offered (Matt's "only what's realistic"): a theme or tribe when a fresh build has OVERHAUL.minPlan cards on it and adds
// OVERHAUL.minGain to the deck; a commander you own that shares a colour when your cards fill its deck. Settings live in one
// object so tests can loosen them for the small demo pool.
const OVERHAUL = { steps: [10, 20, 30], def: 20, minPlan: 15, minGain: 8, tribes: 6, stickMax: 40, stickTop: 16, verMin: HOTSWAP_MIN, verMax: HOTSWAP_MAX };
const CHANGELING_IDX = () => (DATA && DATA.keywords ? DATA.keywords.indexOf("Changeling") : -1);
// How many of a deck's nonland cards (commanders left out) fit these themes or tribes.
function planCount(cards, cmds, themes, tribes) {
  const skip = new Set((cmds || []).map(norm)), ch = CHANGELING_IDX(), kinds = legendKinds(cmds); let n = 0;
  for (const x of cards) {
    const k = norm(x.name), i = skip.has(k) ? null : LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (c && c[2] !== "L" && fitsPlan(i, c, themes, tribes, ch, kinds)) n += x.qty;
  }
  return n;
}
// kinds: legendKinds of the plan's commanders (0 = any legendary card counts on a plan with Legendaries).
const fitsPlan = (i, c, themes, tribes, ch = CHANGELING_IDX(), kinds = legendKinds([])) => !!((planThemes(i, c, kinds) & themes)
  || ((tribes || []).length && tribes.some(t => inTribe(i, c, t))));
// The generator's options for an overhaul of b toward target {commanders, themes, tribes}: the build's playstyle, dial notch,
// lands and card choice carry over; kept cards stay when they fit the colours; dropped cards and tuned targets carry over only
// for the same commander; the sideboard's cards are never used (they carry over as the new build's sideboard). home: the
// deck the build stands for, whose cards are usable.
function overhaulOpts(b, target, home = null) {
  const o = buildOpts(b), cmds = (target.commanders || o.commanders).map(canonical), ident = identityOf(cmds);
  const same = cmds.map(norm).sort().join("|") === o.commanders.map(norm).sort().join("|");
  const keep = (b.keep || []).filter(n => { const c = cardOf(n); return !!c && fitsIdentity(c, ident) && !cmds.some(x => norm(x) === norm(n)); });
  return { commanders: cmds, themes: target.themes || 0, tribes: target.tribes || [], useDecks: o.useDecks,
    lands: (b.targets && b.targets.lands) || o.lands, pop: o.pop, ...(o.mana ? { mana: o.mana } : {}), ...(o.style ? { style: o.style } : {}), ...(o.lean ? { lean: o.lean } : {}),
    ...(home || o.home ? { home: home || o.home } : {}), keep, exclude: [...(same ? b.notHere || [] : []), ...sideOf(b).map(c => c.name)], ...(same && b.targets ? { targets: b.targets } : {}) };
}
let OVERHAUL_CACHE = new Map();
const ohKey = (b, extra) => [CHANGE, DATA && DATA.version, JSON.stringify([b.cards, b.commanders, b.source, b.keep, b.notHere, b.targets, b.side]), extra].join("|");
// The swap choices for one target: { opts, before, fresh, steps: [{want, swaps, plan, fresh, fewest, cards, why, short,
// alwaysMissing}], def } where def is the index of the default (the step nearest OVERHAUL.def swaps). Each step is a full
// generator run; the last is Fresh, a plain build of the new plan. A step that can't get as low as asked (cards outside the
// new colours must go) becomes "fewest", the least the overhaul can change.
function overhaulSteps(b, target, home = null) {
  const opts = overhaulOpts(b, target, home), key = ohKey(b, "s|" + JSON.stringify(opts));
  if (OVERHAUL_CACHE.has(key)) return OVERHAUL_CACHE.get(key);
  if (OVERHAUL_CACHE.size > 30) OVERHAUL_CACHE = new Map();
  const from = deckMap(b.cards), names = b.cards.map(c => c.name);
  const plan = r => planCount(r.cards, opts.commanders, opts.themes, opts.tribes);
  const run = bonus => { const r = generateBuild(bonus ? { ...opts, stick: names, stickBonus: bonus } : opts); return { ...r, swaps: deckDiff(from, deckMap(r.cards)), plan: plan(r) }; };
  const fresh = run(0), fewest = run(OVERHAUL.stickMax);
  // More bonus, fewer swaps: bisect for the bonus that lands nearest `want`.
  const near = want => {
    let lo = 0, hi = OVERHAUL.stickTop, best = null;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2, s = run(mid);
      if (!best || Math.abs(s.swaps - want) < Math.abs(best.swaps - want) || (Math.abs(s.swaps - want) === Math.abs(best.swaps - want) && s.plan > best.plan)) best = s;
      if (s.swaps === want) break;
      if (s.swaps > want) lo = mid; else hi = mid;
    }
    return best;
  };
  const steps = [];
  for (const want of OVERHAUL.steps) {
    if (want >= fresh.swaps) break;
    const s = want <= fewest.swaps ? { ...fewest, fewest: true } : near(want);
    if (s.swaps >= fresh.swaps || steps.some(x => x.swaps === s.swaps)) continue;
    steps.push({ ...s, want });
  }
  steps.push({ ...fresh, want: null, fresh: true });
  let def = 0;
  steps.forEach((s, j) => { if (Math.abs(s.swaps - OVERHAUL.def) < Math.abs(steps[def].swaps - OVERHAUL.def)) def = j; });
  const res = { opts, before: planCount(b.cards, buildOpts(b).commanders, opts.themes, opts.tribes), fresh: { swaps: fresh.swaps, plan: fresh.plan }, steps, def };
  OVERHAUL_CACHE.set(key, res);
  return res;
}
// What a build could become: { plans: [{kind, label, themes, tribes, ok, why, before, fresh, gain}], commanders: [{name, colors, plan,
// stay, ok, why, inDeck}] }, offered ones first (plans by cards gained, commanders by how many of the deck's cards they could keep).
function overhaulOptions(b, home = null) {
  const key = ohKey(b, "o|" + home);
  if (OVERHAUL_CACHE.has(key)) return OVERHAUL_CACHE.get(key);
  const out = { plans: [], commanders: [] };
  const o = buildOpts(b), cmds = o.commanders;
  if (!DATA || !cmds.length || !hasThemes()) return out;
  const ident = identityOf(cmds), base = overhaulOpts(b, { commanders: cmds }, home), gp = genPool(base), pool = [...gp.pool, ...gp.spare], ch = CHANGELING_IDX();
  const cands = DATA.themes.map((t, bit) => ({ kind: "theme", label: t, themes: 1 << bit, tribes: [] }));
  const counts = new Map();
  for (const it of pool) if (it.c[2] === "C" && it.c.length > 8) for (const s of it.c[8]) counts.set(s, (counts.get(s) || 0) + 1);
  const wanted = commanderWants(cmds).tribes, top = [...counts].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, OVERHAUL.tribes).map(x => x[0]);
  for (const s of [...new Set([...wanted, ...top])]) cands.push({ kind: "tribe", label: tribePlural(DATA.subtypes[s]), themes: 0, tribes: [s] });
  const curTribes = [...o.tribes].sort().join(",");
  for (const t of cands) {
    if (t.themes === o.themes && t.tribes.slice().sort().join(",") === curTribes) continue;   // the plan it already has
    const r = generateBuild(overhaulOpts(b, { commanders: cmds, themes: t.themes, tribes: t.tribes }, home));
    const fresh = planCount(r.cards, cmds, t.themes, t.tribes), before = planCount(b.cards, cmds, t.themes, t.tribes);
    const usable = pool.filter(it => it.c[2] !== "L" && fitsPlan(it.i, it.c, t.themes, t.tribes, ch, legendKinds(cmds))).sort((x, y) => y.score - x.score).map(it => it.name);
    const ok = fresh >= OVERHAUL.minPlan && fresh - before >= OVERHAUL.minGain;
    // Shown after the target's name ("Graveyard: only 3 cards…"), so the reasons don't repeat it.
    const why = ok ? "" : fresh >= OVERHAUL.minPlan ? `Your deck already plays ${before} of the ${fresh} a fresh build would`
      : usable.length >= OVERHAUL.minPlan ? `Only ${fresh} of your ${usable.length} cards for it make the deck`
      : usable.length ? `Only ${nCards(usable.length)} you could use ${inColours(ident)} (${listNames(usable)})`
      : `No cards you could use ${inColours(ident)}`;
    out.plans.push({ ...t, ok, why, before, fresh, gain: fresh - before });
  }
  out.plans.sort((x, y) => (y.ok - x.ok) || y.gain - x.gain || x.label.localeCompare(y.label));
  // Commanders you own that share a colour (colourless decks: colourless commanders), each with how many cards could stay.
  const cmdKeys = new Set(cmds.map(norm)), deck = deckMap(b.cards, cmds);
  for (const x of buildableCommanders({ useDecks: o.useDecks, home: base.home || null })) {
    const c = cardOf(x.name); if (!c || cmdKeys.has(norm(x.name)) || (hasFlags() && c[7] & FLAG_PARTNER)) continue;
    const xi = new Set([...c[1]].filter(h => h !== "C"));
    if (ident.size ? ![...xi].some(h => ident.has(h)) : xi.size) continue;
    let stay = 0;
    for (const [name, q] of deck) { const d = cardOf(name); if (d && !BASICS.has(norm(name)) && fitsIdentity(d, xi)) stay += q; }
    const ok = !x.short;
    out.commanders.push({ name: x.name, colors: c[1], plan: x.plan, stay, ok, why: ok ? "" : `${nCards(x.short)} short of a full deck in its colours`, inDeck: x.inDeck, fit: x.score });
  }
  out.commanders.sort((x, y) => (y.ok - x.ok) || y.stay - x.stay || y.fit - x.fit || x.name.localeCompare(y.name));
  OVERHAUL_CACHE.set(key, out);
  return out;
}

// Overhauls as versions (Matt, Nov 9): a small overhaul with the same commander can be kept as a second version of the build,
// switched in Assemble like a hot-swap (core, packages, a Swaps binder). Versions "v0" (the deck as it was) and "v1" (the overhaul)
// carry their names and plans in hs.versions and the swaps asked for in hs.want, so Regenerate can rebuild both.
const versionsOk = (b, target, swaps) => !b.hotswap && swaps >= OVERHAUL.verMin && swaps <= OVERHAUL.verMax
  && target.commanders.map(norm).sort().join("|") === buildOpts(b).commanders.map(norm).sort().join("|");
// Two decks as one hot-swap: what both play is the core, the rest each version's package.
function versionsOf(a, c, meta) {
  const ma = deckMap(a.cards), mc = deckMap(c.cards), core = new Map(), pa = new Map(), pc = new Map();
  for (const [n, q] of ma) { const m = Math.min(q, mc.get(n) || 0); if (m) core.set(n, m); if (q > m) pa.set(n, q - m); }
  for (const [n, q] of mc) { const d = q - (core.get(n) || 0); if (d > 0) pc.set(n, d); }
  return { styles: ["v0", "v1"], core: cardList(core, a.cards), packages: { v0: cardList(pa, a.cards), v1: cardList(pc, c.cards) },
    whys: { v0: { ...(a.why || {}) }, v1: { ...(c.why || {}) } }, short: { v0: a.short || 0, v1: c.short || 0 }, ...meta };
}
// The plan b is about now, from a generated build's source or what its commander asks for. Its name as a version is the plan's
// lead (the tribe, else the first theme), short enough for a button: "Vampires" for Vampires, Tokens, +1/+1 counters, Combat.
function planNow(b) { const o = buildOpts(b), lead = planLabel(o).split(", ")[0]; return { name: lead || "Original", themes: o.themes || 0, tribes: [...(o.tribes || [])] }; }
// b's hot-swap made from an overhaul step: b's cards as "v0" (still played), the step as "v1".
function overhaulVersions(b, step, target, label) {
  return { ...versionsOf({ cards: b.cards, why: b.why, short: b.genShort }, step, {
    versions: { v0: planNow(b), v1: { name: label, themes: target.themes || 0, tribes: [...(target.tribes || [])] } },
    want: step.want != null ? step.want : step.swaps }), active: "v0" };
}
// Regenerate both versions: the first plan built afresh, then the overhaul from it to the second at about the same swaps.
// opts: the generator's options for the build (as Tune's Regenerate makes them). → a hot-swap with `short`, and the active id kept.
function versionsRegenerate(b, opts) {
  const hs = b.hotswap, v0 = hs.versions.v0, v1 = hs.versions.v1;
  const first = generateBuild({ ...opts, themes: v0.themes, tribes: v0.tribes });
  const tmp = { ...b, hotswap: null, cards: first.cards, why: first.why, source: { ...(b.source || {}), themes: v0.themes, tribes: v0.tribes } };
  const s = overhaulSteps(tmp, { commanders: opts.commanders, themes: v1.themes, tribes: v1.tribes }, opts.home || null);
  const want = hs.want || OVERHAUL.def;
  let pick = s.steps[0]; for (const x of s.steps) if (Math.abs(x.swaps - want) < Math.abs(pick.swaps - want)) pick = x;
  return { ...versionsOf(first, pick, { versions: hs.versions, want }), active: hs.active, alwaysMissing: first.alwaysMissing };
}

// ------------------------------------------------------------ "What can I build?" (Matt, Nov 9)
// Every commander you own, ranked by how well your own cards fit it, with no deck data from any site. One pass over
// your usable cards per commander: how many fit what its text asks for (themes, tribe), how well they cover the usual
// jobs (GEN_SLOTS), and whether there are enough cards in its colours to fill a deck. A rough guide to where to start;
// the generator then builds the real thing. Cached until the collection, preferences or data change.
// Plan depth: each card that fits counts 1 per theme it hits and 1.5 for the tribe (a tribe is narrower than a theme), and
// only the best FIT_PLAN_TOP count, about what a deck plays on plan, so a broad theme that half your cards touch (Tokens)
// doesn't outrank a commander whose cards fit it several ways.
const FIT_PLAN_TOP = 35;
let FIT_CACHE = { key: "", list: [] };
const colorMask = s => [...s].reduce((m, ch) => m | (COLORS.includes(ch) ? 1 << COLORS.indexOf(ch) : 0), 0);
function buildableCommanders({ useDecks = false, home = null } = {}) {
  if (!DATA || !hasFlags() || !AGG.size) return [];
  const key = [CHANGE, useDecks, home, DATA.version, AGG.size].join("|");
  if (FIT_CACHE.key === key) return FIT_CACHE.list;
  const changeling = DATA.keywords ? DATA.keywords.indexOf("Changeling") : -1;
  const pool = [];   // your usable nonland cards, read once
  for (const [k, a] of AGG) {
    if (BASICS.has(k) || isBlocked(a.name)) continue;
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || !legalCard(c) || !(a.free > 0 || (useDecks && a.qty > 0) || (home && a.locs.has(home)))) continue;
    if (c[2] === "L") continue;
    pool.push({ k, mask: colorMask(c[1]), roles: c[5] || 0, themes: hasThemes() ? DATA.cardThemes[i] || 0 : 0,
      subs: c.length > 8 ? c[8] : [], changeling: changeling >= 0 && c.length > 9 && c[9].includes(changeling), i, c });
  }
  const slots = GEN_SLOTS.map(([role, quota]) => ({ role, quota, bit: hasRoles() ? DATA.roles.indexOf(role) : -1 })).filter(s => s.bit >= 0);
  const nonlandSlots = 100 - 1 - 36, out = [];
  for (const [k, a] of AGG) {
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || !(c[7] & FLAG_COMMANDER) || !legalCard(c) || !(a.qty > 0)) continue;
    const m = colorMask(c[1]), w = commanderWants([c[0]]), kinds = legendKinds([c[0]]);
    // The line under each commander names its first two wants (planName): onNamed counts the cards that fit those two,
    // onPlan everything it wants (the review, Nov 10: "280 of your cards fit Samurai, Warriors" when 46 did).
    const nameTribes = w.tribes.slice(0, 2), nameThemes = [...Array(32).keys()].filter(bit => (w.themes >> bit) & 1).slice(0, 2 - nameTribes.length).reduce((x, bit) => x | (1 << bit), 0);
    const had = tribesHad({ commanders: [c[0]], tribes: w.tribes, useDecks, home });
    const hadNamed = Object.assign(had.filter(t => nameTribes.includes(t)), { cast: (had.cast || had).filter(t => nameTribes.includes(t)) });
    let onPlan = 0, onNamed = 0, nonland = 0;
    const have = slots.map(() => 0), depth = new Array(32).fill(0);   // on-plan cards by weight × 2
    for (const p of pool) {
      if (p.k === k || p.mask & ~m) continue;
      nonland++;
      const nd = needOf(p.i), lacks = !!nd && !needMet(nd, had);   // a card that needs a creature type this deck wouldn't have fits nothing
      const pt = p.themes | (legendFits(p.c, kinds) ? 1 << legendsBit() : 0);            // a legendary card of the kind this commander asks for
      const tf = lacks ? null : tribeFit(p.i, p.c, w.tribes, w.counted, had), tribe = !!tf, hits = lacks ? 0 : popcount(pt & w.themes);   // 1.5 for a card of the tribe, 1 for its tokens, 2 for several when counted
      if (hits || tribe) { onPlan++; depth[Math.min(31, hits * 2 + (tf ? tf.level + 2 : 0))]++; }
      if (!lacks && ((pt & nameThemes) || (nameTribes.length && tribeFit(p.i, p.c, nameTribes, w.counted, hadNamed)))) onNamed++;
      if (!lacks) slots.forEach((s, j) => { if ((p.roles >> s.bit) & 1) have[j]++; });   // the generator wouldn't give it a job
    }
    const filled = slots.reduce((t, s, j) => t + Math.min(have[j], s.quota), 0), quotas = slots.reduce((t, s) => t + s.quota, 0);
    const gaps = slots.filter((s, j) => have[j] < s.quota).map(s => s.role), short = Math.max(0, nonlandSlots - nonland);
    const planName = [...w.tribes.map(t => tribePlural(DATA.subtypes[t])), ...themeNames(w.themes)].slice(0, 2).join(", ");
    const inDeck = a.free > 0 ? "" : [...a.locs.keys()].find(l => a.locs.get(l).inDeck) || "";
    let plan = 0, left = FIT_PLAN_TOP;
    for (let d = 31; d > 0 && left > 0; d--) { const n = Math.min(depth[d], left); plan += n * d / 2; left -= n; }
    const score = plan + filled * 0.5 - short * 0.5;
    out.push({ name: c[0], colors: c[1], onPlan, onNamed, more: Math.max(0, w.tribes.length + popcount(w.themes) - 2), plan: planName, depth: plan, filled, quotas, gaps, short, inDeck, score, band: popBand(i) });
  }
  out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  FIT_CACHE = { key, list: out };
  return out;
}

// ------------------------------------------------------------ tuning: feedback → a few swaps
// Any build can be tuned. Feedback comes from a closed menu: what's been happening in games
// (TUNE_SYMPTOMS) or "more / less" of a job, theme, creature type or lands (TUNE_DIALS). Each turns
// into steps of {add, cut}: a card to bring in from the cards you own, and the card it replaces.
// Steps are simulated one after another on a copy of the deck, so tapping "More removal" twice asks
// for four different cards. Nothing changes until the person applies the swaps they keep ticked.
// Cuts never touch the commander, companion, cards you kept (b.keep), cards you set to Always, cards
// this tune just added, or a card whose job the deck is at or under target for (buildSlots(b)).
// Applying records the resulting counts as the build's targets, which regenerating also follows.
const TUNE_SYMPTOMS = [
  { id: "screw", label: "I miss land drops", hint: "+1 land, +1 cheap ramp",
    ops: () => [{ add: { land: true }, cut: { weak: true } }, { add: { role: "Ramp", maxMv: 2 }, cut: { weak: true, big: true } }] },
  { id: "flood", label: "I draw too many lands", hint: "−1 land, +1 card draw",
    ops: () => [{ add: { role: "Card draw" }, cut: { land: true } }] },
  { id: "empty", label: "I run out of cards", hint: "+2 card draw",
    ops: () => [1, 2].map(() => ({ add: { role: "Card draw" }, cut: { weak: true } })) },
  { id: "slow", label: "I'm too slow", hint: "Expensive cards out, cheaper ones in",
    ops: () => [1, 2, 3].map(() => ({ add: { maxMv: 3 }, cut: { big: true, only: "big" } })) },
  { id: "threats", label: "I can't deal with threats", hint: "+2 removal",
    ops: () => [1, 2].map(() => ({ add: { role: "Removal" }, cut: { weak: true } })) },
  { id: "cmd", label: "My commander keeps dying", hint: "+2 protection",
    ops: () => [1, 2].map(() => ({ add: { role: "Protection" }, cut: { weak: true } })) },
  { id: "theme", label: "The theme doesn't show up", hint: "+3 cards on theme",
    ops: () => [1, 2, 3].map(() => ({ add: { onTheme: true }, cut: { weak: true, offTheme: true } })) },
];
// "More / less" choices: "r:Ramp", "t:3" (theme bit), "y:12" (creature type), "lands".
function tuneDialChoices(b) {
  const out = [["lands", "Lands"]];
  if (hasRoles()) for (const r of ROLE_COUNTED) if (DATA.roles.includes(r)) out.push(["r:" + r, r]);
  if (hasThemes()) DATA.themes.forEach((t, bit) => out.push(["t:" + bit, t]));
  const o = buildOpts(b);
  for (const t of o.tribes || []) out.push(["y:" + t, DATA.subtypes[t]]);
  return out;
}
const dialLabel = (b, key) => (tuneDialChoices(b).find(x => x[0] === key) || [key, key])[1];
function dialOps(key, dir) {
  const [kind, val] = key === "lands" ? ["lands", null] : [key.slice(0, 1), key.slice(2)];
  if (kind === "lands") return [dir > 0 ? { add: { land: true }, cut: { weak: true } } : { add: {}, cut: { land: true } }];
  const twice = op => [op, JSON.parse(JSON.stringify(op))];
  if (kind === "r") return twice(dir > 0 ? { add: { role: val }, cut: { weak: true } } : { add: { notRole: val }, cut: { role: val } });
  if (kind === "t") return twice(dir > 0 ? { add: { theme: +val }, cut: { weak: true, notTheme: +val } } : { add: { notTheme: +val }, cut: { theme: +val } });
  if (kind === "y") return twice(dir > 0 ? { add: { tribe: +val }, cut: { weak: true } } : { add: {}, cut: { tribe: +val } });
  return [];
}
function stepLabel(b, s) {
  if (s.template) { const t = templateById(s.template); return `Closer to ${t ? t.name : "the template"}`; }
  if (s.symptom) return (TUNE_SYMPTOMS.find(x => x.id === s.symptom) || {}).label || s.symptom;
  return `${s.dir > 0 ? "More" : "Less"} ${dialLabel(b, s.dial).toLowerCase()}`;
}
function stepOps(s, b) {
  if (s.template) { const t = templateById(s.template); return t && b ? templateOps(b, t) : []; }
  return s.symptom ? ((TUNE_SYMPTOMS.find(x => x.id === s.symptom) || { ops: () => [] }).ops()) : dialOps(s.dial, s.dir);
}

const TUNE_CACHE = new Map();
const roleBit = r => (hasRoles() ? DATA.roles.indexOf(r) : -1);
const hasRole = (it, r) => { const bit = roleBit(r); return bit >= 0 && ((it.roles >> bit) & 1) === 1; };
const rawThemes = i => (hasThemes() && i != null ? DATA.cardThemes[i] || 0 : 0);
const BASIC_COLOR = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G", wastes: "C" };
const basicColor = name => BASIC_COLOR[norm(name).replace(/^snow-covered /, "")] || null;

// One deck as tuning sees it: nonbasic cards with their scores, plus basic land counts.
// Cards in a combo the deck already has (every piece, commander included) are never cut.
function comboPieces(b) {
  const out = new Set(); if (!COMBOS || !COMBOS.combos) return out;
  const have = new Set(b.cards.map(c => LOOKUP.get(norm(c.name))).filter(i => i != null));
  for (const cb of COMBOS.combos) if (cb[1].every(i => have.has(i))) for (const i of cb[1]) out.add(i);
  return out;
}
function tuneDeck(b, opts) {
  const played = playedCounts(), items = [], basics = new Map(), combo = comboPieces(b);
  const cmdKeys = new Set(opts.commanders.map(norm));
  for (const c of deckCards(b)) {
    const k = norm(c.name);
    if (cmdKeys.has(k)) continue;
    if (isBasic(c.name)) { basics.set(c.name, (basics.get(c.name) || 0) + c.qty); continue; }
    const i = LOOKUP.get(k), card = i == null ? null : DATA.cards[i];
    const g = card ? genScore(i, card, opts, played) : { score: 0, hits: 0, tribe: null };
    items.push({ name: card ? card[0] : c.name, k, i, c: card, qty: c.qty, roles: card ? card[5] || 0 : 0, hits: g.hits, tribe: g.tribe, score: g.score,
      land: card ? card[2] === "L" : false, mv: card ? card[4] || 0 : 0, combo: i != null && combo.has(i),
      locked: isKept(b, c.name) || tasteOf(c.name) === 2 || isComp(b, c.name) || (i != null && combo.has(i)) });
  }
  return { items, basics };
}
const deckLandCount = d => d.items.filter(x => x.land).reduce((n, x) => n + x.qty, 0) + [...d.basics.values()].reduce((n, q) => n + q, 0);
const deckRoleCount = (d, r) => d.items.filter(x => !x.land && hasRole(x, r)).reduce((n, x) => n + x.qty, 0);

// alt: {"in:3": name, "out:3": name} picks a runner-up for swap 3 instead of the first choice.
function tunePlan(b, steps, alt = {}) {
  const key = b.id + "|" + b.updated + "|" + CHANGE + "|" + JSON.stringify(steps) + "|" + JSON.stringify(alt) + "|" + JSON.stringify(b.tuneOpts || {});
  if (TUNE_CACHE.has(key)) return TUNE_CACHE.get(key);
  const opts = deckOpts(b), ident = identityOf(opts.commanders), played = playedCounts();
  const d = tuneDeck(b, opts), kinds = legendKinds(opts.commanders);
  const skip = new Set([...b.cards.map(c => norm(c.name)), ...(b.notHere || []).map(norm), ...sideKeys(b)]);   // sideboard cards stay where you put them
  const { pool, lands } = genPool(opts, skip);
  const slots = buildSlots(b);
  const target = r => { const s = slots.find(x => x[0] === r); return s ? s[1] : null; };
  const fresh = new Set(), swaps = [], notes = [], used = new Set();
  const nonbasicLands = () => d.items.filter(x => x.land).length;
  const maxNonbasic = Math.round(deckLandCount(d) * (ident.size <= 1 ? 0.3 : 0.6));
  const makes = it => { const lc = landMakes(it.i, deckHas(d.items), typeCount(d.items)).colors; return lc == null ? undefined : lc; };
  // Colour need (spells of each colour) vs sources (lands that make it), for choosing basics.
  const colourGap = () => {
    const need = {}, src = {};
    for (const ch of ident) { need[ch] = 1; src[ch] = 0; }
    for (const x of d.items) if (!x.land && x.c) for (const ch of x.c[1]) if (ch in need) need[ch] += x.qty;
    for (const x of d.items) if (x.land) { const lc = makes(x); if (lc) for (const ch of lc) if (ch in src) src[ch]++; }
    for (const [n, q] of d.basics) { const ch = basicColor(n); if (ch in src) src[ch] += q; }
    return { need, src };
  };
  const cutWhy = (x, spec, r) => spec.land ? (isBasic(x.name) ? `${x.name}: you have the most of these` : "weakest land")
    : spec.role || spec.theme != null || spec.tribe != null ? `${r || "fits it"}` : spec.only === "big" ? `${x.mv} mana` : "";
  function chooseCut(spec, add) {
    if (spec.land) {
      if (deckLandCount(d) <= 30) return { err: "The deck is already at 30 lands, the fewest tuning will go." };
      const bs = [...d.basics].filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      if (bs.length) return { basic: bs[0][0] };
      const ls = d.items.filter(x => x.land && !x.locked && !fresh.has(x.k)).sort((x, y) => x.score - y.score);
      return ls[0] ? { item: ls[0] } : { err: "Every land here is kept." };
    }
    let cands = d.items.filter(x => !x.land && !x.locked && !fresh.has(x.k));
    if (spec.role) cands = cands.filter(x => hasRole(x, spec.role));
    if (spec.theme != null) cands = cands.filter(x => (planThemes(x.i, x.c, kinds) >> spec.theme) & 1);
    if (spec.tribe != null) cands = cands.filter(x => x.c && ((x.c[8] || []).includes(spec.tribe) || !!(makesOf(x.i) && makesOf(x.i).indexOf(spec.tribe, 1) > 0)));
    if (spec.only === "big") { cands = cands.filter(x => x.mv >= 5); if (!cands.length) return { err: "Nothing here costs 5 or more that isn't kept." }; }
    // Don't cut a card whose job the deck needs (at or under target), or one that does the job being added.
    cands = cands.filter(x => {
      if (add.role && hasRole(x, add.role)) return false;
      if (add.theme != null && (planThemes(x.i, x.c, kinds) >> add.theme) & 1) return false;
      if (add.onTheme && (x.hits || x.tribe)) return false;
      for (const [r] of slots) if (r !== spec.role && hasRole(x, r) && deckRoleCount(d, r) <= target(r)) return false;
      return true;
    });
    if (!cands.length) return { err: spec.role ? `No ${spec.role.toLowerCase()} card here can go without dropping below what the deck needs.`
      : spec.only === "big" ? "The other cards costing 5 or more are kept or do a job the deck is short on." : "Every other card here is kept or does a job the deck is short on." };
    const val = x => x.score + (spec.offTheme && (x.hits || x.tribe) ? 4 : 0) - (spec.big ? x.mv * 0.6 : 0) + (spec.only === "big" ? -x.mv * 2 : 0);
    cands.sort((x, y) => val(x) - val(y) || x.name.localeCompare(y.name));
    return pickWithAlts(cands, "out:" + swaps.length);
  }
  // The first choice, or the runner-up the person picked; plus two others they could pick instead.
  function pickWithAlts(cands, slot) {
    const want = alt[slot] && cands.find(x => norm(x.name) === norm(alt[slot]));
    const item = want || cands[0];
    return { item, alts: cands.slice(0, 3).filter(x => x !== item).slice(0, 2).map(x => x.name) };
  }
  function chooseIn(spec, cut) {
    if (spec.land) {
      const { need, src } = colourGap();
      if (nonbasicLands() < maxNonbasic) {
        const ls = lands.filter(it => !used.has(it.i)).map(it => { const lc = makes(it); return { it, n: lc == null ? 0 : [...lc].filter(ch => ident.has(ch)).length }; })
          .filter(x => x.n >= Math.min(2, ident.size) && x.n > 0).sort((x, y) => y.n - x.n || y.it.score - x.it.score);
        if (ls[0]) return { item: ls[0].it, why: `land · makes ${[...makes(ls[0].it)].filter(ch => ident.has(ch)).join("/")}` };
      }
      if (!ident.size) return { basic: "Wastes", why: "basic land" };
      const ch = [...ident].sort((x, y) => src[x] / need[x] - src[y] / need[y])[0];
      return { basic: BASIC_FOR[ch], why: `basic land · ${COLOR_NAMES[ch].toLowerCase()} has the fewest sources for what needs it` };
    }
    let cands = pool.filter(it => !used.has(it.i));
    if (spec.role) cands = cands.filter(it => hasRole(it, spec.role));
    if (spec.notRole) cands = cands.filter(it => !hasRole(it, spec.notRole));
    if (spec.maxMv != null) cands = cands.filter(it => (it.c[4] || 0) <= spec.maxMv);
    if (spec.theme != null) cands = cands.filter(it => (planThemes(it.i, it.c, kinds) >> spec.theme) & 1);
    if (spec.notTheme != null) cands = cands.filter(it => !((planThemes(it.i, it.c, kinds) >> spec.notTheme) & 1));
    if (spec.onTheme) cands = cands.filter(it => it.hits || it.tribe);
    if (spec.tribe != null) cands = cands.filter(it => inTribe(it.i, it.c, spec.tribe));
    if (cut && cut.item && cut.item.mv >= 6) cands = cands.filter(it => (it.c[4] || 0) < cut.item.mv);
    const val = it => it.score + popcount(it.hits) - (spec.maxMv != null ? (it.c[4] || 0) * 0.3 : 0);
    cands.sort((x, y) => val(y) - val(x) || x.name.localeCompare(y.name));
    if (!cands.length) return { err: true };
    const { item: it, alts } = pickWithAlts(cands, "in:" + swaps.length);
    const bits = [spec.role, it.tribe, ...themeNames(it.hits)].filter(Boolean);
    return { item: it, alts, why: [...new Set(bits)].slice(0, 2).join(", ") + (bits.length ? " · " : "") + `${it.c[4] || 0} mana` };
  }
  // Up to three cards you don't own that would do it, when nothing you own does.
  function ideasFor(spec) {
    if (spec.land || !DATA) return [];
    const out = [];
    DATA.cards.forEach((c, i) => {
      if (c[2] === "L" || !legalCard(c) || !fitsIdentity(c, ident) || isBlocked(c[0])) return;
      const k = norm(c[0]); if (skip.has(k) || (AGG.get(k) && AGG.get(k).qty > 0) || opts.commanders.some(n => norm(n) === k)) return;
      const it = { roles: c[5] || 0 };
      if (spec.role && !hasRole(it, spec.role)) return;
      if (spec.maxMv != null && (c[4] || 0) > spec.maxMv) return;
      if (spec.theme != null && !((planThemes(i, c, kinds) >> spec.theme) & 1)) return;
      if (spec.tribe != null && !inTribe(i, c, spec.tribe)) return;
      const g = genScore(i, c, opts, played);
      if (g.need || (spec.onTheme && !g.hits && !g.tribe)) return;
      out.push({ name: c[0], score: g.score });
    });
    return out.sort((x, y) => y.score - x.score).slice(0, 3).map(x => x.name);
  }
  steps.forEach((s, si) => {
    const label = stepLabel(b, s);
    for (const op of stepOps(s, b)) {
      const inPick = op.add && Object.keys(op.add).length ? null : { any: true };
      let cut = chooseCut(op.cut, op.add || {});
      if (cut.err) { notes.push({ step: si, label, text: cut.err }); break; }
      const pick = inPick ? chooseIn({}, cut) : chooseIn(op.add, cut);
      if (pick.err) {
        const ideas = ideasFor(op.add);
        notes.push({ step: si, label, text: `You don't own ${op.add.role ? `another ${op.add.role.toLowerCase()} card` : "another card that fits"}${op.add.maxMv != null ? ` costing ${op.add.maxMv} or less` : ""} in these colours that's free to use.`, ideas });
        break;
      }
      // Apply to the simulated deck.
      const outName = cut.basic || cut.item.name;
      if (cut.basic) d.basics.set(cut.basic, d.basics.get(cut.basic) - 1);
      else d.items.splice(d.items.indexOf(cut.item), 1);
      const inName = pick.basic || pick.item.name;
      if (pick.basic) d.basics.set(pick.basic, (d.basics.get(pick.basic) || 0) + 1);
      else {
        used.add(pick.item.i); fresh.add(norm(inName));
        d.items.push({ ...pick.item, k: norm(inName), qty: 1, land: pick.item.c[2] === "L", mv: pick.item.c[4] || 0, locked: false });
      }
      fresh.add(norm(inName));
      const r = op.cut.role || (op.cut.theme != null ? DATA.themes[op.cut.theme] : op.cut.tribe != null ? DATA.subtypes[op.cut.tribe] : null);
      swaps.push({ step: si, label, out: outName, outWhy: cutWhy(cut.item || { name: outName }, op.cut, r), in: inName, inWhy: pick.why || "",
        outAlts: cut.alts || [], inAlts: pick.alts || [], cutSpec: op.cut, addSpec: op.add || {},
        inSt: cardStatus(inName, 1, buildHome(b)) });
    }
  });
  const res = { swaps, notes, after: d };
  TUNE_CACHE.clear(); TUNE_CACHE.set(key, res);
  return res;
}

// Plain-words reasons, from the same numbers the scores use: what the card does, whether it fits
// the deck's themes or tribe, how widely it's played, whether you play it, and your taste.
function decksWith(name) {
  const a = AGG.get(norm(name)); if (!a) return 0;
  let n = 0; for (const l of a.locs.values()) if (l.inDeck) n++;
  return n;
}
function explainCard(b, name, side, spec = {}) {
  const c = DATA && cardOf(name); if (!c) return [];
  if (isBasic(name)) return [];
  const opts = deckOpts(b), i = LOOKUP.get(norm(name)), g = genScore(i, c, opts, playedCounts());
  const wanted = [...(opts.tribes || []).map(t => tribePlural(DATA.subtypes[t])), ...themeNames(opts.themes || 0)];
  const fits = [g.tribe, ...themeNames(g.hits)].filter(Boolean);
  const roles = roleList(c[5] || 0).filter(r => ROLE_COUNTED.includes(r));
  const out = [];
  if (g.need) out.push(`needs ${g.need}${(needOf(i) || [-1])[0] < 0 ? "" : ", and this deck has too few"}`);
  if (side === "out") {
    out.push(spec.only === "big" ? `one of the most expensive cards here (${c[4] || 0} mana)` : spec.land ? "a land the deck can spare" : "scores lowest of the cards that could go");
    if (wanted.length) out.push(fits.length ? `fits ${fits.join(", ")}` : `doesn't fit ${wanted.slice(0, 3).join(" or ")}`);
    out.push(roles.length ? `${roles.join(", ")}: the deck has enough without it` : "does none of the jobs the deck counts");
  } else {
    if (roles.length) out.push(roles.join(", "));
    if (fits.length) out.push(`fits ${fits.join(", ")}`);
    if (c[2] !== "L") out.push(`${c[4] || 0} mana`);
  }
  if (c[6]) out.push(`EDHREC rank ${c[6].toLocaleString()}` + (hasPop() && !manaOnlyLand(c) ? ` (${popName(popBand(i))})` : ""));
  const nd = decksWith(name);
  out.push(nd ? `in ${nd} of your decks` : "in none of your decks");
  const lv = tasteOf(name), dn = dismissCount(name);
  if (lv === 1 || lv === -1) out.push(`you set it to ${tasteName(lv)}`);
  if (dn) out.push(`dismissed ${dn}×`);
  return out;
}

// Apply the ticked swaps; the counts they produce become the build's targets.
// Changes the build in place and returns its state from before, for Undo; the caller saves.
function tuneApply(b, plan, off, steps) {
  const before = { cards: b.cards.map(c => ({ ...c })), why: { ...(b.why || {}) }, targets: b.targets ? JSON.parse(JSON.stringify(b.targets)) : null };
  const keep = plan.swaps.filter((_, i) => !off.has(i));
  b.why = { ...(b.why || {}) };
  for (const s of keep) {
    const oi = b.cards.findIndex(c => norm(c.name) === norm(s.out));
    if (oi < 0) continue;
    if (b.cards[oi].qty > 1) b.cards[oi].qty--; else { b.cards.splice(oi, 1); delete b.why[s.out]; }
    const ex = b.cards.find(c => norm(c.name) === norm(s.in));
    if (ex) ex.qty++; else b.cards.push({ name: s.in, qty: 1 });
    if (!isBasic(s.in)) b.why[s.in] = `Tuned: ${s.label}${s.inWhy ? " · " + s.inWhy : ""}`;
  }
  // Targets: the count after tuning for each job, theme, land or curve the applied steps touched.
  // Asking for more never sets a target below the usual quota; asking for less never raises one.
  const opts = buildOpts(b), d = tuneDeck(b, opts), t = { ...(b.targets || {}), roles: { ...((b.targets || {}).roles || {}) } };
  const old = buildSlots(b), oldTarget = r => { const x = old.find(s => s[0] === r); return x ? x[1] : null; };
  const set = (cur, after, more) => cur == null ? after : more ? Math.max(after, cur) : Math.min(after, cur);
  const touched = new Set(keep.map(s => s.step));
  for (const si of touched) {
    const s = steps[si]; if (!s) continue;
    if (s.template) {                       // moving toward a template adopts its numbers as targets
      const tp = templateById(s.template); if (!tp) continue;
      t.lands = tp.shape.lands;
      for (const [r, n] of templateSlots(tp.shape, identityOf(opts.commanders))) t.roles[r] = n;
      continue;
    }
    for (const op of stepOps(s, b)) {
      if (op.add && op.add.role) t.roles[op.add.role] = set(oldTarget(op.add.role), deckRoleCount(d, op.add.role), true);
      if (op.cut && op.cut.role) t.roles[op.cut.role] = set(oldTarget(op.cut.role), deckRoleCount(d, op.cut.role), false);
      if (op.add && op.add.land) t.lands = set(b.targets && b.targets.lands, deckLandCount(d), true);
      if (op.cut && op.cut.land) t.lands = set(b.targets && b.targets.lands, deckLandCount(d), false);
      if (op.cut && op.cut.only === "big") t.big = d.items.filter(x => !x.land && x.mv >= 6).length;
    }
  }
  b.targets = t;
  TUNE_CACHE.clear(); GEN_IDEAS.clear();
  return before;
}

// ------------------------------------------------------------ deck numbers: lands, colours, jobs
// Chance of at least k lands among n cards drawn from a library of N with K lands (hypergeometric).
// log of "a choose b" (−Infinity when b is out of range), for odds over draws without replacement.
const lnChoose = (a, b) => { if (b < 0 || b > a) return -Infinity; let s = 0; for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i); return s; };
function atLeast(N, K, n, k) {
  const lc = lnChoose;
  let p = 0; const tot = lc(N, n);
  for (let i = k; i <= Math.min(n, K); i++) p += Math.exp(lc(K, i) + lc(N - K, n - i) - tot);
  return Math.min(1, p);
}
// ------------------------------------------------------------ artists
// decks.json (format 4): "artists" (display names, one per Scryfall artist ID, so one person credited
// under two spellings is one artist), "artistAka" ({index: [other spellings]}), "artistArtworks"
// (distinct illustrations per artist) and "cardArtists" (per card: artist indices, the default
// printing's first, as a nested list when that printing credits several; then other printings').
function artistIdx(name) {
  const i = LOOKUP.get(norm(name)), e = i == null || !DATA || !DATA.cardArtists ? null : DATA.cardArtists[i];
  if (!e || !e.length) return { lead: [], all: [] };
  const lead = Array.isArray(e[0]) ? e[0] : [e[0]];
  return { lead, all: [...lead, ...e.slice(1)] };
}
const artistName = a => (DATA && DATA.artists && DATA.artists[a]) || "";
// Every spelling an artist was credited under (for search).
function artistSpellings(a) { return [artistName(a), ...((DATA && DATA.artistAka && DATA.artistAka[a]) || [])].filter(Boolean); }
// Built once per card table: any spelling -> artist, and artist -> the cards they illustrated
// ({i, lead}: lead = the default printing is theirs).
let ARTISTS = null;
function artistIndex() {
  if (ARTISTS && ARTISTS.data === DATA) return ARTISTS;
  const byName = new Map(), cards = new Map();
  if (DATA && DATA.artists) {
    DATA.artists.forEach((n, a) => byName.set(norm(n), a));
    for (const [a, aka] of Object.entries(DATA.artistAka || {})) for (const n of aka) if (!byName.has(norm(n))) byName.set(norm(n), +a);
    (DATA.cardArtists || []).forEach((e, i) => {
      if (!e || !e.length) return;
      const lead = new Set(Array.isArray(e[0]) ? e[0] : [e[0]]);
      for (const a of new Set([...lead, ...e.slice(1)])) {
        if (!cards.has(a)) cards.set(a, []);
        cards.get(a).push({ i, lead: lead.has(a) });
      }
    });
  }
  return (ARTISTS = { data: DATA, byName, cards });
}
// The artist a credited name belongs to (any spelling), or null when the data doesn't know them.
const artistByName = n => { const a = artistIndex().byName.get(norm(n)); return a == null ? null : a; };
// The artist profile: how many cards and artworks, their most played cards (EDHREC rank, cards whose
// default printing is theirs first, so a reprint's art doesn't make Sol Ring everyone's top card), and
// how many of their cards are in your collection (any printing, as the artist search counts).
function artistProfile(a, topN = 3) {
  const list = (DATA && artistIndex().cards.get(a)) || [];
  const rank = x => DATA.cards[x.i][6] || Infinity;
  const top = list.filter(x => DATA.cards[x.i][6]).sort((x, y) => (y.lead - x.lead) || rank(x) - rank(y)).slice(0, topN)
    .map(x => ({ name: DATA.cards[x.i][0], rank: DATA.cards[x.i][6], lead: x.lead }));
  const works = DATA && DATA.artistArtworks ? DATA.artistArtworks[a] : null;
  return { name: artistName(a), aka: (DATA && DATA.artistAka && DATA.artistAka[a]) || [], cards: list.length,
    artworks: works == null ? null : works, top, owned: list.filter(x => AGG.has(KEY[x.i])).length };
}

// ------------------------------------------------------------ mana costs and symbols
// decks.json "manaCosts" (format 3): one string per card in Scryfall notation, "{2}{W}{U/P}", split
// cards "{1}{R} // {2}{U}", "" for none (lands). Older data has no costs: costOf returns null.
const costOf = name => { if (!DATA || !DATA.manaCosts) return null; const i = LOOKUP.get(norm(name)); return i == null ? null : DATA.manaCosts[i] || ""; };
// "{2}{W/U} // {R}" -> ["2", "W/U", "//", "R"]
const costSymbols = cost => (String(cost || "").match(/\{[^}]+\}|\/\//g) || []).map(t => t === "//" ? "//" : t.slice(1, -1));
// ------------------------------------------------------------ quick filters (deck screen; Matt, Nov 8)
// A card's colours as the rules mean them: from its mana cost (a hybrid symbol counts for both colours), so
// lands and other cards without a cost are colourless and a red-black instant is red. That's how cards like
// Sunforger read ("a red or white instant card"). Without cost data, colour identity stands in.
function cardColors(name) {
  const cost = costOf(name);
  if (cost == null) { const r = cardOf(name); return r ? r[1].replace("C", "") : ""; }
  const out = new Set();
  for (const sym of costSymbols(cost)) for (const p of sym.split("/")) if (p.length === 1 && "WUBRG".includes(p)) out.add(p);
  return COLORS.filter(c => out.has(c)).join("");
}
const QUICK_TYPES = ["C", "A", "E", "P", "B", "L", "I", "S"];   // permanents first, then instants and sorceries (Matt)
const QUICK_MV_TOP = 6;                                         // the last mana-value chip, shown as "6+"
// A quick filter: types (any of), mana value with mode le|eq|ge, colours (any of; "C" = colourless). Plain
// arrays, so a saved filter is plain JSON. The colours are the card's own (its cost: a land is colourless) or, with
// `by: "id"` (0.80.0; Matt, Nov 12: "I'd add that filter"), its colour identity, so Red finds a Mountain and a
// Blood Crypt too. Not the same thing as the Filters sheet's Within colors, which asks what a commander may run
// (the identity inside the colours picked): the two can be on together.
const quickBlank = () => ({ types: [], mv: null, mode: "le", colors: [] });
// A card's colour identity as letters ("" = colourless); a basic land's is known without card data.
const cardIdent = name => { const c = DATA ? cardOf(name) : null; return (c ? c[1] : basicColor(name) || "").replace("C", ""); };
const quickColors = (name, f) => (f.by === "id" ? cardIdent(name) : cardColors(name));
const quickOn = f => f.types.length + (f.mv != null ? 1 : 0) + f.colors.length;
function mvMatches(mv, v, mode) {
  if (v == null) return true;
  if (mode === "ge" || (mode === "eq" && v >= QUICK_MV_TOP)) return mv >= v;
  return mode === "eq" ? mv === v : mv <= v;
}
// skip leaves one part out, for the counts on that part's own chips. A mana-value filter leaves lands out.
function quickMatch(name, f, skip) {
  if (skip !== "type" && f.types.length && !f.types.includes(typeOf(name))) return false;
  if (skip !== "mv" && f.mv != null) { const r = cardOf(name); if (!r || r[2] === "L" || !mvMatches(r[4] || 0, f.mv, f.mode)) return false; }
  if (skip !== "color" && f.colors.length) { const cs = quickColors(name, f); if (!f.colors.some(c => c === "C" ? !cs : cs.includes(c))) return false; }
  return true;
}

// How much of each colour a cost asks for: a plain symbol counts 1; a hybrid or Phyrexian symbol, which
// can be paid another way, counts 1/2 for each colour in it. Split cards count both halves.
function pipCounts(cost) {
  const out = {};
  for (const sym of costSymbols(cost)) {
    const parts = sym.split("/"), cols = parts.filter(p => "WUBRG".includes(p) && p.length === 1);
    if (!cols.length) continue;
    const soft = parts.length > 1;
    for (const ch of cols) out[ch] = (out[ch] || 0) + (soft ? 0.5 : 1);
  }
  return out;
}

function manaNumbers(b) {
  const opts = buildOpts(b), ident = identityOf(opts.commanders), d = tuneDeck(b, opts);
  const N = d.items.reduce((n, x) => n + x.qty, 0) + [...d.basics.values()].reduce((n, q) => n + q, 0);
  const lands = deckLandCount(d), ramp = deckRoleCount(d, "Ramp");
  const need = {}, src = {}; let unknown = 0;
  for (const ch of ident) { need[ch] = 0; src[ch] = 0; }
  // Coloured symbols in the deck's costs per colour (with cost data), and cards that need each colour.
  const pips = {}, hasCosts = !!DATA.manaCosts;
  for (const ch of ident) pips[ch] = 0;
  for (const x of d.items) if (!x.land && x.c) {
    for (const ch of x.c[1]) if (ch in need) need[ch] += x.qty;
    if (hasCosts) for (const [ch, n] of Object.entries(pipCounts(DATA.manaCosts[x.i] || ""))) if (ch in pips) pips[ch] += n * x.qty;
  }
  // A land counts for the colours it makes in this deck; held: lands whose other colours have strings the deck doesn't meet.
  const has = deckHas(d.items), count = typeCount(d.items), held = [];
  for (const x of d.items) if (x.land) {
    const m = landMakes(x.i, has, count);
    if (m.colors == null) unknown++; else for (const ch of m.colors) if (ch in src) src[ch] += x.qty;
    if ([...m.held].some(ch => ch in src)) held.push(x.name);
  }
  for (const [n, q] of d.basics) { const ch = basicColor(n); if (ch in src) src[ch] += q; }
  return { N, lands, ramp, ident, need, pips, hasCosts, src, unknown, held, hasLandData: !!DATA.landColors,
    play4: N >= 10 ? atLeast(N, lands, 10, 4) : 0, draw4: N >= 11 ? atLeast(N, lands, 11, 4) : 0,
    open: N >= 7 ? atLeast(N, lands, 7, 2) - atLeast(N, lands, 7, 5) : 0, slots: buildSlots(b), d };
}
// ------------------------------------------------------------ templates: a deck's shape, reused
// "Use as template" on any deck (yours in ManaBox, a saved deck, a build) records its shape, not its
// cards: lands, curve, creatures, how many cards do each job, total interaction (removal, counterspells
// and wipes as one budget), and how many cards are "on plan" (fit its commander's themes or tribe).
// Generating with a template fills those numbers for a different commander: a goblin deck's shape
// becomes an elf deck's. Colours matter less than they seem, because one card counts toward every job it
// does (an elf that makes mana fills a ramp slot and an elf slot), and a deck without blue gets its
// template's counterspells as removal. Kept in bt.templates; synced in builds.json and backups.
const JOB_ROLES = ["Ramp", "Card draw", "Removal", "Board wipe", "Counterspell", "Protection", "Tutor", "Recursion"];
const INTERACTION = ["Removal", "Counterspell", "Board wipe"];
let TEMPLATES = [];
const templateById = id => (id && TEMPLATES.find(t => t.id === id)) || null;
const isInteraction = it => INTERACTION.some(r => hasRole(it, r));
// What a deck is built around: its commander's themes and tribe, or else the creature type or theme
// it has most of (8 cards or more).
function deckPlan(cards, commanders) {
  const w = commanders.length ? commanderWants(commanders.map(canonical)) : { themes: 0, tribes: [] };
  if (w.themes || w.tribes.length) return w;
  const cmdKeys = new Set(commanders.map(norm)), types = new Map(), themes = new Map();
  for (const x of cards) {
    if (cmdKeys.has(norm(x.name))) continue;
    const i = LOOKUP.get(norm(x.name)), c = i == null ? null : DATA.cards[i]; if (!c || c[2] === "L") continue;
    for (const t of c[2] === "C" ? c[8] || [] : []) types.set(t, (types.get(t) || 0) + 1);
    const th = rawThemes(i); for (let bit = 0; th >> bit; bit++) if ((th >> bit) & 1) themes.set(bit, (themes.get(bit) || 0) + 1);
  }
  const tribe = [...types].sort((a, b) => b[1] - a[1])[0], theme = [...themes].sort((a, b) => b[1] - a[1])[0];
  if (tribe && tribe[1] >= 8) return { themes: 0, tribes: [tribe[0]] };
  if (theme && theme[1] >= 8) return { themes: 1 << theme[0], tribes: [] };
  return { themes: 0, tribes: [] };
}
// A creature type as a group of them: Elf → Elves, Ally → Allies, Fox → Foxes, Human → Humans.
// Plurals no rule makes (Matt checked every creature type, Nov 7). The fetcher's IRREGULAR_PLURALS reads the same words in card text.
const TRIBE_PLURALS = { Mouse: "Mice", Ox: "Oxen", Dwarf: "Dwarves", Wolf: "Wolves", Elf: "Elves", Werewolf: "Werewolves",
  Fungus: "Fungi", Homunculus: "Homunculi", Pegasus: "Pegasi", Cyclops: "Cyclopes", Locus: "Loci",
  Child: "Children", Grandchild: "Grandchildren" };
// Types whose plural is the same word: the -folk races, old Magic races, animals like Deer, and most Star Trek species.
const SAME_PLURAL = new Set(["Fish", "Sheep", "Merfolk", "Treefolk", "Kithkin", "Moonfolk", "Clamfolk", "Townsfolk", "Myr", "Kor",
  "Vedalken", "Eldrazi", "Djinn", "Samurai", "Kavu", "Aetherborn", "Elk", "Deer", "Bison", "Aurochs", "Jellyfish", "Starfish",
  "Dauthi", "Soltari", "Thalakos", "Metathran", "Zubera", "Kirin", "Surrakar", "Astartes", "Custodes", "C'tan", "Nephilim",
  "Borg", "Ferengi", "Xindi", "Vorta", "Jem'Hadar", "Kwejian", "Ocampa", "Trill", "Kree", "Shi'ar", "Aenar"]);
function tribePlural(t) {
  if (!t) return "";
  if (TRIBE_PLURALS[t]) return TRIBE_PLURALS[t];
  if (SAME_PLURAL.has(t)) return t;
  if (/[^aeiou]y$/.test(t)) return t.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(t)) return t + "es";
  return t + "s";
}
const planLabel = p => [...(p.tribes || []).map(t => tribePlural(DATA.subtypes[t])), ...themeNames(p.themes || 0)].join(", ");
function deckShape(cards, commanders, companion = null) {
  const plan = deckPlan(cards, commanders);
  const fake = { cards, commanders, companion, keep: [] };
  const opts = { commanders: commanders.map(canonical), themes: plan.themes, tribes: plan.tribes, useDecks: false };
  const d = tuneDeck(fake, opts), nl = d.items.filter(x => !x.land);
  const curve = new Array(8).fill(0); let sum = 0, n = 0;
  for (const x of nl) { curve[Math.min(x.mv, 7)] += x.qty; sum += x.mv * x.qty; n += x.qty; }
  const roles = {}; for (const r of JOB_ROLES) roles[r] = deckRoleCount(d, r);
  const count = f => nl.filter(f).reduce((t, x) => t + x.qty, 0);
  return { lands: deckLandCount(d), nonland: n, curve, avgMv: n ? +(sum / n).toFixed(2) : 0, roles,
    interaction: count(isInteraction), creatures: count(x => x.c && x.c[2] === "C"),
    onPlan: count(x => x.hits || x.tribe), plan: planLabel(plan), colours: identityOf(commanders).size };
}
function templateSummary(sh) {
  return [`${sh.lands} lands`, `average mana value ${sh.avgMv}`, `${sh.roles.Ramp || 0} ramp`, `${sh.roles["Card draw"] || 0} card draw`,
    `${sh.interaction} interaction`, sh.plan ? `${sh.onPlan} on plan (${sh.plan})` : ""].filter(Boolean).join(" · ");
}
// The jobs a template asks for, scaled to this deck's size; counterspells become removal without blue.
function templateSlots(sh, ident, sf = 1) {
  const out = new Map();
  for (const r of JOB_ROLES) { const n = Math.round((sh.roles[r] || 0) * sf); if (n > 0) out.set(r, n); }
  if (ident && !ident.has("U") && out.has("Counterspell")) { out.set("Removal", (out.get("Removal") || 0) + out.get("Counterspell")); out.delete("Counterspell"); }
  return [...out];
}
// Ops that move a build toward a template: a couple of swaps per gap, at most eight in all.
function templateOps(b, t) {
  const sh = t.shape, opts = deckOpts(b), d = tuneDeck(b, opts), ops = [];
  const push = (n, op) => { for (let k = 0; k < Math.min(n, 2) && ops.length < 8; k++) ops.push(JSON.parse(JSON.stringify(op))); };
  const landGap = sh.lands - deckLandCount(d);
  if (landGap > 0) push(landGap, { add: { land: true }, cut: { weak: true } });
  if (landGap < 0) push(-landGap, { add: {}, cut: { land: true } });
  for (const [r, n] of templateSlots(sh, identityOf(opts.commanders))) {
    const gap = n - deckRoleCount(d, r);
    if (gap > 0) push(gap, { add: { role: r }, cut: { weak: true } });
    else if (gap < -1) push(-gap - 1, { add: { notRole: r }, cut: { role: r } });
  }
  const on = d.items.filter(x => !x.land && (x.hits || x.tribe)).reduce((t2, x) => t2 + x.qty, 0);
  if ((opts.themes || (opts.tribes || []).length) && sh.onPlan - on > 1) push(sh.onPlan - on, { add: { onTheme: true }, cut: { weak: true, offTheme: true } });
  return ops;
}
// ------------------------------------------------------------ build helpers: owned decks, deck check, curve, roles
const FLAG_LEGAL = 1, FLAG_BANNED = 2, FLAG_COMMANDER = 4, FLAG_PARTNER = 8, FLAG_ANY_NUMBER = 16;
const hasFlags = () => !!(DATA && DATA.cards.length && DATA.cards[0].length > 7);
const flagsOf = name => { const c = DATA && cardOf(name); return c && c.length > 7 ? c[7] : null; };

// ------------------------------------------------------------ companions
// A companion starts outside the game: it isn't one of the 100, must fit the commander's colors,
// and the starting deck (commander included) must meet its condition. One per deck.
// These bits come with data that lists "companion" in DATA.facts (fetcher card_flags).
const FLAG_COMPANION = 32, FLAG_REPEATS_SYMBOL = 64, FLAG_ACTIVATED = 128;
const T = { creature: 256, artifact: 512, enchantment: 1024, planeswalker: 2048, instant: 4096, sorcery: 8192, battle: 16384, land: 32768, kindred: 65536 };
const T_PERMANENT = T.creature | T.artifact | T.enchantment | T.planeswalker | T.battle | T.land;
const T_NONLAND = T.creature | T.artifact | T.enchantment | T.planeswalker | T.instant | T.sorcery | T.battle | T.kindred;
const hasFacts = () => !!(DATA && Array.isArray(DATA.facts) && DATA.facts.includes("companion"));
const CODE_BITS = { C: T.creature, A: T.artifact, E: T.enchantment, P: T.planeswalker, I: T.instant, S: T.sorcery, B: T.battle, L: T.land };
// Card types as bits: exact with the new data, from the one-letter type code before it.
const typeBits = name => { const f = flagsOf(name); return hasFacts() && f != null ? f & (T_PERMANENT | T_NONLAND) : CODE_BITS[typeOf(name)] || 0; };
const mvOf = name => (isBasic(name) ? 0 : ((cardOf(name) || [])[4] || 0));
const subtypesOf = name => { const c = cardOf(name); return c && c.length > 8 && DATA.subtypes ? c[8].map(i => DATA.subtypes[i]) : []; };
const COMPANIONS = {
  "gyruda, doom of depths": { short: "Gyruda", rule: "every card has an even mana value", bad: n => mvOf(n) % 2 !== 0 },
  "jegantha, the wellspring": { short: "Jegantha", rule: "no card's mana cost has the same symbol twice", needsFacts: true, bad: n => !!((flagsOf(n) || 0) & FLAG_REPEATS_SYMBOL),
    byHand: "make sure no card's mana cost repeats a symbol (like {W}{W}, {X}{X} or {W/U}{W/U})" },
  "kaheera, the orphanguard": { short: "Kaheera", rule: "every creature card is a Cat, Elemental, Nightmare, Dinosaur or Beast", needsSubtypes: true,
    byHand: "make sure every creature card is a Cat, Elemental, Nightmare, Dinosaur or Beast",
    bad: n => !!(typeBits(n) & T.creature) && !subtypesOf(n).some(t => ["Cat", "Elemental", "Nightmare", "Dinosaur", "Beast"].includes(t)) },
  "keruga, the macrosage": { short: "Keruga", rule: "every nonland card has mana value 3 or more", bad: n => !(typeBits(n) & T.land) && !isBasic(n) && mvOf(n) < 3 },
  "lurrus of the dream-den": { short: "Lurrus", rule: "every permanent card has mana value 2 or less", bad: n => (!!(typeBits(n) & T_PERMANENT) || isBasic(n)) && mvOf(n) > 2 },
  "obosh, the preypiercer": { short: "Obosh", rule: "every nonland card has an odd mana value", bad: n => !(typeBits(n) & T.land) && !isBasic(n) && mvOf(n) % 2 !== 1 },
  "umori, the collector": { short: "Umori", rule: "every nonland card shares a card type", needsFacts: true, whole: true,
    byHand: "make sure every nonland card shares a card type (all creatures, for example)" },
  "zirda, the dawnwaker": { short: "Zirda", rule: "every permanent card has an activated ability", needsFacts: true, likely: true,
    bad: n => (!!(typeBits(n) & T_PERMANENT) || isBasic(n)) && !isBasic(n) && !((flagsOf(n) || 0) & FLAG_ACTIVATED),
    byHand: "make sure every permanent card has an activated ability" },
  "yorion, sky nomad": { never: "Yorion can't be a companion in Commander: its condition needs a deck of more than 100 cards." },
  "lutri, the spellchaser": { never: "Lutri is banned as a companion in Commander (since February 9, 2026). It can still be one of the 100." },
};
const isCompanionCard = name => (hasFacts() ? !!((flagsOf(name) || 0) & FLAG_COMPANION) : !!COMPANIONS[norm(name)]);
const isComp = (b, name) => !!(b && b.companion && norm(b.companion) === norm(name));
const deckCards = b => b.cards.filter(c => !isComp(b, c.name));   // the 100 (or fewer), without the companion

// A sideboard (0.57.0; Matt, Nov 11): cards kept with the deck, in its box, and outside the 100. b.side = [{name, qty}],
// absent when there is none. Everything about how the deck plays (the deck check, mana, jobs, hands, the bracket,
// tuning) reads b.cards alone; everything about the box (gathering, moving cards when a build is marked built, what a
// deck has to take out) reads boxCards(b). Only you move a card in or out of it: the generator, tuning and swap
// suggestions leave sideboard cards where they are (sideKeys joins their lists of cards not to use).
const sideOf = b => (b && Array.isArray(b.side) ? b.side : []);
const sideQty = b => sideOf(b).reduce((n, c) => n + (c.qty || 1), 0);
const sideKeys = b => new Set(sideOf(b).map(c => norm(c.name)));
const inSide = (b, name) => sideOf(b).some(c => norm(c.name) === norm(name));
const anyNumber = name => isBasic(name) || !!((flagsOf(name) || 0) & FLAG_ANY_NUMBER);
// What the deck's box holds: the deck (its companion too) and the sideboard, one line per card. `side` marks a card that
// is only in the sideboard; `sideQty` is how many of a line's copies are (basics can be in both).
function boxCards(b) {
  const out = b.cards.map(c => ({ ...c })), at = new Map(out.map(c => [norm(c.name), c]));
  for (const c of sideOf(b)) {
    const k = norm(c.name), ex = at.get(k);
    if (ex) { ex.qty += c.qty; ex.sideQty = (ex.sideQty || 0) + c.qty; }
    else { const x = { ...c, side: true, sideQty: c.qty }; out.push(x); at.set(k, x); }
  }
  return out;
}
// Keep the two lists apart after any change: a card that is now in the deck leaves the sideboard (one copy of each card,
// except those a deck may hold any number of), empty lines go, and an empty sideboard is no sideboard. → whether it changed.
function sideClean(b) {
  if (!b || b.side == null) return false;
  const deck = new Set(b.cards.map(c => norm(c.name))), seen = new Map(), out = [];
  for (const c of sideOf(b)) {
    const k = norm(c.name), qty = Math.floor(+c.qty) || 0;
    if (qty <= 0 || !c.name || (deck.has(k) && !anyNumber(c.name))) continue;
    const ex = seen.get(k); if (ex) ex.qty += qty; else { const x = { name: c.name, qty }; seen.set(k, x); out.push(x); }
  }
  const changed = JSON.stringify(out) !== JSON.stringify(b.side);
  if (out.length) b.side = out; else delete b.side;
  return changed;
}

function companionChecks(b) {
  const comp = b.companion, items = [];
  if (!comp) return items;
  const card = b.cards.find(c => isComp(b, c.name));
  if (!card) return items;
  const rule = COMPANIONS[norm(comp)];
  items.push({ ok: true, text: `Companion: ${comp} (outside the 100)` });
  if (!isCompanionCard(comp)) { items.push({ ok: false, text: `${comp} doesn't have Companion` }); return items; }
  if (isCmd(b, comp)) items.push({ ok: false, text: "Your companion can't also be your commander" });
  if (card.qty > 1) items.push({ ok: false, text: "Only one copy of your companion" });
  if (rule && rule.never) { items.push({ ok: false, text: rule.never }); return items; }
  if (!rule) { items.push({ ok: null, text: `${comp}'s companion condition isn't checked here. Check it by hand.` }); return items; }
  const deck = deckCards(b).map(c => c.name);
  const name = rule.short || comp;
  if ((rule.needsFacts && !hasFacts()) || (rule.needsSubtypes && !(DATA && DATA.subtypes))) { items.push({ ok: null, text: `${name}'s condition isn't checked until the next data refresh: ${rule.byHand}. Your commander counts too.` }); return items; }
  if (rule.whole) {   // Umori: one card type shared by every nonland card
    const nonland = deck.filter(n => !(typeBits(n) & T.land) && !isBasic(n) && cardOf(n));
    let shared = T_NONLAND; for (const n of nonland) shared &= typeBits(n);
    if (shared || !nonland.length) { items.push({ ok: true, text: `${name}: ${rule.rule}` }); return items; }
    const counts = Object.entries(T).map(([k, bit]) => [k, nonland.filter(n => typeBits(n) & bit).length]).sort((a, c) => c[1] - a[1]);
    const [best, bit] = [counts[0][0], T[counts[0][0]]];
    items.push({ ok: false, text: `${name}: ${rule.rule}. Most are ${best === "sorcery" ? "sorceries" : best + "s"}; these aren't`, list: nonland.filter(n => !(typeBits(n) & bit)) });
    return items;
  }
  const offenders = deck.filter(n => (cardOf(n) || isBasic(n)) && rule.bad(n));
  if (!offenders.length) items.push({ ok: true, text: rule.likely ? `${name}: every permanent card seems to have an activated ability` : `${name}: ${rule.rule}` });
  else if (rule.likely) items.push({ ok: null, text: `${name}: ${rule.rule}. These look like they don't (worth a check)`, list: offenders });
  else items.push({ ok: false, text: `${name}: ${rule.rule}. These don't`, list: offenders });
  return items;
}
// The deck a build is made from: the location it was built into (builtLoc, 0.53.0), an owned deck's own build, or an
// overhaul of a deck you have (source.home).
const buildHome = b => (!b ? null : b.builtLoc ? b.builtLoc : !b.source ? null : b.source.kind === "owned" ? b.source.loc : b.source.kind === "generated" && b.source.home ? b.source.home : null);
const typeOf = name => (DATA && cardOf(name) ? cardOf(name)[2] : (isBasic(name) ? "L" : "O"));

// Deck binders in the collection: the decks you already have.
function ownedDecks() {
  const decks = new Map();
  for (const e of (COLL ? COLL.entries : [])) {
    if (!e.inDeck || swapsBase(e.loc) != null) continue;     // a hot-swap's Swaps binder isn't a deck of its own
    decks.set(e.loc, (decks.get(e.loc) || 0) + e.qty);
  }
  return [...decks].map(([loc, count]) => ({ loc, count })).sort((a, b) => a.loc.localeCompare(b.loc));
}
// `lead` = the commanders you named for this deck ("Who leads it?", 0.47.0), used while they're still in it.
function ownedDeckList(loc, lead = null) {
  const cards = new Map();
  for (const e of COLL.entries) if (e.loc === loc) {
    const name = canonical(e.name), k = norm(name);
    const ex = cards.get(k); if (ex) ex.qty += e.qty; else cards.set(k, { name, qty: e.qty });
  }
  const named = (lead || []).map(n => cards.get(norm(canonical(n)))).filter(Boolean).slice(0, 2);
  // Otherwise a binder named after its commander ("Deck – Queen Marchesa") tells us which card leads it.
  const bare = norm(loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, ""));
  const cmd = named.length ? named : [...cards.values()].filter(c => norm(c.name) === bare || norm(c.name).startsWith(bare + ",")).slice(0, 1);
  return { name: loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, "") || loc, cards: [...cards.values()], commanders: cmd.map(c => c.name) };
}
// Who could lead a deck location: the cards in it that can be a commander (or share command: partners, Backgrounds), each
// with how many of the box's other known cards fit its colours. Those that take in every colour in the box come first,
// then the best fits; a box with a few off-colour cards (a sideboard) still gets its likeliest leaders at the top.
// → [{name, colors, partner, commander, fits, of, covers}]. Nothing is picked for you: several often cover (five
// five-colour legends in a Dragons box), and a wrong commander is worse than none.
function deckLeaders(loc) {
  if (!COLL || !hasFlags()) return [];
  const seen = new Map();
  for (const e of COLL.entries) if (e.loc === loc) { const name = canonical(e.name), c = cardOf(name); if (c && !seen.has(norm(name))) seen.set(norm(name), c); }
  const cards = [...seen.values()], masks = cards.map(c => colorMask(c[1]));
  const all = masks.reduce((m, x) => m | x, 0);
  return cards.filter(c => c[7] & (FLAG_COMMANDER | FLAG_PARTNER)).map(c => {
    const m = colorMask(c[1]);
    return { name: c[0], colors: c[1], partner: !!(c[7] & FLAG_PARTNER), commander: !!(c[7] & FLAG_COMMANDER), fits: masks.filter(x => !(x & ~m)).length - 1, of: cards.length - 1, covers: !(all & ~m), rank: c[6] || 1e9 };
  }).sort((a, b) => (b.covers - a.covers) || (b.commander - a.commander) || (b.fits - a.fits) || (a.rank - b.rank) || a.name.localeCompare(b.name))
    .map(({ rank, ...x }) => x);
}
function deckCheck(b) {
  const items = [];
  const total = deckCards(b).reduce((n, c) => n + c.qty, 0);
  const ident = buildIdentity(b);
  items.push(total === 100 ? { ok: true, text: "100 cards" } : { ok: false, text: `${total} cards; a Commander deck has exactly 100` });
  if (!b.commanders.length) items.push({ ok: false, text: "No commander chosen. Tap ★ on a card to set it." });
  else if (hasFlags()) {
    const f = b.commanders.map(n => flagsOf(n));
    if (b.commanders.length > 2) items.push({ ok: false, text: "More than two commanders" });
    else if (b.commanders.length === 2) {
      const ok = f.every(x => x == null || (x & FLAG_PARTNER)) && f.some(x => x == null || (x & FLAG_COMMANDER));
      items.push(ok ? { ok: true, text: "Partner commanders" } : { ok: false, text: "These two can't share command (each needs Partner, Friends forever, a Background, or similar)" });
    } else {
      const ok = f[0] == null || (f[0] & FLAG_COMMANDER);
      items.push(ok ? { ok: true, text: `${b.commanders[0]} can be your commander` } : { ok: false, text: `${b.commanders[0]} can't be a commander` });
    }
  }
  const dupes = b.cards.filter(c => c.qty > 1 && !isBasic(c.name) && !((flagsOf(c.name) || 0) & FLAG_ANY_NUMBER)).map(c => c.name);
  items.push(dupes.length ? { ok: false, text: "More than one copy", list: dupes } : { ok: true, text: "One copy of each card" });
  if (ident) {
    const outside = b.cards.filter(c => { const card = DATA && cardOf(c.name); return card && [...card[1]].some(ch => ch !== "C" && !ident.has(ch)); }).map(c => c.name);
    items.push(outside.length ? { ok: false, text: "Outside your commander's colors", list: outside } : { ok: true, text: "Everything fits the commander's colors" });
  }
  if (hasFlags()) {
    const banned = b.cards.filter(c => (flagsOf(c.name) || 0) & FLAG_BANNED).map(c => c.name);
    const illegal = b.cards.filter(c => { const f = flagsOf(c.name); return f != null && !(f & FLAG_LEGAL) && !(f & FLAG_BANNED) && !isBasic(c.name); }).map(c => c.name);
    items.push(banned.length ? { ok: false, text: "Banned in Commander", list: banned } : { ok: true, text: "No banned cards" });
    if (illegal.length) items.push({ ok: false, text: "Not legal in Commander", list: illegal });
  }
  items.push(...companionChecks(b));
  const sq = sideQty(b);   // said, not judged: a sideboard isn't part of the 100, and Commander has no rule for one
  if (sq) items.push({ ok: true, text: `Sideboard: ${sq} card${sq === 1 ? "" : "s"}, kept with the deck and outside the 100` });
  const unknown = DATA ? b.cards.filter(c => !cardOf(c.name) && !isBasic(c.name)).map(c => c.name) : [];
  if (unknown.length) items.push({ ok: null, text: "Not recognized, so not checked", list: unknown });
  return items;
}
// Cards you kept in a build (b.keep): tuning and regenerating never take them out. Cards you add or
// swap in by hand are kept automatically; the commander and companion always stay.
const isKept = (b, name) => (b.keep || []).some(n => norm(n) === norm(name));
// A name as the card table writes it. A split card written with one slash, as MTGO and Moxfield's default text do
// ("Wear/Tear"), is found by its front face; only when the name as written isn't a card, so one whose own name
// holds slashes (SP//dr) is found first.
const canonical = name => {
  if (!DATA) return name;
  const s = String(name), c = cardOf(s) || (s.includes("/") ? cardOf(s.split("/")[0]) : null);
  return c ? c[0] : name;
};
const isCmd = (b, name) => b.commanders.some(n => norm(n) === norm(name));

function buildIdentity(b) {
  const set = new Set();
  for (const n of b.commanders) { const c = DATA && cardOf(n); if (c) for (const ch of c[1]) if (ch !== "C") set.add(ch); }
  return b.commanders.length ? set : null;
}
function primaryRole(name) {
  let best = null, w = -1;
  for (const r of roleList(roleBits(name))) if (ROLE_COUNTED.includes(r) && (ROLE_WEIGHT[r] ?? 5) > w) { best = r; w = ROLE_WEIGHT[r] ?? 5; }
  return best;
}

// ------------------------------------------------------------ build history
// Every change to a build's cards, commander, companion or sideboard is kept as a diff in b.history (newest last):
// { at, why?, add: [[name, qty]], cut: [[name, qty]], cmd?: [before[], after[]], comp?: [before, after],
//   sadd?: [[name, qty]], scut?: [[name, qty]] } (sadd/scut: into and out of the sideboard, 0.57.0; a card moved from
// the deck to the sideboard is in cut and in sadd). A diff can be undone (applyChange with undo = true), so going back
// to any point replays the undos.
const HISTORY_MAX = 30, HISTORY_MERGE_MS = 10 * 60 * 1000;
function buildState(b) {
  const cards = {};
  for (const c of b.cards || []) cards[c.name] = (cards[c.name] || 0) + (c.qty || 1);
  const side = {};
  for (const c of sideOf(b)) side[c.name] = (side[c.name] || 0) + (c.qty || 1);
  return { cards, cmd: [...(b.commanders || [])], comp: b.companion || null, side };
}
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function stateDiff(a, b) {
  const gained = (from, to) => { const l = []; for (const [n, q] of Object.entries(to || {})) { const d = q - ((from || {})[n] || 0); if (d > 0) l.push([n, d]); } return l; };
  const add = gained(a.cards, b.cards), cut = gained(b.cards, a.cards), sadd = gained(a.side, b.side), scut = gained(b.side, a.side);
  const out = { add, cut };
  if (!sameList(a.cmd, b.cmd)) out.cmd = [a.cmd, b.cmd];
  if ((a.comp || null) !== (b.comp || null)) out.comp = [a.comp || null, b.comp || null];
  if (sadd.length) out.sadd = sadd;
  if (scut.length) out.scut = scut;
  return add.length || cut.length || out.cmd || out.comp || out.sadd || out.scut ? out : null;
}
function applyChange(state, d, undo = false) {
  const moved = (was, plus, minus) => {
    const m = { ...(was || {}) };
    for (const [n, q] of plus || []) m[n] = (m[n] || 0) + q;
    for (const [n, q] of minus || []) { const left = (m[n] || 0) - q; if (left > 0) m[n] = left; else delete m[n]; }
    return m;
  };
  return { cards: undo ? moved(state.cards, d.cut, d.add) : moved(state.cards, d.add, d.cut),
    cmd: d.cmd ? [...d.cmd[undo ? 0 : 1]] : [...state.cmd], comp: d.comp ? d.comp[undo ? 0 : 1] : state.comp,
    side: undo ? moved(state.side, d.scut, d.sadd) : moved(state.side, d.sadd, d.scut) };
}
// Record a change from `before` to b's current state. An unlabelled change soon after another unlabelled
// one is merged into it, and an unlabelled change that exactly reverses the latest one (an Undo) removes
// that entry. A labelled one ("Went back to…") is always kept, so it can be undone in turn.
function recordChange(b, before, why, now = Date.now()) {
  const after = buildState(b), d = stateDiff(before, after);
  if (!d) return false;
  const h = b.history || (b.history = []), last = h[h.length - 1];
  if (last && now - last.at < HISTORY_MERGE_MS) {
    const beforeLast = applyChange(before, last, true), net = stateDiff(beforeLast, after);
    if (!net && !why) { h.pop(); return true; }               // undone (an Undo is unlabelled; going back isn't)
    if (!why && !last.why) { h[h.length - 1] = { at: now, ...net }; return true; }
  }
  h.push({ at: now, ...(why ? { why } : {}), ...d });
  if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  return true;
}
// The state just before history entry j: the current state with entries j..last undone.
function stateBefore(b, j) {
  let s = buildState(b);
  for (let i = (b.history || []).length - 1; i >= j; i--) s = applyChange(s, b.history[i], true);
  return s;
}
// Put a state back on a build, keeping the order of cards that stay.
function restoreState(b, s) {
  const left = { ...s.cards }, cards = [];
  for (const c of b.cards) if (left[c.name]) { cards.push({ ...c, qty: left[c.name] }); delete left[c.name]; }
  for (const [name, qty] of Object.entries(left)) cards.push({ name, qty });
  b.cards = cards; b.commanders = [...s.cmd]; b.companion = s.comp || null;
  const sleft = { ...(s.side || {}) }, side = [];
  for (const c of sideOf(b)) if (sleft[c.name]) { side.push({ ...c, qty: sleft[c.name] }); delete sleft[c.name]; }
  for (const [name, qty] of Object.entries(sleft)) side.push({ name, qty });
  if (side.length) b.side = side; else delete b.side;
}
// A short description for an entry without a label.
function changeLabel(d) {
  if (d.why) return d.why;
  const names = l => l.map(([n, q]) => q > 1 ? `${q} ${n}` : n);
  const sadd = d.sadd || [], scut = d.scut || [];
  if (sadd.length || scut.length) {
    const same = (x, y) => x.length === y.length && x.every(([n, q]) => y.some(([m, r]) => m === n && r === q));
    const few = (l, one, many) => l.length <= 2 ? one(names(l).join(" and ")) : many(l.reduce((n, x) => n + x[1], 0));
    if (!scut.length && !d.add.length && same(d.cut, sadd)) return few(sadd, x => `Moved ${x} to the sideboard`, n => `Moved ${n} cards to the sideboard`);
    if (!sadd.length && !d.cut.length && same(d.add, scut)) return few(scut, x => `Moved ${x} to the deck`, n => `Moved ${n} cards from the sideboard to the deck`);
    if (!d.add.length && !d.cut.length && !scut.length) return few(sadd, x => `Added ${x} to the sideboard`, n => `Added ${n} cards to the sideboard`);
    if (!d.add.length && !d.cut.length && !sadd.length) return few(scut, x => `Removed ${x} from the sideboard`, n => `Removed ${n} cards from the sideboard`);
    return `Changed ${d.add.length + d.cut.length} cards and the sideboard`;
  }
  if (d.add.length === 1 && d.cut.length === 1 && d.add[0][1] === 1 && d.cut[0][1] === 1) return `Swapped ${d.cut[0][0]} for ${d.add[0][0]}`;
  if (d.add.length && !d.cut.length) return d.add.length <= 2 ? `Added ${names(d.add).join(" and ")}` : `Added ${d.add.reduce((n, x) => n + x[1], 0)} cards`;
  if (d.cut.length && !d.add.length) return d.cut.length <= 2 ? `Removed ${names(d.cut).join(" and ")}` : `Removed ${d.cut.reduce((n, x) => n + x[1], 0)} cards`;
  if (d.add.length || d.cut.length) return `Changed ${d.add.length + d.cut.length} cards`;
  if (d.cmd) return d.cmd[1].length ? `Commander: ${d.cmd[1].join(" and ")}` : "Unset the commander";
  return d.comp && d.comp[1] ? `Companion: ${d.comp[1]}` : "Unset the companion";
}

// ------------------------------------------------------------ sample hand
// The library a game starts with: every card but the commanders and the companion, one entry per copy.
function libraryOf(b) {
  const out = [];
  for (const c of deckCards(b)) if (!isCmd(b, c.name)) for (let i = 0; i < (c.qty || 1); i++) out.push(c.name);
  return out;
}
function shuffled(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// A fresh hand: shuffle, draw seven. London mulligan: after the nth mulligan, n cards go to the bottom,
// except that Commander's first mulligan is free.
function dealHand(b, mulligans = 0, rnd = Math.random) {
  const lib = shuffled(libraryOf(b), rnd);
  return { lib: lib.slice(7), hand: lib.slice(0, 7), drawn: 0, mull: mulligans, toBottom: Math.max(0, mulligans - 1) };
}
const isLandCard = name => isBasic(name) || typeOf(name) === "L";
function handCounts(hand) { const lands = hand.filter(isLandCard).length; return { lands, spells: hand.length - lands }; }

// Keep rates (0.37.0): how often the opening seven is one you'd keep, as exact odds over every possible seven (lands,
// nonland ramp and the rest, drawn without replacement), so the numbers are the same on every render. A friend's
// workflow (Nov 7) asked for "2+ lands and ramp". The first mulligan is free in Commander, so a second seven counts too.
const KEEP_HAND = 7;
const isRampCard = name => !isLandCard(name) && roleList(roleBits(name)).includes("Ramp");
const KEEP_TESTS = [
  { id: "lands", label: "2 to 4 lands", good: true, ok: l => l >= 2 && l <= 4 },
  { id: "ramp", label: "2+ lands and a ramp card", good: true, ok: (l, r) => l >= 2 && r >= 1 },
  { id: "start", label: "3+ lands, or 2 and ramp", good: true, ok: (l, r) => l >= 3 || (l === 2 && r >= 1) },
  { id: "few", label: "0 or 1 land: mulligan", good: false, ok: l => l <= 1 },
  { id: "flood", label: "5+ lands: likely flood", good: false, ok: l => l >= 5 },
];
// → null under 8 cards, else {cards, lands, ramp, rates: [{id, label, good, p}], freeMull (2 to 4 lands within a free mulligan)}.
function keepRates(b) {
  const lib = libraryOf(b), N = lib.length;
  if (N <= KEEP_HAND) return null;
  let L = 0, R = 0;
  for (const n of lib) { if (isLandCard(n)) L++; else if (isRampCard(n)) R++; }
  const O = N - L - R, tot = lnChoose(N, KEEP_HAND);
  const odds = ok => {
    let p = 0;
    for (let l = 0; l <= KEEP_HAND; l++) for (let r = 0; l + r <= KEEP_HAND; r++)
      if (ok(l, r)) p += Math.exp(lnChoose(L, l) + lnChoose(R, r) + lnChoose(O, KEEP_HAND - l - r) - tot);
    return Math.min(1, p);
  };
  const rates = KEEP_TESTS.map(t => ({ id: t.id, label: t.label, good: t.good, p: odds(t.ok) }));
  const lands = rates[0].p;
  return { cards: N, lands: L, ramp: R, rates, freeMull: 1 - (1 - lands) * (1 - lands) };
}

// ------------------------------------------------------------ formats (legal.json)
// Every format Scryfall knows is stored; the page shows this shortlist (Matt, Nov 7), the rest waits for an
// "advanced" search. Display names for formats outside it come with that search (some keys are new to us).
const FORMAT_SHORTLIST = ["commander", "paupercommander", "oathbreaker", "brawl", "pauper"];
const FORMAT_NAMES = { commander: "Commander", paupercommander: "Pauper Commander", oathbreaker: "Oathbreaker", brawl: "Brawl", pauper: "Pauper" };
let LEGAL = null;   // legal.json for the current card table: {version, formats, bit: {fmt: b}, legal, banned: {fmt: Set}, restricted, gameChangers: Set}
function setLegal(j) {
  if (!j || !DATA || j.version !== DATA.version || !Array.isArray(j.legal) || !Array.isArray(j.formats)) { LEGAL = null; return false; }
  const sets = o => Object.fromEntries(Object.entries(o || {}).map(([f, ix]) => [f, new Set(ix)]));
  LEGAL = { version: j.version, updated: j.updated || null, formats: j.formats, bit: Object.fromEntries(j.formats.map((f, b) => [f, b])),
    legal: j.legal, banned: sets(j.banned), restricted: sets(j.restricted), gameChangers: new Set(j.gameChangers || []) };
  return true;
}
const legalReady = () => !!(LEGAL && DATA && LEGAL.version === DATA.version);
// Formats from the shortlist this data has.
const shownFormats = () => legalReady() ? FORMAT_SHORTLIST.filter(f => f in LEGAL.bit) : [];
// "legal" | "restricted" | "banned" | "not", or null when the card or format isn't in the data.
function formatStatus(name, fmt) {
  if (!legalReady() || !(fmt in LEGAL.bit)) return null;
  const i = LOOKUP.get(norm(name)); if (i == null) return null;
  if (LEGAL.banned[fmt] && LEGAL.banned[fmt].has(i)) return "banned";
  if (LEGAL.restricted[fmt] && LEGAL.restricted[fmt].has(i)) return "restricted";
  return (LEGAL.legal[i] >>> LEGAL.bit[fmt]) & 1 ? "legal" : "not";
}
// The shortlist grouped by status, for the card details: {legal: [fmt…], restricted, banned, not}.
function legalityOf(name) {
  const out = { legal: [], restricted: [], banned: [], not: [] };
  for (const f of shownFormats()) { const s = formatStatus(name, f); if (s) out[s].push(f); }
  return out;
}
// The collection filter. "legal": legal (or restricted) in every format ticked, so ticking more narrows the list;
// "banned": banned in any of them. A card the data doesn't know never matches.
function matchesFormats(name, mode, fmts) {
  if (!fmts || !fmts.length) return true;
  const st = fmts.map(f => formatStatus(name, f));
  if (st.some(s => s == null)) return mode === "banned" ? st.includes("banned") : false;
  return mode === "banned" ? st.includes("banned") : st.every(s => s === "legal" || s === "restricted");
}

// ------------------------------------------------------------ tokens and markers (tokens.json; data formats 13 and 14)
// Matt, Nov 11: "Deck views should show which tokens the cards in the deck can create… We can skip images for the
// tokens, we only need to list the tokens' card details." Many tokens share a name (a dozen Soldiers), so a token is
// told apart by its details; its `id` (Scryfall's Oracle ID) is what lasts, its place in the table changes with every
// build. Markers (Matt's word) are what a deck wants on the table that is neither a card nor a token: the Monarch, a
// dungeon, the Ring, an emblem. Both come from Scryfall's own links, never from a card's rules text.
let TOKENS = null;   // {version, tokens: [token…], of: Map(card index → [token index…]), unlisted: Set(card index), markers: [token…], markersOf: Map}
const TOKEN_COLORS = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };
// A row of tokens.json ([id, colours, faces, otherIds?]) as the page uses it. `type` is the type line as a person reads
// it ("Creature — Soldier": every token's line starts with the word Token; a marker's "Card" says nothing and is dropped).
function tokenRow(r, i, marker) {
  const faces = (r[2] || []).map(f => ({ name: f[0] || "", cost: f[1] || "", type: f[2] || "", text: f[3] || "", pt: f[4] || "" }));
  const f = faces[0] || { name: "", type: "", text: "", pt: "" };
  const type = marker ? (f.type === "Card" ? "" : f.type) : f.type.replace(/^Token\s*/, "");
  return { i, id: r[0], ids: [r[0], ...(r[3] || [])], colors: r[1] || "C", faces, name: f.name, pt: f.pt, type, marker: !!marker,
    copy: !marker && !type };   // the Copy token has no card type: it stands for a copy of something else
}
function setTokens(j) {
  if (!j || !DATA || j.version !== DATA.version || !Array.isArray(j.tokens)) { TOKENS = null; return false; }
  const links = o => new Map(Object.entries(o || {}).map(([k, v]) => [+k, v]));
  TOKENS = { version: j.version, tokens: j.tokens.map((r, i) => tokenRow(r, i, false)), of: links(j.of), unlisted: new Set(j.unlisted || []),
    markers: (j.markers || []).map((r, i) => tokenRow(r, i, true)), markersOf: links(j.markersOf) };
  return true;
}
const tokensReady = () => !!(TOKENS && DATA && TOKENS.version === DATA.version);
// "white", "white and red", "colorless": a token's colours as its card would say them.
function tokenColors(t) {
  const w = [...(t.colors || "")].map(c => TOKEN_COLORS[c]).filter(Boolean);
  return w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : w[0] || "colorless";
}
// The table is in order by name; Copy goes last (Matt, Nov 11: "Doesn't hurt to include": one line, at the end).
const tokenOrder = (a, b) => (a.copy - b.copy) || a.i - b.i;
// What one card makes and uses: {tokens, markers, unlisted}. `unlisted` = its text makes tokens Scryfall lists none
// for (a copy of something, an old card whose token was never printed). null until tokens.json is here.
function cardTokens(name) {
  if (!tokensReady()) return null;
  const i = LOOKUP.get(norm(name));
  if (i == null) return { tokens: [], markers: [], unlisted: false };
  return { tokens: (TOKENS.of.get(i) || []).map(t => TOKENS.tokens[t]).filter(Boolean).sort(tokenOrder),
    markers: (TOKENS.markersOf.get(i) || []).map(t => TOKENS.markers[t]).filter(Boolean).sort(tokenOrder), unlisted: TOKENS.unlisted.has(i) };
}
// What a deck makes and uses, one line per token whatever number it makes (Matt: "just one line for each the deck makes
// with no quantity tracked at that level"): {tokens: [{token, by, side}], markers: [the same], unlisted: [card names]}.
// `by` = the deck's cards that make it, `side` = cards that are only in the sideboard (they are in the box too: a
// token only they make has an empty `by`). `cards` and `side` are lists of {name} or names. null until the file is here.
function deckTokens(cards, side = []) {
  if (!tokensReady()) return null;
  const tok = new Map(), mk = new Map(), unlisted = [], seen = new Set();
  const take = (list, where) => {
    for (const c of list || []) {
      const name = typeof c === "string" ? c : c.name, k = norm(name);
      if (seen.has(k)) continue;
      seen.add(k);
      const i = LOOKUP.get(k); if (i == null) continue;
      for (const [links, rows, into] of [[TOKENS.of, TOKENS.tokens, tok], [TOKENS.markersOf, TOKENS.markers, mk]]) {
        for (const t of links.get(i) || []) {
          if (!rows[t]) continue;
          if (!into.has(t)) into.set(t, { token: rows[t], by: [], side: [] });
          into.get(t)[where].push(name);
        }
      }
      if (TOKENS.unlisted.has(i)) unlisted.push(name);
    }
  };
  take(cards, "by"); take(side, "side");
  const rows = m => [...m.values()].sort((a, b) => tokenOrder(a.token, b.token)).map(r => ({ token: r.token, by: r.by.sort((a, b) => a.localeCompare(b)), side: r.side.sort((a, b) => a.localeCompare(b)) }));
  return { tokens: rows(tok), markers: rows(mk), unlisted: unlisted.sort((a, b) => a.localeCompare(b)) };
}

// ------------------------------------------------------------ the tokens a person owns (0.61.0)
// Matt, Nov 11: tracking is a switch, off to start ("many players just use whiteboard cards"); the import knows nothing
// of tokens, so these are kept apart from the collection's entries and an import never touches them. Each is recorded
// where it is kept (a location's name as the import has it; "" = not in a box), with a count, under the token's ID
// and with its name, size, colours and type beside it, so it can be shown and found again if the data loses that ID.
// A token taken away stays as a record with n 0 and its time, so another device learns it went. Markers aren't
// tracked (Matt: "markers don't need tracking in the collection for now").
let TOKOWN = { on: false, at: 0, own: {} };   // own: {loc: {token id: {n, at, name, pt, colors, type}}}
const TOKOWN_MAX = 999;
const tokenSig = t => [t.name, t.pt || "", t.colors || "C", t.type || ""].join("|").toLowerCase();
function tokOwnRec(r) {
  return { n: Math.max(0, Math.min(TOKOWN_MAX, Math.floor(+r.n) || 0)), at: +r.at || 0, name: String(r.name || ""), pt: String(r.pt || ""), colors: String(r.colors || "C"), type: String(r.type || "") };
}
function setTokOwn(j) {
  const own = {};
  for (const [loc, m] of Object.entries((j && typeof j.own === "object" && j.own) || {})) {
    if (loc === "__proto__" || !m || typeof m !== "object") continue;
    for (const [id, r] of Object.entries(m)) if (id !== "__proto__" && r && typeof r === "object") (own[loc] = own[loc] || {})[id] = tokOwnRec(r);
  }
  TOKOWN = { on: !!(j && j.on), at: +(j && j.at) || 0, own };
}
// Another device's copy: the switch and each record go to whichever was changed later. Returns how many things changed.
function tokOwnMerge(j) {
  if (!j || typeof j !== "object") return 0;
  const mine = TOKOWN, theirs = (setTokOwn(j), TOKOWN);
  TOKOWN = mine;
  let n = 0;
  if (theirs.at > mine.at) { if (mine.on !== theirs.on) n++; mine.on = theirs.on; mine.at = theirs.at; }
  for (const [loc, m] of Object.entries(theirs.own)) for (const [id, r] of Object.entries(m)) {
    const l = (mine.own[loc] || {})[id];
    if (!l || r.at > l.at) { (mine.own[loc] = mine.own[loc] || {})[id] = r; if (!l || l.n !== r.n) n++; }
  }
  return n;
}
// Today's token for a record: by its ID (or one of the IDs Scryfall has had it under), else by its details.
function tokenOf(id, rec) {
  if (!tokensReady()) return null;
  if (!TOKENS.byId) {
    TOKENS.byId = new Map(); TOKENS.bySig = new Map();
    for (const t of TOKENS.tokens) { for (const x of t.ids) if (!TOKENS.byId.has(x)) TOKENS.byId.set(x, t); if (!TOKENS.bySig.has(tokenSig(t))) TOKENS.bySig.set(tokenSig(t), t); }
  }
  return TOKENS.byId.get(id) || (rec && rec.name && TOKENS.bySig.get(tokenSig(rec))) || null;
}
// Where a person has a token: [{loc, n}] for every location holding one, in order by location.
function tokenHave(t) {
  const out = [];
  for (const [loc, m] of Object.entries(TOKOWN.own)) {
    let n = 0;
    for (const [id, r] of Object.entries(m)) if (r.n > 0 && tokenOf(id, r) === t) n += r.n;
    if (n) out.push({ loc, n });
  }
  return out.sort((a, b) => a.loc.localeCompare(b.loc));
}
// What one location holds: [{id, n, token, rec}], today's tokens in the table's order, then the ones today's data
// doesn't know (token null), by their kept names.
function tokensIn(loc) {
  const rows = Object.entries(TOKOWN.own[loc] || {}).filter(([, r]) => r.n > 0).map(([id, r]) => ({ id, n: r.n, token: tokenOf(id, r), rec: r }));
  return rows.sort((a, b) => !a.token - !b.token || (a.token && b.token ? tokenOrder(a.token, b.token) : a.rec.name.localeCompare(b.rec.name)) || a.id.localeCompare(b.id));
}
const tokensOwnedCount = () => Object.values(TOKOWN.own).reduce((s, m) => s + Object.values(m).reduce((x, r) => x + r.n, 0), 0);
// Record that a location holds n of a token (0 = none). One record per token: a count kept under another of its IDs
// is folded into this one. `t` is a token, or {id, rec} for one today's data doesn't know.
function tokenSet(loc, t, n, at = Date.now()) {
  const m = TOKOWN.own[loc] = TOKOWN.own[loc] || {};
  n = Math.max(0, Math.min(TOKOWN_MAX, Math.floor(+n) || 0));
  if (t.rec) { m[t.id] = { ...t.rec, n, at }; return n; }
  for (const [id, r] of Object.entries(m)) if (id !== t.id && r.n > 0 && tokenOf(id, r) === t) { r.n = 0; r.at = at; }
  m[t.id] = { n, at, name: t.name, pt: t.pt, colors: t.colors, type: t.type };
  return n;
}
// A deck's tokens with where the person has each: deckTokens' rows gain `have` ([{loc, n}]); `missing` counts the rest.
function deckTokensOwned(d) {
  const rows = d.tokens.map(r => ({ ...r, have: tokenHave(r.token) }));
  return { rows, missing: rows.filter(r => !r.have.length).length };
}
// Marking a deck built (0.64.0; agreed with Matt, Nov 11: by default "move the tokens recorded elsewhere that the deck
// makes, as cards move", never inventing one). For each token the deck or its sideboard makes that its box doesn't
// hold yet: the ones recorded "not in a box" all go (they were recorded for a build that had no box), else one comes
// from a box or binder that isn't a deck (a deck's list says which tokens, not how many, so the rest stay where they
// are); a token kept in another deck's box is left there. → [{token, from, n}]. `isDeck(loc)` is the page's.
function tokenMoves(cards, side, loc, isDeck) {
  const d = TOKOWN.on ? deckTokens(cards, side) : null, out = [];
  for (const r of d ? d.tokens : []) {
    const have = tokenHave(r.token);
    if (!have.length || have.some(h => h.loc === loc)) continue;
    const loose = have.find(h => h.loc === ""), from = loose || have.find(h => !isDeck(h.loc));
    if (from) out.push({ token: r.token, from: from.loc, n: loose ? loose.n : 1 });
  }
  return out;
}
// Make those moves. → what each count was before ([[loc, token, n]]), for tokenCountsSet to put back.
function tokenMovesApply(moves, loc, at = Date.now()) {
  const count = (l, t) => tokensIn(l).filter(r => r.token === t).reduce((s, r) => s + r.n, 0), was = [];
  for (const m of moves) {
    const a = count(m.from, m.token), b = count(loc, m.token);
    was.push([m.from, m.token, a], [loc, m.token, b]);
    tokenSet(m.from, m.token, a - m.n, at); tokenSet(loc, m.token, b + m.n, at);
  }
  return was;
}
function tokenCountsSet(list, at = Date.now()) { for (const [loc, t, n] of list) tokenSet(loc, t, n, at); }
// Tokens whose name has every word typed, for adding by hand: names that start with it first, then the table's order.
function tokenSearch(q, limit = 12) {
  if (!tokensReady()) return [];
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hay = t => norm([t.faces.map(f => f.name).join(" "), t.pt, tokenColors(t), t.type].join(" "));
  const hit = TOKENS.tokens.filter(t => { const h = hay(t); return words.every(w => h.includes(w)); });
  const first = t => norm(t.name).startsWith(words[0]) ? 0 : 1;
  return hit.sort((a, b) => first(a) - first(b) || tokenOrder(a, b)).slice(0, limit);
}

// ------------------------------------------------------------ token lines (0.62.0)
// A token in a list, as a person would write it (the format Matt agreed on Nov 11): `3 Soldier 1/1 white`, `2 Treasure`,
// `1 Zombie 2/2 black decayed`. Only the name is required; a size, colours and any word of its type or text narrow it
// down, in any order. Many tokens share a name, so a line is read against every token of that name and **never guessed**:
// it names a token when one fits, or when one of the fitting tokens is the plainest (everything the line leaves unsaid
// about it is also unsaid about each of the others, and its size and colours were said: "Zombie 2/2 black" is the Zombie
// with no text, not the decayed one). Otherwise the page shows the candidates.
const TOKEN_LINE_STOP = new Set(["and", "with", "token", "tokens", "creature", "//", "-", "—", "x"]);
const TOKEN_COLOR_WORDS = new Set(Object.values(TOKEN_COLORS));
const isTokenSize = w => /^[\d*x][\d*x+-]*\/[\d*x][\d*x+-]*$/.test(w);   // "1/1", "*/*", "1+*/1+*"; not the "+1/+1" of a token's text
// Words of a line or of a token's details: lower case, no accents, punctuation off the ends, "protection from red" kept
// as one word so the colour in it isn't read as the token's own.
function tokenWords(s) {
  const raw = String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase().replace(/colourless/g, "colorless")
    .split(/[\s,;]+/).map(w => w.replace(/^[^\w{*+'-]+|[^\w}*+'-]+$/g, "")).filter(Boolean);
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === "from" && TOKEN_COLOR_WORDS.has(raw[k + 1])) { out.push("from-" + raw[++k]); continue; }
    if (!TOKEN_LINE_STOP.has(raw[k])) out.push(raw[k]);
  }
  return out;
}
const tokenPlainText = t => t.faces.map(f => f.text).join("\n").replace(/\s*\([^()]*\)/g, "").trim();   // without reminder text
// What a token can be told by, worked out once: its name's words, everything a line may say of it, and what a line
// must say (or leave unsaid of every other candidate too) to mean it.
function tokenTells(t) {
  if (t.tells) return t.tells;
  const name = tokenWords(t.name), colors = t.colors === "C" || !t.colors ? [] : [...t.colors].map(c => TOKEN_COLORS[c]).filter(Boolean);
  const sizes = t.faces.map(f => f.pt.toLowerCase()).filter(isTokenSize), type = tokenWords(t.faces[0] ? t.faces[0].type : "").filter(w => !name.includes(w));
  const hay = new Set([...t.faces.flatMap(f => tokenWords(f.name)), ...t.faces.flatMap(f => tokenWords(f.type)), ...t.faces.flatMap(f => tokenWords(f.text)), ...t.faces.flatMap(f => tokenWords(f.pt)), ...colors, "colorless"]);
  if (colors.length) hay.delete("colorless");
  return t.tells = { name, colors, sizes, hay, key: [...tokenWords(t.pt), ...colors], more: [...type, ...tokenWords(tokenPlainText(t))].filter(w => !name.includes(w)) };
}
// One line (without its count) → {token} when it names one, {marker} when it names a marker (those aren't tracked),
// else {cands, why}: the tokens it could mean, for the person to pick from. `why` = "several" (they all fit the line),
// "nofit" (tokens have that name, none with those details) or "noname" (no token has that name: the nearest names, if any).
function tokenLineFind(text) {
  if (!tokensReady()) return { why: "noname", cands: [] };
  const words = tokenWords(text), has = new Set(words);
  if (!words.length) return { why: "noname", cands: [] };
  // Every token whose whole name is in the line, the longest names first ("Elf Warrior" before "Elf" and "Warrior"). A
  // colour can be part of a name too ("Blue Horror"), so when the tokens of the longest name don't fit the rest of the
  // line, the next names are tried: "Horror 1/1 blue and black" is a Horror.
  const named = rows => { const by = new Map();
    for (const t of rows) { const n = tokenTells(t).name; if (n.length && n.every(w => has.has(w))) by.set(n.length, [...(by.get(n.length) || []), t]); }
    return [...by.entries()].sort((a, b) => b[0] - a[0]).map(x => x[1]); };
  const groups = named(TOKENS.tokens);
  if (!groups.length) {
    const m = named(TOKENS.markers);
    if (m.length) return { marker: m[0][0], cands: [] };
    return { why: "noname", cands: TOKENS.tokens.filter(t => tokenTells(t).name.some(w => has.has(w))).sort(tokenOrder).slice(0, 12) };
  }
  // A size in the line is the token's own size, unless that was said too (a token's text can name another's: "create
  // two 1/1 green Ooze creature tokens"); a colour is one of the token's own colours.
  const fit = t => { const k = tokenTells(t), sized = words.some(w => k.sizes.includes(w));
    return words.every(w => isTokenSize(w) ? k.sizes.includes(w) || (sized && k.hay.has(w)) : TOKEN_COLOR_WORDS.has(w) && w !== "colorless" ? k.colors.includes(w) : k.hay.has(w)); };
  let fits = [];
  for (const g of groups) { fits = g.filter(fit); if (fits.length) break; }
  if (fits.length === 1) return { token: fits[0], cands: fits };
  if (!fits.length) return { why: "nofit", cands: groups[0].sort(tokenOrder) };
  const unsaid = fits.map(t => { const k = tokenTells(t); return { t, key: k.key.filter(w => !has.has(w)), rest: new Set([...k.key, ...k.more].filter(w => !has.has(w))) }; });
  const plain = unsaid.filter(a => !a.key.length && unsaid.every(b => b === a || (b.rest.size > a.rest.size && [...a.rest].every(w => b.rest.has(w)))));
  return plain.length === 1 ? { token: plain[0].t, cands: fits } : { why: "several", cands: fits.sort(tokenOrder) };
}
// A token as a line: its name, size and colours ("Treasure", "Soldier 1/1 white"), then only what is needed for the
// line to read back as this token and no other: its keywords ("Zombie 2/2 black decayed"), its type, or its text.
function tokenLine(t, n) {
  const k = tokenTells(t), base = [t.faces.map(f => f.name).join(" // "), t.pt, k.colors.length > 1 ? `${k.colors.slice(0, -1).join(", ")} and ${k.colors[k.colors.length - 1]}` : k.colors[0] || ""].filter(Boolean).join(" ");
  const text = ": " + tokenPlainText(t).replace(/\s*\n\s*/g, "; "), first = tokenPlainText(t).split("\n")[0], kw = first.length <= 40 && !/[.:]/.test(first) ? first.toLowerCase() : "";
  const type = (t.faces[0] ? t.faces[0].type : "").replace(/^Token\s*/, "").split(" — ")[0].toLowerCase().replace(/\s*creature\s*/, " ").trim();
  const sub = tokenWords(((t.faces[0] ? t.faces[0].type : "").split(" — ")[1]) || "").filter(w => !k.name.includes(w)).join(" ");
  let line = base;
  for (const extra of ["", " " + kw, " " + type, " " + [type, kw].filter(Boolean).join(" "), " " + sub, text, " " + [type, sub].filter(Boolean).join(" ") + text]) {
    line = (base + extra).replace(/\s+/g, " ").replace(/ :/, ":").trim();
    if (tokenLineFind(line).token === t) break;
  }
  return (n ? n + " " : "") + line;
}
// The token lines of a pasted text: [{qty, text}]. A text with a "Tokens" heading gives the lines under it (a whole
// decklist can be pasted into a box's tokens); one with no headings at all is a list of tokens. A line with no number
// counts once. Lines under "Markers" are left out: markers aren't tracked.
const TOKEN_LIST_HEADS = /^(commanders?|command zone|deck|main ?deck|main ?board|companions?|side ?board|maybe ?board|considering|markers?|creatures?|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|lands?|battles?|other)$/;
function tokenListLine(line) {
  const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  const text = (m ? m[2] : line).replace(/\s*\*[A-Za-z]+\*\s*/g, " ").replace(/\s+\[[^\]]*\]/g, "").replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, "").replace(/\s+\^[^^]*\^/g, "").trim();
  return text ? { qty: Math.max(1, Math.min(TOKOWN_MAX, m ? parseInt(m[1], 10) : 1)), text } : null;
}
function tokenListLines(text) {
  const loose = [], under = []; let section = "", seen = false;
  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    const h = line.replace(/:$/, "").replace(/\s*\(\d+\)$/, "").toLowerCase();
    if (/^tokens?$/.test(h)) { section = "tokens"; seen = true; continue; }
    if (TOKEN_LIST_HEADS.test(h)) { section = "other"; continue; }
    const row = tokenListLine(line);
    if (row && section !== "other") (section ? under : loose).push(row);
  }
  return seen ? under : loose;
}
// Lines read against the tokens: {sure: [[token, count]…] (a token named on two lines is counted once, with both
// counts), ask: [{qty, text, cands, why}] for the lines that fit several or none, markers: how many lines named a marker}.
function tokenLinesRead(lines) {
  const sure = new Map(), ask = []; let markers = 0;
  for (const l of lines || []) {
    const f = tokenLineFind(l.text);
    if (f.token) sure.set(f.token, Math.min(TOKOWN_MAX, (sure.get(f.token) || 0) + l.qty));
    else if (f.marker) markers++;
    else ask.push({ qty: l.qty, text: l.text, cands: f.cands, why: f.why });
  }
  return { sure: [...sure.entries()].sort((a, b) => tokenOrder(a[0], b[0])), ask, markers };
}
// A list of tokens as text, under its heading: `rows` = [[token, count]] (a count of 0 or none writes no number: a deck's
// list says which tokens, not how many). Markers follow under their own heading when given.
function tokenListText(rows, markers = []) {
  const out = rows.length ? ["Tokens", ...rows.map(([t, n]) => tokenLine(t, n))] : [];
  if (markers.length) out.push(...(out.length ? [""] : []), "Markers", ...markers.map(m => m.faces.map(f => f.name).join(" // ")));
  return out.join("\n");
}

// ------------------------------------------------------------ reading a decklist (in the engine since 0.87.1)
// Decklists from Moxfield, Archidekt, or plain "1 Card Name" lines → {cards, commanders, companion, side, tokens, out}.
// A "Sideboard" section (or Archidekt's [Sideboard] tag on a line) is the build's sideboard (0.57.0). A "Tokens"
// section (or a line tagged [Tokens]) comes back as `tokens`, [{qty, text}] as written (0.62.0): a build's tokens come
// from its cards, so the page records these as tokens the person owns, or leaves them out and says so
// (tokensFromList). Lines under "Markers" are left out.
// `out` (0.87.1) = [{name, qty}]: the cards left out, by the name their list has in the text, in the order met, for
// the page to say. They are a "Maybeboard" or "Considering" section or tag, and on an Archidekt line any category
// of the person's own that Archidekt marks {noDeck} (Matt's sample, Nov 13: "Wishlist" and "Spare Dragons" were read
// into the deck, making it 127 cards). Archidekt writes a card's categories as [First{noDeck}{noPrice},Second]: the
// first is the one that says whether the card is in the deck.
// Moxfield's default text names no commander: it ends with the commander by itself after a blank line, under the
// sideboard when there is one (the same sample: Queen Marchesa was read as a fourth sideboard card). So in a text
// that names no commander, a last block of one or two single cards that can each be a commander is the commander,
// and those cards are the deck's even under a "Sideboard" heading. A block is a run of lines with no blank one.
function parseDecklist(text) {
  const cards = [], commanders = [], side = [], tokens = [], out = []; let section = "main", companion = null, skipAs = "";
  let tail = null, blocks = 0, gap = true;   // tail: the card lines of the block being read, null once it holds anything else
  const leftOut = (label, qty) => { const o = out.find(x => x.name.toLowerCase() === label.toLowerCase()); if (o) o.qty += qty; else out.push({ name: label, qty }); };
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) { gap = true; continue; }
    if (line.startsWith("//") || line.startsWith("#")) continue;
    if (gap) { gap = false; blocks++; tail = []; }
    const head = line.replace(/:$/, "").replace(/\s*\(\d+\)$/, ""), h = head.toLowerCase();
    let to = null;
    if (/^(commanders?|command zone)$/.test(h)) to = "cmd";
    else if (/^(deck|main ?deck|main ?board|creatures?|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|lands?|battles?|other)$/.test(h)) to = "main";
    else if (/^companions?$/.test(h)) to = "comp";
    else if (/^side ?board$/.test(h)) to = "side";
    else if (/^(maybe ?board|considering|markers?)$/.test(h)) { to = "skip"; skipAs = /^markers?$/.test(h) ? "" : head.charAt(0).toUpperCase() + head.slice(1).toLowerCase(); }
    else if (/^tokens?$/.test(h)) to = "tok";
    if (to) { section = to; tail = null; continue; }
    let qty = 1;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (section === "skip") { if (skipAs) leftOut(skipAs, m ? parseInt(m[1], 10) : 1); tail = null; continue; }
    if (section === "tok" || /\[[^\]]*\btokens?\b[^\]]*\]/i.test(line)) { const row = tokenListLine(line); if (row) tokens.push(row); tail = null; continue; }
    if (m) { qty = parseInt(m[1], 10); line = m[2]; }
    const cmd = section === "cmd" || /\[commander[^\]]*\]|\*cmdr\*/i.test(line);
    const groups = line.match(/\[[^\]]*\]/g) || [], tags = groups.join(" ").toLowerCase();   // Archidekt: "1x Card (set) 12 [Sideboard{noDeck}{noPrice},Artifact]"
    const cats = groups.flatMap(g => g.slice(1, -1).split(",")), first = cats[0] || "", named = c => c.replace(/\{[^}]*\}/g, "").trim();
    const toSide = section === "side" || /side ?board/.test(tags);
    const maybe = cats.find(c => /maybe ?board|considering/i.test(c));
    if (maybe || (/\{nodeck\}/i.test(first) && !toSide)) { leftOut(named(maybe || first) || "Other lists", qty); tail = null; continue; }
    line = line.replace(/\s*\*[A-Za-z]+\*\s*/g, " ").replace(/\s+\[[^\]]*\]/g, "")
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, "").replace(/\s+\^[^^]*\^/g, "").trim();
    if (!line) continue;
    const name = canonical(line), into = toSide ? side : cards;
    const ex = into.find(c => norm(c.name) === norm(name));
    if (ex) ex.qty += qty; else into.push({ name, qty });
    if (tail) tail.push({ name, qty, toSide, plain: !cmd && section !== "comp" });
    if (toSide) continue;
    if (cmd && !commanders.some(n => norm(n) === norm(name))) commanders.push(name);
    if (section === "comp" && !companion) companion = name;
  }
  if (!commanders.length && blocks > 1 && tail && tail.length && tail.length <= 2 && tail.every(c => c.plain && c.qty === 1 && (flagsOf(c.name) & 4))) {
    for (const c of tail) {
      if (c.toSide) {
        const j = side.findIndex(x => norm(x.name) === norm(c.name));
        if (j >= 0 && --side[j].qty < 1) side.splice(j, 1);
        const ex = cards.find(x => norm(x.name) === norm(c.name));
        if (ex) ex.qty += 1; else cards.push({ name: c.name, qty: 1 });
      }
      if (!commanders.some(n => norm(n) === norm(c.name))) commanders.push(c.name);
    }
  }
  return { cards, commanders, companion, side, tokens, out };
}
// What a decklist left out, for a message: "Left out: Spare Dragons 12, Wishlist 15" ("" when nothing was).
const leftOutWords = out => (out && out.length ? `Left out: ${out.map(o => `${o.name} ${o.qty}`).join(", ")}` : "");

// ------------------------------------------------------------ bracket estimate
// Wizards' Commander brackets (still a beta; criteria checked Nov 8 2026): 1 Exhibition, 2 Core, 3 Upgraded,
// 4 Optimized, 5 cEDH. Bracket 3 allows up to three Game Changers and no mass land denial or chained extra turns;
// bracket 2 allows no Game Changers and extra turns only in small doses; bracket 4 has no limits. The estimate
// reads what can be counted: Game Changers (Scryfall's list, in legal.json), combos the deck holds (Commander
// Spellbook tags each with the brackets it suits), and mass land denial and extra turns (fetcher facts). It starts
// at 2, since brackets 1 and 5 are about intent, and each signal can only raise it. Matt (Nov 8): include it,
// with a note that it's a beta and not a perfect measure of how a deck plays. b.bracket is the person's own call.
const FLAG_MASS_LAND_DENIAL = 131072, FLAG_EXTRA_TURN = 262144;
const hasBracketFacts = () => !!(DATA && Array.isArray(DATA.facts) && DATA.facts.includes("brackets"));
const BRACKET_NAMES = ["", "Exhibition", "Core", "Upgraded", "Optimized", "cEDH"];
const BRACKET_GC_MAX = 3;      // Game Changers bracket 3 allows
const BRACKET_FEW_TURNS = 2;   // extra-turn cards that still read as "small doses"
// Commander Spellbook's syntax guide: Exhibition 1, Core and Oddball 2, Powerful and Spicy 3, Ruthless 4 (Banned: none).
const COMBO_TAG_BRACKET = { E: 1, C: 2, O: 2, P: 3, S: 3, R: 4 };
// → {bracket, set (the person's own, or null), shown, signals: [{kind, bracket, list, tag?}], unknown: [kinds not checked]}.
// Kinds: "gc" (Game Changers), "combo" (one per Spellbook tag, list = combos as card-name lists), "mld", "turns".
function bracketEstimate(b) {
  const signals = [], unknown = [];
  let bracket = 2;
  const add = s => { signals.push(s); if (s.bracket > bracket) bracket = s.bracket; };
  const have = new Map();   // card index → name; the commander and a companion count too
  for (const c of b.cards) { const i = LOOKUP.get(norm(c.name)); if (i != null) have.set(i, DATA.cards[i][0]); }
  if (legalReady()) {
    const gc = [...have].filter(([i]) => LEGAL.gameChangers.has(i)).map(([, n]) => n).sort();
    if (gc.length) add({ kind: "gc", bracket: gc.length > BRACKET_GC_MAX ? 4 : 3, list: gc });
  } else unknown.push("gc");
  if (COMBOS && COMBOS.combos) {
    const byTag = new Map();
    for (const cb of COMBOS.combos) {
      const tag = cb[6];
      if (!(tag in COMBO_TAG_BRACKET) || !cb[1].every(i => have.has(i))) continue;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(cb[1].map(i => have.get(i)));
    }
    for (const [tag, list] of byTag) add({ kind: "combo", tag, bracket: COMBO_TAG_BRACKET[tag], list });
  } else unknown.push("combo");
  if (hasBracketFacts()) {
    const named = bit => [...have.values()].filter(n => (flagsOf(n) || 0) & bit).sort();
    const mld = named(FLAG_MASS_LAND_DENIAL), turns = named(FLAG_EXTRA_TURN);
    if (mld.length) add({ kind: "mld", bracket: 4, list: mld });
    if (turns.length) add({ kind: "turns", bracket: turns.length > BRACKET_FEW_TURNS ? 3 : 2, list: turns });
  } else unknown.push("mld", "turns");
  signals.sort((x, y) => y.bracket - x.bracket);
  const set = Number.isInteger(b.bracket) && b.bracket >= 1 && b.bracket <= 5 ? b.bracket : null;
  return { bracket, set, shown: set || bracket, signals, unknown };
}

// ------------------------------------------------------------ printings and prices (0.68.0; data format 15)
// Which price goes where (Matt, Nov 12): a copy you own is priced by its own printing in its finish, a card you don't
// own by its cheapest printing. The card table's price (row[3]) is the cheapest printing in the currency in use: the
// page writes it from prices.json (`low`, `lowEur`) and names the currency with setCurrency. printings.json says where
// each printing sits in the price tables (its place: the sets as listed, each set's numbers as listed), and one
// print-prices file (dollars: TCGplayer's market price; euros: Cardmarket's; both by way of Scryfall) holds every
// printing's price by finish, in cents. All are Near Mint prices: nothing prices a condition or a language.
let CURRENCY = "usd";       // the currency the card table's prices and PRINT_PRICE are in ("usd" | "eur")
let PRINTS = null;          // printings.json as read: {version, count, sets: Map(code → {code, name, released, type, start, cns, rar, at})}
let PRINT_PRICE = null;     // one print-prices file: {version, updated, currency, usd, foil, etched}
function setCurrency(c) {
  const to = c === "eur" ? "eur" : "usd";
  if (to !== CURRENCY) { CURRENCY = to; if (PRINT_PRICE && PRINT_PRICE.currency !== to) PRINT_PRICE = null; CHANGE++; }
  return CURRENCY;
}
function setPrintings(j) {
  PRINTS = null; CHANGE++;
  if (!j || !Array.isArray(j.sets) || !DATA || j.version !== DATA.version) return false;
  const sets = new Map(); let start = 0;
  for (const r of j.sets) {
    const cns = r[4] ? String(r[4]).split(" ") : [];
    sets.set(String(r[0]), { code: String(r[0]), name: r[1] || String(r[0]).toUpperCase(), released: r[2] || "", type: r[3] || "", start, cns, rar: r[5] || "", at: null });
    start += cns.length;
  }
  PRINTS = { version: j.version, count: start, sets };
  if (PRINT_PRICE && PRINT_PRICE.version !== j.version) PRINT_PRICE = null;
  return true;
}
// A print-prices file is taken only when it lines up with the printings and is in the currency in use; a file that
// isn't leaves the prices already here alone (a refresh that brought nothing usable).
function setPrintPrices(j) {
  if (!j || !PRINTS || j.version !== PRINTS.version || !Array.isArray(j.usd) || !Array.isArray(j.foil) || j.usd.length !== PRINTS.count || (j.currency || "usd") !== CURRENCY) return false;
  PRINT_PRICE = { version: j.version, updated: j.updated || null, currency: j.currency || "usd", usd: j.usd, foil: j.foil, etched: j.etched || {} };
  CHANGE++;
  return true;
}
const printingsReady = () => !!PRINTS;
const printPricesReady = () => !!(PRINTS && PRINT_PRICE);
const setOf = code => (PRINTS && code ? PRINTS.sets.get(String(code).toLowerCase()) : null) || null;
const setName = code => { const s = setOf(code); return s ? s.name : String(code || "").toUpperCase(); };
// A printing by set code and collector number (what every import that names printings gives) → {place, set, cn, rar}.
function printOf(set, cn) {
  const s = setOf(set); if (!s || cn == null || cn === "") return null;
  if (!s.at) { s.at = new Map(); s.cns.forEach((n, i) => s.at.set(n, i)); }
  const key = String(cn);
  let i = s.at.get(key);
  if (i == null) i = s.at.get(key.toLowerCase());
  if (i == null) i = s.at.get(key.replace(/^0+(?=\d)/, ""));
  return i == null ? null : { place: s.start + i, set: s, cn: s.cns[i], rar: s.rar[i] || "" };
}
const tablePrice = name => { const c = DATA && cardOf(name); return c ? c[3] || 0 : 0; };
// One copy of a collection entry, in the currency in use → {price, own}. `own`: it is its own printing's price, in
// its finish, or in the printing's other finish when Scryfall has none for that one (a foil with no foil price).
// A copy whose import names no printing, or one today's data doesn't know or has no price for, is priced as the
// card's cheapest printing.
function copyPriceOf(e) {
  const p = PRINT_PRICE && e.set && e.cn ? printOf(e.set, e.cn) : null;
  if (p) {
    const i = p.place, reg = PRINT_PRICE.usd[i] || 0, foil = PRINT_PRICE.foil[i] || 0, etched = PRINT_PRICE.etched[i] || 0;
    const cents = e.foil === "etched" ? etched || foil || reg : e.foil === "foil" ? foil || reg || etched : reg || foil || etched;
    if (cents) return { price: cents / 100, own: true };
  }
  return { price: tablePrice(e.name), own: false };
}
const copyPrice = e => copyPriceOf(e).price;
// Your copies of each card with their prices, worked out once per change (collection, prices, currency).
let OWN = { at: -1, entries: null, by: new Map() };
function ownCopies(name) {
  const entries = COLL ? COLL.entries : null;
  if (OWN.at !== CHANGE || OWN.entries !== entries) {
    const by = new Map();
    for (const e of entries || []) {
      if (!(e.qty > 0)) continue;
      const k = norm(e.name); let a = by.get(k);
      if (!a) by.set(k, a = []);
      a.push({ e, ...copyPriceOf(e) });
    }
    OWN = { at: CHANGE, entries, by };
  }
  return OWN.by.get(norm(name)) || [];
}
// What your copies of a card are worth, all of them or those in one location → {qty, sum, lo, hi}: `lo` and `hi` are
// the cheapest and dearest copy that has a price (0 when none has).
function ownValue(name, loc = null) {
  let qty = 0, sum = 0, lo = 0, hi = 0;
  for (const c of ownCopies(name)) {
    if (loc != null && c.e.loc !== loc) continue;
    qty += c.e.qty; sum += c.price * c.e.qty;
    if (c.price > 0) { lo = lo ? Math.min(lo, c.price) : c.price; hi = Math.max(hi, c.price); }
  }
  return { qty, sum, lo, hi };
}
// The price to show beside a card: your own copies' when you have it (in `loc`, when the screen is one location),
// else the cheapest printing's → {lo, hi, own}.
function shownPrice(name, loc = null) {
  const v = ownValue(name, loc);
  if (v.qty && v.hi) return { lo: v.lo, hi: v.hi, own: true };
  const p = tablePrice(name);
  return { lo: p, hi: p, own: false };
}
// What an entry says of its copy, with what the printings add: the set's name, and the rarity when the import gave none.
function copyPrint(e) {
  const p = e.set && e.cn ? printOf(e.set, e.cn) : null;
  return { set: e.set || "", setName: e.set ? setName(e.set) : "", cn: e.cn || "", foil: e.foil || "", rar: e.rar || (p ? p.rar : ""), cond: e.cond || "", lang: e.lang || "", known: !!p };
}

// ------------------------------------------------------------ a list with your own printings (0.78.0)
// For ManaBox (Matt, Nov 12: the loop "Copy decklist → ManaBox imports a deck from text → Build from collection"):
// a card of a list as the copies the build takes, each with its set code, collector number and finish, so the other
// app picks the same copies. Which copies: the ones in the build's own box (`home`) when the card is there, else
// where cardStatus sends you (a free copy's box, or a deck's when every copy is in one), then your other copies,
// free ones first. A copy the import named no printing for, and what you don't own, go by name alone.
// → [{name, qty, set?, cn?, foil?}], one per printing and finish. The line is the form ManaBox's deck import reads
// (checked by Matt on Nov 12: `1 Sol Ring (C13) 259`, and `*F*` for a foil; an etched copy has its own number in
// most sets, and how ManaBox writes one is unchecked, so it gets no mark).
function printLines(name, qty = 1, home = null) {
  const st = cardStatus(name, qty, home), first = st.kind === "here" ? home : st.loc || null;
  const copies = [...ownCopies(name)].sort((a, b) => ((b.e.loc === first) - (a.e.loc === first)) || (!!a.e.inDeck - !!b.e.inDeck)
    || a.e.loc.localeCompare(b.e.loc, undefined, { numeric: true }) || (a.e.set || "").localeCompare(b.e.set || "") || String(a.e.cn || "").localeCompare(String(b.e.cn || ""), undefined, { numeric: true }));
  const out = new Map(); let left = qty;
  const add = (key, line, n) => { const x = out.get(key); if (x) x.qty += n; else out.set(key, { ...line, qty: n }); };
  for (const { e } of copies) {
    if (left <= 0) break;
    const n = Math.min(left, e.qty); left -= n;
    if (e.set && e.cn) add(`${e.set}|${e.cn}|${e.foil || ""}`, { name, set: e.set, cn: String(e.cn), foil: e.foil || "" }, n); else add("", { name }, n);
  }
  if (left > 0) add("", { name }, left);
  return [...out.values()];
}
const printLineText = l => `${l.qty} ${l.name}${l.set && l.cn ? ` (${l.set.toUpperCase()}) ${l.cn}${l.foil === "foil" ? " *F*" : ""}` : ""}`;

// ------------------------------------------------------------ sorting (0.75.0)
// Matt, Nov 12: "an order by/sort by option… Support for ordering by multiple filter values at once… users should be
// able to sort and order boxes in their collection freely." One sort for every list of cards: up to SORT_MAX keys in
// order, each in its usual direction or turned round, and the name last so the order never depends on the list it
// came from. A sort is kept as text, keys apart by spaces and "-" before one that is turned round: "color type letter"
// (how his own boxes run: "color, type, then alphabetically by first letter only"), "-price name". The old one-key
// values (name, price, mv, type, qty) are sorts already.
//   name    A to Z                      letter  the first letter only, A to Z (digits and marks first)
//   color   the card's own colours (cardColors: a land is colourless): W U B R G, two or more, colourless
//   ident   its colour identity (the card table's colours: a Mountain is red), in the same order
//   type    creatures … lands (SORT_TYPES), cards the data doesn't know last
//   mv      low to high                 price   high to low       qty   most first
//   rar     mythic, rare, uncommon, common, special, bonus        set   newest first
// What a row is differs by list, so the caller says how to read it: get = { name, qty, price, rar, set } (functions
// of a row; name defaults to row.name, the others to nothing, which sorts last or leaves the rows as they were).
const SORT_KEYS = ["name", "letter", "color", "ident", "type", "mv", "price", "qty", "rar", "set"];
const SORT_MAX = 3;
const SORT_TYPES = "CISAEPBL", SORT_RARS = "mrucsb";
function canonSort(spec, keys = SORT_KEYS) {
  const out = [], seen = new Set();
  for (const part of String(spec == null ? "" : spec).split(/[\s,]+/)) {
    const down = part.startsWith("-"), k = down ? part.slice(1) : part;
    if (!keys.includes(k) || seen.has(k) || out.length >= SORT_MAX) continue;
    seen.add(k); out.push((down ? "-" : "") + k);
  }
  return out.join(" ") || "name";
}
const sortParts = spec => canonSort(spec).split(" ").map(p => (p.startsWith("-") ? { k: p.slice(1), down: true } : { k: p, down: false }));
const sortColorRank = cols => (cols == null ? 7 : cols.length > 1 ? 5 : cols.length ? "WUBRG".indexOf(cols) : 6);
function sortValue(k, name, row, get) {
  const c = DATA ? cardOf(name) : null;
  switch (k) {
    case "letter": { const n = norm(name); return n ? n[0] : ""; }
    case "color": return sortColorRank(c ? cardColors(name) : isBasic(name) ? "" : null);
    case "ident": return sortColorRank(c ? c[1].replace("C", "") : isBasic(name) ? (basicColor(name) || "").replace("C", "") : null);
    case "type": { const i = SORT_TYPES.indexOf(c ? c[2] : isBasic(name) ? "L" : "?"); return i < 0 ? 99 : i; }
    case "mv": return c ? c[4] || 0 : 0;
    case "price": return -(get.price ? +get.price(row) || 0 : 0);
    case "qty": return -(get.qty ? +get.qty(row) || 0 : 0);
    case "rar": { const i = SORT_RARS.indexOf(get.rar ? get.rar(row) || "?" : "?"); return i < 0 ? 99 : i; }
    case "set": { const code = get.set ? get.set(row) || "" : "", s = setOf(code); return s && s.released ? s.released : ""; }   // a date as text; newest first below
  }
  return 0;
}
// → a comparator for rows. Each row's values are worked out once.
function sortCmp(spec, get = {}) {
  const parts = sortParts(spec), nameOf = get.name || (row => row.name), memo = new Map();
  const vals = row => {
    let v = memo.get(row);
    if (!v) { const name = nameOf(row); v = { name, v: parts.map(p => (p.k === "name" ? null : sortValue(p.k, name, row, get))) }; memo.set(row, v); }
    return v;
  };
  return (a, b) => {
    const x = vals(a), y = vals(b);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; let d;
      if (p.k === "name") d = x.name.localeCompare(y.name);
      else if (p.k === "set") d = x.v[i] === y.v[i] ? 0 : !x.v[i] ? 1 : !y.v[i] ? -1 : x.v[i] < y.v[i] ? 1 : -1;   // no set known: last either way
      else d = x.v[i] < y.v[i] ? -1 : x.v[i] > y.v[i] ? 1 : 0;
      if (d) return p.down && !(p.k === "set" && (!x.v[i] || !y.v[i])) ? -d : d;
    }
    return x.name.localeCompare(y.name);
  };
}
const sortRows = (rows, spec, get) => rows.sort(sortCmp(spec, get));

// ------------------------------------------------------------ views (0.81.0)
// Matt, Nov 12: "saving sort/filters as views is a great idea. they should be able to be renamed, not just deleted."
// A view is a name plus the filters that are on, the sort and the grouping (never List/Grid/Table):
// {id, name, f, sort, group, pins, updated}.
//   f      only what is on: q (the search), types, mv + mode, colors (+ by: "id"), role, formats (+ fmtMode: "banned"),
//          within (Within colors), set, rar, foil (your copies)
//   sort   a sort as text (canonSort)         group   "" | "type" | "color" | "role" | "location"
//   pins   the screens it shows on as a chip: "all", "deck:<loc>", "box:<loc>", "saved:<id>", "build:<id>"
// The page keeps the list (VIEWS) and says what each list has; here: one way to write a view down, what a view needs
// of a list, and the saved filters and saved sorts of before 0.81.0 read as views.
const VIEW_GROUPS = ["", "type", "color", "role", "location"];
function canonViewFilter(f) {
  f = f && typeof f === "object" ? f : {};
  const out = {}, list = v => (Array.isArray(v) ? v : v instanceof Set ? [...v] : []);
  const q = typeof f.q === "string" ? f.q.trim().slice(0, 80) : ""; if (q) out.q = q;
  const types = QUICK_TYPES.filter(t => list(f.types).includes(t)); if (types.length) out.types = types;
  if (f.mv != null && Number.isFinite(+f.mv)) { out.mv = Math.max(0, Math.min(QUICK_MV_TOP, Math.round(+f.mv))); out.mode = ["le", "eq", "ge"].includes(f.mode) ? f.mode : "le"; }
  const colors = [...COLORS, "C"].filter(c => list(f.colors).includes(c)); if (colors.length) { out.colors = colors; if (f.by === "id") out.by = "id"; }
  if (f.role && typeof f.role === "string") out.role = f.role.slice(0, 40);
  const formats = [...new Set(list(f.formats).filter(x => typeof x === "string" && x))].sort();
  if (formats.length) { out.formats = formats; if (f.fmtMode === "banned") out.fmtMode = "banned"; }
  const within = COLORS.filter(c => list(f.within).includes(c)); if (within.length) out.within = within;
  if (f.set && typeof f.set === "string") out.set = f.set.slice(0, 12);
  if (f.rar && typeof f.rar === "string") out.rar = f.rar.slice(0, 2);
  if (f.foil === "foil" || f.foil === "non") out.foil = f.foil;
  return out;
}
// What a view says, with nothing else: the same choices give the same text however they were made.
const canonView = v => ({ f: canonViewFilter(v && v.f), sort: canonSort(v && v.sort), group: v && VIEW_GROUPS.includes(v.group) ? v.group : "" });
const sameView = (a, b) => JSON.stringify(canonView(a)) === JSON.stringify(canonView(b));
// What a list must have for a view to work there whole: kinds of filter beyond the quick row (which every list
// has), the keys of its sort, its grouping.
function viewNeeds(v) {
  const c = canonView(v), f = c.f, kinds = [];
  if (f.q) kinds.push("q");
  if (f.role) kinds.push("role");
  if (f.formats) kinds.push("formats");
  if (f.within) kinds.push("within");
  if (f.set || f.rar || f.foil) kinds.push("copies");
  return { kinds, keys: sortParts(c.sort).map(p => p.k), group: c.group };
}
// has: what a list offers, { kinds, keys, groups }.
function viewFits(v, has) {
  const n = viewNeeds(v);
  return n.kinds.every(k => has.kinds.includes(k)) && n.keys.every(k => has.keys.includes(k)) && has.groups.includes(n.group);
}
// A stored view, checked (from storage, a backup or another device) → the view, or null when it isn't one.
function cleanView(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id || typeof x.name !== "string") return null;
  const name = x.name.trim().slice(0, 60); if (!name) return null;
  const pins = [...new Set((Array.isArray(x.pins) ? x.pins : []).filter(p => typeof p === "string" && p))].slice(0, 200);
  return { id: x.id, name, ...canonView(x), pins, updated: +x.updated || 0 };
}
// Before 0.81.0 a deck had saved filters ({id, deck, name, f, updated}: the quick row and the search) and every list
// saved sorts ({id, name, sort, updated}). Each is a view under the id and the date it had, so two devices that
// change over apart agree, and a deletion made on either side still finds it: a saved filter is pinned to its deck
// and opens as a deck's screen does (by name, grouped by type); a saved sort has no filter and no grouping.
const viewFromFilter = x => (x && typeof x === "object" ? cleanView({ id: x.id, name: x.name, f: x.f, sort: "name", group: "type", pins: typeof x.deck === "string" ? [x.deck] : [], updated: x.updated }) : null);
const viewFromSort = x => (x && typeof x === "object" && typeof x.sort === "string" ? cleanView({ id: x.id, name: x.name, f: {}, sort: x.sort, group: "", pins: [], updated: x.updated }) : null);

// ------------------------------------------------------------ buying list (0.38.0)
// What a build needs that you don't have, grouped into price ranges. The ranges are data the person edits (Matt, Nov 8:
// start with "quick buys" and "expensive future buys", "coded in a way where adding additional categories and tweaking
// the range covered by each category can be modified"): an ordered list of {name, upTo}; each range runs from the one
// before's upTo (not included) to its own (included), and the last has upTo null, "and up".
const BUY_DEFAULT = [{ name: "Grab now", upTo: 2 }, { name: "Save up", upTo: null }];
// Tidy a list of ranges: names trimmed (blank → "Range N"), limits positive and rising (repeats dropped), the last open-ended.
function canonBuckets(list) {
  const src = Array.isArray(list) && list.length ? list : BUY_DEFAULT;
  const named = (x, i) => String((x && x.name) || "").trim().slice(0, 40) || `Range ${i + 1}`;
  const capped = src.slice(0, -1).map((x, i) => ({ name: named(x, i), upTo: Math.round(Number(x && x.upTo) * 100) / 100 }))
    .filter(x => Number.isFinite(x.upTo) && x.upTo > 0).sort((a, b) => a.upTo - b.upTo)
    .filter((x, i, a) => i === 0 || x.upTo !== a[i - 1].upTo);
  return [...capped, { name: named(src[src.length - 1], capped.length), upTo: null }];
}
// Cards to buy: missing ones, and copies beyond what you own (a second Relentless Rats). With inDecks, also cards you only
// have in other decks, for a second copy instead of moving one. Basics and cards already in the build's own deck never.
// → [{name, qty, price (null when unknown), why: "missing" | "short" | "indeck"}]
function buyList(b, { inDecks = false } = {}) {
  const home = buildHome(b), out = [];
  for (const c of boxCards(b)) {   // the sideboard's cards too: they are part of what the box should hold
    const st = cardStatus(c.name, c.qty, home);
    let qty = 0, why = "missing";
    if (st.kind === "missing") qty = c.qty;
    else if (st.kind === "indeck") { qty = inDecks ? c.qty : st.short || 0; why = inDecks ? "indeck" : "short"; }
    else if (st.kind === "free") { qty = st.short || 0; why = "short"; }
    if (qty <= 0) continue;
    const card = DATA && cardOf(c.name), price = card && card[3] > 0 ? card[3] : null;
    out.push({ name: card ? card[0] : c.name, qty, price, why, ...(c.side ? { side: true } : {}) });
  }
  return out;
}
// Group a buying list by price range, dearest first in each; unpriced cards on their own. Each group: {name, from, upTo,
// items, qty, total}; empty ranges stay in (so the shape matches what the person set), and the page decides what to show.
function buyGroups(items, buckets) {
  const bs = canonBuckets(buckets), unpriced = [];
  const groups = bs.map((x, i) => ({ name: x.name, from: i ? bs[i - 1].upTo : 0, upTo: x.upTo, items: [], qty: 0, total: 0 }));
  for (const it of items) {
    if (it.price == null) { unpriced.push(it); continue; }
    const g = groups.find(x => x.upTo == null || it.price <= x.upTo);
    g.items.push(it); g.qty += it.qty; g.total += it.price * it.qty;
  }
  for (const g of groups) { g.items.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name)); g.total = Math.round(g.total * 100) / 100; }
  unpriced.sort((a, b) => a.name.localeCompare(b.name));
  return { groups, unpriced, qty: items.reduce((n, x) => n + x.qty, 0), total: Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100 };
}
// Mass-entry text: "1 Sol Ring" per line, which TCGplayer's Mass Entry, Card Kingdom's Deck Builder and ManaBox all read.
const buyText = items => items.map(it => `${it.qty} ${it.name}`).join("\n");

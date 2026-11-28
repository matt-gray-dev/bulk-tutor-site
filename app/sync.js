"use strict";
// Bulk Tutor, the page's script, part "sync": sync: the backup file and Dropbox.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ sync: backup file and Dropbox
// Everything worth keeping (collection, decks, settings) can travel as one document: a backup
// file you download, or files in the person's own Dropbox app folder. Decks carry their own
// timestamps, so merging keeps the newer copy of each; deletions are remembered as tombstones (bt.tomb,
// "b:<id>") so a deleted deck doesn't come back from another device. Data goes from the
// browser straight to Dropbox; there's no server of ours in between, and the page holds only Dropbox's
// public app key (PKCE, no secret).
// **Decks travel in a file of their own since 0.95.0** (decks.json; step 5, piece b: Matt, Nov 15, "decks go to
// Dropbox in a new file"). builds.json keeps the settings it also carried (templates, views, tastes, looks, the
// tombstones…); the `builds` and `saved` a version before 0.95.0 wrote into it are never read again, because a
// device still on such a version would read decks as builds and bring them over a second time. Each device
// brings its own lists over (decks.js), and the same lists make the same decks, so they meet by id.
// **The collection is the record** (record.js) and travels in a file of its own since 0.93.0 ("the collection in
// Dropbox", below): two devices are merged change by change (engine mergeRecs). Dropbox's collection.json holds
// the form from before 0.88.0 and is never read or changed again ("Dropbox starts clean"; from 0.88.0 to 0.92.1
// the collection didn't sync at all). A backup file carries the record as `record`.
const SYNC_FORMAT = "bulk-tutor-sync";
const OLD_SYNC_FORMAT = "binder-brew-sync";   // backups and Dropbox files from before the rename; still read
const TOMB_DAYS = 180;
let CONFIG = {};               // site/config.json, written by the workflow: { dropboxAppKey }
let TOMB = {};                 // "b:<id>" (a deck; a build before 0.95.0) | "d:<id>" (a saved deck, before 0.95.0) -> deleted at (ms)
let CSV_DONE = null;           // the Dropbox CSV that last became the collection: { rev, name, at }
const knownIds = { b: new Set(), d: new Set(), t: new Set(), v: new Set() };
let applyingRemote = false;

const stampOf = x => Math.max((x && x.updated) || 0, (x && x.saved) || 0);
// Same content, same string, whatever order keys or items happen to be in on each device.
const stableJSON = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
const byId = list => [...(list || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
function loadSyncState() {
  try { TOMB = JSON.parse(store.get("bt.tomb") || "{}") || {}; } catch { TOMB = {}; }
  const cut = Date.now() - TOMB_DAYS * 864e5;
  for (const k in TOMB) if (!(TOMB[k] >= cut)) delete TOMB[k];
  try { CSV_DONE = JSON.parse(store.get("bt.csvdone") || "null"); } catch { CSV_DONE = null; }
  knownIds.t = new Set(TEMPLATES.map(x => x.id)); knownIds.v = new Set(VIEWS.map(x => x.id));   // the decks' ids are known once they are read (decks.js openDecks)
  if (oldTombs()) saveTomb();
}
// Saved filters ("f:<id>") and saved sorts ("o:<id>") became views under the same ids (0.81.0), so a deletion made
// before the change, or on a device that hasn't changed over, counts for the view too. → whether any was added.
function oldTombs() {
  let changed = false;
  for (const k in TOMB) if (k.startsWith("f:") || k.startsWith("o:")) { const vk = "v:" + k.slice(2); if (!(TOMB[vk] >= TOMB[k])) { TOMB[vk] = TOMB[k]; changed = true; } }
  return changed;
}
const saveTomb = () => store.set("bt.tomb", JSON.stringify(TOMB));
// Called whenever decks, templates or views are saved: an id that vanished was deleted on this device.
function trackDeletions(kind, items) {
  const ids = new Set(items.map(x => x.id)); let changed = false;
  for (const id of knownIds[kind]) if (!ids.has(id) && !TOMB[kind + ":" + id]) { TOMB[kind + ":" + id] = Date.now(); changed = true; }
  knownIds[kind] = ids;
  if (changed) saveTomb();
  return changed;
}

// **Your own decks and record, whatever is on the screen** (0.106.0): with the example showing, BUILDS is the
// example's list (decks.js myDecks), and during a visit to it your record is behind it (record.js visiting).
function fullDoc() {
  return { format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: new Date().toISOString(),
    record: (ownColl() || visiting()) && REC ? packRec(REC) : null, csv: CSV_DONE, decks: myDecks(), templates: TEMPLATES, views: VIEWS, deleted: TOMB, prefs: PREFS, locStyle: LOCSTYLE, buy: BUY, tokens: TOKOWN, rules: RULES, history: CHDAYS };
}

// What a sync that changed the collection says (Matt, Nov 12: "might be worth notifying the user that's happening";
// the words as he agreed them on the pictures, Nov 14): that both devices' changes are kept when both had some, what
// came from the other one and when it last changed, and how many changes weren't made. The stamps are UTC; the
// time is shown in this device's own time zone (his point, Nov 12), with the day when it wasn't today.
function whenWords(ms) {
  const d = new Date(ms), now = new Date(), time = { hour: "numeric", minute: "2-digit" };
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, time) : d.toLocaleString(undefined, { month: "short", day: "numeric", ...time });
}
// m: mergeRecs' answer ("merged", or "theirs" with what came).
function mergedWords(m) {
  const n = (k, one, many) => (k ? `${k.toLocaleString()} ${k === 1 ? one : many}` : ""), came = (m.came || []).filter(c => !isLeft(c)), c = { moved: 0, added: 0, removed: 0 };
  for (const ch of came) for (const l of ch.lines) c[l.from == null ? "added" : l.to == null ? "removed" : "moved"] += l.qty;
  const what = [n(c.moved, "card moved", "cards moved"), n(c.added, "added", "added"), n(c.removed, "removed", "removed")].filter(Boolean).join(", ");
  const at = m.theirsAt || came.reduce((t, ch) => Math.max(t, Date.parse(ch.at) || 0), 0), short = list => (list || []).filter(x => leftSaid(x) || x.how.left > 0).length;
  const not = (k, where) => (k ? ` ${k === 1 ? "1 change" : `${k} changes`} ${where} ${k === 1 ? "wasn't" : "weren't"} made.` : "");
  // The device they were made on, when they all name the same one (0.94.0). Its name has a comma of its own
  // ("iPhone, Safari"), so the time goes in brackets after it.
  const who = oneDev(m.came);
  const lead = m.take === "merged" ? `Your collection was changed on two devices, and both sets of changes are kept. From ${who || "the other device"}` : `Your collection was changed on ${who || "another device"}`;
  return `${lead}${!at ? "" : who ? ` (last changed ${whenWords(at)})` : `, last changed ${whenWords(at)}`}${what ? `: ${what}` : ""}.${not(short(m.sent), "here")}${not(short(m.came), `from ${who || "the other device"}`)}`;
}

// Merge a list by id: the newer copy of each item wins, and a tombstone newer than an item removes it.
function mergeList(kind, local, remote) {
  const m = new Map(local.map(x => [x.id, x])), fresh = [];
  let changed = 0;
  for (const r of remote) {
    if (!r || !r.id) continue;
    const l = m.get(r.id);
    if (!l) { if (!(TOMB[kind + ":" + r.id] >= stampOf(r))) { fresh.push(r); changed++; } }
    else if (stampOf(r) > stampOf(l)) { m.set(r.id, r); changed++; }
  }
  const list = [...fresh, ...[...m.values()].filter(x => { const gone = TOMB[kind + ":" + x.id] >= stampOf(x); if (gone) changed++; return !gone; })];
  return { list, changed };
}

// Apply a backup or a synced file. Returns what changed here.
// `sync`: the document is one of Dropbox's files (not a backup file), which carry no collection. **Decks** come as
// `decks` (0.95.0); a backup from before carries builds, saved decks and deck marks instead, and those are read as
// the move reads the browser's own (decks.js decksFrom), against the backup's own collection when it has one. A backup file's
// collection is taken whole when it changed more recently than the one here, and handed back as `older` when it
// didn't and its cards differ, for Restore to ask (0.93.0): the record (`record`, since 0.88.0), or a backup from
// before in the old shape (`collection`), brought over the way the first open brings the browser's own.
function applyDoc(doc, sync = false) {
  if (!doc || (doc.format !== SYNC_FORMAT && doc.format !== OLD_SYNC_FORMAT)) throw new Error("This isn't a Bulk Tutor backup.");
  if (!doc.builds && Array.isArray(doc.brews)) doc = { ...doc, builds: doc.brews };
  const r = { builds: 0, collection: false };
  // A backup's collection: the record (`record`, since 0.88.0), or the old shape (`collection`), brought over as the first open brings the browser's own.
  const theirs = sync ? null : doc.record && typeof doc.record === "object" ? unpackRec(doc.record) : doc.collection && Array.isArray(doc.collection.entries) ? convertCollection(doc.collection, [...MADE]) : null;
  let redrawn = false;
  applyingRemote = true;
  try {
    const cut = Date.now() - TOMB_DAYS * 864e5;
    let tombChanged = false;
    for (const [k, t] of Object.entries(doc.deleted || {})) if (t >= cut && !(TOMB[k] >= t)) { TOMB[k] = t; tombChanged = true; }
    if (tombChanged) { oldTombs(); saveTomb(); }
    let decks = Array.isArray(doc.decks) ? doc.decks.filter(d => d && d.id && Array.isArray(d.cards)) : null;
    if (!decks && !sync && (Array.isArray(doc.builds) || Array.isArray(doc.saved))) {
      const lists = k => (Array.isArray(doc[k]) ? doc[k].filter(x => x && x.id && Array.isArray(x.cards)) : []);
      try { decks = decksFrom({ builds: lists("builds"), saved: lists("saved") }, theirs || ownRec(), doc.locStyle && doc.locStyle.decks).decks; } catch { decks = null; }
    }
    if (decks || tombChanged) {
      const m = mergeList("b", myDecks(), decks || []);   // your own, also while the example's are on the screen (decks.js)
      if (m.changed) { r.builds = m.changed; takeMyDecks(m.list); }   // the open deck removed on another device: the Workbench gives way to the list
    }
    if (Array.isArray(doc.templates) || tombChanged) {
      const m = mergeList("t", TEMPLATES, doc.templates || []);
      if (m.changed) { TEMPLATES = m.list; r.templates = m.changed; saveTemplates(true); }
    }
    // Views; and, from a backup or a device of before 0.81.0, its saved filters and saved sorts read as views
    // (the ids they had, so the same one arriving both ways is one view).
    if (Array.isArray(doc.views) || Array.isArray(doc.filters) || Array.isArray(doc.sorts) || tombChanged) {
      const theirs = new Map();
      for (const v of [...(Array.isArray(doc.views) ? doc.views : []).map(cleanView), ...(Array.isArray(doc.filters) ? doc.filters : []).map(viewFromFilter), ...(Array.isArray(doc.sorts) ? doc.sorts : []).map(viewFromSort)]) if (v && !theirs.has(v.id)) theirs.set(v.id, v);
      const m = mergeList("v", VIEWS, [...theirs.values()]);
      if (m.changed) { VIEWS = m.list; r.views = m.changed; saveViews(true); }
    }
    // Card preferences (dismissed / never suggest): per card, the newer entry wins.
    if (doc.prefs && doc.prefs.cards && typeof doc.prefs.cards === "object") {
      let n = 0;
      for (const [k, p] of Object.entries(doc.prefs.cards)) {
        if (!p || typeof p !== "object") continue;
        const mine = PREFS.cards[k];
        if (!mine || (p.at || 0) > (mine.at || 0)) { PREFS.cards[k] = p; n++; }
      }
      if (n) { r.prefs = n; savePrefs(true); }
    }
    // Location icons, the defaults and which locations are decks: per entry, the newer one wins.
    if (doc.locStyle && typeof doc.locStyle === "object") {
      let n = 0, marks = 0;
      for (const part of LOCSTYLE_PARTS) for (const [k, st] of Object.entries(doc.locStyle[part] || {})) {
        if (!st || typeof st !== "object") continue;
        const mine = LOCSTYLE[part][k];
        if (!mine || (st.at || 0) > (mine.at || 0)) { LOCSTYLE[part][k] = st; if (part === "decks") marks++; else n++; }   // the marks only count for the example and a link's collection since 0.95.0, and aren't spoken of
      }
      if (n) r.looks = n;
      if (marks) r.decks = marks;
      if (n || marks) saveLocStyle(true);
    }
    // Buying list price ranges: the newer set wins.
    if (doc.buy && Array.isArray(doc.buy.buckets) && (doc.buy.at || 0) > (BUY.at || 0)) {
      const was = BUY.cur;
      BUY = { buckets: canonBuckets(doc.buy.buckets), cur: buyCur(doc.buy), at: doc.buy.at }; saveBuy(true); r.buy = true;
      if (BUY.cur !== was) currencyChanged();
    }
    // Filing rules: the newer set wins whole (their order is part of what they say).
    if (doc.rules && typeof doc.rules === "object" && (+doc.rules.at || 0) > (RULES.at || 0)) { setRules(doc.rules); saveRules(true); r.rules = true; }
    // How long changes to the collection are kept (changes.js): the newer choice wins, and a shorter one forgets here too.
    if (doc.history && typeof doc.history === "object" && (+doc.history.at || 0) > (CHDAYS.at || 0) && setChDays(+doc.history.days, +doc.history.at, true)) r.history = true;
    // The tokens you own and the switch that tracks them: record by record, the later change wins.
    if (doc.tokens && typeof doc.tokens === "object") { const n = tokOwnMerge(doc.tokens); if (n) { r.tokens = n; saveTokOwn(true); } }
    if (doc.csv && (!CSV_DONE || (doc.csv.at || 0) > (CSV_DONE.at || 0))) { CSV_DONE = doc.csv; store.set("bt.csvdone", JSON.stringify(CSV_DONE)); }
    if (!sync) {
      const mine = ownColl() && REC ? REC : null;
      if (theirs && (theirs.lines.size || theirs.changes.length)) {
        if (!mine || recStamp(theirs) > recStamp(mine)) { REC = theirs; recForeign(); recChanged(); r.collection = true; }
        else if (!recSame(mine, theirs)) r.older = theirs;   // older than the one here, and not the same cards: asked (restoreBackup)
      }
    }
    // New decks, or new marks, for the collection that's already here: its cards' "in a deck" follows them.
    if ((r.builds || r.decks) && !r.collection && COLL) { if (ownColl()) setCollection(); else setCollection(COLL); redrawn = true; }
  } finally { applyingRemote = false; }
  if ((r.builds || r.templates || r.views || r.looks || r.buy || r.tokens || r.rules || r.history) && !r.collection && !redrawn) renderAll();
  return r;
}
function describeApplied(r) {
  const parts = [r.collection ? "your collection" : "", r.builds ? `${r.builds} deck${r.builds === 1 ? "" : "s"}` : "", r.templates ? `${r.templates} template${r.templates === 1 ? "" : "s"}` : "", r.views ? `${r.views} view${r.views === 1 ? "" : "s"}` : "", r.looks ? "location icons" : "", r.buy ? "your currency and price ranges" : "", r.tokens ? "the tokens you own" : "", r.rules ? "your filing rules" : "", r.history ? "how long changes are kept" : ""].filter(Boolean);
  return parts.length ? parts.join(", ").replace(/, ([^,]*)$/, " and $1") : "";
}

// ---- backup file
function downloadBackup() {
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  downloadFile(`bulk-tutor-backup-${stamp}.json`, JSON.stringify(fullDoc()));
}
// **A backup whose collection is older than the one here is asked about** (0.93.0; Matt agreed, Nov 14: until then
// it was passed over without a word, so a collection saved as a file couldn't be put back). The rest of the backup
// is merged first, as always. RESTORE_ASK = {rec, label} while the question stands, under Backups in Settings.
// "Use the backup's" makes it the collection as a record of its own (engine recRestored: it wins whole on your
// other devices too), and this device's goes to Dropbox as it is.
let RESTORE_ASK = null;
function restoreBackup(text, label) {
  let doc;
  try { doc = JSON.parse(text); } catch { toast(`${label} isn't a Bulk Tutor backup`); return; }
  leaveExample(false);   // a backup is about your own collection: a visit to the example ends first (it would read as no collection here)
  try {
    const r = applyDoc(doc), what = describeApplied(r);
    RESTORE_ASK = r.older ? { rec: r.older, label } : null;
    if (RESTORE_ASK) { showView("settings"); renderSettings(); const q = $("#restore-ask"); if (q) q.scrollIntoView({ block: "center" }); if (what) toast(`Restored ${what} from the backup`); else { const t = $(".toast"); if (t) t.hidden = true; } }   // the question is on the screen: a message over its buttons would hide them
    else toast(what ? `Restored ${what} from the backup` : "Nothing new in that backup: everything here is the same or newer");
    syncSoon(500);
  } catch (e) { toast(e.message || "That backup couldn't be read"); }
}
// "today, 3:40 PM", "yesterday, 9:12 PM", "Nov 2, 9:12 PM": when a collection last changed, in this device's time.
function lastWords(ms) {
  const day = chDay(ms);
  return day === "Today" || day === "Yesterday" ? `${day.toLowerCase()}, ${chTime(ms)}` : `${day}, ${chTime(ms)}`;
}
// What a collection's latest change was, in a few words: it tells two collections apart when their counts don't
// (Matt's two, Nov 15: both 3,774 cards, one imported that minute). A change that wasn't made says nothing.
function recLast(rec) {
  let c = null, t = -1;
  for (const x of rec.changes) { const a = Date.parse(x.at) || 0; if (!isLeft(x) && a >= t) { c = x; t = a; } }
  return c;
}
function recFrom(rec) {
  const c = recLast(rec);
  if (!c) return "";
  const how = c.how, n = cardsWord(c.lines.reduce((k, l) => k + l.qty, 0));
  if (how.by === "convert") return "brought over from an earlier version";
  if (how.by === "restore") return "restored from a backup";
  if (how.by === "file") return `imported ${how.label || how.app || "a file"}`;
  if (how.by === "deck") return how.act === "apart" ? `took ${how.label || "a deck"} apart` : `built ${how.label || "a deck"}`;
  if (how.by === "undo") return "took back a change";
  if (how.by === "rules" || how.act === "filed") return `put away ${n}`;
  return how.act === "added" ? `added ${n}` : how.act === "removed" ? `removed ${n}` : `moved ${n}`;
}
// With the device that change was made on, when it says (0.94.0; Matt, Nov 15, on the question: info on where each
// collection came from "could only help").
const recWords = rec => { const from = recFrom(rec), dev = changeDev(recLast(rec)); return `${cardsWord(recCount(rec))}, last changed ${lastWords(recStamp(rec))}${dev ? ` on ${dev}` : ""}${from ? ` (${from})` : ""}`; };
function restoreAskHTML() {
  if (!RESTORE_ASK || !REC || !ownColl()) return "";
  return `<div class="restore-ask" id="restore-ask"><p class="small"><strong>This backup's collection is older than the one here.</strong></p>
    <p class="small">Backup: ${esc(recWords(RESTORE_ASK.rec))}.<br>Here: ${esc(recWords(REC))}.</p>
    <p class="muted small">Its decks and settings are merged either way, keeping the newer copy of each.</p>
    <div class="sheet-pair"><button class="btn" data-restore="keep">Keep the one here</button><button class="btn danger" data-restore="use">Use the backup's</button></div>
    <p class="small"><button class="btn link" data-restore="download">Download a backup of the one here first</button></p></div>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-restore]"); if (!t || !RESTORE_ASK) return;
  const act = t.dataset.restore;
  if (act === "download") { downloadBackup(); return; }
  if (act === "use" && REC && ownColl()) {
    REC = recRestored(RESTORE_ASK.rec, RESTORE_ASK.label); cameBy([], 0, true);
    if (DBX.state) { DBX.state.recForce = true; dbxSave(); }
    RESTORE_ASK = null; recChanged();
    toast(`Your collection is the backup's now: ${cardsWord(recCount(REC))}`);
    syncSoon(500);
  } else RESTORE_ASK = null;
  renderSettings();
});
const looksLikeBackup = text => /^\s*\{/.test(text) && text.includes(SYNC_FORMAT);

// ---- Dropbox
const DBX = { state: null, status: "idle", error: "", confirmOff: false };   // state is saved as bb.dbx
const DBX_PARTS = [   // /collection.json, the collection as it was kept before 0.88.0, is left where it is (above)
  // The settings, and the tombstones: read before the decks, so a deck deleted elsewhere is gone before its file is merged.
  { name: "builds", path: "/builds.json", oldPath: "/brews.json", keys: ["templates", "views", "deleted", "prefs", "locStyle", "buy", "tokens", "rules"], sig: d => stableJSON([d.deleted || {}, (d.prefs && d.prefs.cards) || {}, byId(d.templates), d.locStyle || {}, byId(d.views), d.buy || {}, d.tokens || {}, d.rules && d.rules.at ? d.rules : {}]) },
  { name: "decks", path: "/decks.json", keys: ["decks"], sig: d => stableJSON(byId(d.decks)) },   // 0.95.0: your decks, in a file of their own
];
const dbxKey = () => (CONFIG && CONFIG.dropboxAppKey || "").trim();
const dbxAvailable = () => !!dbxKey() && !isFramed && !!(window.crypto && crypto.subtle);
const dbxConnected = () => dbxAvailable() && !!(DBX.state && DBX.state.refresh);
const dbxRedirect = () => location.origin + location.pathname.replace(/index\.html$/, "");
function dbxLoad() {
  try { DBX.state = JSON.parse(store.get("bt.dbx") || "null"); } catch { DBX.state = null; }
  // Still waiting for a pasted code (the page may have been reloaded while Dropbox was open)?
  try { const pk = JSON.parse(store.get("bt.dbx-pkce") || "null"); DBX.awaitingCode = !!(pk && pk.mode === "code" && Date.now() - pk.at < 30 * 60e3); } catch {}
}
function dbxSave() { if (DBX.state) store.set("bt.dbx", JSON.stringify(DBX.state)); else store.del("bt.dbx"); }
async function loadConfig() {
  try { const r = await fetch("config.json", { cache: "no-store" }); if (r.ok) CONFIG = await r.json() || {}; } catch {}
}

// Two ways to sign in. Normally the page goes to Dropbox and comes back with a code. An app on an
// iPhone Home Screen can't reliably come back from another site, so there Dropbox opens in a separate
// window and shows a code to paste in ("code" mode); anyone can choose that way too.
//
// The sign-in secret (PKCE) is made ahead of time: iOS only lets a Home Screen app open a window
// during the tap itself, and making the secret takes an await, which would lose the tap and the
// window would silently never open.
const dbxPreferCode = () => isIOS && isStandalone();
let dbxPkce = null;
async function dbxPrepare() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  dbxPkce = { verifier, challenge, state: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}
function dbxConnect(mode = dbxPreferCode() ? "code" : "redirect") {
  const p = dbxPkce; dbxPkce = null;
  if (p) { dbxStart(mode, p, null); dbxPrepare(); return; }
  // Not ready yet (only in the first moment after the page opens): open the window now, while the
  // tap still counts, and point it at Dropbox once the secret is made.
  const win = mode === "code" ? window.open("", "_blank") : null;
  dbxPrepare().then(() => { const q = dbxPkce; dbxPkce = null; dbxStart(mode, q, win); dbxPrepare(); });
}
function dbxStart(mode, p, win) {
  store.set("bt.dbx-pkce", JSON.stringify({ verifier: p.verifier, state: p.state, at: Date.now(), view, mode }));
  const q = new URLSearchParams({ client_id: dbxKey(), response_type: "code", code_challenge: p.challenge, code_challenge_method: "S256", token_access_type: "offline" });
  if (mode === "code") {
    DBX.awaitingCode = true; renderSyncBits();
    const url = "https://www.dropbox.com/oauth2/authorize?" + q;
    if (win) { try { win.opener = null; } catch {} win.location.href = url; }
    else window.open(url, "_blank", "noopener");
    return;
  }
  q.set("redirect_uri", dbxRedirect()); q.set("state", p.state);
  location.assign("https://www.dropbox.com/oauth2/authorize?" + q);
}
async function dbxExchange(code, verifier, redirectUri) {
  const body = new URLSearchParams({ code, grant_type: "authorization_code", code_verifier: verifier, client_id: dbxKey() });
  if (redirectUri) body.set("redirect_uri", redirectUri);
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body });
  if (!res.ok) throw new Error(String(res.status));
  const t = await res.json();
  DBX.state = { refresh: t.refresh_token, access: t.access_token, expires: Date.now() + ((t.expires_in || 14400) - 120) * 1000, account: t.account_id, revs: {}, sigs: {} };
  dbxSave();
  try { const a = await dbxRpc("users/get_current_account", null); DBX.state.name = a.name && a.name.display_name; DBX.state.email = a.email; dbxSave(); } catch {}
  toast("Dropbox connected");
}
async function dbxFinishWithCode(code) {
  let pk = null; try { pk = JSON.parse(store.get("bt.dbx-pkce") || "null"); } catch {}
  if (!pk || !code.trim()) return;
  try { await dbxExchange(code.trim(), pk.verifier, null); store.del("bt.dbx-pkce"); DBX.awaitingCode = false; renderSyncBits(); dbxSync(); }
  catch { DBX.codeError = "That code didn't work. Codes expire after a few minutes, so start again if it's been a while."; renderSyncBits(); }
}
// **The code's field** (Settings, and the sheet below): `id` is its input's. The buttons find their field through
// `[data-dbx-codebox]`, as both can be in the page at once: Settings wraps it, the sheet's body is one. In the sheet
// the buttons are the sheets' own: the main one across, the other two a pair under it.
function dbxCodeHTML(id, sheet = false) {
  const btns = sheet
    ? `<button class="btn primary" data-dbx="code-go">Finish connecting</button><div class="sheet-pair"><button class="btn" data-dbx="code-again">Open Dropbox again</button><button class="btn" data-dbx="code-cancel">Cancel</button></div>`
    : `<div class="actions"><button class="btn primary" data-dbx="code-go">Finish connecting</button><button class="btn" data-dbx="code-again">Open Dropbox again</button><button class="btn" data-dbx="code-cancel">Cancel</button></div>`;
  const h = `<div class="filter-row"><div class="field grow"><label for="${id}">Code from Dropbox</label><input type="text" id="${id}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></div></div>
    <p class="small warn-text" data-dbx-code-err${DBX.codeError ? "" : " hidden"}>${esc(DBX.codeError || "")}</p>${btns}`;
  return sheet ? h : `<div data-dbx-codebox>${h}</div>`;
}
// **A page opened while a code is awaited asks for it at once** (0.101.3; Matt, Nov 19: the Home Screen app came back
// from Dropbox on the welcome, not on Settings, "we should let them enter that code before going back to the welcome
// page"): iOS often reloads a Home Screen app left for another app. A sheet over whatever screen opened, the welcome
// too; closing it leaves the code awaited in Settings, Cancel stops connecting. Drawn once, so typing isn't redrawn:
// `dbxCodeTidy` closes it when the code is taken or dropped, and says an error in place.
function openDbxCode() {
  const dlg = $("#dbxcode"); if (!dlg || dlg.open) return;
  $("#dbxcode-body").innerHTML = `<h2 id="dbxcode-title" tabindex="-1" autofocus>Finish connecting Dropbox</h2>
    <p>In Dropbox, sign in and tap <strong>Allow</strong>, then copy the code it shows and paste it here.</p>${dbxCodeHTML("dbx-code-sheet", true)}`;
  openDlg(dlg);
}
function dbxCodeTidy() {
  const dlg = $("#dbxcode"); if (!dlg || !dlg.open) return;
  if (!DBX.awaitingCode || dbxConnected()) { closeDlg(dlg); return; }
  const err = dlg.querySelector("[data-dbx-code-err]"); if (err) { err.textContent = DBX.codeError || ""; err.hidden = !DBX.codeError; }
}
// Back from Dropbox's sign-in page with ?code= (or ?error=). Returns the view to reopen, or null.
async function dbxFinishConnect() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return null;
  let pk = null; try { pk = JSON.parse(store.get("bt.dbx-pkce") || "null"); } catch {}
  store.del("bt.dbx-pkce");
  try { history.replaceState(history.state, "", location.pathname + location.hash); } catch {}
  if (!pk || !dbxAvailable()) return null;
  if (q.has("error")) { toast(q.get("error") === "access_denied" ? "Dropbox wasn't connected" : `Dropbox couldn't connect: ${q.get("error_description") || q.get("error")}`); return pk.view || null; }
  if (pk.state !== q.get("state") || Date.now() - pk.at > 30 * 60e3) { toast("That Dropbox sign-in expired. Try connecting again."); return pk.view || null; }
  try { await dbxExchange(q.get("code"), pk.verifier, dbxRedirect()); }
  catch { toast("Dropbox sign-in didn't finish. Try connecting again."); }
  return pk.view || null;
}

class DbxError extends Error { constructor(msg, kind, status) { super(msg); this.kind = kind; this.status = status; } }
async function dbxToken(force) {
  const s = DBX.state; if (!s || !s.refresh) throw new DbxError("Not connected", "auth");
  if (!force && s.access && s.expires > Date.now()) return s.access;
  let res;
  try { res = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: dbxKey() }) }); }
  catch { throw new DbxError("offline", "network"); }
  if (res.status === 400 || res.status === 401) throw new DbxError("signed out", "auth", res.status);
  if (!res.ok) throw new DbxError("token " + res.status, "http", res.status);
  const t = await res.json();
  s.access = t.access_token; s.expires = Date.now() + ((t.expires_in || 14400) - 120) * 1000; dbxSave();
  return s.access;
}
async function dbxFetch(url, opts, retried) {
  const token = await dbxToken();
  let res;
  try { res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + token } }); }
  catch { throw new DbxError("offline", "network"); }
  if (res.status === 401 && !retried) { await dbxToken(true); return dbxFetch(url, opts, true); }
  if (res.status === 401) throw new DbxError("signed out", "auth", 401);
  if (res.status === 429 || res.status === 503) throw new DbxError("busy", "busy", res.status);
  return res;
}
// Dropbox-API-Arg must be ASCII: escape everything else as \uXXXX.
const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
async function dbxRpc(path, body) {
  const res = await dbxFetch("https://api.dropboxapi.com/2/" + path,
    body == null ? { method: "POST" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new DbxError(path + " " + res.status, "http", res.status);
  return res.json();
}
async function dbxList() {
  let r = await dbxRpc("files/list_folder", { path: "", recursive: false }), entries = r.entries || [];
  while (r.has_more) { r = await dbxRpc("files/list_folder/continue", { cursor: r.cursor }); entries = entries.concat(r.entries || []); }
  return entries.filter(e => e[".tag"] === "file");
}
async function dbxDownload(path) {
  const res = await dbxFetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { "Dropbox-API-Arg": dbxArg({ path }) } });
  if (!res.ok) throw new DbxError("download " + res.status, "http", res.status);
  return res.text();
}
// Returns the new file's metadata, or null if someone else changed the file first.
async function dbxUpload(path, text, rev) {
  const res = await dbxFetch("https://content.dropboxapi.com/2/files/upload", { method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dbxArg({ path, mode: rev ? { ".tag": "update", update: rev } : { ".tag": "add" }, autorename: false, mute: true }) },
    body: text });
  if (res.status === 409) return null;
  if (res.status === 507) throw new DbxError("full", "full", 507);
  if (!res.ok) throw new DbxError("upload " + res.status, "http", res.status);
  return res.json();
}

// The newest CSV saved into the app folder (a ManaBox export) is taken in, once on each device: as the collection
// when there is none, else as an update (what was done here stays).
async function dbxPickCsv(files) {
  const f = files.filter(x => /\.(csv|txt)$/i.test(x.name)).sort((a, b) => Date.parse(b.server_modified) - Date.parse(a.server_modified))[0];
  if (!f || (CSV_DONE && CSV_DONE.rev === f.rev)) return;
  const mark = () => { CSV_DONE = { rev: f.rev, name: f.name, at: Date.now() }; store.set("bt.csvdone", JSON.stringify(CSV_DONE)); };
  const ours = ownColl() ? Date.parse(COLL.importedAt) || 0 : 0;
  if (Date.parse(f.server_modified) <= ours) { mark(); return; }   // something imported here since that file was saved
  const { entries, source, noLoc } = parseCollection(await dbxDownload(f.path_lower || f.path_display)); dbxHold();
  mark();
  if (!entries.length) { toast(`${f.name} in Dropbox doesn't look like a collection export, so it was skipped`); return; }
  const t = takeFile({ entries, source, label: `${f.name} (Dropbox)`, importedAt: new Date().toISOString(), sig: entriesSig(entries), noLoc: !!noLoc }, "update");
  toast(`Imported ${f.name} from Dropbox: ${cardsWord(entryCount(entries))}`, "Undo", () => { fileDecksBack(t.decks); if (t.own) recUndo(t.did.change && t.did.change.id); else removeCollection(); });
}

// ------------------------------------------------------------ this device's name (0.94.0: step 4's last piece)
// Matt, Nov 15, with two collections on his phone both called "Dropbox's": "Might be worth tracking the source of
// the device as the change in Dropbox so each device can have a clearer picture of where the changes are coming
// from." His three calls (Nov 15, 14:05): the name is guessed and never asked for ("iPhone, Home Screen app",
// "iPhone, Safari", "Mac, Chrome": engine deviceGuess), and can be changed in Settings beside Dropbox sync; it
// shows wherever the page said "another device"; changes from before stay "another device", and two devices with
// the same guessed name read the same until one is renamed.
// A change made here carries the name as it is then (engine setDevice), and so does the collection's file in
// Dropbox (`by`: who wrote it last). The name the person gave is kept on this device only ("bt.device"); with none
// kept, the guess is made again at each start, so a better guess in a later version reaches everyone. It goes
// nowhere but the person's own Dropbox and backup files.
let DEVICE_OWN = "";
const deviceGuessed = () => deviceGuess(navigator.userAgent, isStandalone(), navigator.maxTouchPoints || 0);
const deviceName = () => DEVICE_OWN || deviceGuessed();
function loadDevice() { DEVICE_OWN = deviceClean(store.get("bt.device") || ""); setDevice(deviceName()); }
// The person's own name for it; empty, or the guess itself, goes back to the guess. → the name in use.
function nameDevice(name) {
  DEVICE_OWN = deviceClean(name); if (DEVICE_OWN === deviceGuessed()) DEVICE_OWN = "";
  if (DEVICE_OWN) store.set("bt.device", DEVICE_OWN); else store.del("bt.device");
  return setDevice(deviceName());
}
loadDevice();   // before anything can change the collection: the first open's move is a change too
// Settings, under Dropbox sync while it is connected (a name is only ever read on another device). A panel of its
// own, so a sync that redraws the one above leaves the field alone while it is being typed in.
function deviceSetHTML() {
  return `<div class="field"><label for="device-name">This device is called</label><input type="text" id="device-name" maxlength="${DEVICE_MAX}" autocomplete="off" spellcheck="false" enterkeyhint="done" value="${esc(deviceName())}"></div>
    <p class="muted small">Your other devices show this name beside the changes made here, from now on. Leave it empty to go back to ${esc(deviceGuessed())}.</p>`;
}
document.addEventListener("change", e => {
  if (e.target.id !== "device-name") return;
  const was = deviceName(), now = nameDevice(e.target.value);
  e.target.value = now;
  if (now !== was) toast(`This device is called ${now}`);
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "device-name") e.target.blur(); });

// ------------------------------------------------------------ the collection in Dropbox (0.93.0: step 4, piece d)
// The record travels in a file of its own (REC_PATH): engine packRec as JSON, gzipped where the browser can (Matt's
// collection is about 1 MB as plain data, and every change sends it whole; a file that isn't gzipped is read too).
// A sync reads the file when it isn't the one this device last saw, asks the engine what the two make (mergeRecs:
// this device's record and the shared file) and does it; then this device's record goes up unless the file holds
// just that. A write that finds the file changed meanwhile starts over, as for builds. What is remembered, in
// DBX.state: `revs.rec` and `sigs.rec` (the file and the record as they last agreed), `recMet` (this device's
// record and the file have been put together once: until then, and after anything that makes the collection here
// one the file may not know, recForeign, the file is always read first), `recForce` (the person chose this
// device's collection over the file's: it goes up as it is).
//   one side has news       taken as it is; what came is said, and listed "On another device" (changes.js CAME)
//   both have               merged; said, with how many changes weren't made
//   no change in common     (`whole`) the same cards: the one changed later, quietly. Different cards and never
//                           put together: **asked, two buttons** (Matt, Nov 14, call 2: taking the newer by itself
//                           would let a fresh import on a new device replace the one in Dropbox). Put together
//                           before (away longer than changes are kept, or a backup restored elsewhere): the one
//                           changed most recently wins whole (Nov 13)
// **Whichever collection loses whole is offered once as a file, on the device that sees it happen** (call 1): kept
// in the browser ("lost" in IndexedDB) until the person saves it or says no.
const REC_PATH = "/record.json.gz", REC_FORMAT = "bulk-tutor-record";
const recSig = rec => (rec ? [rec.changes.length, rec.forgot.length, rec.changes.length ? rec.changes[rec.changes.length - 1].id : "", rec.lines.size, recCount(rec)].join(".") : "");
// A record with no card and no change in it yet (0.101.0: the welcome's "Start with a deck you've built") counts as no
// collection: it is neither sent, nor asked about when Dropbox holds one, which then simply arrives.
const myRec = () => (REC && ownColl() && (REC.lines.size || REC.changes.length) ? REC : null);
// The collection here is no longer known to descend from the file (removed, started again, a backup taken).
function recForeign() { if (DBX.state && DBX.state.recMet) { DBX.state.recMet = false; dbxSave(); } }
async function gzip(text) {
  if (typeof CompressionStream !== "function") return new TextEncoder().encode(text);
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}
async function gunzip(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return new TextDecoder().decode(b);
  if (typeof DecompressionStream !== "function") throw new Error("gzip");
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
async function dbxDownloadBytes(path) {
  const res = await dbxFetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { "Dropbox-API-Arg": dbxArg({ path }) } });
  if (!res.ok) throw new DbxError("download " + res.status, "http", res.status);
  return res.arrayBuffer();
}
// → the file's record, or null when this version can't read it (a newer version's, or not ours): it is then left
// alone, and Settings says so.
async function dbxReadRec() {
  try {
    const j = JSON.parse(await gunzip(await dbxDownloadBytes(REC_PATH)));
    DBX.recBy = deviceClean(j && j.by);   // the device that wrote the file last (0.94.0)
    return j && j.format === REC_FORMAT && j.v === 1 && j.rec ? unpackRec(j.rec) : null;
  } catch (e) { if (e instanceof DbxError) throw e; return null; }
}
// The record becomes `rec` because a sync says so: forgotten again by this device's choice (the shared file may
// list what this device had forgotten), kept, shown.
function recTake(rec) {
  REC = rec; trimChanges(REC, CHDAYS.days);
  const was = applyingRemote; applyingRemote = true;
  try { recChanged(); } finally { applyingRemote = was; }
}
// Step 1 of a sync for the collection. → what to say (the notice's words), if anything.
async function recFromDropbox(rf, st) {
  DBX.recBad = false;
  if (!rf) return "";
  const mine = myRec();
  if (DBX.ask && DBX.ask.rev === rf.rev && mine) return "";              // still waiting on the person's answer
  DBX.ask = null;
  if (st.recForce && mine) return "";                                    // their choice: this device's goes up as it is
  if (rf.rev === st.revs.rec && (st.recMet || !mine)) return "";        // nothing new there (a collection removed here stays removed)
  const theirs = await dbxReadRec(); dbxHold();
  if (!theirs) { DBX.recBad = true; return ""; }
  const m = mergeRecs(mine, theirs);
  if (m.whole && !m.same && !st.recMet) { DBX.ask = { theirs, rev: rf.rev, take: m.take, by: DBX.recBy || changeDev(recLast(theirs)) }; openSyncAsk(); return ""; }
  // Put together before, and nothing in common now: the one changed most recently, whole; the other is offered.
  if (m.whole && !m.same) await offerLost(m.take === "theirs" ? mine : theirs, m.take === "theirs" ? "here" : "dropbox", m.rec.changes.some(c => c.how.by === "restore") ? "restore" : "away", m.rec);
  st.revs.rec = rf.rev; st.recMet = true;
  if (m.take === "mine") { st.sigs.rec = ""; return ""; }
  if (m.take === "theirs") {
    recTake(theirs); st.sigs.rec = recSig(REC);
    if (m.whole || !mine) { cameBy([], 0, "dropbox"); return mine ? "" : `Your collection came from Dropbox: ${cardsWord(recCount(REC))}`; }
    cameBy(m.came || [], (m.came || []).reduce((t, c) => Math.max(t, Date.parse(c.at) || 0), 0));
    // What this device did and the other one, merging, couldn't make: this device's own changes, come back as marks or made in part.
    const was = new Map(mine.changes.map(c => [c.id, c])), short = theirs.changes.filter(c => { const o = was.get(c.id); return o && !isLeft(o) && (isLeft(c) || (c.how.left || 0) > (o.how.left || 0)); });
    return (m.came || []).length || short.length ? mergedWords({ ...m, sent: short }) : "";
  }
  recTake(m.rec); st.sigs.rec = "";
  cameBy(m.came, m.theirsAt);
  return mergedWords(m);
}
// Step 3 for the collection: this device's record goes up unless the file holds just that. → false on a conflict.
async function recToDropbox(rf, st, written) {
  const mine = myRec();
  if (!mine || DBX.ask || DBX.recBad || (rf && !st.recForce && recSig(mine) === st.sigs.rec)) return true;
  const body = await gzip(JSON.stringify({ format: REC_FORMAT, v: 1, app: APP_VERSION, written, by: deviceName(), rec: packRec(mine) }));
  const meta = await dbxUpload(REC_PATH, body, rf ? rf.rev : null);
  if (!meta) return false;
  st.revs.rec = meta.rev; st.sigs.rec = recSig(mine); st.recMet = true; st.recForce = false;   // (`mine` is the record as it was sent, whatever is on the screen by now)
  return true;
}

// ---- A collection that lost whole, offered once as a file. LOST = {rec (packed), where ("here" | "dropbox": which
// one it was), why ("away" | "restore" | "chosen"), was (its cards and when it last changed, in words), kept (the
// same of the collection that took its place), dev (the device the kept one was last changed on, when it came from
// Dropbox and says)}; kept in IndexedDB too, so the one offer outlives a reload.
// `kept` is said when the offer is made, not read from REC when the sheet is drawn: the sheet opens before the
// collection from Dropbox is taken (0.93.0 gave the replaced collection's time as the kept one's: Matt's phone,
// Nov 15), and a change made before a reload would move the time again.
let LOST = null;
async function offerLost(rec, where, why, keptRec) {
  if (!rec) return;
  LOST = { rec: packRec(rec), where, why, was: recWords(rec), kept: keptRec ? recWords(keptRec) : "", dev: keptRec && where === "here" ? changeDev(recLast(keptRec)) : "" };
  await idbPut("lost", LOST);
  openSyncAsk();
}
function lostDone(save) {
  if (LOST && save) downloadFile(`bulk-tutor-collection-replaced-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: new Date().toISOString(), record: LOST.rec }));
  LOST = null; idbDel("lost"); renderSyncAsk();
}
// ---- The sheet (#syncask): the question when two devices never met (DBX.ask), then or else the offer (LOST).
// The filled button is the collection changed later (what "the newer wins" would have taken). "Decide later"
// leaves the collection unsynced on this device, which Settings says, and builds and decks go on syncing.
function syncAskHTML() {
  if (DBX.ask && myRec()) {
    const a = DBX.ask, opt = (act, label, rec, on) => `<div class="import-opt"><button class="btn${on ? " primary" : ""}" data-syncask="${act}">${label}</button><p class="muted small">${esc(recWords(rec))}</p></div>`;
    return `<div class="sync-ask" id="sync-which"><h2 id="syncask-title" tabindex="-1" autofocus>Which collection is yours?</h2>
      <p class="small">${a.by ? `Dropbox already holds a collection, put there by ${esc(a.by)}. It isn't the same as the one here.` : "Dropbox already holds a collection from another device, and it isn't the same as the one here."} The two have never synced, so they can't be merged change by change.</p>
      ${opt("dropbox", "Use the collection in Dropbox", a.theirs, a.take === "theirs")}${opt("here", "Use this device's", REC, a.take !== "theirs")}
      <p class="muted small">The other one is offered to you as a backup file. Your decks and settings sync either way.</p>
      <div class="actions"><button class="btn link" data-syncask="later">Decide later</button></div></div>`;
  }
  if (LOST) {
    const here = LOST.where === "here", cur = myRec(), kept = LOST.kept || (cur ? recWords(cur) : "");
    const head = here ? "The collection in Dropbox replaced the one here" : "This device's collection replaced the one in Dropbox";
    const why = LOST.why === "chosen" ? `You chose ${here ? "the collection in Dropbox" : "this device's collection"}${kept ? `: ${kept}` : ""}.`
      : LOST.why === "restore" ? `A backup was restored ${here ? `on ${LOST.dev || "another device"}` : "here"}, and its collection takes the place of the one ${here ? "here" : "in Dropbox"}.`
      : `The collection in Dropbox and the one on this device have no changes in common, so they couldn't be merged change by change. That happens when another device put its own collection in Dropbox, or when this device hasn't synced for longer than changes are kept (${chDaysWords()}). The one changed most recently is kept, ${here ? "Dropbox's" : "this device's"}${kept ? `: ${kept}` : ""}.`;
    return `<div class="sync-ask" id="sync-lost"><h2 id="syncask-title" tabindex="-1" autofocus>${head}</h2>
      <p class="small">${esc(why)}</p>
      <p class="small"><strong>The collection that was ${here ? "here" : "in Dropbox"}</strong> can be saved as a backup file: ${esc(LOST.was)}. This is the only time it is offered.</p>
      <div class="sheet-pair"><button class="btn" data-syncask="nosave">Don't save it</button><button class="btn primary" data-syncask="save">Save it as a file</button></div></div>`;
  }
  return "";
}
function renderSyncAsk() {
  const dlg = $("#syncask"), body = $("#syncask-body"); if (!dlg || !body) return;
  const h = syncAskHTML();
  body.innerHTML = h;
  if (!h) closeDlg(dlg);
  renderSyncBits();
}
function openSyncAsk() { renderSyncAsk(); const dlg = $("#syncask"); if (dlg && $("#syncask-body").innerHTML) openDlg(dlg); }
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-syncask]"); if (!t) return;
  const act = t.dataset.syncask, a = DBX.ask, st = DBX.state;
  if (act === "open") { openSyncAsk(); return; }
  if (act === "save" || act === "nosave") { lostDone(act === "save"); return; }
  if (act === "later" || !a || !st || visiting()) { closeDlg($("#syncask")); renderSyncBits(); return; }
  DBX.ask = null;
  if (act === "dropbox") {
    const mine = myRec();
    st.revs.rec = a.rev; st.recMet = true; recTake(a.theirs); st.sigs.rec = recSig(REC); cameBy([], 0, "dropbox"); dbxSave();
    offerLost(mine, "here", "chosen", a.theirs);
  } else {
    st.recForce = true; dbxSave();
    offerLost(a.theirs, "dropbox", "chosen", myRec());
    dbxSync();
  }
});

let dbxBusy = false, dbxAgain = false, dbxTimer = null, dbxRetry = null, dbxWarned = false;
// **No sync while the example is looked at** (0.106.0; decks.js, the visit). A sync asks what is on the screen
// whether there is a collection here (myRec, ownColl, import.js ownHere), and the example says no: it would take
// Dropbox's record whole over yours, or a CSV in the folder as a first import onto a new record. So none starts
// (syncSoon, dbxSync), and one under way when the visit begins stops at the next step that would read or change
// anything here (dbxHold, after each wait), as a sync that lost its connection stops. Leaving the visit syncs.
function dbxHold() { if (visiting()) throw new DbxError("paused", "paused"); }
function syncSoon(delay = 4000) {
  if (applyingRemote || !dbxConnected() || visiting()) return;
  clearTimeout(dbxTimer); dbxTimer = setTimeout(() => dbxSync(), delay);
}
async function dbxSync() {
  if (!dbxConnected() || visiting()) return;
  if (dbxBusy) { dbxAgain = true; return; }
  dbxBusy = true; clearTimeout(dbxTimer); clearTimeout(dbxRetry);
  DBX.status = "syncing"; DBX.error = ""; renderSyncBits();
  const st = DBX.state; st.revs = st.revs || {}; st.sigs = st.sigs || {};
  const applied = { builds: 0 }; let recSays = "";
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const files = await dbxList(); dbxHold();
      // 1. Bring in whatever another device changed.
      for (const part of DBX_PARTS) {
        const f = files.find(x => (x.path_lower || "") === part.path);
        part.file = f || null;
        part.old = !f && part.oldPath ? files.find(x => (x.path_lower || "") === part.oldPath) || null : null;
        if (part.old) {   // only the file from before the rename: take it in; step 3 writes the new one
          const before = JSON.parse(await dbxDownload(part.oldPath)); dbxHold();
          const r = applyDoc(before);
          applied.builds += r.builds;
          continue;
        }
        if (f && f.rev !== st.revs[part.name]) {
          const remote = JSON.parse(await dbxDownload(part.path)); dbxHold();
          const r = applyDoc(remote, true);
          applied.builds += r.builds;
          st.revs[part.name] = f.rev; st.sigs[part.name] = part.sig(remote);
        }
      }
      // 1b. The collection, from its own file.
      const rf = files.find(x => (x.path_lower || "") === REC_PATH) || null;
      recSays = (await recFromDropbox(rf, st)) || recSays; dbxHold();
      // 2. A new ManaBox export in the folder?
      await dbxPickCsv(files); dbxHold();
      // 3. Send up what changed here.
      const doc = fullDoc(); let conflict = false;
      for (const part of DBX_PARTS) {
        if (part.file && part.sig(doc) === st.sigs[part.name]) continue;
        const body = { format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: doc.written };
        for (const k of part.keys) body[k] = doc[k];
        const meta = await dbxUpload(part.path, JSON.stringify(body), part.file ? part.file.rev : null);   // (what was read above goes up whole, visit or not: it is yours as it stood)
        if (!meta) { conflict = true; break; }
        st.revs[part.name] = meta.rev; st.sigs[part.name] = part.sig(doc);
        if (part.old) { await dbxRpc("files/delete_v2", { path: part.oldPath }).catch(() => {}); part.old = null; }
      }
      dbxHold();   // the record is read from here on (recToDropbox would read "none here" from the example and skip it)
      if (!conflict && !(await recToDropbox(rf, st, doc.written))) conflict = true;
      if (!conflict) break;
      if (attempt === 3) throw new DbxError("conflict", "busy");
    }
    st.synced = Date.now(); DBX.status = "idle"; dbxWarned = false;
    const what = describeApplied(applied);
    if (recSays && CAME.fresh) toast(recSays, "See changes", () => openChanges(), 12000);   // what came is listed: a tap away
    else if (recSays) toast(recSays, null, null, 6000);
    else if (what) toast(`Updated ${what} from Dropbox`);
  } catch (e) {
    const kind = e && e.kind;
    if (kind === "paused") { DBX.status = "idle"; return; }   // a visit to the example began: nothing is wrong, and leaving it syncs (finally still runs)
    DBX.status = "error";
    DBX.error = kind === "network" ? "Couldn't reach Dropbox. It'll try again when you're back online."
      : kind === "auth" ? "Dropbox signed this device out. Connect again to keep syncing."
      : kind === "busy" ? "Dropbox is busy right now. It'll try again in a minute."
      : kind === "full" ? "Your Dropbox is full, so changes can't be saved there."
      : `Couldn't sync with Dropbox${e && e.status ? ` (error ${e.status})` : ""}. It'll try again in a minute.`;
    if (kind === "auth") { DBX.state = { name: st.name, email: st.email, lost: true }; }
    else dbxRetry = setTimeout(() => { if (document.visibilityState === "visible") dbxSync(); }, 60e3);
    if (!dbxWarned) { dbxWarned = true; toast(DBX.error); }
  } finally {
    dbxSave(); dbxBusy = false; renderSyncBits();
    if (dbxAgain) { dbxAgain = false; syncSoon(300); }
  }
}
async function dbxDisconnect() {
  const s = DBX.state;
  if (s && s.access) { try { await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: "Bearer " + s.access } }); } catch {} }
  DBX.state = null; DBX.status = "idle"; DBX.error = ""; DBX.confirmOff = false; dbxSave(); renderSyncBits();
  store.del("bt.collbase");   // from before 0.88.0
  toast("Dropbox disconnected on this device");
}
async function dbxBoot() {
  await loadConfig();
  dbxLoad();
  syncChrome();   // the welcome's Dropbox line waits on the config
  if (dbxAvailable()) dbxPrepare();
  const backTo = await dbxFinishConnect();
  if (backTo && backTo !== view && !["deck", "browse"].includes(backTo)) showView(backTo);
  renderSyncBits();
  renderBanners();
  if (DBX.awaitingCode && !dbxConnected()) openDbxCode();   // back from Dropbox with the page reloaded (0.101.3)
  idbGet("lost").then(r => { if (r.ok && r.value && r.value.rec) { LOST = r.value; openSyncAsk(); } });   // offered once: still open after a reload
  if (dbxConnected()) dbxSync();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && dbxConnected() && Date.now() - ((DBX.state && DBX.state.synced) || 0) > 20e3) dbxSync();
});
window.addEventListener("online", () => { if (dbxConnected()) dbxSync(); });
setInterval(() => { if (document.visibilityState === "visible" && dbxConnected() && !dbxBusy) dbxSync(); }, 3 * 60e3);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return shortDate(ts);
}
function syncLineHTML(withButton = true) {
  if (!dbxConnected() && !(DBX.state && DBX.state.lost)) return "";
  const s = DBX.state || {};
  const text = DBX.status === "syncing" ? "Syncing with Dropbox…" : DBX.status === "error" ? DBX.error
    : s.synced ? `Synced with Dropbox ${ago(s.synced)}` : "Connected to Dropbox";
  return `<div class="sync-line ${DBX.status === "error" ? "bad" : ""}"><span class="dot"></span><span>${esc(text)}</span>${withButton && dbxConnected() ? `<button class="btn link" data-dbx="sync"${DBX.status === "syncing" ? " disabled" : ""}>Sync now</button>` : ""}</div>`;
}
// The Collection summary's chip: Dropbox's state in a few words; tapping it opens Settings.
function syncChipHTML() {
  if ((!dbxConnected() && !(DBX.state && DBX.state.lost)) || visiting()) return "";   // (the example isn't synced: nothing to say beside it)
  const s = DBX.state || {}, bad = DBX.status === "error";
  const what = DBX.status === "syncing" ? "syncing" : bad ? "not synced" : s.synced ? `synced ${ago(s.synced)}` : "connected", text = `Dropbox · ${what}`;
  // Beside "Your collection" on a narrow phone the chip drops "Dropbox ·" (0.105.3; styles.css, .sync-short).
  return `<button class="sync-chip sync-line${bad ? " bad" : ""}" data-sync-goto title="${esc(bad ? DBX.error : text)}" aria-label="${esc(text)}"><span class="dot"></span><span class="sync-long">${esc(text)}</span><span class="sync-short" aria-hidden="true">${esc(what[0].toUpperCase() + what.slice(1))}</span></button>`;
}
// Under Settings while the collection waits on the person (the two-button question put off) or can't be read.
function syncCollNote() {
  if (DBX.ask && myRec()) return `<p class="small" id="sync-coll-ask"><strong>Your collection isn't syncing yet.</strong> ${DBX.ask.by ? `Dropbox holds a different one, put there by ${esc(DBX.ask.by)}.` : "Dropbox holds a different one from another device."} <button class="btn link" data-syncask="open">Choose which to keep</button></p>`;
  if (DBX.recBad) return `<p class="small warn-text" id="sync-coll-bad">The collection in Dropbox can't be read by this version of Bulk Tutor, so it is left alone and your collection isn't syncing on this device. Reload to get the latest version.</p>`;
  return "";
}
function syncPanelHTML() {
  const s = DBX.state || {};
  let dbx = "";
  if (dbxAvailable()) {
    if (dbxConnected()) {
      dbx = `<p><strong>Syncing with Dropbox</strong>${s.name ? ` as ${esc(s.name)}` : ""}${s.email ? ` <span class="muted small">(${esc(s.email)})</span>` : ""}. Your collection, decks and settings stay the same on every device you connect.</p>
        ${syncCollNote()}${visiting() ? `<div class="banner info" id="sync-paused"><span>Syncing waits while you look at the example, and catches up when you're back on your own collection.</span></div>` : ""}
        ${syncLineHTML(false)}
        <p class="muted small">Tip: save a ManaBox export into <strong>Dropbox › Apps › ${esc(CONFIG.dropboxFolder || "Bulk Tutor")}</strong> and each device takes it in the next time it syncs.</p>
        <div class="actions" id="dbx-off-zone">${DBX.confirmOff
          ? `<span class="small">Stop syncing on this device? Your data stays here and in Dropbox.</span><button class="btn danger" data-dbx="off-yes">Disconnect</button><button class="btn" data-dbx="off-no">Keep syncing</button>`
          : `<button class="btn" data-dbx="sync"${DBX.status === "syncing" || visiting() ? " disabled" : ""}>Sync now</button><button class="btn" data-dbx="off">Disconnect</button>`}</div>`;
    } else if (DBX.awaitingCode) {
      dbx = `<p><strong>Finish connecting Dropbox.</strong> Dropbox opened in a new window. Sign in, tap <strong>Allow</strong>, then copy the code it shows and paste it here.</p>
        ${dbxCodeHTML("dbx-code")}`;
    } else {
      dbx = `${s.lost ? `<p class="small warn-text">${esc(DBX.error || "Dropbox signed this device out.")}</p>` : ""}
        <p>Keep your collection, decks and settings the same on all your devices with <strong>your own Dropbox</strong>. Bulk Tutor only gets its own folder (Apps › ${esc(CONFIG.dropboxFolder || "Bulk Tutor")}), and your data goes straight from this browser to your Dropbox.</p>
        <div class="actions"><button class="btn primary" data-dbx="connect">Connect Dropbox</button>${dbxPreferCode() ? "" : `<button class="btn link" data-dbx="connect-code">Connect with a code instead</button>`}</div>`;
    }
  } else if (dbxKey() && isFramed) {
    dbx = `<p class="muted small">Dropbox sync works when Bulk Tutor is opened at its own address, not inside this preview.</p>`;
  }
  return dbx;
}
function backupPanelHTML() {
  return `<p class="small">A backup file holds your collection, decks and settings. Restoring one merges it with what's here, keeping the newer copy of each.</p>
    <div class="sheet-pair"><button class="btn" data-dbx="backup" aria-label="Download backup">Download</button><button class="btn" data-dbx="restore" aria-label="Restore from backup">Restore</button></div>
    <input type="file" id="restore-file" accept=".json,application/json" hidden>${restoreAskHTML()}${beforeHTML()}${decksBeforeHTML()}`;
}
// The copy from before the move (record.js): while it is in this browser, it can be downloaded (as a backup file that
// holds only that collection, which Restore reads) or made the collection again. BEFORE_ASK: the second is asked first.
let BEFORE_ASK = false;
function beforeHTML() {
  const mv = movedInfo(), old = (mv || MOVE_FAILED) && oldCollection(); if (!old) return "";
  // The move failed (record.js MOVE_FAILED): the old copy can still be downloaded, to be sent with a report.
  if (!mv) return `<div id="before-copy"><h4 class="subhead">The copy from before</h4>
    <p class="small">Your collection as earlier versions kept it is still in this browser: ${cardsWord(countsOf(old.entries).cards)}.</p>
    <div class="actions" id="before-zone"><button class="btn" data-before="download">Download the copy from before</button></div></div>`;
  return `<div id="before-copy"><h4 class="subhead">The copy from before</h4>
    <p class="small">Bulk Tutor began keeping your collection in a new way on ${esc(shortDate(Date.parse(mv.at)))}. Your collection as it was until then is still in this browser: ${cardsWord(mv.before.cards)}.</p>
    ${BEFORE_ASK ? `<div class="actions" id="before-zone"><span class="small">Start again from the copy from before? Your collection goes back to how it was then, and what you have done to it since is forgotten.</span><button class="btn danger" data-before="again-yes">Start again</button><button class="btn" data-before="again-no">Keep it</button></div>`
      : `<div class="sheet-pair" id="before-zone"><button class="btn" data-before="download">Download the copy from before</button><button class="btn" data-before="again">Start again from it</button></div>`}</div>`;
}
function downloadBefore() {
  const old = oldCollection(), mv = movedInfo(); if (!old) return;
  downloadFile(`bulk-tutor-collection-before-${(mv ? mv.at : new Date().toISOString()).slice(0, 10)}.json`, JSON.stringify({ format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: new Date().toISOString(), collection: old }));
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-before]"); if (!t) return;
  const act = t.dataset.before;
  if (act === "download") { downloadBefore(); return; }
  BEFORE_ASK = act === "again";
  if (act === "again-yes") startAgain(); else renderSettings();
});
// The builds and saved decks from before the decks' move (decks.js): while they are in this browser they can be
// downloaded (as a backup file, which Restore reads as it reads any backup from before 0.95.0) or made your decks
// again. DECKS_BEFORE_ASK: the second is asked first.
let DECKS_BEFORE_ASK = false;
function decksBeforeHTML() {
  const mv = decksMovedInfo(), old = (mv || DECKS_HOLD) && oldLists(); if (!old || !(old.builds.length + old.saved.length)) return "";
  const what = [old.builds.length ? `${old.builds.length} build${old.builds.length === 1 ? "" : "s"}` : "", old.saved.length ? `${old.saved.length} saved deck${old.saved.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  // The move failed (decks.js DECKS_HOLD): the lists can still be downloaded, to be sent with a report.
  if (!mv) return `<div id="decks-before"><h4 class="subhead">Your builds and saved decks from before</h4>
    <p class="small">Your lists as earlier versions kept them are still in this browser: ${what}.</p>
    <div class="actions" id="decks-before-zone"><button class="btn" data-decks-before="download">Download the lists from before</button></div></div>`;
  return `<div id="decks-before"><h4 class="subhead">Your builds and saved decks from before</h4>
    <p class="small">Bulk Tutor made your builds, saved decks and deck boxes one list of decks on ${esc(shortDate(Date.parse(mv.at)))}. The lists as they were until then are still in this browser: ${what}.</p>
    ${DECKS_BEFORE_ASK ? `<div class="actions" id="decks-before-zone"><span class="small">Start again from the lists from before? Your decks go back to how they were brought over then, and what you have done to them since is forgotten.</span><button class="btn danger" data-decks-before="again-yes">Start again</button><button class="btn" data-decks-before="again-no">Keep them</button></div>`
      : `<div class="sheet-pair" id="decks-before-zone"><button class="btn" data-decks-before="download">Download the lists from before</button><button class="btn" data-decks-before="again">Start again from them</button></div>`}</div>`;
}
function downloadDecksBefore() {
  const old = oldLists(), mv = decksMovedInfo(); if (!old) return;
  downloadFile(`bulk-tutor-decks-before-${(mv ? mv.at : new Date().toISOString()).slice(0, 10)}.json`, JSON.stringify({ format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: new Date().toISOString(), builds: old.builds, saved: old.saved, locStyle: { decks: LOCSTYLE.decks } }));
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-decks-before]"); if (!t) return;
  const act = t.dataset.decksBefore;
  if (act === "download") { downloadDecksBefore(); return; }
  DECKS_BEFORE_ASK = act === "again";
  if (act === "again-yes") decksAgain();
  renderSettings();
});
function renderSyncBits() {
  const line = $("#sync-line-slot"); if (line) line.innerHTML = syncChipHTML();
  const panel = $("#sync-panel"); if (panel) { const h = syncPanelHTML(); panel.innerHTML = h; panel.closest(".set-group").hidden = !h; }
  const dev = $("#device-set"); if (dev) dev.hidden = !dbxConnected();
  dbxCodeTidy();
  if (showHomeScreenSyncHint() !== !!$("#banners [data-hs-dismiss]")) renderBanners();
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-dbx]"); if (!t) return;
  switch (t.dataset.dbx) {
    case "connect": dbxConnect(); break;
    case "connect-code": case "code-again": DBX.codeError = ""; dbxConnect("code"); break;
    case "code-go": { const box = t.closest("[data-dbx-codebox]"), input = box && box.querySelector("input"); DBX.codeError = ""; dbxFinishWithCode(input ? input.value : ""); break; }
    case "code-cancel": DBX.awaitingCode = false; DBX.codeError = ""; store.del("bt.dbx-pkce"); renderSyncBits(); break;
    case "sync": dbxSync(); break;
    case "off": DBX.confirmOff = true; renderSyncBits(); break;
    case "off-no": DBX.confirmOff = false; renderSyncBits(); break;
    case "off-yes": dbxDisconnect(); break;
    case "backup": downloadBackup(); break;
    case "restore": { const f = $("#restore-file"); if (f) f.click(); break; }
  }
});
document.addEventListener("change", async e => {
  if (e.target.id !== "restore-file") return;
  const f = e.target.files[0]; if (f) restoreBackup(await f.text(), f.name); e.target.value = "";
});

"use strict";
// Bulk Tutor, the page's script, part "sync": sync: the backup file and Dropbox.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ sync: backup file and Dropbox
// Everything worth keeping (collection, builds, saved decks) can travel as one document: a backup
// file you download, or a file in the person's own Dropbox app folder (builds.json). Builds and saved
// decks carry their own timestamps, so merging keeps the newer copy of each; deletions are remembered
// as tombstones (bb.tomb) so a deleted build doesn't come back from another device. Data goes from the
// browser straight to Dropbox; there's no server of ours in between, and the page holds only Dropbox's
// public app key (PKCE, no secret).
// **The collection doesn't sync between pieces (b) and (d) of step 4** (0.88.0; Matt agreed, Nov 13): it is the
// record now (record.js), Dropbox's collection.json holds the form from before and is never read or changed
// again ("Dropbox starts clean"), and piece (d) puts the record in new files and merges two devices change by
// change. Until then a backup file carries the collection: the record, as `record`.
const SYNC_FORMAT = "bulk-tutor-sync";
const OLD_SYNC_FORMAT = "binder-brew-sync";   // backups and Dropbox files from before the rename; still read
const TOMB_DAYS = 180;
let CONFIG = {};               // site/config.json, written by the workflow: { dropboxAppKey }
let TOMB = {};                 // "b:<id>" | "d:<id>" -> deleted at (ms)
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
  knownIds.b = new Set(BUILDS.map(x => x.id)); knownIds.d = new Set(SAVED.map(x => x.id)); knownIds.t = new Set(TEMPLATES.map(x => x.id)); knownIds.v = new Set(VIEWS.map(x => x.id));
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
// Called whenever builds or saved decks are saved: an id that vanished was deleted on this device.
function trackDeletions(kind, items) {
  const ids = new Set(items.map(x => x.id)); let changed = false;
  for (const id of knownIds[kind]) if (!ids.has(id) && !TOMB[kind + ":" + id]) { TOMB[kind + ":" + id] = Date.now(); changed = true; }
  knownIds[kind] = ids;
  if (changed) saveTomb();
  return changed;
}

function fullDoc() {
  return { format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: new Date().toISOString(),
    record: ownColl() && REC ? packRec(REC) : null, csv: CSV_DONE, builds: BUILDS, saved: SAVED, templates: TEMPLATES, views: VIEWS, deleted: TOMB, prefs: PREFS, locStyle: LOCSTYLE, buy: BUY, tokens: TOKOWN, rules: RULES, history: CHDAYS };
}

// What a merged sync says (Matt, Nov 12: "might be worth notifying the user that's happening"; not called between
// pieces (b) and (d) of step 4, while the collection doesn't sync: (d) says it again from the changes): that both
// devices' changes are kept, what came in from the other one and when it last changed, and whether any change lost to a later
// one. The stamps are UTC; the time is shown in this device's own time zone (his point, Nov 12), with the day when
// it wasn't today.
function whenWords(ms) {
  const d = new Date(ms), now = new Date(), time = { hour: "numeric", minute: "2-digit" };
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, time) : d.toLocaleString(undefined, { month: "short", day: "numeric", ...time });
}
function mergedWords(m) {
  const n = (k, one, many) => (k ? `${k.toLocaleString()} ${k === 1 ? one : many}` : ""), c = m.came;
  const came = [n(c.moved, "card moved", "cards moved"), n(c.added, "added", "added"), n(c.removed, "removed", "removed"), n(c.back, "put back", "put back")].filter(Boolean).join(", ");
  return `Your collection was changed on two devices, and both sets of changes are kept.${came ? ` From the other device${m.theirsAt ? ` (last changed ${whenWords(m.theirsAt)})` : ""}: ${came}.` : ""}${m.record ? ` The newer import is your collection, and what was ${m.whole === "theirs" ? "done here" : "done on the other device"} since was made again on it.` : ""}${m.dropped ? ` ${m.dropped === 1 ? "1 change" : `${m.dropped} changes`} touched the same cards on both, so the later one stands.` : ""}`;
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
// `sync`: the document is Dropbox's (not a backup file), which carries no collection for now. A backup file's
// collection wins or loses whole, by when it last changed: the record (`record`, since 0.88.0), or a backup from
// before in the old shape (`collection`), brought over the way the first open brings the browser's own.
function applyDoc(doc, sync = false) {
  if (!doc || (doc.format !== SYNC_FORMAT && doc.format !== OLD_SYNC_FORMAT)) throw new Error("This isn't a Bulk Tutor backup.");
  if (!doc.builds && Array.isArray(doc.brews)) doc = { ...doc, builds: doc.brews };
  const r = { builds: 0, saved: 0, collection: false };
  let redrawn = false;
  applyingRemote = true;
  try {
    const cut = Date.now() - TOMB_DAYS * 864e5;
    let tombChanged = false;
    for (const [k, t] of Object.entries(doc.deleted || {})) if (t >= cut && !(TOMB[k] >= t)) { TOMB[k] = t; tombChanged = true; }
    if (tombChanged) { oldTombs(); saveTomb(); }
    if (Array.isArray(doc.builds) || tombChanged) {
      const m = mergeList("b", BUILDS, doc.builds || []);
      if (m.changed) {
        BUILDS = m.list; r.builds = m.changed;
        if (!BUILDS.some(b => b.id === CUR)) { CUR = BUILDS.length ? BUILDS[0].id : null; if (!CUR) buildMode = "list"; }
        saveBuilds(true);
      }
    }
    if (Array.isArray(doc.saved) || tombChanged) {
      const m = mergeList("d", SAVED, doc.saved || []);
      if (m.changed) { SAVED = m.list; r.saved = m.changed; saveSaved(true); }
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
        if (!mine || (st.at || 0) > (mine.at || 0)) { LOCSTYLE[part][k] = st; if (part === "decks") marks++; else n++; }
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
      const theirs = doc.record && typeof doc.record === "object" ? unpackRec(doc.record) : doc.collection && Array.isArray(doc.collection.entries) ? convertCollection(doc.collection, [...MADE]) : null;
      if (theirs && (theirs.lines.size || theirs.changes.length) && recStamp(theirs) > (ownColl() && REC ? recStamp(REC) : -1)) { REC = theirs; recChanged(); checkBuiltLocs(); r.collection = true; }
    }
    // New marks for the collection that's already here: its cards' "in a deck" follows them.
    if (r.decks && !r.collection && COLL) { setCollection(COLL); redrawn = true; }
  } finally { applyingRemote = false; }
  if ((r.builds || r.saved || r.templates || r.views || r.looks || r.buy || r.tokens || r.rules || r.history) && !r.collection && !redrawn) renderAll();
  return r;
}
function describeApplied(r) {
  const parts = [r.collection ? "your collection" : "", r.builds ? `${r.builds} build${r.builds === 1 ? "" : "s"}` : "", r.saved ? `${r.saved} saved deck${r.saved === 1 ? "" : "s"}` : "", r.templates ? `${r.templates} template${r.templates === 1 ? "" : "s"}` : "", r.views ? `${r.views} view${r.views === 1 ? "" : "s"}` : "", r.looks ? "location icons" : "", r.decks ? "which locations are decks" : "", r.buy ? "your currency and price ranges" : "", r.tokens ? "the tokens you own" : "", r.rules ? "your filing rules" : "", r.history ? "how long changes are kept" : ""].filter(Boolean);
  return parts.length ? parts.join(", ").replace(/, ([^,]*)$/, " and $1") : "";
}

// ---- backup file
function downloadBackup() {
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  downloadFile(`bulk-tutor-backup-${stamp}.json`, JSON.stringify(fullDoc()));
}
function restoreBackup(text, label) {
  let doc;
  try { doc = JSON.parse(text); } catch { toast(`${label} isn't a Bulk Tutor backup`); return; }
  try {
    const r = applyDoc(doc), what = describeApplied(r);
    toast(what ? `Restored ${what} from the backup` : "Nothing new in that backup: everything here is the same or newer");
    syncSoon(500);
  } catch (e) { toast(e.message || "That backup couldn't be read"); }
}
const looksLikeBackup = text => /^\s*\{/.test(text) && text.includes(SYNC_FORMAT);

// ---- Dropbox
const DBX = { state: null, status: "idle", error: "", confirmOff: false };   // state is saved as bb.dbx
const DBX_PARTS = [   // /collection.json, the collection as it was kept before 0.88.0, is left where it is (above)
  { name: "builds", path: "/builds.json", oldPath: "/brews.json", keys: ["builds", "saved", "templates", "views", "deleted", "prefs", "locStyle", "buy", "tokens", "rules"], sig: d => stableJSON([byId(d.builds), byId(d.saved), d.deleted || {}, (d.prefs && d.prefs.cards) || {}, byId(d.templates), d.locStyle || {}, byId(d.views), d.buy || {}, d.tokens || {}, d.rules && d.rules.at ? d.rules : {}]) },
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
// Back from Dropbox's sign-in page with ?code= (or ?error=). Returns the view to reopen, or null.
async function dbxFinishConnect() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return null;
  let pk = null; try { pk = JSON.parse(store.get("bt.dbx-pkce") || "null"); } catch {}
  store.del("bt.dbx-pkce");
  try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
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
  const { entries, source, noLoc } = parseCollection(await dbxDownload(f.path_lower || f.path_display));
  mark();
  if (!entries.length) { toast(`${f.name} in Dropbox doesn't look like a collection export, so it was skipped`); return; }
  const t = takeFile({ entries, source, label: `${f.name} (Dropbox)`, importedAt: new Date().toISOString(), sig: entriesSig(entries), noLoc: !!noLoc }, "update");
  checkBuiltLocs();
  toast(`Imported ${f.name} from Dropbox: ${cardsWord(entryCount(entries))}`, "Undo", () => { if (t.own) recUndo(t.did.change && t.did.change.id); else removeCollection(); });
}

let dbxBusy = false, dbxAgain = false, dbxTimer = null, dbxRetry = null, dbxWarned = false;
function syncSoon(delay = 4000) {
  if (applyingRemote || !dbxConnected()) return;
  clearTimeout(dbxTimer); dbxTimer = setTimeout(() => dbxSync(), delay);
}
async function dbxSync() {
  if (!dbxConnected()) return;
  if (dbxBusy) { dbxAgain = true; return; }
  dbxBusy = true; clearTimeout(dbxTimer); clearTimeout(dbxRetry);
  DBX.status = "syncing"; DBX.error = ""; renderSyncBits();
  const st = DBX.state; st.revs = st.revs || {}; st.sigs = st.sigs || {};
  const applied = { builds: 0, saved: 0 };
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const files = await dbxList();
      // 1. Bring in whatever another device changed.
      for (const part of DBX_PARTS) {
        const f = files.find(x => (x.path_lower || "") === part.path);
        part.file = f || null;
        part.old = !f && part.oldPath ? files.find(x => (x.path_lower || "") === part.oldPath) || null : null;
        if (part.old) {   // only the file from before the rename: take it in; step 3 writes the new one
          const r = applyDoc(JSON.parse(await dbxDownload(part.oldPath)));
          applied.builds += r.builds; applied.saved += r.saved;
          continue;
        }
        if (f && f.rev !== st.revs[part.name]) {
          const remote = JSON.parse(await dbxDownload(part.path));
          const r = applyDoc(remote, true);
          applied.builds += r.builds; applied.saved += r.saved;
          st.revs[part.name] = f.rev; st.sigs[part.name] = part.sig(remote);
        }
      }
      // 2. A new ManaBox export in the folder?
      await dbxPickCsv(files);
      // 3. Send up what changed here.
      const doc = fullDoc(); let conflict = false;
      for (const part of DBX_PARTS) {
        if (part.file && part.sig(doc) === st.sigs[part.name]) continue;
        const body = { format: SYNC_FORMAT, version: 1, app: APP_VERSION, written: doc.written };
        for (const k of part.keys) body[k] = doc[k];
        const meta = await dbxUpload(part.path, JSON.stringify(body), part.file ? part.file.rev : null);
        if (!meta) { conflict = true; break; }
        st.revs[part.name] = meta.rev; st.sigs[part.name] = part.sig(doc);
        if (part.old) { await dbxRpc("files/delete_v2", { path: part.oldPath }).catch(() => {}); part.old = null; }
      }
      if (!conflict) break;
      if (attempt === 3) throw new DbxError("conflict", "busy");
    }
    st.synced = Date.now(); DBX.status = "idle"; dbxWarned = false;
    const what = describeApplied(applied);
    if (what) toast(`Updated ${what} from Dropbox`);
  } catch (e) {
    const kind = e && e.kind;
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
  if (dbxAvailable()) dbxPrepare();
  const backTo = await dbxFinishConnect();
  if (backTo && backTo !== view && !["deck", "browse"].includes(backTo)) showView(backTo);
  renderSyncBits();
  renderBanners();
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
  if (!dbxConnected() && !(DBX.state && DBX.state.lost)) return "";
  const s = DBX.state || {}, bad = DBX.status === "error";
  const text = DBX.status === "syncing" ? "Dropbox · syncing" : bad ? "Dropbox · not synced" : s.synced ? `Dropbox · synced ${ago(s.synced)}` : "Dropbox · connected";
  return `<button class="sync-chip sync-line${bad ? " bad" : ""}" data-sync-goto title="${esc(bad ? DBX.error : text)}"><span class="dot"></span><span>${esc(text)}</span></button>`;
}
// While the collection doesn't sync (above). Placeholder words: Matt sees them as a picture first.
const SYNC_COLL_NOTE = `<p class="small" id="sync-coll-note"><strong>Your collection isn't syncing for now.</strong> Bulk Tutor is changing how it keeps your collection, and until that is finished it stays on this device. A backup file carries it to another one.</p>`;
function syncPanelHTML() {
  const s = DBX.state || {};
  let dbx = "";
  if (dbxAvailable()) {
    if (dbxConnected()) {
      dbx = `<p><strong>Syncing with Dropbox</strong>${s.name ? ` as ${esc(s.name)}` : ""}${s.email ? ` <span class="muted small">(${esc(s.email)})</span>` : ""}. Your builds, saved decks and settings stay the same on every device you connect.</p>
        ${SYNC_COLL_NOTE}
        ${syncLineHTML(false)}
        <p class="muted small">Tip: save a ManaBox export into <strong>Dropbox › Apps › ${esc(CONFIG.dropboxFolder || "Bulk Tutor")}</strong> and each device takes it in the next time it syncs.</p>
        <div class="actions" id="dbx-off-zone">${DBX.confirmOff
          ? `<span class="small">Stop syncing on this device? Your data stays here and in Dropbox.</span><button class="btn danger" data-dbx="off-yes">Disconnect</button><button class="btn" data-dbx="off-no">Keep syncing</button>`
          : `<button class="btn" data-dbx="sync"${DBX.status === "syncing" ? " disabled" : ""}>Sync now</button><button class="btn" data-dbx="off">Disconnect</button>`}</div>`;
    } else if (DBX.awaitingCode) {
      dbx = `<p><strong>Finish connecting Dropbox.</strong> Dropbox opened in a new window. Sign in, tap <strong>Allow</strong>, then copy the code it shows and paste it here.</p>
        <div class="filter-row"><div class="field grow"><label for="dbx-code">Code from Dropbox</label><input type="text" id="dbx-code" autocomplete="off" autocapitalize="off" spellcheck="false"></div></div>
        ${DBX.codeError ? `<p class="small warn-text">${esc(DBX.codeError)}</p>` : ""}
        <div class="actions"><button class="btn primary" data-dbx="code-go">Finish connecting</button><button class="btn" data-dbx="code-again">Open Dropbox again</button><button class="btn" data-dbx="code-cancel">Cancel</button></div>`;
    } else {
      dbx = `${s.lost ? `<p class="small warn-text">${esc(DBX.error || "Dropbox signed this device out.")}</p>` : ""}
        <p>Keep your builds, saved decks and settings the same on all your devices with <strong>your own Dropbox</strong>. Bulk Tutor only gets its own folder (Apps › ${esc(CONFIG.dropboxFolder || "Bulk Tutor")}), and your data goes straight from this browser to your Dropbox.</p>
        ${SYNC_COLL_NOTE}
        <div class="actions"><button class="btn primary" data-dbx="connect">Connect Dropbox</button>${dbxPreferCode() ? "" : `<button class="btn link" data-dbx="connect-code">Connect with a code instead</button>`}</div>`;
    }
  } else if (dbxKey() && isFramed) {
    dbx = `<p class="muted small">Dropbox sync works when Bulk Tutor is opened at its own address, not inside this preview.</p>`;
  }
  return dbx;
}
function backupPanelHTML() {
  return `<p class="small">A backup file holds your collection, builds, saved decks and settings. Restoring one merges it with what's here, keeping the newer copy of each.</p>
    <div class="sheet-pair"><button class="btn" data-dbx="backup" aria-label="Download backup">Download</button><button class="btn" data-dbx="restore" aria-label="Restore from backup">Restore</button></div>
    <input type="file" id="restore-file" accept=".json,application/json" hidden>${beforeHTML()}`;
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
function renderSyncBits() {
  const line = $("#sync-line-slot"); if (line) line.innerHTML = syncChipHTML();
  const panel = $("#sync-panel"); if (panel) { const h = syncPanelHTML(); panel.innerHTML = h; panel.closest(".set-group").hidden = !h; }
  if (showHomeScreenSyncHint() !== !!$("#banners [data-hs-dismiss]")) renderBanners();
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-dbx]"); if (!t) return;
  switch (t.dataset.dbx) {
    case "connect": dbxConnect(); break;
    case "connect-code": case "code-again": DBX.codeError = ""; dbxConnect("code"); break;
    case "code-go": { const box = $("#dbx-code"); DBX.codeError = ""; dbxFinishWithCode(box ? box.value : ""); break; }
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

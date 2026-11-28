"use strict";
// Bulk Tutor, the page's script, part "main": toasts, switching screens (showView, renderAll), page-wide events, and the start.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ helpers
let toastTimer;
function toast(msg, actionLabel, action, ms) {
  let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  if (actionLabel) {
    const btn = document.createElement("button"); btn.className = "toast-btn"; btn.textContent = actionLabel;
    btn.addEventListener("click", () => { t.hidden = true; clearTimeout(toastTimer); action(); });
    t.appendChild(btn);
  }
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms || toastMs(msg, !!actionLabel));
}
// How long a message stays (0.98.1; Matt, Nov 18, of the first tick's message: "it disappears too quickly"): by how
// much it says, a second and a half and a quarter of a second a word, so "Copied" goes as before and a sentence stays
// about five seconds; one with a button at least six, and none longer than ten unless its caller says so.
const toastMs = (msg, button) => Math.min(10000, Math.max(button ? 6000 : 2200, 1500 + 250 * String(msg).trim().split(/\s+/).length));
function copyText(text, outSel, okMsg, onOk) {
  const fallback = () => { const out = $(outSel); if (!out) return; out.innerHTML = `<p class="muted small">Copying isn't allowed here. Select the text below and copy it.</p><textarea class="copybox" readonly></textarea>`; const ta = out.querySelector("textarea"); ta.value = text; ta.focus(); ta.select(); };
  try { navigator.clipboard.writeText(text).then(() => { if (onOk) onOk(); toast(okMsg); }, fallback); } catch { fallback(); }
}

// Find decks is offered while there are decks to find (0.85.0: EDHREC's are off until they answer); without any its
// tab is hidden and anything that would open it opens the Decks tab.
const decksOffered = () => !!(DATA && DATA.decks.length);
// What the welcome and the missing decks change outside the screens: the tabs (hidden behind the welcome), the Find
// decks tab, and leaving the welcome once it isn't needed (a collection arrived from Dropbox or a backup).
function syncChrome() {
  const w = needsWelcome();
  document.body.toggleAttribute("data-welcome", w);
  $("#tab-decks").hidden = !decksOffered(); $("nav.tabs .tab-sep").hidden = !decksOffered();
  $("#ex-pill").hidden = !exampleOn() || w;   // the header's "Example" marker, whenever the example's cards are the ones showing (0.106.0; decks.js)
  $("#welcome-sync").hidden = !dbxAvailable() || dbxConnected();   // its line offers Dropbox "to bring your collection over" (held back from 0.88.0 to 0.93.0, while the collection didn't sync)
  if (view === "welcome" && !w) showView("build");
}
// **The Decks tab is two screens** (0.96.0; step 5 of the plan, piece c): `yourdecks`, the list of your decks
// (decks.js; `decks` was taken, by Find decks), and `build`, the Workbench a deck opens into, which also draws New
// deck. The Workbench with no deck open is the list, and a list with nothing on it is New deck, so a first visit
// still starts where a deck is made. Combos has no tab since then: its screen is reached from the foot of the list
// and lights the Decks tab.
const VIEWS_ALL = ["welcome", "decks", "deck", "yourdecks", "build", "combos", "collection", "import", "browse", "putaway", "changes", "settings"];
let DECKS_AT = "build";   // where the Decks tab was left: the list, or the Workbench
function showView(v) {
  if (!VIEWS_ALL.includes(v)) v = "build";   // a view kept by a version that had another name for it
  if (visiting() && (v === "import" || v === "changes")) leaveExample(false);   // these are about your own collection: a visit to the example ends first (decks.js; Matt's call 4, Nov 20)
  if (needsWelcome() && !["welcome", "import", "settings"].includes(v)) v = "welcome";
  if ((v === "decks" || v === "deck") && !decksOffered()) v = "build";
  if (v === "build" && buildMode !== "new" && !curBuild()) v = "yourdecks";
  if (v === "yourdecks" && !listedDecks().length) { buildMode = "new"; v = "build"; }
  if (v === "settings" && view !== "settings") SETTINGS_FROM = view;
  view = v;
  for (const name of VIEWS_ALL) $("#view-" + name).hidden = name !== v;
  const tab = v === "deck" ? "decks" : v === "import" || v === "browse" || v === "putaway" || v === "changes" ? "collection" : v === "yourdecks" || v === "combos" ? "build" : v;
  if (v === "yourdecks" || v === "build") DECKS_AT = v;
  if (v === "yourdecks" || (v === "build" && buildMode === "new")) DECK_SEEN = null;   // no deck is open
  document.body.dataset.view = v;
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === tab)));
  if (v === "yourdecks") renderYourDecks(); else $("#view-yourdecks").innerHTML = "";   // drawn only while it shows, so its ids (New deck, the Combos row) exist once
  if (v === "build") renderBuild();
  if (v === "combos") renderCombos();
  if (v === "collection") renderCollection();
  if (v === "import") renderImport();
  if (v === "browse") renderBrowse();
  if (v === "putaway") renderPutAway();
  if (v === "changes") renderChanges();
  if (v === "settings") renderSettings();
  $("#gear").setAttribute("aria-pressed", String(v === "settings"));
  if (v !== "settings" && v !== "welcome") store.set("bt.view", tab === "build" ? v : tab);   // within the Decks tab, the screen itself: the next open goes back to it
  syncChrome();
  syncWakeLock();
  navRecord(); deckBarCheck();
}

// ------------------------------------------------------------ back and forward (0.104.0)
// Matt, Nov 14, from the Home Screen app: "gestures controls that normally work in safari don't seem to work in the
// home screen app"; agreed with step 6 (Nov 14, 12:15; Nov 19, 12:57). Each change of screen is an entry in the
// browser's history, so Back, the Home Screen app's edge swipe and Android's Back go to the screen before, and Forward
// returns. A screen is the view and what it shows (the deck, the box, Find decks' deck); typing, filters and a deck's
// Edit list / Tune / Assemble add no entry (Safari allows 100 history calls in 30 seconds), though the deck's entry
// keeps its mode. The address is left alone, so share links (#c, #b) and Dropbox's return work as before. Back first
// closes a sheet that is open, and the screen stays. A screen whose deck or box is gone falls back: a deck to the list
// of your decks, a box to the Collection. An entry keeps its scroll from when it was left, put back on return.
const navNow = () => {
  const s = { bt: 1, v: view };
  if (view === "build") { if (buildMode === "new" || !curBuild()) s.deck = "new"; else { s.deck = CUR; s.mode = buildMode; } }
  else if (view === "browse") s.loc = BROWSE.loc;
  else if (view === "deck") s.idx = curDeckIdx;
  return s;
};
const navSame = (a, b) => !!a && !!b && a.v === b.v && a.deck === b.deck && a.loc === b.loc && a.idx === b.idx;
let NAV_SHOWN = null, NAV_GOING = false, NAV_Y = 0;
try { history.scrollRestoration = "manual"; } catch {}
window.addEventListener("scroll", () => { NAV_Y = window.scrollY; }, { passive: true });
function navRecord() {
  if (NAV_GOING) return;
  const s = navNow(), had = history.state && history.state.bt ? history.state : null;
  try {
    if (!had) history.replaceState(s, "");   // the first screen (or one after the address was tidied) adds no entry
    else if (navSame(had, s)) { if (had.mode !== s.mode) history.replaceState({ ...had, mode: s.mode }, ""); }
    else { history.replaceState({ ...had, y: NAV_Y }, ""); history.pushState(s, ""); }
  } catch {}
  NAV_SHOWN = history.state;
}
function navGo(s) {
  NAV_GOING = true;
  try {
    if (s.v === "build") {
      const d = s.deck !== "new" && BUILDS.find(x => x.id === s.deck);
      if (s.deck === "new") { buildMode = "new"; showView("build"); }
      else if (d) { CUR = d.id; buildMode = s.mode || "list"; showView("build"); }
      else { CUR = null; leaveNewDeck(true); showView("yourdecks"); }   // the deck is gone: the list
    } else if (s.v === "browse") {
      if (s.loc == null || locationSummary().some(l => l.loc === s.loc)) openBrowse(s.loc); else showView("collection");   // the box is gone
    } else if (s.v === "deck") { if (decksOffered() && RESULTS[s.idx]) openDeck(s.idx); else showView("decks"); }
    else if (s.v === "putaway") openPutAway();
    else if (s.v === "yourdecks") { leaveNewDeck(true); showView("yourdecks"); }
    else showView(s.v);
  } finally { NAV_GOING = false; }
  const now = navNow();
  try { history.replaceState({ ...now, ...(navSame(now, s) && s.y ? { y: s.y } : {}) }, ""); } catch {}   // what shows: a fallback may differ
  NAV_SHOWN = history.state;
  window.scrollTo({ top: navSame(now, s) ? s.y || 0 : 0 });
  deckBarCheck();
}
window.addEventListener("popstate", e => {
  const s = e.state; if (!s || !s.bt) return;
  const open = [...document.querySelectorAll("dialog[open]")];
  if (open.length) {   // Back closes the sheet first, as Escape does, and the screen stays where it is
    for (const d of open) { const c = new Event("cancel", { cancelable: true }); d.dispatchEvent(c); if (!c.defaultPrevented) closeDlg(d); }
    try { history.pushState(NAV_SHOWN || navNow(), ""); } catch {}
    return;
  }
  navGo(s);
});
function renderAll() { loadPrintings();   // once the collection names a printing (cards.js); asks for nothing twice
  syncChrome(); renderLegal(); renderBanners(); renderDecks(); if (view === "yourdecks") renderYourDecks(); if (view === "build") renderBuild(); if (view === "combos") renderCombos(); if (view === "collection") renderCollection(); if (view === "import") renderImport(); if (view === "browse") renderBrowse(); if (view === "putaway") renderPutAway(); if (view === "changes") renderChanges(); if (view === "settings") renderSettings(); }

// ------------------------------------------------------------ events
document.addEventListener("click", async e => {
  const t = e.target.closest("button, [data-go]");
  if (!t) return;
  // The Decks tab reopens what it was left on, the deck last worked on or the list; a second tap goes to the list
  // (Matt, Nov 15: the Workbench is the screen a deck opens into, not a tab).
  if (t.id === "tab-build") { const there = ["build", "yourdecks", "combos"].includes(view); leaveNewDeck(there); showView(there ? "yourdecks" : DECKS_AT); if (there) window.scrollTo({ top: 0 }); return; }
  if (t.dataset.view) { showView(t.dataset.view); return; }
  if (t.dataset.go) { if (t.dataset.go === "yourdecks") { leaveNewDeck(true); showView("yourdecks"); window.scrollTo({ top: 0 }); return; } showView(t.dataset.go); return; }
  if (t.hasAttribute("data-what-can")) { genReset(); FIT_ALL = false; buildMode = "new"; showView("build"); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.color) { colorSel.has(t.dataset.color) ? colorSel.delete(t.dataset.color) : colorSel.add(t.dataset.color); shown = 40; renderColorFilter(); renderDecks(); return; }
  if (t.dataset.deck != null) { openDeck(+t.dataset.deck); return; }
  if (t.dataset.xcolor) { xColorSel.has(t.dataset.xcolor) ? xColorSel.delete(t.dataset.xcolor) : xColorSel.add(t.dataset.xcolor); comboShown = { ready: 30, near: 30 }; renderComboColors(); renderCombos(); return; }
  if (t.dataset.more) { comboShown[t.dataset.more] += 60; renderCombos(); return; }
  if (t.dataset.xtag) { xTagOff.has(t.dataset.xtag) ? xTagOff.delete(t.dataset.xtag) : xTagOff.add(t.dataset.xtag); comboShown = { ready: 30, near: 30 }; renderComboTags(); renderCombos(); return; }
  switch (t.id) {
    case "welcome-example": chooseExample(); break;
    case "welcome-deck": startWithDeck(); break;
    case "coll-newdeck": buildMode = "new"; showView("build"); window.scrollTo({ top: 0 }); break;
    case "more": shown += 60; renderDecks(); break;
    case "back": showView("decks"); break;
    case "copy-missing": { const x = $("#view-deck")._deck; copyText(x.missing.map(m => `1 ${m.name}`).join("\n"), "#copy-out", `Copied ${x.missing.length} missing cards`); break; }
    case "build-from-deck": buildFromDeck($("#view-deck")._deck.d); break;
    case "copy-pull": { const x = $("#view-deck")._deck; copyText(pullText(x.title, x.groups), "#copy-out", "Copied the list by location"); break; }
    case "dl-pull": { const x = $("#view-deck")._deck; downloadFile(`${fileSlug(x.title)}-by-location.csv`, pullCSV(x.groups)); break; }
    case "dl-coll": {
      const rows = [["Quantity", "Card", "Location", "In a deck", "Type", "Color identity", `Price (${CURRENCY.toUpperCase()})`]];
      const byKey = new Map();
      for (const e of COLL.entries) { const k = norm(e.name) + "|" + e.loc; const r = byKey.get(k); if (r) r.qty += e.qty; else byKey.set(k, { ...e }); }
      const each = e => { const v = ownValue(e.name, e.loc); return v.qty ? v.sum / v.qty : 0; };   // per copy: the row's copies by their own printings
      for (const e of [...byKey.values()].sort((a, b) => a.loc.localeCompare(b.loc, undefined, { numeric: true }) || a.name.localeCompare(b.name))) {
        const c = DATA && cardOf(e.name);
        rows.push([e.qty, e.name, e.loc, e.inDeck ? "Yes" : "No", c ? TYPE_SINGULAR[c[2]] : "", c ? c[1] : "", each(e) ? each(e).toFixed(2) : ""]);
      }
      downloadFile("bulk-tutor-collection.csv", toCSV(rows)); break;
    }
    case "copy-coll": copyText([...AGG.values()].sort((a, b) => a.name.localeCompare(b.name)).map(a => `${a.qty} ${a.name}`).join("\n"), "#coll-out", `Copied ${AGG.size.toLocaleString()} cards`); break;
    case "copy-full": { const x = $("#view-deck")._deck; copyText([...x.owned, ...x.missing].map(m => `1 ${m.name}`).sort().join("\n"), "#copy-out", "Copied the full list"); break; }
    case "paste-go": doImport($("#paste").value, "the pasted text"); break;
    case "keep-link": {   // the link's cards become your collection: a first file, from a source called "Collection link"
      const c = COLL; if (!c || !c.fromLink) break;
      REC = recNew();
      const did = doChange(REC, planFile(REC, { app: c.source, label: "a collection link", at: c.importedAt, entries: c.entries, noLoc: false }, { mode: "update" }).change);
      fileDecks(did.change, new Set());   // the locations the link calls decks get a deck each, as a file's do (decks.js)
      recChanged();
      try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
      toast("Saved in this browser"); break;
    }
    case "copy-link": {
      if (!COLL || COLL.example) { $("#link-out").innerHTML = `<p class="muted small">Import your collection first.</p>`; break; }
      if (typeof CompressionStream === "undefined") { $("#link-out").innerHTML = `<p class="muted small">This browser can't build collection links. Try a current version of Safari, Chrome or Firefox.</p>`; break; }
      const packed = await packCollection(COLL);
      const url = location.href.split("#")[0] + "#c" + packed;
      copyText(url, "#link-out", `Copied link (${Math.round(url.length / 1024)} KB)`);
      break;
    }
    case "clear": $("#clear-zone").innerHTML = `<span>Remove your collection from this browser?${dbxConnected() ? " If this isn't your device, disconnect Dropbox in Settings too." : ""}</span><button class="btn danger" id="clear-yes">Remove</button><button class="btn" id="clear-no">Keep it</button>`; break;
    case "clear-no": $("#clear-zone").innerHTML = `<button class="btn danger" id="clear">Remove your collection from this browser</button>`; break;
    case "import-update": if (PENDING_IMPORT) applyImport(PENDING_IMPORT, "update"); break;
    case "import-add": if (PENDING_IMPORT) applyImport(PENDING_IMPORT, "add"); break;
    case "import-wipe": askWipe(true); break;
    case "import-wipe-no": askWipe(false); break;
    case "import-wipe-yes": if (PENDING_IMPORT) applyImport(PENDING_IMPORT, "wipe"); break;
    case "import-undo": undoImport(); break;
    case "import-cancel": PENDING_IMPORT = null; PENDING_BOX = null; $("#import-result").innerHTML = ""; break;
    case "import-pile": if (PENDING_IMPORT) applyImport(PENDING_IMPORT, "here", PUT_AWAY); break;
    case "import-box": if (PENDING_IMPORT) openAddCards(null, PENDING_IMPORT); break;
    case "import-whole": if (PENDING_IMPORT) askImport(PENDING_IMPORT); break;
    case "import-where-back": if (PENDING_IMPORT) askWhere(PENDING_IMPORT); break;
    case "import-boxupdate": if (PENDING_IMPORT && PENDING_BOX) applyImport(PENDING_IMPORT, "box", PENDING_BOX); break;
    case "import-boxadd": if (PENDING_IMPORT && PENDING_BOX) applyImport(PENDING_IMPORT, "here", PENDING_BOX); break;
    case "clear-yes": $("#clear-zone").innerHTML = `<button class="btn danger" id="clear">Remove your collection from this browser</button>`; $("#import-result").innerHTML = ""; $("#import-summary").textContent = "Import a collection export or paste a card list. It stays in this browser unless you connect your own Dropbox."; removeCollection(); renderImport(); toast("Collection removed"); break;
  }
});
$("#lock-form").addEventListener("submit", e => { e.preventDefault(); unlock(); });
["q", "sort", "maxcost", "mindecks", "owncmd", "themes", "countdecks"].forEach(id => $("#" + id).addEventListener("input", () => { shown = 40; renderDecks(); }));
["xq", "xsort", "xsalt", "xfree", "xplain"].forEach(id => $("#" + id).addEventListener("input", () => { comboShown = { ready: 30, near: 30 }; renderCombos(); }));
// A new deck prefix: a location whose name starts with it is a deck by the file's word from now on (none is unmade).
$("#prefix").addEventListener("change", e => {
  store.set("bt.prefix", e.target.value.trim());
  if (!COLL || COLL.example) return;
  if (!ownColl()) { COLL.entries.forEach(x => { if (x.loc !== "Pasted list" && looksLikeDeck(x.loc)) { if (x.asImported != null) x.asImported = true; else x.inDeck = true; } }); setCollection(COLL); return; }
  const locs = [...REC.locs.values()].filter(l => !l.deck && l.name !== "Pasted list" && looksLikeDeck(l.name)).map(l => ({ id: l.id, name: l.name, deck: true }));
  // What a location is called isn't a change of cards: nothing is written down. Each one that holds cards and has no
  // deck gets one (0.95.0: decks.js fileDecks), as a file that named it a deck would have made.
  if (locs.length) { doChange(REC, { ...changeOf({ by: "hand" }, []), locs }); fileDecks({ locs }, new Set()); recChanged(); }
});
$("#file").addEventListener("change", async e => { const f = e.target.files[0]; if (f) doImport(await f.text(), f.name); e.target.value = ""; });
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", async e => { const f = e.dataTransfer.files[0]; if (f) doImport(await f.text(), f.name); });

// ---- Sheets and the on-screen keyboard (0.91.0; Matt, Nov 14, naming a new box on his phone: "I was able to scroll
// away from the text box so I couldn't see what I was typing"). A phone's keyboard covers the bottom of the screen
// without making the page shorter (iOS; Android's Chrome since 108): a sheet docked to the bottom sits under it, the
// browser pans the view up to show the field, and a drag pans it away again. So the sheets are told what is covered
// (--kb: from the bottom of the page's viewport up to the bottom of what is in view) and how tall the view is
// (--vvh), and styles.css keeps a sheet above the one and within the other: it stays in view wherever the view is
// dragged. Not while the page is pinched larger (that shrinks the view too), and not for less than a keyboard's
// height (a browser's own bars coming and going). **Never run on an iPhone before Matt tries it**: no keyboard
// opens in the checks, which give the view a height by hand (tests/ui_keyboard.py).
const KB_MIN = 120;
let KB_UP = false;
function fitToKeyboard() {
  const vv = window.visualViewport, root = document.documentElement; if (!vv) return;
  const kb = Math.round(root.clientHeight - vv.height - vv.offsetTop), up = vv.scale < 1.05 && root.clientHeight - vv.height >= KB_MIN;
  if (up) { root.style.setProperty("--kb", Math.max(0, kb) + "px"); root.style.setProperty("--vvh", Math.round(vv.height) + "px"); }
  else { root.style.removeProperty("--kb"); root.style.removeProperty("--vvh"); }
  // As the keyboard comes up, the field being typed in is brought into what is left of its sheet.
  if (up && !KB_UP) { const a = document.activeElement; if (a && a.closest && a.closest("dialog[open]")) try { a.scrollIntoView({ block: "center" }); } catch {} }
  KB_UP = up;
}
if (window.visualViewport) { window.visualViewport.addEventListener("resize", fitToKeyboard); window.visualViewport.addEventListener("scroll", fitToKeyboard); }

// Screens that keep keyboard focus across a redraw (core.js, withFocus).
renderBuild = withFocus(renderBuild, "#view-build");
renderBrowse = withFocus(renderBrowse, "#view-browse");
renderPutAway = withFocus(renderPutAway, "#view-putaway");
renderCollection = withFocus(renderCollection, "#view-collection");
renderCombos = withFocus(renderCombos, "#view-combos");
renderDecks = withFocus(renderDecks, "#view-decks");
openSheet = withFocus(openSheet, "#sheet");

// ------------------------------------------------------------ start
async function finishStart() {
  loadBuildPrefs(); loadPrefs(); loadTemplates(); loadViews(); loadLocStyle(); loadBuy(); loadRules(); loadChDays(); loadCame(); loadTokOwn(); loadSyncState(); renderVersion();
  const shared = await takeShared();
  let c = null;
  if (location.hash.startsWith("#c") && location.hash.length > 10 && typeof DecompressionStream !== "undefined") {
    try { c = await unpackCollection(location.hash.slice(2)); } catch { c = null; }
  }
  let sharedView = null;
  if (location.hash.startsWith("#b") && location.hash.length > 10 && typeof DecompressionStream !== "undefined") {
    try { SHARED_BUILD = await unpackBuild(location.hash.slice(2)); sharedView = "build"; WELCOME_SKIP = true; } catch { SHARED_BUILD = null; }
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
  }
  await openRecord();   // your own collection, from the browser's storage (record.js)
  await openDecks();    // your decks, from the same storage, or brought over from the builds and saved decks of before 0.95.0 (decks.js)
  forgetOld(true);      // changes older than your choice in Settings are forgotten (changes.js)
  setCollection(c);     // a link's collection when the address carries one; else your own, or the example
  nameDecks();
  const v = sharedView || store.get("bt.view");
  const cv = store.get("bt.cardview"); CARDVIEW = ["list", "grid", "stacks", "table"].includes(cv) ? cv : "list";
  loadImgCache();
  if (sharedView && !curBuild()) buildMode = "new";   // a share link with no deck open here: New deck, the shared deck offered above it (not the list)
  showView(v && !["deck", "import", "browse"].includes(v) ? v : "build");
  dbxBoot();
  picsSoon(4000);
  if (shared) {
    showView("import");
    if (shared.kind === "text") { $("#paste").value = shared.text; toast("The shared text is in the paste box. Check it, then import it."); }
    else doImport(shared.text, shared.name);
  }
}

// Header height for sticky elements below it.
const setHeadH = () => document.documentElement.style.setProperty("--head-h", $("header.top").offsetHeight + "px");
try { new ResizeObserver(setHeadH).observe($("header.top")); } catch {}
setHeadH();

// Offline support when installed from GitHub Pages (not when the page is embedded in another one). The service worker
// (sw.js) shows the saved copy of the app at once and checks the site behind it; when it has saved a newer version it
// says so. Someone who hasn't touched the page yet just gets the new version; anyone else is offered it, and has it
// at the next visit either way.
let TOUCHED = false;
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => { TOUCHED = true; }, { capture: true, passive: true });
function newVersionReady(msg = "A new version of Bulk Tutor is ready.") {
  let last = 0; try { last = +sessionStorage.getItem("bt.reloaded") || 0; } catch {}
  // Not on a shared link or a return from Dropbox or the share sheet (the address carries what a reload would lose),
  // and never twice in a minute, whatever the worker says.
  const quiet = !TOUCHED && !location.search && !SHARED_BUILD && !document.querySelector("dialog[open]") && Date.now() - last > 60000;
  if (quiet) { try { sessionStorage.setItem("bt.reloaded", String(Date.now())); } catch {} location.reload(); return; }
  toast(msg, "Reload", () => location.reload(), 12000);
}
if ("serviceWorker" in navigator && window.top === window && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data && e.data.type === "shell-updated") newVersionReady();
    else if (e.data && e.data.type === "data-late") dataLate(e.data);
  });
}
// The connection came back or went: say so in the header, and fetch what an offline start couldn't.
addEventListener("online", () => {
  NET.down = false; renderStatus(); netBack();
  if (DATA_STATE === "unreachable") { if (!TOUCHED || !document.querySelector("dialog[open], input:focus, textarea:focus")) location.reload(); return; }
  if (!$("#lock").hidden) return;
  retryCombos();
  if (legalState === "failed") { legalState = "idle"; if (formatsOffered()) loadLegal(); }
  if (DATA) { renderBanners(); tellWorker(); }
});
addEventListener("offline", () => { renderStatus(); if ($("#lock").hidden) renderBanners(); });
// A touch screen has no hover for the header marker's explanation: tapping Offline or Slow says it.
$("#status").addEventListener("click", e => { const el = e.currentTarget; if (el.title && (el.classList.contains("off") || el.classList.contains("slow"))) toast(el.title, null, null, 7000); });
// A phone can miss "online" while the app is in the background (airplane mode switched in Settings): when the app comes
// back to the front, look again. If it is still marked Offline, one small request to the site settles it either way.
function backInFront() {
  if (document.hidden || navigator.onLine === false) return;
  netBack();
  if (NET.down && DATA) dataFetch("data/meta.json", { cache: "no-cache" }).then(() => { if (!NET.down) { retryCombos(); renderBanners(); tellWorker(); } }).catch(() => {});
}
document.addEventListener("visibilitychange", backInFront);
addEventListener("pageshow", e => { if (e.persisted) backInFront(); });
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-reload], [data-combos-retry]");
  if (!t) return;
  if (t.hasAttribute("data-reload")) location.reload(); else retryCombos();
});

(async function start() {
  renderColorFilter();
  renderComboColors();
  renderComboTags();
  PASSWORD = store.get("bt.password");
  const st = await loadData();
  // Only a password that failed to open the file is forgotten. With no answer about the data (offline with nothing
  // saved), the app opens on what it has and keeps the password for when the connection is back.
  if (st === "password") { PASSWORD = null; store.del("bt.password"); showLock("The password has changed. Enter the new one."); renderStatus(); return; }
  if (st === "locked") { showLock(""); renderStatus(); return; }
  await finishStart();
})();

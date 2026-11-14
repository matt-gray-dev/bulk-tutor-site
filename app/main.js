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
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms || (actionLabel ? 6000 : 2200));
}
function copyText(text, outSel, okMsg, onOk) {
  const fallback = () => { const out = $(outSel); if (!out) return; out.innerHTML = `<p class="muted small">Copying isn't allowed here. Select the text below and copy it.</p><textarea class="copybox" readonly></textarea>`; const ta = out.querySelector("textarea"); ta.value = text; ta.focus(); ta.select(); };
  try { navigator.clipboard.writeText(text).then(() => { if (onOk) onOk(); toast(okMsg); }, fallback); } catch { fallback(); }
}

// Find decks is offered while there are decks to find (0.85.0: EDHREC's are off until they answer); without any its
// tab is hidden and anything that would open it opens the Workbench.
const decksOffered = () => !!(DATA && DATA.decks.length);
// What the welcome and the missing decks change outside the screens: the tabs (hidden behind the welcome), the Find
// decks tab, and leaving the welcome once it isn't needed (a collection arrived from Dropbox or a backup).
function syncChrome() {
  const w = needsWelcome();
  document.body.toggleAttribute("data-welcome", w);
  $("#tab-decks").hidden = !decksOffered();
  $("#welcome-sync").hidden = true;   // its line offers Dropbox "to bring your collection over", which waits for step 4's Dropbox piece: back then, as !dbxAvailable() || dbxConnected()
  if (view === "welcome" && !w) showView("build");
}
function showView(v) {
  if (needsWelcome() && !["welcome", "import", "settings"].includes(v)) v = "welcome";
  if ((v === "decks" || v === "deck") && !decksOffered()) v = "build";
  if (v === "settings" && view !== "settings") SETTINGS_FROM = view;
  view = v;
  for (const name of ["welcome", "decks", "deck", "build", "combos", "collection", "import", "browse", "putaway", "changes", "settings"]) $("#view-" + name).hidden = name !== v;
  const tab = v === "deck" ? "decks" : v === "import" || v === "browse" || v === "putaway" || v === "changes" ? "collection" : v;
  document.body.dataset.view = v;
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === tab)));
  if (v === "build") renderBuild();
  if (v === "combos") renderCombos();
  if (v === "collection") renderCollection();
  if (v === "import") renderImport();
  if (v === "browse") renderBrowse();
  if (v === "putaway") renderPutAway();
  if (v === "changes") renderChanges();
  if (v === "settings") renderSettings();
  $("#gear").setAttribute("aria-pressed", String(v === "settings"));
  if (v !== "settings" && v !== "welcome") store.set("bt.view", tab);
  syncChrome();
  syncWakeLock();
}
function renderAll() { loadPrintings();   // once the collection names a printing (cards.js); asks for nothing twice
  syncChrome(); renderLegal(); renderBanners(); renderDecks(); if (view === "build") renderBuild(); if (view === "combos") renderCombos(); if (view === "collection") renderCollection(); if (view === "import") renderImport(); if (view === "browse") renderBrowse(); if (view === "putaway") renderPutAway(); if (view === "changes") renderChanges(); if (view === "settings") renderSettings(); }

// ------------------------------------------------------------ events
document.addEventListener("click", async e => {
  const t = e.target.closest("button, [data-go]");
  if (!t) return;
  if (t.dataset.view) { showView(t.dataset.view); return; }
  if (t.dataset.go) { showView(t.dataset.go); return; }
  if (t.hasAttribute("data-what-can")) { genReset(); FIT_ALL = false; buildMode = "new"; showView("build"); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.color) { colorSel.has(t.dataset.color) ? colorSel.delete(t.dataset.color) : colorSel.add(t.dataset.color); shown = 40; renderColorFilter(); renderDecks(); return; }
  if (t.dataset.deck != null) { openDeck(+t.dataset.deck); return; }
  if (t.dataset.owned) { openOwnedDeck(t.dataset.owned); return; }
  if (t.dataset.xcolor) { xColorSel.has(t.dataset.xcolor) ? xColorSel.delete(t.dataset.xcolor) : xColorSel.add(t.dataset.xcolor); comboShown = { ready: 30, near: 30 }; renderComboColors(); renderCombos(); return; }
  if (t.dataset.more) { comboShown[t.dataset.more] += 60; renderCombos(); return; }
  if (t.dataset.xtag) { xTagOff.has(t.dataset.xtag) ? xTagOff.delete(t.dataset.xtag) : xTagOff.add(t.dataset.xtag); comboShown = { ready: 30, near: 30 }; renderComboTags(); renderCombos(); return; }
  switch (t.id) {
    case "welcome-example": chooseExample(); break;
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
      recDo(planFile(REC, { app: c.source, label: "a collection link", at: c.importedAt, entries: c.entries, noLoc: false }, { mode: "update" }).change);
      try { history.replaceState(null, "", location.pathname + location.search); } catch {}
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
  if (locs.length) recDo({ ...changeOf({ by: "hand" }, []), locs });   // what a location is called isn't a change of cards: nothing is written down
});
$("#file").addEventListener("change", async e => { const f = e.target.files[0]; if (f) doImport(await f.text(), f.name); e.target.value = ""; });
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", async e => { const f = e.dataTransfer.files[0]; if (f) doImport(await f.text(), f.name); });

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
  loadBuilds(); loadSaved(); loadPrefs(); loadTemplates(); loadViews(); loadLocStyle(); loadBuy(); loadRules(); loadChDays(); loadTokOwn(); loadSyncState(); renderVersion();
  const shared = await takeShared();
  let c = null;
  if (location.hash.startsWith("#c") && location.hash.length > 10 && typeof DecompressionStream !== "undefined") {
    try { c = await unpackCollection(location.hash.slice(2)); } catch { c = null; }
  }
  let sharedView = null;
  if (location.hash.startsWith("#b") && location.hash.length > 10 && typeof DecompressionStream !== "undefined") {
    try { SHARED_BUILD = await unpackBuild(location.hash.slice(2)); sharedView = "build"; WELCOME_SKIP = true; } catch { SHARED_BUILD = null; }
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  }
  await openRecord();   // your own collection, from the browser's storage (record.js)
  forgetOld(true);      // changes older than your choice in Settings are forgotten (changes.js)
  setCollection(c);     // a link's collection when the address carries one; else your own, or the example
  nameDecks();
  const v = sharedView || store.get("bt.view");
  const cv = store.get("bt.cardview"); CARDVIEW = ["list", "grid", "stacks", "table"].includes(cv) ? cv : "list";
  loadImgCache();
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

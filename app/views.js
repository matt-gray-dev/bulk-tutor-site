"use strict";
// Bulk Tutor, the page's script, part "views": saved views: a list's filters, sort and grouping under one name, their chips, and the Views sheet.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ views (0.81.0)
// Matt, Nov 12: "saving sort/filters as views is a great idea. they should be able to be renamed, not just deleted."
// The calls he agreed to: (1) a view is a name plus the filters that are on, the sort and the grouping, not
// List/Grid/Table; (2) one list of views, synced, offered in every list that can use all of one; (3) the saved
// filters and saved sorts of before became views, nothing lost, a deck's still chips on that deck; (4) a view saved
// on a screen is pinned there as a chip, and every view is reached from one Views sheet, where they are renamed and
// deleted. The engine says what a view is (canonView, viewFits, cleanView); here: the list (VIEWS; bt.views, synced
// in builds.json and backups as `views`, mergeList "v", tombstones), what each list has and how a view is taken there
// (VIEW_TARGETS), the chips, and the sheet (#viewsheet).
let VIEWS = [];
const VIEW_MAX = 100;
const storedList = key => { try { const v = JSON.parse(store.get(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
function loadViews() {
  VIEWS = storedList("bt.views").map(cleanView).filter(Boolean);
  // Once: what 0.80.0 and before kept as saved filters (bt.filters) and saved sorts (bt.sorts), under the ids they had.
  if (store.get("bt.filters") == null && store.get("bt.sorts") == null) return;
  for (const v of [...storedList("bt.filters").map(viewFromFilter), ...storedList("bt.sorts").map(viewFromSort)]) if (v && !VIEWS.some(x => x.id === v.id)) VIEWS.push(v);
  if (store.set("bt.views", JSON.stringify(VIEWS))) { store.del("bt.filters"); store.del("bt.sorts"); }   // the old keys go only once the views are kept
}
function saveViews(fromSync) {
  store.set("bt.views", JSON.stringify(VIEWS));
  trackDeletions("v", VIEWS);
  if (!fromSync) syncSoon();
}

// Each list: what it has for a view to use (has: kinds of filter beyond the quick row, sort keys, groupings), how
// it looks now and when it opens (now, base), how a view is taken (apply), the screen's name for a pin (key) and in
// words (where). A build has the quick row, its own sort keys and groupings, and always some grouping: a view with
// none leaves the build's as it is (fit).
const VIEW_TARGETS = {
  browse: {
    has: () => ({ kinds: ["q", "within", ...(hasRoles() ? ["role"] : []), ...(formatsOffered() ? ["formats"] : []), ...(copyFiltersOffered() ? ["copies"] : [])], keys: sortKeysFor("browse"), groups: groupChoices().map(c => c[0]) }),
    now: () => ({ f: { ...BROWSE.quick, q: BROWSE.q, role: hasRoles() ? BROWSE.role : "", fmtMode: BROWSE.fmtMode, formats: [...BROWSE.formats], within: [...BROWSE.colors],
      ...(copyFiltersOffered() ? { set: BROWSE.set, rar: BROWSE.rar, foil: BROWSE.foil } : {}) }, sort: sortOf("browse"), group: BROWSE.group }),
    base: () => ({ f: {}, sort: canonSort((!BROWSE.saved && BROWSE.loc != null && locSort(BROWSE.loc)) || "name", sortKeysFor("browse")), group: browseIsDeck() ? "type" : "" }),
    apply(v) {
      const f = v.f;
      BROWSE.quick = { types: f.types || [], mv: f.mv ?? null, mode: f.mode || "le", colors: f.colors || [], ...(f.by ? { by: f.by } : {}) };
      Object.assign(BROWSE, { q: f.q || "", role: f.role || "", fmtMode: f.fmtMode || "legal", set: f.set || "", rar: f.rar || "", foil: f.foil || "", sort: v.sort, group: v.group, shown: 0 });
      BROWSE.formats.clear(); for (const x of f.formats || []) BROWSE.formats.add(x);
      BROWSE.colors.clear(); for (const c of f.within || []) BROWSE.colors.add(c);
      if (f.formats) loadLegal();
      renderBrowse();
    },
    key: () => (BROWSE.saved ? "saved:" + BROWSE.saved : BROWSE.loc == null ? "all" : browseIsDeck() ? "deck:" + BROWSE.loc : "box:" + BROWSE.loc),
    where: () => { const s = savedById(BROWSE.saved); return s ? s.name : BROWSE.loc == null ? "All cards" : browseIsDeck() ? deckName(BROWSE.loc) : locName(BROWSE.loc); },
  },
  build: {
    has: () => ({ kinds: [], keys: BUILD_SORT_KEYS, groups: ["", "type", "location", ...(hasRoles() ? ["role"] : [])] }),
    now: () => ({ f: { ...buildQuick(curBuild()) }, sort: sortOf("build"), group: buildGroup }),
    base: () => ({ f: {}, sort: "name", group: "type" }),
    fit: v => ({ ...v, group: v.group || buildGroup }),
    apply(v) {
      const b = curBuild(), f = v.f; if (!b) return;
      BUILD_QUICK.set(b.id, { types: f.types || [], mv: f.mv ?? null, mode: f.mode || "le", colors: f.colors || [], ...(f.by ? { by: f.by } : {}) });
      buildSort = canonSort(v.sort, BUILD_SORT_KEYS); store.set("bt.sort", buildSort);
      if (v.group) { buildGroup = v.group; store.set("bt.group", buildGroup); }
      renderBuild();
    },
    key: () => (curBuild() ? "build:" + curBuild().id : null),
    where: () => (curBuild() ? curBuild().name : "this build"),
  },
};
const viewFit = (target, v) => (VIEW_TARGETS[target].fit ? VIEW_TARGETS[target].fit(v) : v);
const viewNow = target => canonView(VIEW_TARGETS[target].now());
const viewBase = target => canonView(VIEW_TARGETS[target].base());
const viewUsable = (target, v) => viewFits(v, VIEW_TARGETS[target].has());
const viewIsOn = (target, v, now = viewNow(target)) => viewUsable(target, v) && sameView(viewFit(target, v), now);
const viewOn = target => { const now = viewNow(target); return VIEWS.find(v => viewIsOn(target, v, now)) || null; };
// Something to save: the list isn't as it opens, and no view is what it shows.
const viewCanSave = target => VIEWS.length < VIEW_MAX && !sameView(viewNow(target), viewBase(target)) && !viewOn(target);
function applyView(target, v) { VIEW_TARGETS[target].apply(canonView(viewFit(target, v))); }
// A tap on a view: it is taken whole, or, when it is the one that is on, the list goes back to how it opens.
function useView(target, id) {
  const v = VIEWS.find(x => x.id === id); if (!v || !VIEW_TARGETS[target] || !viewUsable(target, v)) return;
  if (viewIsOn(target, v)) { applyView(target, viewBase(target)); return; }
  if (v.f.types || v.f.mv != null || v.f.colors) setQOpen(false);   // the quick row folds into its line, so the list gets the screen
  applyView(target, v);
}
// The list on the screen as a view, under a name, pinned to the screen. The same view already kept is pinned here.
function saveView(target, name) {
  const now = viewNow(target), key = VIEW_TARGETS[target].key(), had = VIEWS.find(x => sameView(x, now));
  if (had) { if (key && !had.pins.includes(key)) { had.pins.push(key); had.updated = Date.now(); saveViews(); } return had; }
  if (VIEWS.length >= VIEW_MAX) return null;
  const v = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || "").trim().slice(0, 60) || viewName(now), ...now, pins: key ? [key] : [], updated: Date.now() };
  VIEWS.push(v); saveViews();
  return v;
}

// ---- A view in words: "Instants · mana value ≤4 · white or red · sorted by price · grouped by type".
const VIEW_GROUP_WORDS = { type: "type", color: "color", role: "role", location: "location" };
function viewFilterText(f) {
  const parts = [], quick = quickSummary({ types: f.types || [], mv: f.mv ?? null, mode: f.mode || "le", colors: f.colors || [], by: f.by });
  if (quick) parts.push(quick);
  if (f.q) parts.push(`“${f.q}”`);
  if (f.role) parts.push(f.role);
  if (f.formats) parts.push(`${f.fmtMode === "banned" ? "banned in" : "legal in"} ${f.formats.map(x => FORMAT_NAMES[x] || x).join(f.fmtMode === "banned" ? " or " : " and ")}`);
  if (f.within) parts.push(`within ${f.within.map(c => COLOR_NAMES[c].toLowerCase()).join(", ")}`);
  if (f.set) parts.push(setName(f.set));
  if (f.rar) parts.push((RARITY_NAMES[f.rar] || f.rar).toLowerCase());
  if (f.foil) parts.push(f.foil === "foil" ? "foil" : "not foil");
  return capFirst(parts.join(" · "));
}
function viewText(v) {
  const c = canonView(v), parts = [viewFilterText(c.f), c.sort !== "name" ? `sorted by ${sortText(c.sort).toLowerCase()}` : "", c.group ? `grouped by ${VIEW_GROUP_WORDS[c.group]}` : ""].filter(Boolean);
  return capFirst(parts.join(" · ")) || "Every card, by name";
}
// The name a new view starts with: its filters, else its sort, else its grouping.
const viewName = v => { const c = canonView(v); return (viewFilterText(c.f) || (c.sort !== "name" ? sortText(c.sort) : c.group ? `By ${VIEW_GROUP_WORDS[c.group]}` : "View")).slice(0, 60); };

// ---- On the screen: a chip for each view pinned here (a tap takes it, a second tap lets go of it), and the chip
// that opens the sheet, which names the view that is on when that one has no chip here.
function viewChipsHTML(target) {
  const key = VIEW_TARGETS[target].key(); if (!key) return "";
  const now = viewNow(target), mark = icon("i-bookmark");
  return VIEWS.filter(v => v.pins.includes(key) && viewUsable(target, v)).map(v => {
    const on = viewIsOn(target, v, now);
    return `<button class="fchip${on ? " on" : ""}" data-view-use="${esc(v.id)}" data-view-at="${target}" aria-pressed="${on}">${mark}<span>${esc(v.name)}</span></button>`;
  }).join("");
}
function viewsChipHTML(target) {
  const on = viewOn(target), key = VIEW_TARGETS[target].key(), named = on && !(key && on.pins.includes(key));
  return `<button class="fchip${named ? " on" : ""}" data-views-open="${target}" aria-haspopup="dialog">${named ? `View: ${esc(on.name)}` : "Views"}</button>`;
}
const viewSaveLinkHTML = target => (viewCanSave(target) ? ` · <button class="btn link small" data-views-open="${target}" data-views-save>Save</button>` : "");

// ------------------------------------------------------------ the Views sheet
let VIEWING = null;   // { target, name?, edit?, editName?, undo? } while the sheet is open
function openViews(target, toSave) {
  if (!VIEW_TARGETS[target] || (target === "build" && !curBuild())) return;
  VIEWING = { target }; renderViews(); openDlg($("#viewsheet"));
  const inp = toSave && $("#view-name"); if (inp) { inp.focus(); inp.select(); }
}
function closeViews() { VIEWING = null; closeDlg($("#viewsheet")); }
function renderViews() {
  const body = $("#viewsheet-body"); if (!body || !VIEWING) return;
  const target = VIEWING.target, T = VIEW_TARGETS[target], now = viewNow(target), key = T.key(), where = T.where();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const usable = VIEWS.filter(v => viewUsable(target, v)).sort(byName), others = VIEWS.filter(v => !usable.includes(v)).sort(byName);
  const atBase = sameView(now, viewBase(target)), canSave = viewCanSave(target);
  const row = (v, can) => {
    if (VIEWING.edit === v.id) return `<div class="menu-item frow"><input type="text" class="fname" id="view-rename" value="${esc(VIEWING.editName != null ? VIEWING.editName : v.name)}" maxlength="60" aria-label="Name of this view" enterkeyhint="done" autocomplete="off">
      <button class="btn" data-view-rename="${esc(v.id)}">Save</button><button class="btn danger" data-view-del="${esc(v.id)}" aria-label="Delete the view ${esc(v.name)}">Delete</button></div>`;
    const text = viewText(v), pinned = !!key && v.pins.includes(key);
    return `<div class="menu-item frow"><button class="btn sort-preset" data-view-use="${esc(v.id)}" aria-pressed="${can && viewIsOn(target, v, now)}"${can ? "" : " disabled"}><span class="mi-text"><span>${esc(v.name)}</span>${v.name.toLowerCase() === text.toLowerCase() ? "" : `<small>${esc(text)}</small>`}</span></button>
      ${can && key ? `<button class="btn view-pin" data-view-pin="${esc(v.id)}" aria-pressed="${pinned}" aria-label="${pinned ? `Unpin ${esc(v.name)} from ${esc(where)}` : `Pin ${esc(v.name)} to ${esc(where)}`}">${icon("i-bookmark")}</button>` : ""}
      <button class="btn" data-view-edit="${esc(v.id)}" aria-label="Rename or delete the view ${esc(v.name)}">Edit</button></div>`;
  };
  // A toast would sit under the sheet, out of reach, so a deleted view's Undo is a line of the sheet.
  const undoHTML = VIEWING.undo ? `<p class="small" id="view-undo">Deleted “${esc(VIEWING.undo.x.name)}”. <button class="btn link" data-view-undo>Undo</button></p>` : "";
  const saveHTML = canSave ? `<section class="fgroup" id="view-save"><h3 class="flabel">This list now</h3>
      <p class="small" id="view-now">${esc(viewText(now))}</p>
      <div class="frow sort-save"><input type="text" class="fname" id="view-name" value="${esc(VIEWING.name != null ? VIEWING.name : viewName(now))}" maxlength="60" aria-label="Name for this view" enterkeyhint="done" autocomplete="off"><button class="btn" data-view-save>Save view</button></div>
      ${key ? `<p class="muted small">It gets a chip at the top of ${esc(where)}, and is offered in every list that can use it.</p>` : ""}</section>` : "";
  const listHTML = usable.length || undoHTML ? `<section class="fgroup" id="view-list"><h3 class="flabel">Your views</h3>${undoHTML}
      ${usable.length ? `<div class="menu-list">${usable.map(v => row(v, true)).join("")}</div>${key ? `<p class="muted small view-hint">${icon("i-bookmark")}<span>keeps a view as a chip at the top of ${esc(where)}.</span></p>` : ""}` : ""}</section>` : "";
  const othersHTML = others.length ? `<section class="fgroup" id="view-others"><h3 class="flabel">Not for this list</h3>
      <p class="muted small">${others.length === 1 ? "It uses" : "They use"} a filter, a sort or a grouping this list doesn't have.</p>
      <div class="menu-list">${others.map(v => row(v, false)).join("")}</div></section>` : "";
  body.innerHTML = `<h2 id="viewsheet-title" tabindex="-1" autofocus>Views</h2>
    <p class="muted small">A view is a list's filters, sort and grouping under one name. A tap puts the list in it; a second tap lets go of it.</p>
    ${saveHTML}${listHTML}${othersHTML}
    ${!VIEWS.length && !canSave && !undoHTML ? `<p class="muted" id="view-none">No views yet. Set filters, a sort or a grouping on a list, then save them here.</p>` : ""}
    <div class="sheet-pair"><button class="btn" data-view-base${atBase ? " disabled" : ""}>Reset this list</button><button class="btn primary" data-view-done>Done</button></div>`;
}
document.addEventListener("input", e => { if (!VIEWING) return; if (e.target.id === "view-name") VIEWING.name = e.target.value; else if (e.target.id === "view-rename") VIEWING.editName = e.target.value; });
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || (e.target.id !== "view-name" && e.target.id !== "view-rename")) return;
  e.preventDefault(); const go = $(e.target.id === "view-name" ? "#viewsheet [data-view-save]" : "#viewsheet [data-view-rename]"); if (go) go.click();
});
document.addEventListener("click", e => {
  const open = e.target.closest && e.target.closest("[data-views-open]");
  if (open) { openViews(open.dataset.viewsOpen, open.dataset.viewsSave != null); return; }
  const chip = e.target.closest && e.target.closest("[data-view-use][data-view-at]");
  if (chip) { useView(chip.dataset.viewAt, chip.dataset.viewUse); return; }
  const dlg = $("#viewsheet"); if (!dlg || !dlg.open || !VIEWING) return;
  if (e.target === dlg) { closeViews(); return; }
  const t = e.target.closest("#viewsheet button"); if (!t) return;
  const d = t.dataset, target = VIEWING.target, byId = id => VIEWS.find(x => x.id === id);
  // The sheet again, and the list behind it (its chips name views), then the focus back where the tap was.
  const again = (sel, behind) => { if (behind) rerenderCurrent(); renderViews(); const el = $(sel) || $("#viewsheet-title"); if (el) el.focus(); };
  if (d.viewDone != null) { closeViews(); return; }
  if (d.viewUse) { closeViews(); useView(target, d.viewUse); return; }   // the list is the answer, so the sheet gets out of its way
  if (d.viewBase != null) { delete VIEWING.name; applyView(target, viewBase(target)); again("#viewsheet-title"); return; }
  if (d.viewSave != null) {
    const inp = $("#view-name"), v = saveView(target, inp ? inp.value : ""); if (!v) return;
    delete VIEWING.name; delete VIEWING.undo; again(`#viewsheet [data-view-use="${v.id}"]`, true); return;
  }
  if (d.viewPin) {
    const v = byId(d.viewPin), key = VIEW_TARGETS[target].key(); if (!v || !key) return;
    v.pins = v.pins.includes(key) ? v.pins.filter(p => p !== key) : [...v.pins, key]; v.updated = Date.now(); saveViews();
    again(`#viewsheet [data-view-pin="${v.id}"]`, true); return;
  }
  if (d.viewEdit) { VIEWING.edit = d.viewEdit; delete VIEWING.editName; renderViews(); const inp = $("#view-rename"); if (inp) { inp.focus(); inp.select(); } return; }
  if (d.viewRename) {
    const v = byId(d.viewRename), inp = $("#view-rename"), name = inp ? inp.value.trim().slice(0, 60) : "";
    const changed = !!(v && name && name !== v.name); if (changed) { v.name = name; v.updated = Date.now(); saveViews(); }
    delete VIEWING.edit; delete VIEWING.editName; again(v ? `#viewsheet [data-view-edit="${v.id}"]` : "#viewsheet-title", changed); return;
  }
  if (d.viewDel) {
    delete VIEWING.edit; delete VIEWING.editName;
    const i = VIEWS.findIndex(x => x.id === d.viewDel); if (i < 0) return;
    const [x] = VIEWS.splice(i, 1); saveViews(); VIEWING.undo = { x, i }; again("#viewsheet [data-view-undo]", true); return;
  }
  if (d.viewUndo != null) {
    const u = VIEWING.undo; if (!u) return;
    delete VIEWING.undo; u.x.updated = Date.now(); VIEWS.splice(Math.min(u.i, VIEWS.length), 0, u.x); saveViews();
    again(`#viewsheet [data-view-edit="${u.x.id}"]`, true);
  }
});
document.addEventListener("close", e => { if (e.target.id === "viewsheet") VIEWING = null; }, true);

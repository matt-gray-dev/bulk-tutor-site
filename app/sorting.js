"use strict";
// Bulk Tutor, the page's script, part "sorting": the Sort sheet: one way to order every list of cards, by up to three things.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ sorting (0.75.0)
// Matt, Nov 12: "an order by/sort by option would be great. Support for ordering by multiple filter values at once
// would be awesome. It shouldn't be locked to that view though, users should be able to sort and order boxes in their
// collection freely." A sort is the engine's (canonSort, sortCmp: keys in order as text, "-" before one turned
// round). Here: the words for each key and its two directions, the lists a sort applies to (SORT_TARGETS), and the
// sheet (#sortsheet) that changes one. A change shows at once in the list behind the sheet.
const SORT_NAMES = { name: "Name", letter: "First letter", color: "Color", ident: "Color identity", type: "Type", mv: "Mana value", price: "Price", qty: "Quantity", rar: "Rarity", set: "Set" };
// [the usual direction, turned round]
const SORT_WAYS = { name: ["A to Z", "Z to A"], letter: ["A to Z", "Z to A"], color: ["White first", "Colorless first"], ident: ["White first", "Colorless first"],
  type: ["Creatures first", "Lands first"], mv: ["Low to high", "High to low"], price: ["High to low", "Low to high"], qty: ["Most first", "Fewest first"],
  rar: ["Mythic first", "Common first"], set: ["Newest first", "Oldest first"] };
const BUILD_SORT_KEYS = ["name", "letter", "color", "ident", "type", "mv", "price"];
// Each list: the keys it offers (a saved decklist and a build have no copies, so no rarity or set), its sort now, and
// how a new one is taken. `box` (0.76.0) is a box's or binder's own order, kept with it (collection.js: locSort); its
// `arg` is the location, and it can be cleared.
const copyKeys = () => SORT_KEYS.filter(k => (k !== "rar" && k !== "set") || (!!COLL && COLL.entries.some(e => e.set || e.rar)));
const SORT_TARGETS = {
  browse: {
    keys: () => SORT_KEYS.filter(k => (k !== "rar" && k !== "set") || copyFiltersOffered()),
    get: () => BROWSE.sort,
    set: spec => { BROWSE.sort = spec; BROWSE.shown = 0; renderBrowse(); },
  },
  build: {
    keys: () => BUILD_SORT_KEYS,
    get: () => buildSort,
    set: spec => { buildSort = spec; store.set("bt.sort", spec); renderBuild(); },
  },
  box: {
    keys: copyKeys,
    get: loc => locSort(loc) || "name",
    set: (spec, loc) => setLocSort(loc, spec),
    title: loc => `Order inside ${locName(loc)}`,
    intro: "The order its cards are in, in the box itself. Its screen opens this way, and Assemble and the put-away list go through its cards in the same order.",
    isSet: loc => !!locSort(loc), clear: loc => setLocSort(loc, ""), clearText: "No order",
  },
};
const sortKeysFor = (target, arg) => SORT_TARGETS[target].keys(arg);
const sortOf = (target, arg) => canonSort(SORT_TARGETS[target].get(arg), sortKeysFor(target, arg));
function setSort(target, spec, arg) { SORT_TARGETS[target].set(canonSort(spec, sortKeysFor(target, arg)), arg); }
// A box's own order as a comparator for rows that have a name, a count and a price (Assemble's, a list by location's,
// the put-away list's), or null when it has none. `from` is where the copies being listed are (the box itself, or the
// put-away pile for cards on their way to it), for a sort by rarity or set.
function copyPrintIn(name, loc) {
  let rar = "", set = "", when = "";
  for (const x of ownCopies(name)) {
    if (x.e.loc !== loc) continue;
    const p = copyPrint(x.e), s = setOf(p.set), w = s ? s.released || "" : "";
    if (p.rar && SORT_RARS.includes(p.rar) && (!rar || SORT_RARS.indexOf(p.rar) < SORT_RARS.indexOf(rar))) rar = p.rar;
    if (p.set && (!set || w > when)) { set = p.set; when = w; }
  }
  return { rar, set };
}
function locSorter(loc, from = loc) {
  const spec = loc ? locSort(loc) : ""; if (!spec) return null;
  const memo = new Map(), print = x => { if (!memo.has(x.name)) memo.set(x.name, copyPrintIn(x.name, from)); return memo.get(x.name); };
  return sortCmp(spec, { qty: x => x.qty, price: x => x.price, rar: x => print(x).rar, set: x => print(x).set });
}
// "Color, type, first letter", and the short form a chip has room for: "color +2".
const sortText = spec => { const names = sortParts(spec).map(p => SORT_NAMES[p.k]); return names.map((n, i) => (i ? n.toLowerCase() : n)).join(", "); };
const sortShort = spec => { const p = sortParts(spec); return SORT_NAMES[p[0].k].toLowerCase() + (p.length > 1 ? ` +${p.length - 1}` : ""); };
// A table's header: a tap sorts by that column alone, and a second tap turns it round.
const headSort = (spec, k) => { const p = sortParts(spec); return p.length === 1 && p[0].k === k && !p[0].down ? "-" + k : k; };
// How a build's rows are read ({c, i}): the card's count and its price as the Workbench shows it.
const buildSorter = () => sortCmp(buildSort, { name: x => x.c.name, qty: x => x.c.qty, price: x => priceNum(x.c.name) });

// ------------------------------------------------------------ sorts from your views (0.81.0)
// Saved sorts (0.77.0) became views with the rest (views.js): a saved sort is a view with no filter. The Sort sheet
// still offers their sorts alone, so a box's own order can be set from one and a list can take a view's order
// without its filters: one row per sort among the views this list can sort by, named by the view that is nothing
// but that sort when there is one. The box keeps a copy of the sort, not a link.
function viewSorts(keys) {
  const seen = new Map();
  for (const v of VIEWS) {
    const s = canonSort(v.sort); if (s === "name" || canonSort(s, keys) !== s) continue;
    const plain = !Object.keys(v.f).length;
    if (!seen.has(s)) seen.set(s, { sort: s, title: plain ? v.name : sortText(s), plain });
    else if (plain && !seen.get(s).plain) Object.assign(seen.get(s), { title: v.name, plain: true });
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

// ------------------------------------------------------------ the Sort sheet
let SORTING = null;   // { target, arg } while the sheet is open
function openSort(target, arg = null) {
  if (!SORT_TARGETS[target]) return;
  SORTING = { target, arg }; renderSort(); openDlg($("#sortsheet"));
}
function closeSort() { SORTING = null; closeDlg($("#sortsheet")); }
function renderSort() {
  const body = $("#sortsheet-body"); if (!body || !SORTING) return;
  const T = SORT_TARGETS[SORTING.target], arg = SORTING.arg, keys = sortKeysFor(SORTING.target, arg), parts = sortParts(sortOf(SORTING.target, arg));
  // On a box's own screen, the sort on the screen can be kept as the box's order.
  const box = SORTING.target === "browse" && !BROWSE.saved && BROWSE.loc != null && canOrderLoc(BROWSE.loc) ? BROWSE.loc : null;
  const keep = box && sortOf("browse") !== (locSort(box) || "name") ? `<button class="btn link" data-sort-keep>Keep this as the order inside ${esc(locName(box))}</button>`
    : box && locSort(box) ? `<p class="muted small" id="sort-kept">This is the order inside ${esc(locName(box))}.</p>` : "";
  const ORD = ["First", "Then", "Then"], rows = parts.length < SORT_MAX ? [...parts, null] : parts;
  const row = (p, i) => {
    const used = new Set(parts.filter((x, j) => j !== i).map(x => x.k));
    const opts = `${i ? `<option value=""${p ? "" : " selected"}>${p ? "Nothing more" : "Add another…"}</option>` : ""}${keys.filter(k => !used.has(k)).map(k => `<option value="${k}"${p && p.k === k ? " selected" : ""}>${SORT_NAMES[k]}</option>`).join("")}`;
    const way = p ? SORT_WAYS[p.k] : null;
    return `<div class="sort-row"><label class="sort-n muted small" for="sort-k${i}">${ORD[i]}</label><select id="sort-k${i}" class="fselect" data-sort-k="${i}">${opts}</select>
      ${p ? `<button class="btn sort-way" data-sort-way="${i}" aria-label="${SORT_NAMES[p.k]}: ${way[p.down ? 1 : 0]}. Change to ${way[p.down ? 0 : 1]}">${way[p.down ? 1 : 0]}</button>` : `<span class="sort-way" aria-hidden="true"></span>`}</div>`;
  };
  // Sorts from your views: the ones this list can sort by, the one that is on marked. Saving, renaming and deleting are the Views sheet's.
  const now = sortOf(SORTING.target, arg), mine = viewSorts(keys), isOn = x => x.sort === now && (!T.isSet || T.isSet(arg));
  const savedHTML = !mine.length ? "" : `<section class="fgroup" id="sort-saved"><h3 class="flabel">From your views</h3>
      <div class="menu-list">${mine.map(x => `<div class="menu-item frow"><button class="btn sort-preset" data-sort-use="${esc(x.sort)}" aria-pressed="${isOn(x)}"><span class="mi-text"><span>${esc(x.title)}</span>${x.title.toLowerCase() === sortText(x.sort).toLowerCase() ? "" : `<small>${esc(sortText(x.sort))}</small>`}</span></button></div>`).join("")}</div>
      <p class="muted small">A view's sort alone, without its filters.</p></section>`;
  body.innerHTML = `<h2 id="sortsheet-title" tabindex="-1" autofocus>${T.title ? esc(T.title(arg)) : "Sort by"}</h2>
    <p class="muted small">${T.intro ? T.intro + " " : ""}Up to three things, in order: each one sorts the cards the one before leaves together. Tap an order to turn it round.</p>
    <div class="sort-rows">${rows.map(row).join("")}</div>${keep}${savedHTML}
    <div class="sheet-pair">${T.clear ? `<button class="btn" data-sort-reset${T.isSet(arg) ? "" : " disabled"}>${T.clearText}</button>`
      : `<button class="btn" data-sort-reset${parts.length === 1 && parts[0].k === "name" && !parts[0].down ? " disabled" : ""}>Back to name</button>`}<button class="btn primary" data-sort-done>Done</button></div>`;
}
const sortJoin = parts => parts.map(p => (p.down ? "-" : "") + p.k).join(" ");
document.addEventListener("change", e => {
  const i = e.target.dataset && e.target.dataset.sortK; if (i == null || !SORTING) return;
  const parts = sortParts(sortOf(SORTING.target, SORTING.arg)), k = e.target.value, at = +i;
  if (!k) parts.splice(at, 1); else parts[at] = { k, down: false };
  setSort(SORTING.target, sortJoin(parts), SORTING.arg); renderSort();
  const again = $(`#sort-k${Math.min(at, sortParts(sortOf(SORTING.target, SORTING.arg)).length)}`) || $("#sort-k0"); if (again) again.focus();
});
document.addEventListener("click", e => {
  const open = e.target.closest && e.target.closest("[data-sort-open]");
  if (open) { openSort(open.dataset.sortOpen, open.dataset.sortArg || null); return; }
  const dlg = $("#sortsheet"); if (!dlg || !dlg.open || !SORTING) return;
  if (e.target === dlg) { closeSort(); return; }
  const t = e.target.closest("#sortsheet button"); if (!t) return;
  if (t.dataset.sortDone != null) { closeSort(); return; }
  if (t.dataset.sortReset != null) { const T = SORT_TARGETS[SORTING.target]; if (T.clear) T.clear(SORTING.arg); else setSort(SORTING.target, "name"); renderSort(); const h = $("#sortsheet-title"); if (h) h.focus(); return; }
  if (t.dataset.sortKeep != null) { const loc = BROWSE.loc; setLocSort(loc, sortOf("browse")); renderSort(); const h = $("#sortsheet-title"); if (h) h.focus(); return; }
  if (t.dataset.sortUse) {
    const spec = t.dataset.sortUse; setSort(SORTING.target, spec, SORTING.arg); renderSort();
    const again = [...document.querySelectorAll("#sortsheet [data-sort-use]")].find(b => b.dataset.sortUse === spec); if (again) again.focus(); return;
  }
  if (t.dataset.sortWay != null) {
    const parts = sortParts(sortOf(SORTING.target, SORTING.arg)), p = parts[+t.dataset.sortWay]; if (!p) return;
    p.down = !p.down; setSort(SORTING.target, sortJoin(parts), SORTING.arg); renderSort();
    const again = $(`#sortsheet [data-sort-way="${t.dataset.sortWay}"]`); if (again) again.focus();
  }
});
document.addEventListener("close", e => { if (e.target.id === "sortsheet") SORTING = null; }, true);

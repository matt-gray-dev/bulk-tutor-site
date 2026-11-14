"use strict";
// Bulk Tutor, the page's script, part "find": Find decks (matching EDHREC decks against the collection), Combos, one EDHREC deck.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ matching
const cmdsOf = d => d.commanders || (d.commander != null ? [d.commander] : []);
function compute() {
  RESULTS = [];
  if (!DATA) return;
  for (const d of DATA.decks) {
    let owned = 0, free = 0, cost = 0;
    for (const i of d.cards) {
      const a = AGG.get(KEY[i]);
      if (a) { owned++; if (a.free > 0) free++; }
      else cost += DATA.cards[i][3] || 0;
    }
    const n = d.cards.length;
    RESULTS.push({ d, n, owned, free, indeck: owned - free, missing: n - owned, cost, cmdOwned: cmdsOf(d).length > 0 && cmdsOf(d).every(i => AGG.has(KEY[i])) });
  }
}

function filteredResults() {
  const q = norm($("#q").value);
  const sort = $("#sort").value;
  const maxCost = parseFloat($("#maxcost").value);
  const minDecks = parseInt($("#mindecks").value, 10) || 0;
  const ownCmd = $("#owncmd").checked, themes = $("#themes").checked, countDecks = $("#countdecks").checked;
  const pct = r => (countDecks ? r.owned : r.free) / r.n;
  const miss = r => countDecks ? r.missing : r.n - r.free;
  let list = RESULTS.filter(r =>
    (themes || !r.d.theme) &&
    (!q || norm(r.d.name).includes(q) || (r.d.theme && norm(r.d.theme.name).includes(q))) &&
    (!ownCmd || r.cmdOwned) &&
    (isNaN(maxCost) || r.cost <= maxCost) &&
    (!minDecks || r.d.deckCount == null || r.d.deckCount >= minDecks) &&
    (!colorSel.size || r.d.colors.split("").every(c => c === "C" || colorSel.has(c))));
  const sorters = {
    pct: (a, b) => pct(b) - pct(a) || a.cost - b.cost,
    missing: (a, b) => miss(a) - miss(b) || pct(b) - pct(a),
    cost: (a, b) => a.cost - b.cost || pct(b) - pct(a),
    pop: (a, b) => (b.d.deckCount || 0) - (a.d.deckCount || 0) || a.d.rank - b.d.rank,
  };
  return list.sort(sorters[sort]).map(r => ({ ...r, pct: pct(r), shownMissing: miss(r) }));
}

// ------------------------------------------------------------ render: decks
function renderColorFilter() {
  $("#colorfilter").innerHTML = COLORS.map(c =>
    `<button class="opt pip-opt" aria-pressed="${colorSel.has(c)}" data-color="${c}" aria-label="${COLOR_NAMES[c]}">${pip(c)}</button>`).join("");
}

function renderDecks() {
  const el = $("#deck-list");
  if (!DATA) { el.innerHTML = noDataHTML("Finding decks needs"); return; }
  if (!DATA.decks.length) { el.innerHTML = ""; return; }   // no decks to find: the tab is hidden and nothing opens this screen (main.js decksOffered)
  const list = filteredResults();
  $("#deck-chips").innerHTML = deckChipsHTML();
  const show = $("#dfilters-show"); if (show) show.textContent = list.length ? `Show ${list.length.toLocaleString()} deck${list.length === 1 ? "" : "s"}` : "No decks match";
  if (!list.length) { el.innerHTML = `<div class="empty panel"><p>No decks match these filters.</p></div>`; return; }
  const rows = list.slice(0, shown).map(r => {
    const freeW = (r.free / r.n * 100).toFixed(1);
    const deckW = $("#countdecks").checked ? (r.indeck / r.n * 100).toFixed(1) : 0;
    return `<button class="deck-row" data-deck="${RESULTS.indexOf(RESULTS.find(x => x.d === r.d))}">
      <span class="deck-name">${pips(r.d.colors)}<strong>${esc(r.d.name)}</strong>${r.d.theme ? `<span class="chip">${esc(r.d.theme.name)}</span>` : ""}${r.cmdOwned ? `<span class="chip own">${cmdsOf(r.d).length > 1 ? "Commanders" : "Commander"} owned</span>` : ""}</span>
      <span class="deck-pct num">${Math.round(r.pct * 100)}%</span>
      <span class="meter" aria-hidden="true"><span class="free" style="width:${freeW}%"></span><span class="indeck" style="width:${deckW}%"></span></span>
      <span class="deck-meta"><span class="num">${r.shownMissing} missing</span><span class="num price">${money(r.cost)} to finish</span>${r.d.deckCount ? `<span class="num${r.d.deckCount < 5 ? " thin" : ""}" title="EDHREC's average of ${r.d.deckCount.toLocaleString()} deck${r.d.deckCount === 1 ? "" : "s"}">${r.d.deckCount.toLocaleString()} deck${r.d.deckCount === 1 ? "" : "s"} on EDHREC</span>` : ""}</span>
    </button>`;
  }).join("");
  const more = list.length > shown ? `<div class="actions center gap-top"><button class="btn" id="more">Show more (${list.length - shown} left)</button></div>` : "";
  const legend = `<div class="legend"><span><i class="sw-free"></i>Owned and free</span>${$("#countdecks").checked ? `<span><i class="sw-deck"></i>In another deck</span>` : ""}<span><i class="sw-missing"></i>Missing</span></div>`;
  el.innerHTML = `<div class="count-row deck-count"><p class="muted small">${list.length.toLocaleString()} deck${list.length === 1 ? "" : "s"}</p>${legend}</div><div class="ledger">${rows}</div>${more}`;
}
// The chips above the list: one per filter that's on (tap to remove it), then Filters and Sort, which open the sheet.
const DECK_SORTS = { pct: "most owned", missing: "fewest missing", cost: "cheapest to finish", pop: "most popular" };
function deckChipsHTML() {
  const on = [], cost = parseFloat($("#maxcost").value), min = $("#mindecks").value;
  if (colorSel.size) on.push(["colors", `Within ${COLORS.filter(c => colorSel.has(c)).map(c => COLOR_NAMES[c]).join(", ")}`]);
  if (!isNaN(cost)) on.push(["cost", `Up to ${money(cost)} to finish`]);
  if (min) on.push(["min", `From ${min}+ decks`]);
  if ($("#owncmd").checked) on.push(["own", "Commanders you own"]);
  if (!$("#themes").checked) on.push(["themes", "No theme decks"]);
  if (!$("#countdecks").checked) on.push(["count", "Free cards only"]);
  return chipsHTML(on, "dclear", "data-dfilters-open", DECK_SORTS[$("#sort").value]);
}
function chipsHTML(on, clearAttr, openAttr, sortName) {
  return on.map(([k, text]) => `<button class="fchip on" data-${clearAttr}="${k}" aria-label="Remove filter: ${esc(text)}"><span>${esc(text)}</span><span class="fchip-x" aria-hidden="true">${MARK.remove}</span></button>`).join("")
    + `<button class="fchip" ${openAttr}>Filters${on.length ? ` · ${on.length}` : ""}</button><button class="fchip" ${openAttr}="sort">Sort: ${esc(sortName)}</button>`;
}
function clearDeckFilter(k) {
  const all = k === "all";
  if (all || k === "colors") colorSel.clear();
  if (all || k === "cost") $("#maxcost").value = "";
  if (all || k === "min") $("#mindecks").value = "";
  if (all || k === "own") $("#owncmd").checked = false;
  if (all || k === "themes") $("#themes").checked = true;
  if (all || k === "count") $("#countdecks").checked = true;
  shown = 40; renderColorFilter(); renderDecks();
}
const COMBO_SORTS = { pop: "most popular", cheap: "cheapest missing card" };
function comboChipsHTML() {
  const on = [], salt = $("#xsalt").value;
  if (xColorSel.size) on.push(["colors", `Within ${COLORS.filter(c => xColorSel.has(c)).map(c => COLOR_NAMES[c]).join(", ")}`]);
  if (salt) on.push(["salt", `Salt ${salt} or less`]);
  if (xTagOff.size) on.push(["tags", `Hiding ${Object.keys(BRACKET_TAGS).filter(k => xTagOff.has(k)).map(k => BRACKET_TAGS[k]).join(", ")}`]);
  if ($("#xfree").checked) on.push(["free", "Free cards only"]);
  if ($("#xplain").checked) on.push(["plain", "No other cards needed"]);
  return chipsHTML(on, "xclear", "data-xfilters-open", COMBO_SORTS[$("#xsort").value]);
}
function clearComboFilter(k) {
  const all = k === "all";
  if (all || k === "colors") xColorSel.clear();
  if (all || k === "salt") $("#xsalt").value = "";
  if (all || k === "tags") xTagOff.clear();
  if (all || k === "free") $("#xfree").checked = false;
  if (all || k === "plain") $("#xplain").checked = false;
  comboShown = { ready: 30, near: 30 }; renderComboColors(); renderComboTags(); renderCombos();
}
function openFilterSheet(id, focus) {
  const dlg = $(id); if (!dlg) return; openDlg(dlg);
  if (focus === "sort") { const sel = dlg.querySelector("select"); if (sel) sel.focus(); }
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-dfilters-open], [data-xfilters-open], [data-dclear], [data-xclear], [data-fsheet-close]");
  if (!t) { if (e.target.id === "dfilters" || e.target.id === "xfilters") closeDlg(e.target); return; }
  const d = t.dataset;
  if (d.dfiltersOpen != null) openFilterSheet("#dfilters", d.dfiltersOpen);
  else if (d.xfiltersOpen != null) openFilterSheet("#xfilters", d.xfiltersOpen);
  else if (d.dclear) clearDeckFilter(d.dclear);
  else if (d.xclear) clearComboFilter(d.xclear);
  else if (d.fsheetClose != null) { closeDlg(t.closest("dialog")); window.scrollTo({ top: 0 }); }
});

// ------------------------------------------------------------ combos
let combosState = "idle", comboShown = { ready: 30, near: 30 };
const xColorSel = new Set();
// Commander Spellbook's combo tags, from its API schema.
const BRACKET_TAGS = { E: "Exhibition", C: "Core", O: "Oddball", P: "Powerful", S: "Spicy", R: "Ruthless", B: "Banned" };
const xTagOff = new Set();
const featName = f => Array.isArray(COMBOS.features[f]) ? COMBOS.features[f][0] : COMBOS.features[f];
const featStatus = f => Array.isArray(COMBOS.features[f]) ? COMBOS.features[f][1] : "S";

async function loadCombos() {
  if (combosState !== "idle" || !DATA) return;       // combos point into the card table: nothing to do without it
  combosState = "loading";
  try {
    const c = await loadJSON("combos");
    if (!c) throw new Error("missing");
    // Combo card indices point into decks.json's card table, so both files must come from the same build.
    if (!DATA || c.version !== DATA.version) throw new Error("version mismatch");
    COMBOS = c;
    combosState = "ready";
  } catch (e) {
    COMBOS = null;
    combosState = e.message === "unreachable" ? "unreachable" : "missing";     // unreachable: asked again by "Try again" or when the connection returns
  }
  if (view === "combos") renderCombos();
  if (view === "deck") renderDeckCombos();
  if (view === "build") { renderBuildCombos(); paintBracket(); }
}

// Combos that didn't load for want of a connection (not for want of data): said plainly, and asked for again.
const combosDownText = () => offline() ? "You're offline, and combos aren't saved on this device yet. They load when you're back online." : "Combos didn't load. The site answered with an error.";
function retryCombos() { if (combosState !== "unreachable") return; combosState = "idle"; loadCombos(); if (view === "combos") renderCombos(); }

function spellbookUrl(id) { return id ? `https://commanderspellbook.com/combo/${encodeURIComponent(id)}/` : null; }

function comboStatus(cards, freeOnly) {
  const missing = [];
  for (const i of cards) {
    const a = AGG.get(KEY[i]);
    if (!a || (freeOnly && a.free <= 0)) missing.push(i);
  }
  return missing;
}

function cardChip(i, missingSet) {
  const c = DATA.cards[i], a = AGG.get(KEY[i]);
  if (!a) return `<span class="cc missing"><strong>${esc(c[0])}</strong><small class="num">not owned · ${c[3] ? money(c[3]) : "no price"}</small></span>`;
  const locs = [...a.locs.entries()].sort((x, y) => (x[1].inDeck - y[1].inDeck) || x[0].localeCompare(y[0]));
  const [loc, info] = locs[0];
  return `<span class="cc${info.inDeck ? " indeck" : ""}${missingSet.has(i) ? " missing" : ""}"><strong>${esc(c[0])}</strong><small>${esc(placeName(loc, info.inDeck))}${info.inDeck ? " · in deck" : ""}</small></span>`;
}

function comboTile(i, ms) {
  const c = DATA.cards[i], a = AGG.get(KEY[i]);
  let sub;
  if (!a) sub = `not owned${c[3] ? " · " + money(c[3]) : ""}`;
  else { const locs = [...a.locs.entries()].sort((x, y) => (x[1].inDeck - y[1].inDeck) || x[0].localeCompare(y[0])); sub = esc(locs[0][0]) + (locs[0][1].inDeck ? " · in deck" : ""); }
  return tileCell(`<button class="ctile${!a || ms.has(i) ? " missing" : ""}" data-sheet="combo" data-card="${esc(c[0])}" aria-label="${esc(c[0])}">${imgTag(c[0])}<span class="ccap">${sub}</span></button>`, c[0]);
}

function comboRow(c, missing) {
  const [id, cards, feats, identity, , flags, tag, salt] = c;
  const ms = new Set(missing);
  const main = feats.filter(f => featStatus(f) !== "H").map(featName);
  const extra = feats.filter(f => featStatus(f) === "H").map(featName);
  const lead = main.length ? main : extra.splice(0, 1);
  const shownFeats = lead.slice(0, 3).map(esc).join(" · ") + (lead.length > 3 ? ` <span class="muted">+${lead.length - 3} more</span>` : "")
    + (extra.length ? ` <span class="helper small">· also ${extra.slice(0, 2).map(esc).join(", ")}${extra.length > 2 ? "…" : ""}</span>` : "");
  const url = spellbookUrl(id);
  return `<div class="combo">
    ${shownView() === "list" ? `<div class="combo-cards">${cards.map(i => cardChip(i, ms)).join("")}</div>` : `<div class="combo-imgs">${cards.map(i => comboTile(i, ms)).join("")}</div>`}
    <div class="results-line">${shownFeats || '<span class="muted">See details for results</span>'}</div>
    <div class="combo-meta">${pips(identity)}${tag && BRACKET_TAGS[tag] ? `<span class="chip">${BRACKET_TAGS[tag]}</span>` : ""}${salt != null ? `<span class="num" title="Average player vote on how unfun this is to play against, 0 to 4">Salt ${salt.toFixed(1)}/4</span>` : ""}${flags & 1 ? `<span class="chip">Also needs other cards</span>` : ""}${url ? `<a href="${url}" target="_blank" rel="noopener">Steps on Commander Spellbook ↗</a>` : ""}</div>
  </div>`;
}

function renderComboTags() {
  $("#xtags").innerHTML = Object.entries(BRACKET_TAGS).map(([k, name]) =>
    `<button class="opt" aria-pressed="${!xTagOff.has(k)}" data-xtag="${k}">${name}</button>`).join("");
}

function renderComboColors() {
  $("#xcolors").innerHTML = COLORS.map(c =>
    `<button class="opt pip-opt" aria-pressed="${xColorSel.has(c)}" data-xcolor="${c}" aria-label="${COLOR_NAMES[c]}">${pip(c)}</button>`).join("");
}

function renderCombos() {
  const el = $("#combo-list");
  if ($("#xview")) $("#xview").innerHTML = viewToggleHTML();
  if (!DATA) { $("#combo-count").textContent = ""; el.innerHTML = noDataHTML("Combos need"); return; }
  if (combosState === "idle") { loadCombos(); }
  if (combosState === "idle" || combosState === "loading") { el.innerHTML = `<div class="empty panel"><p>Loading combos…</p></div>`; return; }
  if (!COMBOS && combosState === "unreachable") { el.innerHTML = `<div class="empty panel"><p>${combosDownText()}</p><div class="actions"><button class="btn" data-combos-retry>Try again</button></div></div>`; return; }
  if (!COMBOS) { el.innerHTML = `<div class="empty panel"><p>Combo data hasn't been built yet. It appears after the next data refresh.</p></div>`; return; }
  $("#combo-chips").innerHTML = comboChipsHTML();
  const q = norm($("#xq").value || "");
  const freeOnly = $("#xfree").checked, plain = $("#xplain").checked;
  const maxSalt = parseFloat($("#xsalt").value);
  const ready = [], near = [];
  for (const c of COMBOS.combos) {
    if (plain && (c[5] & 1)) continue;
    if (c[6] && xTagOff.has(c[6])) continue;
    if (!isNaN(maxSalt) && c[7] != null && c[7] > maxSalt) continue;
    if (xColorSel.size && !c[3].split("").every(ch => ch === "C" || xColorSel.has(ch))) continue;
    if (q && !c[1].some(i => KEY[i].includes(q)) && !c[2].some(f => norm(featName(f)).includes(q))) continue;
    const missing = comboStatus(c[1], freeOnly);
    if (missing.length === 0) ready.push({ c, missing });
    else if (missing.length === 1) near.push({ c, missing, cost: DATA.cards[missing[0]][3] || 0 });
  }
  if ($("#xsort").value === "cheap") near.sort((a, b) => a.cost - b.cost || b.c[4] - a.c[4]);
  $("#combo-count").textContent = `${ready.length.toLocaleString()} ready · ${near.length.toLocaleString()} one card away`;
  const show = $("#xfilters-show"); if (show) show.textContent = ready.length + near.length ? `Show ${(ready.length + near.length).toLocaleString()} combo${ready.length + near.length === 1 ? "" : "s"}` : "No combos match";
  const block = (key, title, sub, list) => `
    <div class="section-head"><h2>${title} <span class="muted small num">${list.length.toLocaleString()}</span></h2><span class="muted small">${sub}</span></div>
    ${list.length ? `<div class="ledger">${list.slice(0, comboShown[key]).map(x => comboRow(x.c, x.missing)).join("")}</div>
      ${list.length > comboShown[key] ? `<div class="actions center"><button class="btn" data-more="${key}">Show more (${list.length - comboShown[key]} left)</button></div>` : ""}`
    : `<div class="empty panel"><p>None${q || xColorSel.size || xTagOff.size || $("#xsalt").value || plain || freeOnly ? " with these filters" : " yet"}.</p></div>`}`;
  el.innerHTML = `<div class="filters">
    ${block("ready", "Ready to assemble", "You own every piece", ready)}
    ${block("near", "One card away", "Dashed card is the one to get", near)}
    <p class="muted small">Combo data from <a href="https://commanderspellbook.com" target="_blank" rel="noopener">Commander Spellbook</a>${COMBOS.demo ? " (demo examples only)" : `, ${COMBOS.combos.length.toLocaleString()} most popular combos`}.</p>
  </div>`;
}

function renderDeckCombos() {
  const box = $("#deck-combos"); if (!box) return;
  const x = $("#view-deck")._deck; if (!x) return;
  if (combosState === "idle") loadCombos();
  if (!COMBOS) { box.hidden = combosState !== "loading"; box.innerHTML = `<h3>Combos in this list</h3><p class="muted small">Loading…</p>`; return; }
  const inDeck = new Set(x.d.cards);
  const found = COMBOS.combos.filter(c => c[1].every(i => inDeck.has(i)));
  box.hidden = false;
  box.innerHTML = `<h3>Combos in this list <span class="muted small">· ${found.length}</span></h3>
    ${found.length ? `<div class="ledger">${found.slice(0, 8).map(c => comboRow(c, comboStatus(c[1], false))).join("")}</div>${found.length > 8 ? `<p class="muted small">Showing the 8 most popular.</p>` : ""}`
      : `<p class="muted small">No known combos are made entirely of cards in this list.</p>`}`;
}

// ------------------------------------------------------------ render: deck detail
function edhrecUrl(d) { return `https://edhrec.com/commanders/${d.slug}${d.theme ? "/" + d.theme.slug : ""}`; }

function openDeck(i, keepScroll) {
  const r = RESULTS[i]; if (!r) return;
  curDeckIdx = i;
  const d = r.d;
  const cmdSet = new Set(cmdsOf(d));
  const groups = pullGroups(d.cards.map(ci => ({ name: DATA.cards[ci][0], qty: 1, cmd: cmdSet.has(ci) })));
  const have = groups.filter(g => g.kind !== "missing"), miss = groups.find(g => g.kind === "missing");
  const missing = miss ? miss.items : [];
  const ownedCount = have.reduce((n, g) => n + g.items.length, 0);
  const title = d.name + (d.theme ? " · " + d.theme.name : "");
  const deckIdent = new Set(d.colors.split("").filter(ch => ch !== "C"));
  const imageGroups = groups.map(g => ({ title: g.kind === "indeck" ? `In deck: ${g.deck || g.title}` : g.title, items: g.items.map(it => ({ name: it.name, qty: it.qty,
    sub: g.kind === "missing" ? (it.price ? money(it.price) : "") : "", tone: g.kind === "missing" ? "missing" : g.kind === "indeck" ? "indeck" : "", mv: (cardOf(it.name) || [])[4] })) }));
  const deckNames = new Set(d.cards.map(ci => KEY[ci]));

  const el = $("#view-deck");
  el.innerHTML = `
    <div class="detail-head">
      <div class="actions"><button class="btn" id="back">${MARK.back} All decks</button></div>
      <div>
        <p class="eyebrow">${d.theme ? esc(d.theme.name) + " theme" : "Average deck"}${d.deckCount ? ` · built from ${d.deckCount.toLocaleString()} deck${d.deckCount === 1 ? "" : "s"}` : ""}${d.fetched ? ` · <span title="When Bulk Tutor last checked this deck on EDHREC">checked ${esc(dataDate(d.fetched))}</span>` : ""}</p>
        <h2 class="title-row">${esc(d.name)} ${pips(d.colors)}</h2>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="eyebrow">Owned</div><div class="v num">${Math.round(r.owned / r.n * 100)}%</div><div class="muted small num">${r.owned} of ${r.n}</div></div>
        <div class="stat"><div class="eyebrow">Free to use</div><div class="v num">${r.free}</div><div class="muted small num">${r.indeck} in other decks</div></div>
        <div class="stat"><div class="eyebrow">Missing</div><div class="v num">${r.missing}</div><div class="muted small">cards to get</div></div>
        <div class="stat"><div class="eyebrow">To finish</div><div class="v num value">${money(r.cost)}</div><div class="muted small">market price</div></div>
      </div>
      <div class="actions">
        <button class="btn primary" id="build-from-deck">Build from this list</button>
        <button class="btn" id="copy-pull">Copy list by location</button>
        <button class="btn" id="dl-pull">Download CSV</button>
        ${missing.length ? `<button class="btn" id="copy-missing">Copy missing list</button>` : ""}
        <a class="btn" href="${edhrecUrl(d)}" target="_blank" rel="noopener">View on EDHREC ↗</a>
      </div>
      <p class="muted small">“Build from this list” copies it onto the Workbench so you can swap cards, then gather the cards and export your version.</p>
      <div id="copy-out"></div>
    </div>
    <div class="section-head"><h3>Cards</h3>${viewToggleHTML()}</div>
    ${shownView() !== "list" ? `<div class="panel">${cardGroupsHTML(imageGroups, "deck")}</div>` : `<div class="cols">
      <div class="panel">
        <h3>Where your cards are <span class="muted small">· ${ownedCount} owned</span></h3>
        ${have.length ? groupsHTML(have) : `<p class="muted">You don't own any cards from this list yet.</p>`}
      </div>
      <div class="panel">
        <h3>Missing <span class="muted small">· most expensive first</span></h3>
        ${hasRoles() && missing.length ? `<p class="muted small">Under each card: cards you own that do the same job, in these colors.</p>` : ""}
        ${missing.length ? `<div class="list">${missing.map(m => {
          const subs = substitutes(m.name, { identity: deckIdent, exclude: deckNames });
          const roles = roleList(roleBits(m.name)).filter(r => ROLE_COUNTED.includes(r));
          return `<div class="line"><span class="name">${esc(m.name)}${subs.length ? `<span class="subs">${roles.length ? esc(roles.join(", ")) + " · " : ""}instead: ${subs.map(x => `<b>${esc(x.name)}</b> (${subWhere(x.st)})`).join(", ")}</span>` : ""}</span><span class="price num">${m.price ? money(m.price) : "—"}</span></div>`;
        }).join("")}</div>` : `<p>You own every card in this list.</p>`}
      </div>
    </div>`}
    ${hasRoles() ? `<div class="panel"><h3>By role</h3>${roleCountsHTML(d.cards.map(ci => ({ name: DATA.cards[ci][0], qty: 1 })))}</div>` : ""}
    <div class="panel" id="deck-combos" hidden></div>`;
  el._deck = { d, missing, owned: have.flatMap(g => g.items), groups, title };
  showView("deck");
  renderDeckCombos();
  if (!keepScroll) window.scrollTo({ top: 0 });
}

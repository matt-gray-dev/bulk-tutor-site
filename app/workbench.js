"use strict";
// Bulk Tutor, the page's script, part "workbench": the Workbench: a build's rows and lists, renderBuild, its combos panel, the decklist box, its buttons and events.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

let buildRole = null, buildGroup = "type", buildSort = "name";
const ROW_WHY = new Set();
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-row-why]"); if (!t) return;
  const k = norm(t.dataset.rowWhy); if (ROW_WHY.has(k)) ROW_WHY.delete(k); else ROW_WHY.add(k);
  renderBuild();
});
const buildCollapsed = new Set();
// While several cards are being selected (builds.js: SEL), a row is one tick: the card's name, cost and where it is, and
// no buttons. list = "deck" | "side". Its state is painted by selPaint, like every tick.
function pickRowHTML(b, c, list, home) {
  const st = cardStatus(c.name, c.qty, home), card = DATA && cardOf(c.name);
  const where = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? (list === "side" ? "in this deck's box" : "in this deck") : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>`
    : st.kind === "basic" ? "basic land" : `<span class="warn">missing</span>${card && card[3] ? " · " + money(card[3]) : ""}`;
  const cost = card && card[2] !== "L" ? costOf(c.name) : null;
  const mv = cost ? `<span class="mv-cost" title="Mana value ${card[4] || 0}">${manaHTML(cost)}</span>`
    : card && card[2] !== "L" ? `<span class="mv num" title="Mana value">${card[4] || 0}</span>` : "";
  const note = list === "deck" && isCmd(b, c.name) ? " · commander" : list === "deck" && isComp(b, c.name) ? " · companion" : list === "deck" && isKept(b, c.name) ? ` · <span class="kept">kept</span>` : "";
  return `<label class="brow sel-row" data-pick="${list}" data-card="${esc(c.name)}"><input type="checkbox" data-sel-box aria-label="Select ${esc(c.name)}">
    <div class="bname"><strong>${c.qty > 1 ? `<span class="num">${c.qty}×</span> ` : ""}${esc(c.name)}${mv}</strong><small>${where}${note}</small></div></label>`;
}
function buildRowHTML(b, c, i, ident, home) {
  if (selOn(b)) return pickRowHTML(b, c, "deck", home);
  const st = cardStatus(c.name, c.qty, home), card = DATA && cardOf(c.name);
  const outside = ident && card && [...card[1]].some(ch => ch !== "C" && !ident.has(ch));
  const where = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? "in this deck" : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>`
    : st.kind === "basic" ? "basic land" : `<span class="warn">missing</span>${card && card[3] ? " · " + money(card[3]) : ""}`;
  const canSwap = hasRoles() && !isCmd(b, c.name) && (st.kind === "missing" || st.kind === "indeck") && roleBits(c.name);
  const swapOpen = canSwap && (showAllSwaps || openSwaps.has(norm(c.name)));
  let swaps = "";
  if (swapOpen) {
    const subs = substitutes(c.name, { identity: ident, exclude: new Set([...b.cards.map(x => norm(x.name)), ...sideKeys(b)]) });
    const roles = roleList(roleBits(c.name)).filter(r => ROLE_COUNTED.includes(r));
    swaps = `<div class="swaps"><span class="muted small">${subs.length ? `Swap for a card you own (${esc(roles.join(", "))}):` : `No cards you own do the same job${ident ? " in these colors" : ""}.`}</span>
      ${subs.map(x => `<button class="swap-opt" data-swap="${i}" data-with="${esc(x.name)}"><strong>${esc(x.name)}</strong><small>${subWhere(x.st)}</small></button>`).join("")}</div>`;
  }
  const qty = isBasic(c.name) ? `<span class="qty"><button class="icon" data-dec="${i}" aria-label="One fewer ${esc(c.name)}">${MARK.fewer}</button><span class="num">${c.qty}</span><button class="icon" data-inc="${i}" aria-label="One more ${esc(c.name)}">${MARK.more}</button></span>` : "";
  const cost = card && card[2] !== "L" ? costOf(c.name) : null;
  const mv = cost ? `<span class="mv-cost" title="Mana value ${card[4] || 0}">${manaHTML(cost)}</span>`
    : card && card[2] !== "L" ? `<span class="mv num" title="Mana value">${card[4] || 0}</span>` : "";
  // The reason a card is here sits behind an "i", so the list stays short.
  const reason = b.why && b.why[c.name] && !isCmd(b, c.name) ? b.why[c.name] : null, whyOpen = reason && ROW_WHY.has(norm(c.name));
  const why = (isKept(b, c.name) && !isCmd(b, c.name) ? ` · <span class="kept">kept</span>` : "")
    + (reason ? ` <button class="info-btn" data-row-why="${esc(c.name)}" aria-expanded="${!!whyOpen}" aria-label="Why ${esc(c.name)} is here" title="Why it's here">${MARK.info}</button>` : "");
  const toSide = sideShown(b) && !isCmd(b, c.name) && !isComp(b, c.name) ? `<button class="icon" data-toside="${i}" aria-label="Move ${esc(c.name)} to the sideboard" title="To the sideboard">${MARK.toSide}</button>` : "";
  return `<div class="brow"><div class="bname"><strong>${esc(c.name)}${mv}</strong>${outside ? ` <span class="chip warn-chip">outside colors</span>` : ""}<small>${where}${why}</small>${whyOpen ? `<small class="why-line">${esc(reason)}</small>` : ""}</div>
    <div class="bact">${qty}${canSwap ? `<button class="icon${swapOpen ? " on" : ""}" data-swaps="${i}" aria-label="Show swaps for ${esc(c.name)}" title="Swaps you own">${MARK.swaps}</button>` : ""}${isCompanionCard(c.name) ? `<button class="pill-toggle${isComp(b, c.name) ? " on" : ""}" data-comp="${i}" aria-pressed="${isComp(b, c.name)}" title="Companion: outside the 100">Companion</button>` : ""}<button class="icon${isCmd(b, c.name) ? " on" : ""}" data-cmd="${i}" aria-label="${isCmd(b, c.name) ? "Unset" : "Set"} ${esc(c.name)} as commander" title="Commander">${MARK.commander}</button>${toSide}<button class="icon" data-rm="${i}" aria-label="Remove ${esc(c.name)}">${MARK.removeRow}</button></div></div>${swaps}`;
}
// A sideboard card's row: where it is, back to the deck, or out of the sideboard. j = its place in b.side.
function sideRowHTML(b, c, j, home) {
  if (selOn(b)) return pickRowHTML(b, c, "side", home);
  const st = cardStatus(c.name, c.qty, home), card = DATA && cardOf(c.name);
  const where = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? "in this deck's box" : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>`
    : st.kind === "basic" ? "basic land" : `<span class="warn">missing</span>${card && card[3] ? " · " + money(card[3]) : ""}`;
  const cost = card && card[2] !== "L" ? costOf(c.name) : null;
  const mv = cost ? `<span class="mv-cost" title="Mana value ${card[4] || 0}">${manaHTML(cost)}</span>`
    : card && card[2] !== "L" ? `<span class="mv num" title="Mana value">${card[4] || 0}</span>` : "";
  return `<div class="brow side-row"><div class="bname"><strong>${c.qty > 1 ? `<span class="num">${c.qty}×</span> ` : ""}${esc(c.name)}${mv}</strong><small>${where}</small></div>
    <div class="bact"><button class="icon" data-todeck="${j}" aria-label="Move ${esc(c.name)} to the deck" title="To the deck">${MARK.toDeck}</button><button class="icon" data-side-rm="${j}" aria-label="Remove ${esc(c.name)} from the sideboard">${MARK.removeRow}</button></div></div>`;
}
// The sideboard under the list, in whichever view the list is shown; with none yet, a line that offers one.
const SIDE_NOTE = "Kept with the deck, outside the 100.";
const sideHow = () => (shownView(true) === "list" ? `Tap ${MARK.toSide} on a card you keep with the deck but don't play: it goes to the sideboard, outside the 100.`
  : "Tap a card you keep with the deck but don't play, then “Move to sideboard”: it stays with the deck, outside the 100.");
// Over 100 cards, the list opens with what to do about it (his Marchesa box holds 119: the deck and its sideboard).
const sideHintHTML = b => (deckOver(b) ? `<p class="small side-hint"><strong>Over 100 cards?</strong> ${sideHow()}</p>` : "");
const sideItems = (b, qf) => sideOf(b).map((c, j) => ({ c, i: j, side: true })).filter(x => quickMatch(x.c.name, qf)).sort(buildSorter());
function sideListHTML(b, home, qf) {
  const all = sideOf(b), items = sideItems(b, qf);
  if (!all.length) {
    if (deckOver(b)) return "";   // the list's first line says how (sideHintHTML)
    if (SIDE_PICK === b.id) return `<p class="muted small side-offer">${sideHow()} <button class="btn link small" data-side-pick="off">Done</button></p>`;
    return `<p class="muted small side-offer">No sideboard. <button class="btn link small" data-side-pick="on">Choose cards for one</button></p>`;
  }
  if (!items.length) return "";
  if (shownView(true) === "table") return "";   // the table takes the sideboard as its last group (buildListHTML)
  const pick = selOn(b);
  if (shownView(true) !== "list") return cardGroupsHTML([{ title: "Sideboard", tick: pick, items: items.map(({ c, i }) => statusItem(c.name, c.qty, home, { i, ...(pick ? { pick: "side" } : {}) })) }], "side");
  return `<details class="grp side-grp" data-grp="side"${buildCollapsed.has("side") ? "" : " open"}>
      <summary class="loc-head">${pick ? grpTickHTML("Sideboard") : ""}<h3>Sideboard</h3><span class="muted small num">${items.reduce((n, x) => n + x.c.qty, 0)}</span></summary>
      <p class="muted small">${SIDE_NOTE}</p>
      <div class="list">${items.map(({ c, i }) => sideRowHTML(b, c, i, home)).join("")}</div>
    </details>`;
}

function buildListHTML(b, ident, home) {
  const groups = new Map(), order = [], qf = buildQuick(b);
  const keyOf = (c) => {
    if (isCmd(b, c.name)) return ["cmd", b.commanders.length > 1 ? "Commanders" : "Commander"];
    if (isComp(b, c.name)) return ["cmp", "Companion"];
    if (buildGroup === "role") { const r = primaryRole(c.name); return r ? ["r:" + r, r] : ["r:", "Other"]; }
    if (buildGroup === "location") {
      const st = cardStatus(c.name, c.qty, home);
      return st.kind === "free" ? ["l:0:" + st.loc, st.loc] : st.kind === "here" ? ["l:1:", "In this deck"] : st.kind === "indeck" ? ["l:2:" + st.loc, "In deck: " + st.loc]
        : st.kind === "basic" ? ["l:3:", "Basic lands"] : ["l:4:", "Missing"];
    }
    const t = typeOf(c.name); return ["t:" + typeRank(t), TYPE_NAMES[t] || "Other"];
  };
  b.cards.forEach((c, i) => { if (!quickMatch(c.name, qf)) return; const [k, label] = keyOf(c); if (!groups.has(k)) { groups.set(k, { label, items: [] }); order.push(k); } groups.get(k).items.push({ c, i }); });
  const roleOrder = r => { const i = ROLE_COUNTED.indexOf(r.slice(2)); return i < 0 ? 99 : i; };
  order.sort((a, b2) => a === "cmd" ? -1 : b2 === "cmd" ? 1 : a === "cmp" ? -1 : b2 === "cmp" ? 1
    : buildGroup === "role" ? roleOrder(a) - roleOrder(b2)
    : buildGroup === "type" ? +a.slice(2) - +b2.slice(2) : a.localeCompare(b2, undefined, { numeric: true }));
  const table = shownView(true) === "table", side = sideListHTML(b, home, qf), sideRows = table ? sideItems(b, qf) : [], sideTable = sideRows.length ? [{ title: "Sideboard", items: sideRows }] : [];
  if (!order.length) return (b.cards.length || quickOn(qf) ? `<p class="muted">No cards in ${sideOf(b).length ? "the deck" : "this build"} match these filters.</p>` : `<p class="muted">The deck is empty. Add cards above.</p>`)
    + (sideTable.length ? buildTableHTML(b, sideTable, home) : side);
  if (table) return buildTableHTML(b, [...order.map(k => { const g = groups.get(k); g.items.sort(buildSorter()); return { title: g.label, items: g.items }; }), ...sideTable], home) + side;
  const pick = selOn(b);
  if (shownView(true) !== "list") return cardGroupsHTML(order.map(k => {
    const g = groups.get(k); g.items.sort(buildSorter());
    return { title: g.label, tick: pick, items: g.items.map(({ c, i }) => statusItem(c.name, c.qty, home, { i, ...(pick ? { pick: "deck" } : {}) })) };
  }), "build") + side;
  return order.map(k => {
    const g = groups.get(k); g.items.sort(buildSorter());
    return `<details class="grp" data-grp="${esc(k)}"${buildCollapsed.has(k) ? "" : " open"}>
      <summary class="loc-head">${pick ? grpTickHTML(g.label) : ""}<h3>${esc(g.label)}</h3><span class="muted small num">${g.items.reduce((n, x) => n + x.c.qty, 0)}</span></summary>
      <div class="list">${g.items.map(({ c, i }) => buildRowHTML(b, c, i, ident, home)).join("")}</div>
    </details>`;
  }).join("") + side;
}

function renderBuild() {
  const el = $("#view-build"); if (!el) return;
  if (!DATA) { el.innerHTML = `<div class="filters">${noDataHTML("Builds need")}</div>`; syncWakeLock(); return; }   // a build can't be drawn without the card table
  const b = curBuild();
  const shared = SHARED_BUILD ? `<div class="banner info"><span><strong>Shared build:</strong> ${esc(SHARED_BUILD.name)} (${SHARED_BUILD.cards.length} cards)</span><span class="actions"><button class="btn primary" id="shared-add">Add to your builds</button><button class="btn" id="shared-dismiss">Dismiss</button></span></div>` : "";
  // The switcher opens the Your builds sheet (switch, or start a new one); Actions opens the build's actions sheet.
  const switcher = (name, sub) => `<button class="build-switch" id="build-switch" aria-haspopup="dialog"><span class="bs-text"><small>${sub}</small><span class="bs-name">${name}</span></span><span class="chev" aria-hidden="true">${MARK.open}</span></button>`;
  const yours = `Your builds${BUILDS.length > 1 ? ` <span class="num">(${BUILDS.length})</span>` : ""}`;
  if (!b || buildMode === "new") {
    const bar = BUILDS.length ? `<div class="build-head">${switcher("New build", yours)}</div>` : "";
    el.innerHTML = `<div class="filters">${shared}${bar}${buildNewPanel()}</div>`; syncWakeLock(); return;
  }

  if (SEL && SEL.id !== b.id) SEL = null;   // the selection belongs to one build
  if (SEL) selPrune(b);
  const home = buildHome(b), s = buildStats(b), ident = buildIdentity(b);
  const diff = 100 - s.total;
  const src = home ? `<p class="muted small">${buildForDeck(home) === b ? `Your deck in <strong>${esc(locName(home))}</strong>` : `Tuning your deck <strong>${esc(deckName(home))}</strong>`}. Cards already in it are marked “in this deck”.</p>`
    : b.source && b.source.slug ? `<p class="muted small">Started from the EDHREC ${b.source.theme ? esc(b.source.theme.name) + " " : "average "}list for ${esc(b.source.name)}. <a href="https://edhrec.com/commanders/${esc(b.source.slug)}${b.source.theme ? "/" + esc(b.source.theme.slug) : ""}" target="_blank" rel="noopener">View on EDHREC ↗</a></p>` : "";
  const gen = b.source && b.source.kind === "generated" ? b.source : null;
  // Notes about where the build came from. The EDHREC line (credit and link) shows in every mode; the rest only in Edit list.
  const genNote = gen && buildMode === "list" ? `<p class="muted small">Generated from your collection${themeNames(gen.themes || 0).length || (gen.tribes || []).length ? ` around ${esc([...(gen.tribes || []).map(t => DATA.subtypes[t]), ...themeNames(gen.themes || 0)].join(", "))}` : ""}. Tap a card for why it's here, to drop it from this build, or to stop suggesting it.</p>
      ${b.alwaysMissing && b.alwaysMissing.length ? `<p class="small">Left out of your Always cards: ${b.alwaysMissing.map(x => `${esc(x.name)} (${x.where ? `in ${esc(x.where)}` : "no copy in your collection"})`).join(", ")}.${b.alwaysMissing.some(x => x.where) && !gen.useDecks ? " Tune › “Also use cards that are in your other decks” lets them in." : ""}</p>` : ""}
      ${b.genShort ? `<p class="small">You don't own enough cards in these colors to fill every slot, so it's ${cardsWord(b.genShort)} short. The ideas below would help fill it.</p>` : ""}` : "";
  const sd = savedFor(b);
  const savedNote = sd && buildMode === "list" ? `<p class="muted small">Saved as <strong>${esc(sd.name)}</strong> in your decks on ${shortDate(sd.saved)}. Actions › Update saved deck copies your changes there.</p>` : "";
  const issues = buildMode === "list" ? deckCheck(b).filter(i => i.ok === false).length : 0;
  const bracketShown = DATA && buildMode !== "pull" && b.cards.length;
  const jumps = issues || bracketShown ? `<div class="jump-row">${issues ? `<button class="btn link small check-jump" data-goto-check>Deck check: ${issues} to fix ${MARK.jump}</button>` : ""}${bracketShown ? `<button class="btn link small bracket-jump" id="bracket-jump" data-goto-bracket>${bracketJumpText(bracketEstimate(b))}</button>` : ""}</div>` : "";
  const tile = (label, v, sub = "", cls = "") => `<div class="stat"><div class="eyebrow">${label}</div><div class="v num">${v}</div>${sub ? `<div class="muted small${cls}">${sub}</div>` : ""}</div>`;
  const stats = `<div class="stat-row stat-strip" style="--n:${home ? 5 : 4}">
      ${tile("Cards", s.total, diff > 0 ? `${diff} short` : diff < 0 ? `${-diff} over` : "of 100")}
      ${home ? tile("In deck", s.here) : ""}
      ${tile(home ? "To gather" : "Ready", s.free, s.basic ? `+ ${s.basic} basic` : "")}
      ${tile("In decks", s.indeck)}
      ${tile("Missing", s.missing, s.missing ? money(s.cost) : "", " num value")}
    </div>`;
  const hsNote = b.hotswap ? `<div class="jump-row hs-note"><span class="muted small">${b.hotswap.versions ? "Versions" : "Hot-swap"}: ${esc(hsLabels(b.hotswap, b.hotswap.styles))}. Playing <strong>${esc(hsLabel(b.hotswap, b.hotswap.active))}</strong>.</span>${buildMode === "pull" ? "" : `<button class="btn link small hs-jump" data-buildmode="pull">Switch in Assemble ${MARK.go}</button>`}</div>` : "";
  const head = `<div class="build-head">${switcher(esc(b.name), yours)}<button class="btn" id="build-menu" aria-haspopup="dialog">Actions</button></div>
    ${src}${buildMode === "list" ? listNoteHTML(b, "build-note-text") : ""}${hsNote}${genNote}${savedNote}
    <div class="seg seg-fill build-modes" role="group" aria-label="View">
      <button data-buildmode="list" aria-pressed="${buildMode === "list"}">Edit list</button>
      <button data-buildmode="tune" aria-pressed="${buildMode === "tune"}">Tune</button>
      <button data-buildmode="pull" aria-pressed="${buildMode === "pull"}">Assemble</button>
    </div>
    ${stats}
    ${jumps}`;

  let main, side;
  if (buildMode === "tune") {
    main = tuneMainHTML(b);
    side = `${templateCompareHTML(b, templateById(b.templateId))}${manaNumbersHTML(b)}${b.cards.length ? bracketPanelHTML(b) : ""}${curveHTML(deckCards(b))}`;
  } else if (buildMode === "pull") {
    const groups = buildPullGroups(b);
    const toPull = groups.filter(g => g.kind !== "missing" && g.kind !== "here"), miss = groups.find(g => g.kind === "missing"), here = groups.find(g => g.kind === "here");
    const total = toPull.reduce((n, g) => n + g.items.length, 0);
    const done = toPull.reduce((n, g) => n + g.items.filter(it => b.pulled[it.name]).length, 0);
    main = `${b.hotswap ? hsAssembleHTML(b) : ""}<div class="panel">
        <div class="section-head build-bar"><h3>${home ? "Changes" : "Gather these cards"} <span class="muted small num">· ${done} of ${total} ${home ? "done" : "found"}</span></h3>
          <label class="check small"><input type="checkbox" id="build-hidepulled"${buildHidePulled ? " checked" : ""}> Hide ${home ? "done" : "found"}</label></div>
        <div class="meter" aria-hidden="true"><span class="free" style="width:${total ? (done / total * 100).toFixed(1) : 0}%"></span></div>
        ${navigator.wakeLock ? `<p class="muted small">Your screen stays on while this list is open.</p>` : ""}
        ${toPull.length ? groupsHTML(toPull, { pulled: b.pulled, hidePulled: buildHidePulled }) : `<p class="muted">${home ? "No changes from your deck yet." : "Nothing in this build is in your collection yet."}</p>`}
        ${done ? `<div class="actions"><button class="btn" id="build-reset-pulled">Clear checkmarks</button></div>` : ""}
      </div>
      ${miss ? `<div class="panel">${groupsHTML([miss])}</div>` : ""}
      ${here ? `<details class="panel"><summary class="section-head"><h3>Already in ${esc(locName(home))}</h3><span class="muted small num">${groupQty(here)}</span></summary>${groupsHTML([here])}</details>` : ""}
      ${b.hotswap ? hsSwapsPanelHTML(b) : ""}
      ${tokensHostHTML("build")}`;
    side = `${buyPanelHTML(b)}${keepOfferHTML()}<p class="muted small">Once the deck is together, ${home ? "move the cards in ManaBox too" : "make a deck binder for it in ManaBox and move these cards into it"}, so they show up correctly here. To copy or download this list, use Actions.</p>`;
  } else {
    main = `<div class="panel">
        <label class="search-field">${SEARCH_ICON}<input type="search" id="bq" aria-label="Add a card" placeholder="Add a card (yours come first)" autocomplete="off" enterkeyhint="done"></label>
        <div id="bresults" class="results"></div>
        ${addListHTML(b)}
        ${diff > 0 && b.source && b.source.slug ? `<p class="muted small">EDHREC lists leave out basic lands. Search for them to add as many as you need.</p>` : ""}
      </div>
      <div class="panel">
        ${b.cards.length || sideOf(b).length ? buildQuickHTML(b) : ""}
        <div class="view-row">
          <div class="field"><label for="build-group">Group by</label><select id="build-group" class="fselect">
            <option value="type"${buildGroup === "type" ? " selected" : ""}>Card type</option>
            ${hasRoles() ? `<option value="role"${buildGroup === "role" ? " selected" : ""}>Role</option>` : ""}
            <option value="location"${buildGroup === "location" ? " selected" : ""}>Location</option></select></div>
          <div class="field"><span class="flabel-sm" id="build-sort-label">Sort by</span><button class="btn sort-open" id="build-sort" data-sort-open="build" aria-haspopup="dialog" aria-describedby="build-sort-label">${esc(sortText(sortOf("build")))}</button></div>
          <div class="field show-as"><span class="flabel-sm" id="build-showas">Show as</span>${viewToggleHTML(true)}</div>
        </div>
        ${!selOn(b) && shownView(true) !== "list" && hasRoles() && (s.missing || s.indeck) ? `<p class="muted small">Tap a card for details and swaps.</p>` : ""}
        ${!selOn(b) && shownView(true) === "list" && hasRoles() && (s.missing || s.indeck) ? `<label class="check small"><input type="checkbox" id="build-allswaps"${showAllSwaps ? " checked" : ""}> Show swaps for every missing card and card in another deck</label>` : ""}
        ${selOn(b) ? "" : sideHintHTML(b)}
        ${selLineHTML(b)}
        ${b.cards.length || sideOf(b).length ? buildListHTML(b, ident, home) : `<p class="muted">This build is empty. Add cards above.</p>`}
      </div>
      ${tokensHostHTML("build")}
      <div class="panel" id="build-combos" hidden></div>
      ${selOn(b) ? `<div class="selbar" id="selbar" role="region" aria-label="Selected cards"></div>` : ""}`;
    side = `${deckCheckHTML(b)}${b.cards.length ? bracketPanelHTML(b) : ""}
      ${hasRoles() ? `<div class="panel"><div class="section-head"><h3>Roles</h3><span class="muted small">Tap one to see cards you own</span></div>${roleCountsHTML(deckCards(b), { clickable: true, active: buildRole })}${buildRole ? roleBrowseHTML(b, buildRole) : ""}</div>` : ""}
      ${curveHTML(deckCards(b))}${handPanelHTML(b)}${gen ? genIdeasHTML(b) : ""}${historyHTML(b)}`;
  }
  el.innerHTML = `<div class="filters">${shared}${head}${builtBannerHTML(b)}${overhaulNoteHTML(b)}
    <div class="build-grid mode-${buildMode}"><div class="build-main filters">${main}</div><aside class="build-side filters" aria-label="Build summary">${side}</aside></div></div>`;
  if (buildMode === "list") { $("#bq").value = buildQuery; renderBuildResults(); renderBuildCombos(); }
  if (selOn(b)) selPaint();
  if (SELMENU_OPEN) renderSelMenu();
  if (BUILDMENU_OPEN) renderBuildMenu();
  syncWakeLock();
}

// ---- Selecting several cards on screen (the state and the group actions are in builds.js). The line over the list
// starts it, or selects everything the filters show; the bar under the screen says how many and opens the actions.
function selLineHTML(b) {
  if (!b.cards.length && !sideOf(b).length) return "";
  if (!selOn(b)) return `<p class="sel-line"><button class="btn link small" data-sel-mode="on">Select cards</button> <span class="muted small">to move, keep or remove several at once</span></p>`;
  return `<p class="sel-line"><button class="btn small" data-sel-all>Select all</button><button class="btn small" data-sel-none>Clear</button><span class="muted small">Tap cards, or a group's box, to select them.</span></p>`;
}
function selBarHTML(n = selCount()) {
  return `<span class="selbar-n" aria-live="polite">${n ? `<strong class="num">${n.toLocaleString()}</strong> selected` : "None selected"}</span>
    <span class="selbar-act"><button class="btn primary" data-sel-actions${n ? "" : " disabled"}>Actions</button><button class="btn" data-sel-mode="off">Done</button></span>`;
}
// Every tick on screen follows SEL (cardviews.js: paintTicks), with the count on "Select all" and the bar. Run after a
// draw and after each tap, so a tap never redraws the list.
function selPaint() {
  const root = $("#view-build"); if (!root || !SEL) return;
  const cards = paintTicks(root, selHas);
  const all = root.querySelector("[data-sel-all]"); if (all) all.textContent = `Select all ${cards.length}`;
  const bar = $("#selbar"); if (bar) bar.innerHTML = selBarHTML();
}
// Taps while selecting, caught before the listeners that would open a card or run a row's button.
$("#view-build").addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-sel-mode], [data-sel-all], [data-sel-none], [data-sel-grp], [data-sel-actions], [data-pick]"); if (!t) return;
  const b = curBuild(); if (!b) return;
  if (t.dataset.selMode) {
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.selMode === "on") selStart(b); else SEL = null;
    renderBuild();
    const next = $(t.dataset.selMode === "on" ? "#view-build [data-sel-all]" : "#view-build [data-sel-mode]"); if (next) next.focus({ preventScroll: true });
    return;
  }
  if (!selOn(b)) return;
  if (t.matches("label[data-pick]")) return;   // a row's own checkbox does the work (the change listener below)
  e.preventDefault(); e.stopPropagation();     // not the card's details, and a group's tick doesn't fold its group
  const root = $("#view-build"), put = (els, on) => { for (const el of els) selSet(el.dataset.pick, [el.dataset.card], on); };
  if (t.dataset.selActions != null) { openSelMenu(); return; }
  if (t.dataset.selAll != null) put(root.querySelectorAll("[data-pick]"), true);
  else if (t.dataset.selNone != null) { SEL.deck.clear(); SEL.side.clear(); }
  else if (t.dataset.selGrp != null) { const els = [...selGroupOf(t).querySelectorAll("[data-pick]")]; put(els, !els.every(el => el.classList.contains("on"))); }
  else put([t], !selHas(t.dataset.pick, t.dataset.card));
  selPaint();
}, true);
document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset || t.dataset.selBox == null || !SEL) return;
  const row = t.closest("#view-build [data-pick]"); if (!row) return;
  selSet(row.dataset.pick, [row.dataset.card], t.checked); selPaint();
});

function renderBuildCombos() {
  const box = $("#build-combos"); const b = curBuild();
  if (!box || !b) return;
  if (combosState === "idle") loadCombos();
  if (!COMBOS) { box.hidden = true; return; }
  const set = new Set(b.cards.map(c => LOOKUP.get(norm(c.name))).filter(i => i != null));
  const ident = buildIdentity(b);
  const fits = c => !ident || c[3].split("").every(ch => ch === "C" || ident.has(ch));
  const complete = [], near = [];
  for (const c of COMBOS.combos) {
    let miss = null, n = 0;
    for (const i of c[1]) if (!set.has(i)) { n++; miss = i; if (n > 1) break; }
    if (n === 0) complete.push(c);
    else if (n === 1 && near.length < 6 && AGG.has(KEY[miss]) && fits(c)) near.push({ c, miss });
  }
  box.hidden = false;
  box.innerHTML = `<h3>Combos in this build <span class="muted small">· ${complete.length}</span></h3>
    ${complete.length ? `<div class="ledger">${complete.slice(0, 6).map(c => comboRow(c, [])).join("")}</div>` : `<p class="muted small">No known combos are made entirely of cards in this build.</p>`}
    ${near.length ? `<h3>One card away, and you own it</h3><p class="muted small">The dashed card is the one to add.</p>
      <div class="ledger">${near.map(x => comboRow(x.c, [x.miss]) + `<div class="actions inset"><button class="btn" data-addname="${esc(DATA.cards[x.miss][0])}">Add ${esc(DATA.cards[x.miss][0])}</button></div>`).join("")}</div>` : ""}`;
}

// "Add a list" under the card search (0.63.0): a link, then a box to write or paste lines in. What is written is kept
// through redraws (ADD_LIST_TEXT).
function addListHTML(b) {
  if (ADD_LIST !== b.id) return `<p class="small addlist-row"><button class="btn link" id="build-addlist-open">Add a list</button></p>`;
  return `<div class="addlist"><label for="build-addlist">A list of cards, one per line</label>
      <textarea id="build-addlist" placeholder="1 Sol Ring&#10;1 Swords to Plowshares&#10;&#10;Sideboard&#10;1 Path to Exile">${esc(ADD_LIST_TEXT)}</textarea>
      <p class="muted small">Cards under “Sideboard” go to the sideboard. A “Tokens” section is read too, for the tokens you own.</p>
      <p id="build-addlist-msg" class="small warn-text" hidden></p>
      <div class="actions"><button class="btn primary" id="build-addlist-go">Add these cards</button><button class="btn" id="build-addlist-cancel">Cancel</button></div></div>`;
}
document.addEventListener("input", e => { if (e.target.id === "build-addlist") ADD_LIST_TEXT = e.target.value; else if (e.target.id === "build-paste") PASTE_TEXT = e.target.value; });

// `own` (0.78.0, "Copy for ManaBox"): each card as the copies of yours the build takes, with their printings (engine: printLines).
function buildDecklist(b, own = false) {
  const home = own ? buildHome(b) : null, line = c => (own ? printLines(c.name, c.qty, home).map(printLineText) : [`${c.qty} ${c.name}`]);
  const cmds = b.cards.filter(c => isCmd(b, c.name)), comps = b.cards.filter(c => isComp(b, c.name)), rest = b.cards.filter(c => !isCmd(b, c.name) && !isComp(b, c.name));
  const t = c => (DATA && cardOf(c.name) ? cardOf(c.name)[2] : (isBasic(c.name) ? "L" : "O"));
  rest.sort((x, y) => typeRank(t(x)) - typeRank(t(y)) || x.name.localeCompare(y.name));
  const head = [...(cmds.length ? ["Commander", ...cmds.flatMap(line), ""] : []), ...(comps.length ? ["Companion", ...comps.flatMap(line), ""] : [])];
  const side = sideOf(b).length ? ["", "Sideboard", ...[...sideOf(b)].sort((x, y) => typeRank(t(x)) - typeRank(t(y)) || x.name.localeCompare(y.name)).flatMap(line)] : [];
  return [...(head.length ? [...head, "Deck"] : []), ...rest.flatMap(line), ...side].join("\n");
}

$("#view-build").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  const b = curBuild(), ds = t.dataset;
  if (ds.buildmode) { buildMode = ds.buildmode; store.set("bt.buildmode", buildMode); renderBuild(); window.scrollTo({ top: 0 }); return; }
  if (ds.role) { buildRole = buildRole === ds.role ? null : ds.role; renderBuild(); return; }
  if (ds.addname) { addToBuild(ds.addname, ds.addside != null); return; }
  if (ds.rm != null) { removeFromBuild(+ds.rm); return; }
  if (ds.toside != null) { moveToSide(+ds.toside); return; }
  if (ds.todeck != null) { moveToDeck(+ds.todeck); return; }
  if (ds.sideRm != null) { removeFromSide(+ds.sideRm); return; }
  if (ds.sidePick && b) { SIDE_PICK = ds.sidePick === "on" ? b.id : null; renderBuild(); return; }
  if (ds.cmd != null) { toggleCommander(+ds.cmd); return; }
  if (ds.comp != null) { toggleCompanion(+ds.comp); return; }
  if (ds.swaps != null && b) { const k = norm(b.cards[+ds.swaps].name); openSwaps.has(k) ? openSwaps.delete(k) : openSwaps.add(k); renderBuild(); return; }
  if (ds.swap != null && b) { swapInBuild(+ds.swap, ds.with); return; }
  if (ds.inc != null && b) { b.cards[+ds.inc].qty++; touchBuild(); return; }
  if (ds.dec != null && b) { const c = b.cards[+ds.dec]; if (c.qty > 1) { c.qty--; touchBuild(); } else removeFromBuild(+ds.dec); return; }
  if (ds.gotoCheck != null) { const c = $("#view-build .check-panel"); if (c) { c.open = true; c.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
  if (ds.buyCopy != null && b) {
    const bg = buyGroups(buyList(b, { inDecks: BUY_INDECKS }), BUY.buckets), k = ds.buyCopy;
    const items = k === "all" ? [...bg.groups.flatMap(g => g.items), ...bg.unpriced] : k === "unpriced" ? bg.unpriced : bg.groups[+k].items;
    const name = k === "all" ? "the buying list" : k === "unpriced" ? "cards with no price yet" : bg.groups[+k].name;
    copyText(buyText(items), "#buy-copy-out", `Copied ${name} (${cardsWord(items.reduce((n, x) => n + x.qty, 0))})`); return;
  }
  if (ds.buyEdit != null) { showView("settings"); const h = $("#buy-ranges"); if (h) h.scrollIntoView({ block: "start" }); return; }
  if (ds.ohKeep && b) { overhaulKeep(b, ds.ohKeep); return; }
  if (ds.ohOpen) { CUR = ds.ohOpen; buildMode = "list"; buildQuery = ""; buildRole = null; saveBuilds(); renderBuild(); window.scrollTo({ top: 0 }); return; }
  if (ds.gotoBracket != null) { const c = $("#bracket-panel"); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (ds.bracketAbout != null) { BRACKET_ABOUT = !BRACKET_ABOUT; renderBuild(); return; }
  if (ds.bracketSet != null && b) { if (ds.bracketSet) b.bracket = +ds.bracketSet; else delete b.bracket; saveBuilds(); renderBuild(); return; }
  buildAction(t);
});
// Actions on the current build, from the view itself, its built banner or the Actions sheet (which closes once one
// is done; a copy that falls back to a text box keeps it open so the text can be selected).
function buildAction(t) {
  const b = curBuild(), groupsFor = x => buildPullGroups(x);
  const done = () => closeBuildMenu();
  switch (t.id) {
    case "build-template": done(); useAsTemplate({ name: b.name, cards: b.cards, commanders: b.commanders, companion: b.companion, from: "build:" + b.id }); break;
    case "build-built": { done(); if (needsBox(b)) { openWhichBox(b); break; } markBuilt(b); const bn = $("#view-build .banner.info"); if (bn) bn.scrollIntoView({ block: "center" }); break; }
    case "build-overhaul": done(); openOverhaul(); break;
    case "build-unbuild": delete b.built; touchBuild(); break;
    case "build-save-new": {
      done(); const d = saveDeck({ name: b.name, cards: b.cards, commanders: b.commanders, companion: b.companion, side: sideOf(b), note: listNote(b), from: "build" });
      b.savedId = d.id; touchBuild(); toast(`Saved “${d.name}” to your decks`, "View", () => openBrowse(null, d.id)); break;
    }
    case "build-save-update": {
      const d = savedFor(b); if (!d) break;
      done(); d.cards = copyCards(b.cards); d.commanders = [...b.commanders]; if (b.companion) d.companion = b.companion; else delete d.companion; if (sideOf(b).length) d.side = copyCards(sideOf(b)); else delete d.side; if (listNote(b)) d.note = listNote(b); else delete d.note; d.saved = Date.now(); saveSaved(); renderBuild(); toast(`Updated “${d.name}”`); break;
    }
    case "build-retire": BUILDS = BUILDS.filter(x => x.id !== CUR); CUR = BUILDS.length ? BUILDS[0].id : null; buildMode = "list"; saveBuilds(); renderBuild(); toast("Build removed; the deck is in your collection now"); break;
    case "build-share": {
      if (typeof CompressionStream === "undefined") { $("#build-copy-out").innerHTML = `<p class="muted small">This browser can't build share links.</p>`; break; }
      packBuild(b).then(packed => copyText(location.href.split("#")[0] + "#b" + packed, "#build-copy-out", "Copied a link to this build", done));
      break;
    }
    case "shared-add": createBuild({ ...SHARED_BUILD }); SHARED_BUILD = null; renderBuild(); toast("Added the shared build"); break;
    case "shared-dismiss": SHARED_BUILD = null; renderBuild(); break;
    case "build-cancel": PASTE_TEXT = ""; buildMode = "list"; renderBuild(); break;
    case "build-empty": createBuild({ name: "New build" }); renderBuild(); setTimeout(() => $("#bq") && $("#bq").focus(), 0); break;
    case "build-paste-go": {
      const p = parseDecklist($("#build-paste").value);
      if (!p.cards.length && !p.side.length) { const m = $("#build-paste-msg"); m.textContent = "No cards found. Paste one card per line, like “1 Sol Ring”."; m.hidden = false; break; }
      PASTE_TEXT = "";
      createBuild({ name: p.commanders[0] || "Pasted list", cards: p.cards, commanders: p.commanders, companion: p.companion, side: p.side });
      renderBuild();
      // The count is of cards, not of lines (0.87.1: a 100-card deck with its basic lands on a few lines read "86 cards").
      tokensFromList(p.tokens, [`Started a build with ${cardsWord(entryCount(p.cards))}${sideOf(curBuild()).length ? ` and a sideboard of ${entryCount(sideOf(curBuild()))}` : ""}`, leftOutWords(p.out)].filter(Boolean).join(". "), "build", null, p.out.length ? LEFT_OUT_MS : 0);
      break;
    }
    case "build-addlist-open": ADD_LIST = b.id; renderBuild(); { const f = $("#build-addlist"); if (f) f.focus(); } break;
    case "build-addlist-cancel": ADD_LIST = null; ADD_LIST_TEXT = ""; renderBuild(); { const o = $("#build-addlist-open"); if (o) o.focus(); } break;
    case "build-addlist-go": {
      const text = $("#build-addlist").value;
      ADD_LIST = null; ADD_LIST_TEXT = "";
      if (!addList(text)) { ADD_LIST = b.id; ADD_LIST_TEXT = text; const m = $("#build-addlist-msg"); m.textContent = "No cards found. Write one card per line, like “1 Sol Ring”."; m.hidden = false; break; }
      if ($("#build-addlist")) renderBuild();   // nothing was added (the cards were all here): close the box
      break;
    }
    case "build-del": $("#build-del-zone").innerHTML = `<div class="del-confirm"><p>Delete “${esc(b.name)}”? Your collection isn't changed.</p><div class="sheet-pair"><button class="btn" id="build-del-no">Keep it</button><button class="btn danger" id="build-del-yes">Delete</button></div></div>`; break;
    case "build-del-no": renderBuildMenu(); break;
    case "build-del-yes": {
      done(); const i = BUILDS.findIndex(x => x.id === CUR), gone = BUILDS[i];
      BUILDS.splice(i, 1); CUR = BUILDS.length ? BUILDS[0].id : null; buildMode = "list"; saveBuilds(); renderBuild();
      toast(`Deleted “${gone.name}”`, "Undo", () => { gone.updated = Date.now(); BUILDS.splice(Math.min(i, BUILDS.length), 0, gone); CUR = gone.id; saveBuilds(); renderBuild(); });
      break;
    }
    case "build-copy-pull": copyText(pullText(b.name, groupsFor(b)), "#build-copy-out", "Copied the list by location", done); break;
    case "build-dl-pull": done(); downloadFile(`${fileSlug(b.name)}-by-location.csv`, pullCSV(groupsFor(b))); break;
    case "build-copy-list": copyText(buildDecklist(b), "#build-copy-out", "Copied the decklist", done); break;
    case "build-copy-manabox": copyText(buildDecklist(b, true), "#build-copy-out", "Copied the decklist with your printings", done); break;
    case "build-copy-missing": { const items = buyList(b); copyText(buyText(items), "#build-copy-out", `Copied the buying list (${cardsWord(items.reduce((n, x) => n + x.qty, 0))})`, done); break; }
    case "build-reset-pulled": b.pulled = {}; touchBuild(); break;
  }
}
document.addEventListener("change", e => {
  const t = e.target, b = curBuild();
  if (t.id === "build-group") { buildGroup = t.value; store.set("bt.group", buildGroup); renderBuild(); }
  else if (t.id === "build-name" && b) { b.name = t.value.trim() || b.name; touchBuild(); const h = $("#buildmenu-title"); if (h) h.textContent = b.name; }
  else if (t.id === "build-allswaps") { showAllSwaps = t.checked; renderBuild(); }
  else if (t.id === "bq-side" && b) { ADD_SIDE = t.checked ? b.id : null; renderBuildResults(); const again = $("#bq-side"); if (again) again.focus(); }
  else if (t.id === "build-hidepulled") { buildHidePulled = t.checked; renderBuild(); }
  else if (t.id === "buy-indecks") { BUY_INDECKS = t.checked; renderBuild(); }
  else if (t.dataset && t.dataset.pulled != null && b) { if (t.checked) b.pulled[t.dataset.pulled] = true; else delete b.pulled[t.dataset.pulled]; touchBuild(); }
});
document.addEventListener("input", e => { if (e.target.id === "bq") { buildQuery = e.target.value; renderBuildResults(); } });
// Collapsed build groups survive re-renders.
document.addEventListener("toggle", e => {
  const d = e.target; if (!d.dataset || d.dataset.grp == null) return;
  if (d.open) buildCollapsed.delete(d.dataset.grp); else buildCollapsed.add(d.dataset.grp);
}, true);
// Keyboard: "/" jumps to the search box on the current tab; Enter in the build search adds the top result.
document.addEventListener("keydown", e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
    const box = { build: "#bq", decks: "#q", combos: "#xq", browse: "#bsq" }[view];
    if (view === "collection" && COLL) { e.preventDefault(); openBrowse(null); $("#bsq").focus(); }
    else if (box && $(box)) { e.preventDefault(); $(box).focus(); }
  } else if (e.key === "Enter" && e.target.id === "bq") {
    const top = $("#bresults [data-addname]"); if (top) { e.preventDefault(); top.click(); }
  }
});

let curDeckIdx = null;

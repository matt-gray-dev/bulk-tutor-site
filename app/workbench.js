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
// "Combos in this deck" folds, and starts folded (0.102.0; Matt, Nov 19), its heading saying how many are complete and
// how many one card away; opened, it stays open for the visit.
let COMBOS_OPEN = false;
document.addEventListener("click", e => { const s = e.target.closest && e.target.closest("#build-combos > summary"); if (s) COMBOS_OPEN = !s.parentElement.open; });   // before it opens or closes, so a redraw right after keeps it
// While several cards are being selected (builds.js: SEL), a row is one tick: the card's name, cost and where it is, and
// no buttons. list = "deck" | "side". Its state is painted by selPaint, like every tick.
// A row's word for a card you don't have: "missing" and its price, or, with nothing in your collection (builds.js,
// collEmpty), only the price.
// A row's name opens the card's details, as a tap on a picture does in Grid and Stacks (0.102.0; Matt, Nov 19). The
// button is laid over the name and the line under it (styles.css, .bname > .nm), so the name wraps as it always did.
const nameBtnHTML = (ctx, name, i) => `<button class="nm" data-sheet="${ctx}" data-card="${esc(name)}" data-i="${i}" aria-label="${esc(name)}"></button>`;
const missingWhere = card => collEmpty() ? (card && card[3] ? money(card[3]) : "") : `<span class="warn">missing</span>${card && card[3] ? " · " + money(card[3]) : ""}`;
function pickRowHTML(b, c, list, home) {
  const st = cardStatus(c.name, c.qty, home), card = DATA && cardOf(c.name);
  const where = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? (list === "side" ? "in this deck's box" : "in this deck") : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>`
    : st.kind === "basic" ? "basic land" : missingWhere(card);
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
    : st.kind === "basic" ? "basic land" : missingWhere(card);
  const canSwap = !collEmpty() && hasRoles() && !isCmd(b, c.name) && (st.kind === "missing" || st.kind === "indeck") && roleBits(c.name);
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
  return `<div class="brow"><div class="bname">${nameBtnHTML("build", c.name, i)}<strong>${esc(c.name)}${mv}</strong>${outside ? ` <span class="chip warn-chip">outside colors</span>` : ""}<small>${where}${why}</small>${whyOpen ? `<small class="why-line">${esc(reason)}</small>` : ""}</div>
    <div class="bact">${qty}${canSwap ? `<button class="icon${swapOpen ? " on" : ""}" data-swaps="${i}" aria-label="Show swaps for ${esc(c.name)}" title="Swaps you own">${MARK.swaps}</button>` : ""}${isCompanionCard(c.name) ? `<button class="pill-toggle${isComp(b, c.name) ? " on" : ""}" data-comp="${i}" aria-pressed="${isComp(b, c.name)}" title="Companion: outside the 100">Companion</button>` : ""}${canCommand(b, c.name) ? `<button class="icon${isCmd(b, c.name) ? " on" : ""}" data-cmd="${i}" aria-label="${isCmd(b, c.name) ? "Unset" : "Set"} ${esc(c.name)} as commander" title="Commander">${MARK.commander}</button>` : ""}${toSide}<button class="icon" data-rm="${i}" aria-label="Remove ${esc(c.name)}">${MARK.removeRow}</button></div></div>${swaps}`;
}
// A sideboard card's row: where it is, back to the deck, or out of the sideboard. j = its place in b.side.
function sideRowHTML(b, c, j, home) {
  if (selOn(b)) return pickRowHTML(b, c, "side", home);
  const st = cardStatus(c.name, c.qty, home), card = DATA && cardOf(c.name);
  const where = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? "in this deck's box" : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>`
    : st.kind === "basic" ? "basic land" : missingWhere(card);
  const cost = card && card[2] !== "L" ? costOf(c.name) : null;
  const mv = cost ? `<span class="mv-cost" title="Mana value ${card[4] || 0}">${manaHTML(cost)}</span>`
    : card && card[2] !== "L" ? `<span class="mv num" title="Mana value">${card[4] || 0}</span>` : "";
  return `<div class="brow side-row"><div class="bname">${nameBtnHTML("side", c.name, j)}<strong>${c.qty > 1 ? `<span class="num">${c.qty}×</span> ` : ""}${esc(c.name)}${mv}</strong><small>${where}</small></div>
    <div class="bact"><button class="icon" data-todeck="${j}" aria-label="Move ${esc(c.name)} to the deck" title="To the deck">${MARK.toDeck}</button>${isBasic(c.name) ? "" : `<button class="icon" data-side-maybe="${j}" aria-label="Move ${esc(c.name)} to the maybeboard" title="To the maybeboard">${MARK.toSide}</button>`}<button class="icon" data-side-rm="${j}" aria-label="Remove ${esc(c.name)} from the sideboard">${MARK.removeRow}</button></div></div>`;
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

// The maybeboard under the list and the sideboard (0.100.0; builds.js, the maybeboard): rows in every view, since it
// is a list to read and prune, not cards to gather. A row says where the card is or what it costs, the list it came
// from when a pasted decklist named one of its own, and "in the deck" (or "in the sideboard") when the deck's own
// lists hold it too; then into the deck, or off the maybeboard. j = its place in b.maybe. While cards are being selected its rows have no buttons.
const MAYBE_NOTE = "Cards you're thinking about for this deck. Outside the 100, and never gathered.";
function maybeRowHTML(b, c, j, home) {
  const st = cardStatus(c.name, c.qty, home), card = DATA && cardOf(c.name), held = maybeHeld(b, c.name), inDeck = held === "deck";
  const where = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? "in this deck's box" : st.kind === "indeck" ? `in deck: ${esc(stName(st))}`
    : st.kind === "basic" ? "basic land" : collEmpty() ? (card && card[3] ? money(card[3]) : "") : `not owned${card && card[3] ? " · " + money(card[3]) : ""}`;
  const from = c.from && !/^(maybe ?board|considering)$/i.test(c.from) ? ` · from ${esc(c.from)}` : "";
  const cost = card && card[2] !== "L" ? costOf(c.name) : null;
  const mv = cost ? `<span class="mv-cost" title="Mana value ${card[4] || 0}">${manaHTML(cost)}</span>`
    : card && card[2] !== "L" ? `<span class="mv num" title="Mana value">${card[4] || 0}</span>` : "";
  // ↑ is one list up (0.105.1): the sideboard while the deck shows one, else the deck (builds.js, maybeToSide).
  const up = sideShown(b) ? (held ? "" : `<button class="icon" data-maybe-side="${j}" aria-label="Move ${esc(c.name)} to the sideboard" title="To the sideboard">${MARK.toDeck}</button>`)
    : inDeck ? "" : `<button class="icon" data-maybe-deck="${j}" aria-label="Move ${esc(c.name)} to the deck" title="To the deck">${MARK.toDeck}</button>`;
  const acts = selOn(b) ? "" : `<div class="bact">${up}<button class="icon" data-maybe-rm="${j}" aria-label="Remove ${esc(c.name)} from the maybeboard">${MARK.removeRow}</button></div>`;
  return `<div class="brow maybe-row" data-maybe="${esc(c.name)}"><div class="bname">${nameBtnHTML("maybe", c.name, j)}<strong>${c.qty > 1 ? `<span class="num">${c.qty}×</span> ` : ""}${esc(c.name)}${mv}</strong>${held ? ` <span class="chip">${inDeck ? "in the deck" : "in the sideboard"}</span>` : ""}<small>${where}${from}</small></div>${acts}</div>`;
}
function maybeListHTML(b, home, qf) {
  const items = maybeOf(b).map((c, j) => ({ c, i: j })).filter(x => quickMatch(x.c.name, qf)).sort(buildSorter());
  if (!items.length) return "";
  return `<details class="grp maybe-grp" data-grp="maybe"${buildCollapsed.has("maybe") ? "" : " open"}>
      <summary class="loc-head"><h3>Maybeboard</h3><span class="muted small num">${items.reduce((n, x) => n + x.c.qty, 0)}</span></summary>
      <p class="muted small">${MAYBE_NOTE}</p>
      <div class="list">${items.map(({ c, i }) => maybeRowHTML(b, c, i, home)).join("")}</div>
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
  if (!order.length) return (b.cards.length || quickOn(qf) ? `<p class="muted">No cards in ${sideOf(b).length ? "the deck" : "this deck"} match these filters.</p>` : `<p class="muted">The deck is empty. Add cards above.</p>`)
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

// Adding cards (0.103.0; step 6, piece 2; Matt, Nov 19, 12:57: "Agreed, S1"; 12:09: "the adding cards in particular
// doesn't need to be so prominent because this will serve as a deck viewer/browser just as often if not more than a
// place to actually add cards"). The search and "Add a list" open under "+ Add cards" and fold on "Done adding"; a deck
// with nothing in it opens with them open. ADDING is the deck drawn last and whether they are open, so another deck, or
// the same one opened again from elsewhere, starts as its own contents say. Until 0.103.0 the search was a panel above
// the list, always open.
let ADDING = { id: null, open: false };
// The deck drawn in the Workbench on this visit, until the list of your decks shows (main.js showView): the one a box's
// selection can add cards to (browse.js bselActions; 0.105.1).
let DECK_SEEN = null;
const addingOpen = b => { if (ADDING.id !== b.id) ADDING = { id: b.id, open: !b.cards.length && !sideOf(b).length && !maybeOf(b).length }; return ADDING.open; };

function renderBuild() {
  const el = $("#view-build"); if (!el) return;
  const b = curBuild();
  const shared = sharedDeckHTML();
  if (GATHER.done.length && (!b || buildMode !== "pull")) GATHER = { id: null, done: [] };   // Assemble was left: its ticked rows are simply in the deck's place now (builds.js, gathering)
  // With no deck open the Workbench is the list of your decks (decks.js), unless a new one is being started.
  if (!b && buildMode !== "new") { if (view === "build") showView("yourdecks"); return; }
  // The way back to the list (0.96.0; Matt, Nov 15: the list is the picker, in place of the "Your builds" sheet).
  const back = `<button class="btn back" data-go="yourdecks" aria-label="Back to Decks">${MARK.back}</button>`;
  // A deck can't be drawn without the card table: its name, the way back, and why.
  if (!DATA) { el.innerHTML = `<div class="filters"><div class="deck-head">${buildMode === "new" && !listedDecks().length ? "" : back}<h2 class="title-ic"><span>${buildMode === "new" ? "New deck" : esc(b.name)}</span></h2></div>${noDataHTML("Decks need")}</div>`; syncWakeLock(); return; }
  if (buildMode === "new") {
    // New deck. With no deck to list there is no list to go back to, and the way to Combos is here.
    const listed = listedDecks().length > 0;
    el.innerHTML = `<div class="filters">${shared}<div class="deck-head">${listed ? back : ""}<h2 class="title-ic"><span>New deck</span></h2></div>${buildNewPanel()}${listed ? "" : combosRowHTML()}</div>`; syncWakeLock(); return;
  }

  DECK_SEEN = b.id;
  if (sideShown(b)) SIDE_PICK = b.id;   // once shown, the arrows stay for the visit, sideboard emptied or not (0.105.2)
  if (SEL && SEL.id !== b.id) SEL = null;   // the selection belongs to one build
  if (SEL) selPrune(b);
  const home = buildHome(b), s = buildStats(b), ident = buildIdentity(b);
  const diff = 100 - s.total;
  // Under its name: its status and what matters at it, as on the list of decks. Then where the list came from, when
  // that isn't the deck itself (an overhaul of a deck you have; EDHREC's credit and link, in every mode).
  const line = `<p class="muted small deck-line"><strong>${DECK_STATUS_WORDS[shownStatus(b)]}</strong> · ${deckLineHTML(b, true)}</p>${deckWarnAskHTML(b)}`;
  const src = home ? (buildForDeck(home) === b ? "" : `<p class="muted small">Tuning your deck <strong>${esc(deckName(home))}</strong>. Cards already in it are marked “in this deck”.</p>`)
    : b.source && b.source.slug ? `<p class="muted small">Started from the EDHREC ${b.source.theme ? esc(b.source.theme.name) + " " : "average "}list for ${esc(b.source.name)}. <a href="https://edhrec.com/commanders/${esc(b.source.slug)}${b.source.theme ? "/" + esc(b.source.theme.slug) : ""}" target="_blank" rel="noopener">View on EDHREC ↗</a></p>` : "";
  const gen = b.source && b.source.kind === "generated" ? b.source : null;
  // Notes about where the list came from: only in Edit list.
  const genNote = gen && buildMode === "list" ? `<p class="muted small">Generated from your collection${themeNames(gen.themes || 0).length || (gen.tribes || []).length ? ` around ${esc([...(gen.tribes || []).map(t => DATA.subtypes[t]), ...themeNames(gen.themes || 0)].join(", "))}` : ""}. Tap a card for why it's here, to drop it from this deck, or to stop suggesting it.</p>
      ${b.alwaysMissing && b.alwaysMissing.length ? `<p class="small">Left out of your Always cards: ${b.alwaysMissing.map(x => `${esc(x.name)} (${x.where ? `in ${esc(x.where)}` : "no copy in your collection"})`).join(", ")}.${b.alwaysMissing.some(x => x.where) && !gen.useDecks ? " Tune › “Also use cards that are in your other decks” lets them in." : ""}</p>` : ""}
      ${b.genShort ? `<p class="small">You don't own enough cards in these colors to fill every slot, so it's ${cardsWord(b.genShort)} short. The ideas below would help fill it.</p>` : ""}` : "";
  const issues = buildMode === "list" ? deckCheck(b).filter(i => i.ok === false).length : 0;
  const bracketShown = DATA && buildMode !== "pull" && b.cards.length;
  // The strip between the tiles and the list (0.103.0; Matt, Nov 19, 12:57: "Agreed, S1"): the Deck check and the
  // Bracket as chips that jump to their panels, and in Edit list a small "+ Add cards" that opens the search under it.
  const adding = buildMode === "list" && addingOpen(b);
  const addBtn = buildMode === "list" ? `<button class="btn small deck-add${adding ? " primary" : ""}" id="build-adding" aria-expanded="${adding}" aria-controls="build-add">${adding ? "Done adding" : `${MARK.more} Add cards`}</button>` : "";
  const est = bracketShown ? bracketEstimate(b) : null;
  const jumps = issues || bracketShown || addBtn ? `<div class="deck-strip">${issues ? `<button class="schip warn check-jump" data-goto-check>Deck check: ${issues} to fix ${MARK.jump}</button>` : ""}${bracketShown ? `<button class="schip bracket-jump" id="bracket-jump" data-goto-bracket aria-label="${esc(bracketJumpLabel(est))}">${bracketJumpText(est)}</button>` : ""}${addBtn}</div>` : "";
  const tile = (label, v, sub = "", cls = "") => `<div class="stat"><div class="eyebrow">${label}</div><div class="v num">${v}</div>${sub ? `<div class="muted small${cls}">${sub}</div>` : ""}</div>`;
  // A deck being gathered in a place of its own (0.98.0): its status line above says how much is gathered, so it keeps
  // four tiles (a fifth cuts three labels short on a phone); a deck in its box and one that replaces a deck have five.
  const gathering = ownColl() && deckStatus(b) === "building" && !(b.source && b.source.home), five = !!home && !gathering;
  const cardsTile = tile("Cards", s.total, diff > 0 ? `${diff} short` : diff < 0 ? `${-diff} over` : "of 100");
  // With nothing in your collection (builds.js, collEmpty) what you own isn't counted: the deck's size and its price.
  const stats = collEmpty() ? `<div class="stat-row stat-strip" style="--n:2">${cardsTile}${tile("Price", money(s.cost), s.basic ? "without basic lands" : "")}</div>`
    : `<div class="stat-row stat-strip" style="--n:${five ? 5 : 4}">
      ${cardsTile}
      ${five ? tile("In deck", s.here) : ""}
      ${tile(home ? "To gather" : "Ready", s.free, s.basic ? `+ ${s.basic} basic` : "")}
      ${tile("In decks", s.indeck)}
      ${tile("Missing", s.missing, s.missing ? money(s.cost) : "", " num value")}
    </div>`;
  const hsNote = b.hotswap ? `<div class="jump-row hs-note"><span class="muted small">${b.hotswap.versions ? "Versions" : "Hot-swap"}: ${esc(hsLabels(b.hotswap, b.hotswap.styles))}. Playing <strong>${esc(hsLabel(b.hotswap, b.hotswap.active))}</strong>.</span>${buildMode === "pull" ? "" : `<button class="btn link small hs-jump" data-buildmode="pull">Switch in Assemble ${MARK.go}</button>`}</div>` : "";
  const head = `<div class="deck-head">${back}<h2 class="title-ic"><span>${esc(b.name)}</span></h2><button class="btn" id="build-menu" aria-haspopup="dialog">Actions</button></div>
    ${line}${src}${buildMode === "list" ? listNoteHTML(b, "build-note-text") : ""}${hsNote}${genNote}
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
  } else if (buildMode === "pull" && collEmpty()) {
    // Nothing in your collection (builds.js, collEmpty): no box to gather from and nothing known to be missing, so the
    // ways to fill it, and no buying list. The deck's own list is still in Actions (Copy decklist).
    main = `<div class="panel"><h3>Nothing to gather yet</h3>
        <p class="muted">Your collection is empty, so there's no box to gather these cards from. Once your cards are in, this lists each one by where it's stored.</p>
        <div class="actions"><button class="btn primary" data-go="import">Import your collection</button>${canAddCards(b) ? `<button class="btn" data-deck-warn="nobox">${ADD_CARDS_WORDS}</button>` : ""}</div>
      </div>
      ${b.hotswap ? hsSwapsPanelHTML(b) : ""}
      ${tokensHostHTML("build")}`;
    side = keepOfferHTML();
  } else if (buildMode === "pull") {
    // In your own collection a tick moves the card (0.98.0: builds.js, gathering), and the rows ticked on this visit
    // stay where they stood. A deck being gathered counts what is already in its place as found; a deck in its
    // box whose list changed, and one made to replace a deck you have, list changes and count the ones done now.
    const own = ownColl(), groups = gatherGroups(b);
    const toPull = groups.filter(g => g.kind !== "missing" && g.kind !== "here"), miss = groups.find(g => g.kind === "missing"), here = groups.find(g => g.kind === "here");
    const ticks = own ? Object.fromEntries(toPull.flatMap(g => g.items.filter(it => it.done || (g.kind === "basic" && b.pulled[it.name])).map(it => [it.name, true]))) : b.pulled;
    const changes = !!home && !gathering, had = !changes && here ? here.items.length : 0;
    const total = toPull.reduce((n, g) => n + g.items.length, 0) + had;
    const done = toPull.reduce((n, g) => n + g.items.filter(it => ticks[it.name]).length, 0) + had;
    main = `${b.hotswap ? hsAssembleHTML(b) : ""}<div class="panel">
        <div class="section-head build-bar"><h3>${changes ? "Changes" : "Gather these cards"} <span class="muted small num">· ${done} of ${total} ${changes ? "done" : "found"}</span></h3>
          <label class="check small"><input type="checkbox" id="build-hidepulled"${buildHidePulled ? " checked" : ""}> Hide ${changes ? "done" : "found"}</label></div>
        <div class="meter" aria-hidden="true"><span class="free" style="width:${total ? (done / total * 100).toFixed(1) : 0}%"></span></div>
        ${navigator.wakeLock ? `<p class="muted small">Your screen stays on while this list is open.</p>` : ""}
        ${toPull.length ? groupsHTML(toPull, { pulled: ticks, hidePulled: buildHidePulled }) : `<p class="muted">${changes ? "No changes from your deck yet." : had ? "Every card you own is gathered." : "Nothing in this deck is in your collection yet."}</p>`}
        ${changes && own && deckStatus(b) === "built" && deckBox(b) ? `<div class="actions"><button class="btn" id="build-update-box">Update box in collection</button></div><p class="muted small">Makes every change at once, if you've already swapped the cards.</p>` : ""}
        ${clearGatherHTML(b, done, own)}
      </div>
      ${miss ? `<div class="panel">${groupsHTML([miss])}</div>` : ""}
      ${here ? `<details class="panel"><summary class="section-head"><h3>${gathering ? "Already gathered" : `Already in ${esc(locName(home))}`}</h3><span class="muted small num">${groupQty(here)}</span></summary>${groupsHTML([here])}</details>` : ""}
      ${b.hotswap ? hsSwapsPanelHTML(b) : ""}
      ${tokensHostHTML("build")}`;
    side = `${buyPanelHTML(b)}${keepOfferHTML()}<p class="muted small" id="gather-note">${own ? `A tick moves that card ${home ? `in or out of <strong>${esc(locName(home))}</strong>` : "into this deck's own place"} in your collection. Untick it to send it back; Recent changes keeps every tick.` : "These ticks are only marks: this isn't your own collection."} To copy or download this list, use Actions.</p>`;
  } else {
    main = `${adding ? `<div class="panel deck-adding" id="build-add">
        <div class="add-line"><label class="search-field">${SEARCH_ICON}<input type="search" id="bq" aria-label="Add a card" placeholder="Add a card" autocomplete="off" enterkeyhint="done"></label>${ADD_LIST === b.id ? "" : `<button class="btn link small" id="build-addlist-open">Add a list</button>`}</div>
        <div id="bresults" class="results"></div>
        ${addListHTML(b)}
        ${diff > 0 && b.source && b.source.slug ? `<p class="muted small">EDHREC lists leave out basic lands. Search for them to add as many as you need.</p>` : ""}
      </div>` : ""}
      <div class="panel">
        ${b.cards.length || sideOf(b).length || maybeOf(b).length ? buildControlsHTML(b) : ""}
        ${!selOn(b) && shownView(true) !== "list" && hasRoles() && ((s.missing && !collEmpty()) || s.indeck) ? `<p class="muted small">Tap a card for details and swaps.</p>` : ""}
        ${!selOn(b) && shownView(true) === "list" && hasRoles() && ((s.missing && !collEmpty()) || s.indeck) ? `<label class="check small"><input type="checkbox" id="build-allswaps"${showAllSwaps ? " checked" : ""}> Show swaps for every missing card and card in another deck</label>` : ""}
        ${selOn(b) ? "" : sideHintHTML(b)}
        ${selLineHTML(b)}
        ${b.cards.length || sideOf(b).length ? buildListHTML(b, ident, home) : `<p class="muted" id="build-emptyline">This deck is empty.${adding ? " Add cards above." : ` “${MARK.more} Add cards” above adds some.`}</p>`}
        ${maybeListHTML(b, home, buildQuick(b))}
      </div>
      ${tokensHostHTML("build")}
      <details class="panel combos-panel" id="build-combos" hidden${COMBOS_OPEN ? " open" : ""}></details>
      ${selOn(b) ? `<div class="selbar" id="selbar" role="region" aria-label="Selected cards"></div>` : ""}`;
    side = `${deckCheckHTML(b)}${b.cards.length ? bracketPanelHTML(b) : ""}
      ${hasRoles() ? `<div class="panel"><div class="section-head"><h3>Roles</h3><span class="muted small">Tap one to see cards you own</span></div>${roleCountsHTML(deckCards(b), { clickable: true, active: buildRole })}${buildRole ? roleBrowseHTML(b, buildRole) : ""}</div>` : ""}
      ${curveHTML(deckCards(b))}${handPanelHTML(b)}${gen ? genIdeasHTML(b) : ""}${historyHTML(b)}`;
  }
  el.innerHTML = `<div class="filters">${shared}${head}${builtBannerHTML(b)}${overhaulNoteHTML(b)}
    <div class="build-grid mode-${buildMode}"><div class="build-main filters">${main}</div><aside class="build-side filters" aria-label="Build summary">${side}</aside></div></div>`;
  if (buildMode === "list") { if ($("#bq")) { $("#bq").value = buildQuery; renderBuildResults(); } renderBuildCombos(); }
  if (selOn(b)) selPaint();
  if (SELMENU_OPEN) renderSelMenu();
  if (BUILDMENU_OPEN) renderBuildMenu();
  syncWakeLock();
  if (view === "build") { navRecord(); deckBarCheck(); }   // another deck, or the same one in another mode (main.js)
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
  box.innerHTML = `<summary class="section-head"><h3>Combos in this deck</h3><span class="muted small"><span class="num">${complete.length}</span> complete${near.length ? ` · <span class="num">${near.length}</span> one card away` : ""}</span></summary>
    ${complete.length ? `<div class="ledger">${complete.slice(0, 6).map(c => comboRow(c, [])).join("")}</div>` : `<p class="muted small">No known combos are made entirely of cards in this deck.</p>`}
    ${near.length ? `<h3>One card away, and you own it</h3><p class="muted small">The dashed card is the one to add.</p>
      <div class="ledger">${near.map(x => comboRow(x.c, [x.miss]) + `<div class="actions inset"><button class="btn" data-addname="${esc(DATA.cards[x.miss][0])}">Add ${esc(DATA.cards[x.miss][0])}</button></div>`).join("")}</div>` : ""}`;
}

// "Add a list" under the card search (0.63.0): a link, then a box to write or paste lines in. What is written is kept
// through redraws (ADD_LIST_TEXT).
function addListHTML(b) {
  if (ADD_LIST !== b.id) return "";   // "Add a list" is beside the search (0.103.0)
  return `<div class="addlist"><label for="build-addlist">A list of cards, one per line</label>
      <textarea id="build-addlist" placeholder="1 Sol Ring&#10;1 Swords to Plowshares&#10;&#10;Sideboard&#10;1 Path to Exile">${esc(ADD_LIST_TEXT)}</textarea>
      <p class="muted small">Cards under “Sideboard” go to the sideboard, and under “Maybeboard” to the maybeboard. A “Tokens” section is read too, for the tokens you own.</p>
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
  const maybe = !own && maybeOf(b).length ? ["", "Maybeboard", ...[...maybeOf(b)].sort((x, y) => typeRank(t(x)) - typeRank(t(y)) || x.name.localeCompare(y.name)).map(c => `${c.qty} ${c.name}`)] : [];
  return [...(head.length ? [...head, "Deck"] : []), ...rest.flatMap(line), ...side, ...maybe].join("\n");
}

$("#view-build").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  const b = curBuild(), ds = t.dataset;
  if (ds.buildmode) { buildMode = ds.buildmode; store.set("bt.buildmode", buildMode); renderBuild(); window.scrollTo({ top: 0 }); return; }
  // A Built deck's warning on its line (0.98.2): "Not currently in <box>" asks under it, "No location saved…" asks
  // which box, and what its list and its box disagree on opens Assemble on those changes.
  if (ds.deckWarn && b) {
    if (ds.deckWarn === "away") { DECKWARN = DECKWARN === b.id ? null : b.id; renderBuild(); const y = $("#deck-back-yes"); if (y) y.focus({ preventScroll: true }); }
    else if (ds.deckWarn === "nobox") openWhichBox(b);
    else { buildMode = "pull"; store.set("bt.buildmode", buildMode); renderBuild(); window.scrollTo({ top: 0 }); }
    return;
  }
  if (ds.role) { buildRole = buildRole === ds.role ? null : ds.role; renderBuild(); return; }
  if (ds.addname) { addToBuild(ds.addname, ds.addmaybe != null ? "maybe" : ds.addside != null); return; }
  if (ds.addto && b) { ADD_TO = ds.addto === "deck" ? null : { id: b.id, to: ds.addto }; renderBuildResults(); const again = $(`#bq-addto [data-addto="${ds.addto}"]`); if (again) again.focus(); return; }
  if (ds.maybeDeck != null) { maybeToDeck(+ds.maybeDeck); return; }
  if (ds.maybeSide != null) { maybeToSide(+ds.maybeSide); return; }
  if (ds.sideMaybe != null) { moveToMaybe(+ds.sideMaybe, "side"); return; }
  if (ds.maybeRm != null) { removeFromMaybe(+ds.maybeRm); return; }
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
  if (ds.wishCopy != null && b) {
    const w = wishTotals(wishList(b));
    copyText(buyText(w.items), "#wish-copy-out", `Copied the wishlist (${cardsWord(w.qty)})`); return;
  }
  if (ds.buyCopy != null && b) {
    const bg = buyGroups(buyList(b, { inDecks: BUY_INDECKS }), BUY.buckets), k = ds.buyCopy;
    const items = k === "all" ? [...bg.groups.flatMap(g => g.items), ...bg.unpriced] : k === "unpriced" ? bg.unpriced : bg.groups[+k].items;
    const name = k === "all" ? "the buy list" : k === "unpriced" ? "cards with no price yet" : bg.groups[+k].name;
    copyText(buyText(items), "#buy-copy-out", `Copied ${name} (${cardsWord(items.reduce((n, x) => n + x.qty, 0))})`); return;
  }
  if (ds.buyEdit != null) { showView("settings"); const h = $("#buy-ranges"); if (h) h.scrollIntoView({ block: "start" }); return; }
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
    case "build-update-box":   // Assemble's own "Update box in collection" (0.98.2): the same as Actions' item
    case "build-built": {
      done(); if (needsBox(b)) { openWhichBox(b); break; }
      const pile = ownColl() ? deckBox(b) : null; if (pile && deckStatus(b) === "building" && isPileLoc(pile)) { openWhichBox(b, "pile"); break; }   // out of its pile (0.98.1)
      // A deck that has its place and isn't built yet (gathered in a box, an overhaul taking its deck's box): the
      // question alone, when it needs cards that aren't free (0.101.0). "Update box in collection" asks nothing.
      const home = ownColl() && !(deckStatus(b) === "built" && deckBox(b)) ? buildHome(b) : null;
      if (home && askBring(b, home)) break;
      markBuilt(b); const bn = $("#view-build .banner.info"); if (bn) bn.scrollIntoView({ block: "center" }); break;
    }
    case "build-tobox": done(); openWhichBox(b, "move"); break;
    case "build-overhaul": done(); openOverhaul(); break;
    case "build-unbuild": delete b.built; touchBuild(); break;
    // "Make a copy" (0.95.0; "Save as deck" until then): a second deck with the same list, an Idea, made without leaving this one.
    case "build-copy": {
      done(); const c = copyDeck(b, false); renderBuild();
      toast(`Made a copy: “${c.name}”`, "Open", () => { CUR = c.id; buildMode = "list"; buildQuery = ""; buildRole = null; saveBuilds(); renderBuild(); window.scrollTo({ top: 0 }); }); break;
    }
    // "It's taken apart", in the question its "Not currently in <box>" asks: it isn't together any more. Its list is kept, with no box.
    case "build-apart": {
      DECKWARN = null; const stand = deckStand(b);
      deckLeave(b); b.updated = Date.now(); saveBuilds(); decksShown();
      toast(`${b.name} is marked as taken apart. Its list is kept`, "Undo", () => { deckStandSet(b, stand); b.updated = Date.now(); saveBuilds(); decksShown(); });
      break;
    }
    case "build-retire": BUILDS = BUILDS.filter(x => x.id !== CUR); CUR = null; buildMode = "list"; saveBuilds(); renderBuild(); toast("Removed its list; the deck is in your collection now"); break;
    case "build-share": {
      if (typeof CompressionStream === "undefined") { $("#build-copy-out").innerHTML = `<p class="muted small">This browser can't build share links.</p>`; break; }
      packBuild(b).then(packed => copyText(location.href.split("#")[0] + "#b" + packed, "#build-copy-out", "Copied a link to this deck", done));
      break;
    }
    case "shared-add": ownDecksNow(); createBuild({ ...SHARED_BUILD }); SHARED_BUILD = null; showView("build"); toast("Added the shared deck"); break;   // among your own decks, never the example's (decks.js)
    case "shared-dismiss": SHARED_BUILD = null; showView(view); break;
    case "build-empty": createBuild({ name: "Untitled deck" }); renderBuild(); setTimeout(() => $("#bq") && $("#bq").focus(), 0); break;   // not named "New deck": that is this screen's own heading
    // "I have this deck built" (0.101.0; Matt, Nov 18, call 4) is the same start, then the sheet "Mark as built"
    // opens: which box it is in, and whether its cards are added (builds.js: a built deck you bring).
    case "build-paste-built":
    case "build-paste-go": {
      const p = parseDecklist($("#build-paste").value);
      if (!p.cards.length && !p.side.length) { const m = $("#build-paste-msg"); m.textContent = "No cards found. Paste one card per line, like “1 Sol Ring”."; m.hidden = false; break; }
      PASTE_TEXT = "";
      const made = createBuild({ name: p.commanders[0] || "Pasted list", cards: p.cards, commanders: p.commanders, companion: p.companion, side: p.side, maybe: p.maybe, prints: p.prints });
      renderBuild();
      // The count is of cards, not of lines (0.87.1: a 100-card deck with its basic lands on a few lines read "86 cards").
      // Its Maybeboard, Considering and {noDeck} lists are the deck's maybeboard (0.100.0; left out and named until then).
      tokensFromList(p.tokens, [`Started a deck with ${cardsWord(entryCount(p.cards))}${sideOf(curBuild()).length ? ` and a sideboard of ${entryCount(sideOf(curBuild()))}` : ""}`, maybeWords(p.maybe)].filter(Boolean).join(". "), "build");
      if (t.id === "build-paste-built" && canBring()) openWhichBox(made);
      break;
    }
    // "+ Add cards" and "Done adding" (0.103.0). Done clears the search, so the next time starts afresh.
    case "build-adding": {
      const open = !addingOpen(b); ADDING = { id: b.id, open };
      if (!open) { buildQuery = ""; ADD_TO = null; if (ADD_LIST === b.id) { ADD_LIST = null; ADD_LIST_TEXT = ""; } }
      renderBuild(); { const f = $(open ? "#bq" : "#build-adding"); if (f) f.focus({ preventScroll: !open }); } break;
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
    // The end of the deck's Actions (buildsheets.js deckEndHTML): each asks in its place first.
    case "build-del": askDeckEnd("del"); break;
    case "build-takeapart": askDeckEnd("apart"); break;
    case "build-del-no": renderBuildMenu(); break;
    case "build-takeapart-yes": { const box = deckBox(b); done(); if (box) takeApart(box); break; }
    case "build-del-yes": {
      done(); const i = BUILDS.findIndex(x => x.id === CUR), gone = BUILDS[i];
      // A deck in its box (0.95.1): its cards stay there and the box is a plain box from now on, which no change on
      // the record says, so the collection is read again. Until then the Collection went on listing the box as a
      // deck, under the box's name and with its cards in use, until the page was opened again.
      // Then the list of your decks (0.96.0; the next deck took its place until then); its Undo opens it again.
      const shown = () => { if (gone.loc) decksShown(); if (view === "build" || view === "yourdecks") showView("build"); };
      BUILDS.splice(i, 1); CUR = null; buildMode = "list"; saveBuilds(); shown(); window.scrollTo({ top: 0 });
      toast(`Deleted “${gone.name}”`, "Undo", () => { gone.updated = Date.now(); BUILDS.splice(Math.min(i, BUILDS.length), 0, gone); CUR = gone.id; buildMode = "list"; saveBuilds(); shown(); });
      break;
    }
    case "build-copy-pull": copyText(pullText(b.name, groupsFor(b)), "#build-copy-out", "Copied the list by location", done); break;
    case "build-dl-pull": done(); downloadFile(`${fileSlug(b.name)}-by-location.csv`, pullCSV(groupsFor(b))); break;
    case "build-copy-list": copyText(buildDecklist(b), "#build-copy-out", "Copied the decklist", done); break;
    case "build-copy-manabox": copyText(buildDecklist(b, true), "#build-copy-out", "Copied the decklist with your printings", done); break;
    case "build-copy-missing": { const items = buyList(b); copyText(buyText(items), "#build-copy-out", `Copied the buy list (${cardsWord(items.reduce((n, x) => n + x.qty, 0))})`, done); break; }
    case "build-reset-pulled": if (ownColl() && REC) { CLEARASK = b.id; renderBuild(); break; } b.pulled = {}; touchBuild(); break;
    case "build-clear-no": CLEARASK = null; renderBuild(); break;
    case "build-clear-yes": CLEARASK = null; clearGather(b); break;
    // A Built deck's warnings (0.98.2): put it back in its box (the move "Mark as built" makes), or not now.
    case "deck-back-yes": DECKWARN = null; markBuilt(b); break;
    case "deck-back-no": DECKWARN = null; renderBuild(); break;
  }
}
document.addEventListener("change", e => {
  const t = e.target, b = curBuild();
  if (t.id === "build-name" && b) { b.name = t.value.trim() || b.name; touchBuild(); const h = $("#buildmenu-title"); if (h) h.textContent = b.name; }
  else if (t.id === "build-allswaps") { showAllSwaps = t.checked; renderBuild(); }
  else if (t.id === "build-hidepulled") { buildHidePulled = t.checked; renderBuild(); }
  else if (t.id === "buy-indecks") { BUY_INDECKS = t.checked; renderBuild(); }
  else if (t.dataset && t.dataset.pulled != null && b) gatherTick(b, t.dataset.pulled, t.checked);   // in your own collection the card moves (builds.js, gathering)
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
    else if (view === "build" && !$("#bq") && buildMode === "list" && curBuild()) { e.preventDefault(); ADDING = { id: curBuild().id, open: true }; renderBuild(); $("#bq").focus(); }   // "+ Add cards" folded (0.103.0)
    else if (box && $(box)) { e.preventDefault(); $(box).focus(); }
  } else if (e.key === "Enter" && e.target.id === "bq") {
    const top = $("#bresults [data-addname]"); if (top) { e.preventDefault(); top.click(); }
  }
});

let curDeckIdx = null;

// ---- The deck's bar (0.104.0; step 6, piece 2b; Matt, Nov 19, 12:09: "I like this idea better, go for it", and 12:57,
// from the mock-up: "Looks great"). Once a deck's name has scrolled away, the header's top row gives way to a bar of
// its own: ← to the list of your decks, the deck's name, and "Jump to"; scrolling up brings the header back. The bar
// lies over the top row (#deckbar inside .top-row), so nothing below moves, and on a wide screen the tabs stay.
// "Jump to" is a sheet of the list's groups with their counts, and the panels under the list (#jumpsheet).
const DECKBAR = { on: false, y: 0, up: 0, frame: 0 };
function deckBarCheck() {
  DECKBAR.frame = 0;
  const b = view === "build" && buildMode !== "new" && !document.body.hasAttribute("data-welcome") ? curBuild() : null;
  const name = b && $("#view-build .deck-head h2"), row = $("header.top .top-row");
  const y = window.scrollY, dy = y - DECKBAR.y; DECKBAR.y = y;
  let on = false;
  if (name && row && name.getBoundingClientRect().bottom < row.getBoundingClientRect().bottom) {
    // Past the name: down shows the bar, up (a little, so a jitter doesn't) brings the header back.
    DECKBAR.up = dy < 0 ? DECKBAR.up - dy : 0;
    on = dy > 0 ? true : DECKBAR.up > 24 ? false : DECKBAR.on;
  } else DECKBAR.up = 0;
  if (on && $("#deckbar-name").textContent !== b.name) $("#deckbar-name").textContent = b.name;
  if (on === DECKBAR.on) return;
  DECKBAR.on = on; $("#deckbar").hidden = !on; $("header.top").classList.toggle("has-bar", on);
}
window.addEventListener("scroll", () => { if (!DECKBAR.frame) DECKBAR.frame = requestAnimationFrame(deckBarCheck); }, { passive: true });

// What "Jump to" lists: the list's groups as they are drawn (List, Grid, Stacks or Table), then each panel under the
// list and beside it that has a heading. → [{ el, title, n, group }]
function jumpTargets() {
  const root = $("#view-build"); if (!root) return [];
  const out = [], text = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const groups = root.querySelectorAll(".build-main details.grp, .build-main section.cgroup, .build-main section.stack, .build-main tr.tgroup");
  for (const g of groups) {
    if (g.closest("[hidden]")) continue;
    const head = g.matches("tr") ? g.querySelector("th") : g.querySelector("summary h3, .loc-head h3, .stack-head strong");
    const n = g.matches("tr") ? text(g.querySelector(".n")) : text(g.querySelector("summary .num, .loc-head .num, .stack-head .num"));
    const title = g.matches("tr") ? text(head).replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "").trim() : text(head);
    if (title) out.push({ el: g, title, n, group: true });
  }
  for (const p of root.querySelectorAll(".build-grid .panel")) {
    if (p.closest("[hidden]") || p.querySelector(".lctl, #bq, .grp, .cgroup, .stack, .ctable") || p.closest(".panel") !== p) continue;
    const head = p.querySelector(":scope > summary h3, :scope > .section-head h3, :scope > summary, :scope > h3, :scope > .section-head h2");
    let title = text(p.querySelector(":scope > summary h3, :scope > .section-head h3, :scope > h3")) || text(head);
    if (!title) continue;
    const extra = p.querySelector(":scope > summary .chip, :scope > summary .muted, :scope > .section-head .chip, :scope > .section-head .bracket-chip");
    const n = extra && text(extra).length <= 14 ? text(extra) : "";
    out.push({ el: p, title: title.replace(/\s*\bi$/, ""), n, group: false });
  }
  return out;
}
let JUMPS = [];
function openJump() {
  JUMPS = jumpTargets();
  const line = $("header.top").getBoundingClientRect().bottom + 20;
  let cur = -1; JUMPS.forEach((j, i) => { if (j.group && j.el.getBoundingClientRect().top <= line) cur = i; });
  const row = (j, i) => `<button class="jump-row-btn${i === cur ? " cur" : ""}" data-jump="${i}"${i === cur ? ` aria-current="true"` : ""}><span>${esc(j.title)}</span><span class="jump-n${/^\d+$/.test(j.n) ? " num" : ""}">${esc(j.n)}</span></button>`;
  const groups = JUMPS.map((j, i) => (j.group ? row(j, i) : "")).join(""), panels = JUMPS.map((j, i) => (j.group ? "" : row(j, i))).join("");
  $("#jumpsheet-body").innerHTML = `<h2 id="jumpsheet-title" tabindex="-1">Jump to</h2>
    <div class="jump-cols"><div class="jump-col"><button class="jump-row-btn" data-jump="top"><span>Top of the deck</span><span class="jump-n"></span></button>${groups}</div>${panels ? `<div class="jump-col">${panels}</div>` : ""}</div>`;
  openDlg($("#jumpsheet"));
}
function jumpTo(k) {
  closeDlg($("#jumpsheet"));
  const j = k === "top" ? null : JUMPS[+k];
  requestAnimationFrame(() => {
    if (!j) { window.scrollTo({ top: 0 }); return; }
    if (j.el.id === "build-combos") COMBOS_OPEN = true;   // folded, a panel or a group opens to be read (its toggle keeps a group open through redraws)
    if (j.el.matches("details") && !j.el.open) j.el.open = true;
    // On a wide screen the panels beside the list are a column of their own that stays in view and scrolls by itself.
    const side = j.el.closest(".build-side");
    if (side && getComputedStyle(side).position === "sticky") { side.scrollTop += j.el.getBoundingClientRect().top - side.getBoundingClientRect().top; return; }
    const under = $("header.top").getBoundingClientRect().bottom;
    window.scrollTo({ top: Math.max(0, j.el.getBoundingClientRect().top + window.scrollY - under - 8) });
  });
}
$("#deckbar-jump").addEventListener("click", openJump);
document.addEventListener("click", e => {
  const dlg = $("#jumpsheet"); if (!dlg || !dlg.open) return;
  if (e.target === dlg) { closeDlg(dlg); return; }
  const t = e.target.closest && e.target.closest("#jumpsheet [data-jump]"); if (t) jumpTo(t.dataset.jump);
});

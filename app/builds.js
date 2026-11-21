"use strict";
// Bulk Tutor, the page's script, part "builds": builds, which are decks since 0.95.0 (state, saving, editing a list, a copy), lists by location and exports, taste, templates, the deck check, the bracket panel, share links, built builds.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ pull lists (shared by deck view and builds)
const TYPE_ORDER = ["C", "I", "S", "A", "E", "P", "B", "L", "O"];
const TYPE_SINGULAR = { C: "Creature", I: "Instant", S: "Sorcery", A: "Artifact", E: "Enchantment", P: "Planeswalker", B: "Battle", L: "Land", O: "Other" };
const STATUS_LABEL = { free: "Free", indeck: "In a deck", basic: "Basic land", missing: "Missing", here: "In this deck", out: "Take out" };
const typeRank = t => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? 99 : i; };

// entries: [{ name, qty, cmd }]. Groups: free locations, then decks, basics, missing (and "here").
// Inside a location, cards are sorted by type then name, the same order as the boxes.
function pullGroups(entries, home = null) {
  const groups = new Map();
  const add = (key, meta, item) => { if (!groups.has(key)) groups.set(key, { ...meta, items: [] }); groups.get(key).items.push(item); };
  for (const e of entries) {
    const st = cardStatus(e.name, e.qty, home), c = DATA ? cardOf(e.name) : null;
    // The price of the copy to fetch (the one in that box), or what a missing card costs to buy.
    const item = { ...e, st, type: c ? c[2] : (isBasic(e.name) ? "L" : "O"), price: st.kind === "missing" ? priceOf(e.name) : priceNum(e.name, st.loc || null) };
    // A group's title is the box or binder to go to, by the name you know it by; `loc` is the import's name for it,
    // and for a deck `deck` is the deck's own name.
    if (st.kind === "free") add("f:" + st.loc, { kind: "free", title: locName(st.loc), loc: st.loc, order: 0 }, item);
    else if (st.kind === "indeck") add("d:" + st.loc, { kind: "indeck", title: locName(st.loc), loc: st.loc, deck: placeName(st.loc, true), order: 1 }, item);
    else if (st.kind === "basic") add("basic", { kind: "basic", title: "Basic lands", order: 2 }, item);
    else if (st.kind === "here") add("here", { kind: "here", title: "Already in this deck", loc: home, order: 4 }, item);
    else add("missing", { kind: "missing", title: "Missing", order: 3 }, item);
  }
  const list = [...groups.values()].sort(pullGroupOrder);
  for (const g of list) g.items.sort(pullItemOrder(g));
  return list;
}
const pullGroupOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title, undefined, { numeric: true });
// A box with an order of its own is gone through in that order (0.76.0), the way you flip through it.
const pullItemOrder = g => (g.kind === "missing"
  ? (a, b) => b.price - a.price || a.name.localeCompare(b.name)
  : ((g.kind === "free" || g.kind === "indeck" || g.kind === "out") && locSorter(g.loc)) || ((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name)));

function itemNote(g, it) {
  const parts = [];
  if (it.cmd) parts.push("commander");
  if (it.side) parts.push("sideboard");
  if (it.st.short) parts.push(`need ${it.st.short} more`);
  if ((g.kind === "free" || g.kind === "indeck") && it.st.also.length) parts.push("also in " + it.st.also.map(esc).join(", "));
  return parts.join(" · ");
}

const groupQty = g => g.items.reduce((s, x) => s + x.qty, 0);

function groupsHTML(groups, opts = {}) {
  return groups.map(g => {
    const swaps = g.kind === "indeck" && swapsBase(g.loc) != null;
    const tag = swaps ? `<span class="tag-deck">SWAPS</span>` : g.kind === "indeck" ? `<span class="tag-deck">IN A DECK</span>`
      : g.kind === "out" ? `<span class="tag-deck">TAKE OUT</span>`
      : g.kind === "missing" ? `<span class="price num small">${money(g.items.reduce((s, x) => s + x.price * x.qty, 0))}</span>`
      : `<span class="muted small num">${groupQty(g)}</span>`;
    const rows = g.items.filter(it => !(opts.hidePulled && opts.pulled && opts.pulled[it.name])).map(it => {
      const note = itemNote(g, it);
      const label = `${it.qty > 1 ? `<span class="num">${it.qty}×</span> ` : ""}${esc(it.name)}${note ? ` <span class="muted small">· ${note}</span>` : ""}`;
      const price = g.kind === "missing" ? (it.price ? money(it.price) : "—") : "";
      if (opts.pulled && g.kind !== "missing" && g.kind !== "here") {
        const on = !!opts.pulled[it.name];
        return `<label class="line pull-row${on ? " pulled" : ""}"><span class="name"><input type="checkbox" data-pulled="${esc(it.name)}"${on ? " checked" : ""}> ${label}</span></label>`;
      }
      return `<div class="line"><span class="name">${label}</span><span class="price num">${price}</span></div>`;
    }).join("");
    const sub = g.kind === "indeck" && !swaps ? `<p class="muted small">${g.deck && g.deck !== g.title ? `Your deck <strong>${esc(g.deck)}</strong>. Take these from it, or swap in other cards.` : "Take these from that deck, or swap in other cards."}</p>` : "";
    const ic = g.kind === "free" || g.kind === "indeck" ? locIconHTML(g.loc, g.kind === "indeck", null, "sm") : "";
    return `<div class="loc-head"><h3>${ic}${esc(g.title)}</h3>${tag}</div>${sub}<div class="list">${rows || `<p class="muted small">All found.</p>`}</div>`;
  }).join("");
}

function pullText(title, groups) {
  const lines = [`${title}: cards by location`, ""];
  for (const g of groups) {
    const head = g.kind === "indeck" ? `${g.title} (IN A DECK${g.deck && g.deck !== g.title ? ": " + g.deck : ""})` : g.kind === "missing" ? "MISSING (to get)" : g.kind === "out" ? `${g.title.toUpperCase()}` : g.title;
    lines.push(`${head} · ${groupQty(g)}`);
    for (const it of g.items) {
      const extra = [it.cmd ? "commander" : "", it.comp ? "companion" : "", it.side ? "sideboard" : "", it.st.short ? `need ${it.st.short} more` : "", g.kind === "missing" && it.price ? money(it.price) : ""].filter(Boolean).join(", ");
      lines.push(`  ${it.qty > 1 ? it.qty + "x " : ""}${it.name}${extra ? ` (${extra})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

const csvCell = v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

function pullCSV(groups) {
  const rows = [["Quantity", "Card", "Location", "Status", "Commander", "Type", "Price (USD)"]];
  for (const g of groups) for (const it of g.items) rows.push([
    it.qty, it.name, g.kind === "free" || g.kind === "indeck" ? g.title : g.loc ? locName(g.loc) : "", STATUS_LABEL[g.kind],
    it.cmd ? "Yes" : it.comp ? "Companion" : it.side ? "Sideboard" : "", TYPE_SINGULAR[it.type] || "", it.price ? it.price.toFixed(2) : ""]);
  return toCSV(rows);
}

const fileSlug = s => (norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list");
function downloadFile(name, text) {
  // CSVs get a byte-order mark so Excel reads them as UTF-8; JSON must not have one.
  const csv = /\.csv$/i.test(name), data = (csv ? "\ufeff" : "") + text;
  const url = URL.createObjectURL(new Blob([data], { type: csv ? "text/csv;charset=utf-8" : "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Downloading ${name}`);
}

// ------------------------------------------------------------ owned substitutes
const subWhere = st => st.kind === "free" ? esc(stName(st)) : st.kind === "indeck" ? `in deck: ${esc(stName(st))}` : "";

// ------------------------------------------------------------ preferences: your taste in cards
const TASTE_NOTE = {
  "-2": "Never suggested: kept out of generated decks, tuning and swap suggestions.",
  "-1": "Suggested less often than similar cards.",
  "0": "No preference.",
  "1": "Suggested more often than similar cards.",
  "2": "Goes into every generated deck it fits, when you have a copy free to use.",
};
function loadPrefs() {
  try { PREFS = JSON.parse(store.get("bt.prefs") || "null") || { cards: {} }; } catch { PREFS = { cards: {} }; }
  if (!PREFS.cards || typeof PREFS.cards !== "object") PREFS.cards = {};
  for (const p of Object.values(PREFS.cards)) if (p && p.level == null) p.level = p.blocked ? -2 : 0;   // 0.16.0 entries
}
function savePrefs(fromSync) { CHANGE++; store.set("bt.prefs", JSON.stringify(PREFS)); if (!fromSync) syncSoon(); }
function setPref(name, change) {
  const k = norm(name), prev = PREFS.cards[k] || {};
  const p = { name: canonical(name), dismissed: 0, level: prev.blocked ? -2 : 0, ...prev, ...change, at: Date.now() };
  if (change.blocked != null && change.level == null) p.level = change.blocked ? -2 : 0;
  p.blocked = p.level === -2;
  PREFS.cards[k] = p;
  savePrefs();
}
const setTaste = (name, level) => setPref(name, { level });
function tasteSegHTML(name) {
  const lv = tasteOf(name), d = dismissCount(name);
  return `<div class="taste"><p class="small"><strong>Your taste</strong> <span class="muted">for this card, everywhere</span></p>
    <div class="seg seg-fill" role="group" aria-label="Your taste for ${esc(name)}">${TASTE.map(([v, label]) => `<button data-taste="${v}" data-card="${esc(name)}" aria-pressed="${lv === v}">${label}</button>`).join("")}</div>
    <p class="muted small">${TASTE_NOTE[String(lv)]}${d ? ` Dismissed from builds ${d}×, which lowers it a little. <button class="btn link" data-taste-reset="${esc(name)}">Reset</button>` : ""}</p></div>`;
}

// ------------------------------------------------------------ tuning: feedback → a few swaps
let TUNE = { id: null, steps: [], off: new Set(), alt: {}, open: new Set(), dial: "r:Removal" };
const tuneFresh = id => ({ id, steps: [], off: new Set(), alt: {}, open: new Set(), dial: TUNE.dial });
// ------------------------------------------------------------ templates: a deck's shape, reused
function loadTemplates() {
  try { TEMPLATES = JSON.parse(store.get("bt.templates") || "[]"); } catch { TEMPLATES = []; }
  if (!Array.isArray(TEMPLATES)) TEMPLATES = [];
}
function saveTemplates(fromSync) {
  CHANGE++; store.set("bt.templates", JSON.stringify(TEMPLATES));
  trackDeletions("t", TEMPLATES);
  if (!fromSync) syncSoon();
}
function useAsTemplate({ name, cards, commanders = [], companion = null, from }) {
  if (!DATA || !hasRoles()) { toast("Templates need card roles, which come with the card data"); return; }
  name = name.replace(/\s*\(generated[^)]*\)\s*$/, "").trim() || name;
  const shape = deckShape(cards, commanders, companion);
  if (shape.nonland + shape.lands < 40) { toast("That deck is too small to make a template from"); return; }
  const ex = TEMPLATES.find(t => t.from === from);
  if (ex) { ex.shape = shape; ex.name = name; ex.updated = Date.now(); }
  else TEMPLATES.unshift({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, from, made: Date.now(), updated: Date.now(), shape });
  saveTemplates();
  toast(`${ex ? "Updated" : "Saved"} “${name}” as a template. Use it when you generate or tune a deck.`);
}
function templateCompareHTML(b, t) {
  if (!t || !b.commanders.length) return "";
  const sh = t.shape, me = deckShape(b.cards, b.commanders, b.companion), ident = identityOf(b.commanders);
  const rows = [["Lands", sh.lands, me.lands, 2], ["Average mana value", sh.avgMv, me.avgMv, 0.4], ["Creatures", sh.creatures, me.creatures, 4],
    ["On plan", sh.onPlan, me.onPlan, 4], ["Interaction", sh.interaction, me.interaction, 3],
    ...templateSlots(sh, ident).filter(([r]) => !INTERACTION.includes(r) || r === "Board wipe").map(([r, n]) => [esc(r), n, me.roles[r] || 0, 2])];
  return `<div class="panel">
    <div class="section-head"><h3>Compared with ${esc(t.name)}</h3></div>
    <table class="cmp-table"><thead><tr><th></th><th class="num">Template</th><th class="num">This deck</th></tr></thead>
    <tbody>${rows.map(([label, a, x, tol]) => `<tr class="${Math.abs(a - x) > tol ? "off" : ""}"><th scope="row">${label}</th><td class="num">${a}</td><td class="num">${x}</td></tr>`).join("")}</tbody></table>
    ${sh.plan || me.plan ? `<p class="small">On plan means cards that fit <strong>${esc(sh.plan || "nothing in particular")}</strong> in the template and <strong>${esc(me.plan || "nothing in particular")}</strong> here.</p>` : ""}
    <p class="muted small">Rows in orange are further from the template than usual. ${ident.has("U") ? "" : "Without blue, the template's counterspells count as removal. "}“Move closer” in Tune suggests swaps for the gaps.</p>
  </div>`;
}

const pct = x => `${Math.round(x * 100)}%`;
function manaNumbersHTML(b) {
  if (!DATA || !b.commanders.length) return "";
  const m = manaNumbers(b);
  if (m.N < 40) return "";
  // With cost data the comparison is coloured symbols vs sources; without it, cards needing the colour.
  const demand = m.hasCosts ? m.pips : m.need;
  const totNeed = Object.values(demand).reduce((a, x) => a + x, 0), totSrc = Object.values(m.src).reduce((a, x) => a + x, 0);
  const colours = [...m.ident].map(ch => {
    const sn = totNeed ? demand[ch] / totNeed : 0, ss = totSrc ? m.src[ch] / totSrc : 0;
    const gap = m.hasLandData && totSrc && sn - ss >= 0.1, sym = Math.round(m.pips[ch] || 0);
    return `<li class="${gap ? "bad" : "info"}"><span class="mark pipmark" aria-hidden="true">${manaHTML(`{${ch}}`)}</span><span><span class="num">${m.src[ch]}</span> ${m.src[ch] === 1 ? "land makes" : "lands make"} ${COLOR_NAMES[ch].toLowerCase()} · <span class="num">${m.need[ch]}</span> ${m.need[ch] === 1 ? "card needs" : "cards need"} it${m.hasCosts ? ` (<span class="num">${sym}</span> ${sym === 1 ? "symbol" : "symbols"})` : ""}${gap ? `<span class="small muted"> · ${pct(sn)} of the coloured ${m.hasCosts ? "symbols in your costs" : "cards"}, but ${pct(ss)} of your coloured sources</span>` : ""}</span></li>`;
  }).join("");
  const jobs = hasRoles() ? m.slots.map(([r, n]) => { const have = deckRoleCount(m.d, r), under = have < n;
    return `<li class="${under ? "bad" : "good"}"><span class="mark" aria-hidden="true">${under ? MARK.under : MARK.pass}</span><span>${esc(r)} <span class="num">${have}</span> <span class="muted small">of ${n}${b.targets && b.targets.roles && b.targets.roles[r] != null ? " (your target)" : ""}</span></span></li>`; }).join("") : "";
  return `<div class="panel">
    <div class="section-head"><h3>Mana and jobs</h3></div>
    <p class="small"><strong class="num">${m.lands}</strong> lands${m.ramp ? ` and <strong class="num">${m.ramp}</strong> ramp cards` : ""} in <span class="num">${m.N}</span> cards.</p>
    <p class="small">You'll have your 4th land on turn 4 about <strong class="num">${pct(m.play4)}</strong> of the time on the play, <strong class="num">${pct(m.draw4)}</strong> on the draw. An opening hand has 2–4 lands <span class="num">${pct(m.open)}</span> of the time.</p>
    <p class="muted small">Lands only; ramp makes it better than this.</p>
    ${m.ident.size ? `<p class="small"><strong>Colours</strong></p><ul class="check-list">${colours}</ul>${m.hasLandData ? (m.unknown ? `<p class="muted small">${cardsWord(m.unknown)} not counted (no colour data).</p>` : "") + (m.held.length ? `<p class="muted small" id="mana-held">${esc(m.held.join(", "))}: ${m.held.length === 1 ? "its colours come" : "their colours come"} with conditions this deck doesn't meet, so ${m.held.length === 1 ? "it isn't" : "they aren't"} counted for them.</p>` : "") : `<p class="muted small">Nonbasic lands' colours appear after the next data refresh; only basics are counted for now.</p>`}` : ""}
    ${jobs ? `<p class="small"><strong>Jobs</strong></p><ul class="check-list">${jobs}</ul>` : ""}
  </div>`;
}


function roleCountsHTML(names, opts = {}) {
  if (!hasRoles()) return "";
  const counts = new Map(ROLE_COUNTED.map(r => [r, 0]));
  for (const { name, qty } of names) for (const r of roleList(roleBits(name))) if (counts.has(r)) counts.set(r, counts.get(r) + (qty || 1));
  const chips = [...counts].filter(([r, n]) => n > 0 || ROLE_CORE.has(r))
    .map(([r, n]) => opts.clickable
      ? `<button class="chip role-chip${n === 0 ? " zero" : ""}" data-role="${r}" aria-pressed="${opts.active === r}">${r} <span class="num">${n}</span></button>`
      : `<span class="chip${n === 0 ? " zero" : ""}">${r} <span class="num">${n}</span></span>`).join("");
  return `<div class="roles" aria-label="Cards by role">${chips}</div>`;
}

// ------------------------------------------------------------ companions
function toggleCompanion(i) {
  const b = curBuild(); const c = b && b.cards[i]; if (!c) return;
  b.companion = isComp(b, c.name) ? null : c.name;
  touchBuild();
}
// A deck's own list: the deck that points at the location (0.95.0; before that the build built into it, else the one
// started from it). With the example or a link's collection, which have no record and so no deck that points
// anywhere: the list started from the location, and a deck that has none yet is its box's cards.
const buildForDeck = loc => BUILDS.find(x => deckBox(x) === loc)
  || (ownColl() ? null : BUILDS.find(x => !x.loc && x.source && x.source.kind === "owned" && x.source.loc === loc)) || null;
// Cards added to and taken out of a deck by its build.
function deckChanges(b) {
  const home = buildHome(b); if (!home || !COLL) return { add: 0, out: 0 };
  const inDeck = new Set(COLL.entries.filter(e => e.loc === home).map(e => norm(e.name)));
  const inBuild = new Set(boxCards(b).map(c => norm(c.name)));   // the box holds the sideboard too
  return { add: [...inBuild].filter(k => !inDeck.has(k)).length, out: [...inDeck].filter(k => !inBuild.has(k)).length };
}

function buildFromOwnedDeck(loc, open = true) {
  const id = ownColl() ? locIdOf(loc) : null;   // in your own collection the list is the deck that holds the box
  return createBuild({ ...deckListOf(loc), name: deckDefaultName(loc), source: { kind: "owned", loc }, ...(id ? { status: "built", loc: id } : {}) }, open);
}
// The deck's build, made now if it has none, without opening it: the copy of its list that keeps the deck's own name,
// and that stays as it was when another deck takes cards out of its box.
const deckBuild = loc => buildForDeck(loc) || buildFromOwnedDeck(loc, false);

function deckCheckHTML(b) {
  const items = deckCheck(b), issues = items.filter(i => i.ok === false).length;
  return `<details class="panel check-panel"${issues ? " open" : ""}>
    <summary class="section-head"><h3>Deck check</h3><span class="chip ${issues ? "warn-chip" : "own"}">${issues ? `${issues} to fix` : "All good"}</span></summary>
    <ul class="check-list">${items.map(i => `<li class="${i.ok === false ? "bad" : i.ok ? "good" : "info"}"><span class="mark" aria-hidden="true">${i.ok === false ? MARK.fail : i.ok ? MARK.pass : MARK.unsure}</span><span>${esc(i.text)}${i.list ? `<span class="small muted"> · ${i.list.slice(0, 8).map(esc).join(", ")}${i.list.length > 8 ? ` and ${i.list.length - 8} more` : ""}</span>` : ""}</span></li>`).join("")}</ul>
    ${hasFlags() ? "" : `<p class="muted small">Legality and commander checks appear after the next data refresh.</p>`}
  </details>`;
}

// ------------------------------------------------------------ bracket estimate (0.36.0)
// The engine's bracketEstimate, shown in the build's side column with what raised it, what isn't checked yet,
// an "i" note that brackets are a beta and the estimate isn't a measure of how the deck plays (Matt, Nov 8), and
// the person's own call (b.bracket), which wins wherever the bracket is shown.
let BRACKET_ABOUT = false;
const BRACKET_GUIDE = "https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026";
const bracketLabel = n => `${n} · ${BRACKET_NAMES[n]}`;
// The strip's chip (0.103.0, as in the S1 picture Matt chose): "Bracket 3 ↓"; whether it is an estimate or your call
// is said to a screen reader and in the panel it jumps to.
const bracketJumpText = est => `Bracket ${est.shown} ${MARK.jump}`;
const bracketJumpLabel = est => `Bracket ${est.shown}, ${est.set ? "your call" : "an estimate"}. Go to the bracket`;
function bracketSignalHTML(s, est) {
  const n = s.list.length, plural = n === 1 ? "" : "s";
  let text, list = s.list;
  if (s.kind === "gc") text = `${n} Game Changer${plural}: ${n > BRACKET_GC_MAX ? `more than ${BRACKET_GC_MAX} is Bracket 4` : `Bracket 3 allows up to ${BRACKET_GC_MAX}`}`;
  else if (s.kind === "combo") { text = `${n} combo${plural} Commander Spellbook rates ${BRACKET_TAGS[s.tag] || s.tag}`; list = s.list.map(c => c.join(" + ")); }
  else if (s.kind === "mld") text = "Mass land denial: only from Bracket 4";
  else text = n > BRACKET_FEW_TURNS ? `${n} extra-turn cards: chaining them is Bracket 4` : "Extra turns: fine in small doses at Bracket 2";
  const sets = s.bracket > 2 && s.bracket === est.bracket;
  return `<li class="${sets ? "sets" : "info"}"><span class="mark num" aria-label="Bracket ${s.bracket}">${s.bracket}</span><span>${esc(text)}<span class="small muted"> · ${list.slice(0, 6).map(esc).join(", ")}${list.length > 6 ? ` and ${list.length - 6} more` : ""}</span></span></li>`;
}
function bracketPanelHTML(b) {
  if (!DATA) return "";
  if (legalState === "idle") loadLegal();
  if (combosState === "idle") loadCombos();
  const est = bracketEstimate(b), unknown = [];
  if (est.unknown.includes("gc")) unknown.push(legalState === "loading" ? "Checking Game Changers…" : "Game Changers aren't checked: this card data has no list of them.");
  if (est.unknown.includes("combo")) unknown.push(combosState === "loading" ? "Checking combos…" : "Combos aren't checked: no combo data loaded.");
  if (est.unknown.includes("mld")) unknown.push("Mass land denial and extra turns are checked after the next data refresh.");
  const nothing = !est.signals.length && !est.unknown.includes("gc") && !est.unknown.includes("combo");
  return `<div class="panel bracket-panel" id="bracket-panel">
    <div class="section-head"><h3>Bracket <button class="info-btn" data-bracket-about aria-expanded="${BRACKET_ABOUT}" aria-controls="bracket-about" aria-label="About this estimate" title="About this estimate">${MARK.info}</button></h3><span class="chip own bracket-chip">${bracketLabel(est.shown)}</span></div>
    ${BRACKET_ABOUT ? `<p class="small" id="bracket-about">Commander brackets are still a beta from Wizards of the Coast. This estimate counts Game Changers, combos, mass land denial and extra turns. It can't see how fast or strong your deck really plays, and it never says 1 or 5, which depend on what you're going for. Use it to start the conversation with your playgroup. <a href="${BRACKET_GUIDE}" target="_blank" rel="noopener">Latest bracket update ↗</a></p>` : ""}
    <p class="muted small">${est.set ? `Your call. The estimate is ${esc(bracketLabel(est.bracket))}.` : "Estimated from the cards below. Each line's number is the bracket it points to."}</p>
    <ul class="check-list">${est.signals.map(sg => bracketSignalHTML(sg, est)).join("")}${nothing ? `<li class="info"><span class="mark" aria-hidden="true">${MARK.pass}</span><span>No Game Changers, combos, mass land denial or extra turns</span></li>` : ""}${unknown.map(u => `<li class="info"><span class="mark" aria-hidden="true">${MARK.unsure}</span><span>${esc(u)}</span></li>`).join("")}</ul>
    <div class="fgroup"><span class="flabel-sm" id="bracket-set-label">Set it yourself</span>
      <div class="seg seg-fill" role="group" aria-labelledby="bracket-set-label">${[1, 2, 3, 4, 5].map(n => `<button data-bracket-set="${n}" aria-pressed="${est.set === n}" title="${BRACKET_NAMES[n]}">${n}</button>`).join("")}</div>
      ${est.set ? `<button class="btn link small" data-bracket-set="">Go back to the estimate</button>` : ""}</div>
  </div>`;
}
// Game Changers and combos load on demand; once they're in, the panel and its jump link catch up.
function paintBracket() {
  const b = curBuild(), p = $("#bracket-panel"); if (!b || !p) return;
  p.outerHTML = bracketPanelHTML(b);
  const j = $("#bracket-jump"), est = j && bracketEstimate(b); if (j) { j.innerHTML = bracketJumpText(est); j.setAttribute("aria-label", bracketJumpLabel(est)); }
}

// Mana curve of nonland cards, 0 to 7+, with average mana value.
function curveHTML(cards) {
  if (!DATA || !DATA.cards.length || DATA.cards[0].length < 5) return "";
  const buckets = new Array(8).fill(0); let sum = 0, n = 0;
  for (const { name, qty = 1 } of cards) {
    const c = cardOf(name); if (!c || c[2] === "L") continue;
    const mv = c[4] || 0; buckets[Math.min(mv, 7)] += qty; sum += mv * qty; n += qty;
  }
  if (!n) return "";
  const max = Math.max(...buckets, 1);
  return `<div class="panel">
    <div class="section-head"><h3>Mana curve</h3><span class="muted small">Average <strong class="num">${(sum / n).toFixed(2)}</strong> · nonland cards</span></div>
    <div class="curve" role="img" aria-label="Nonland cards by mana value: ${buckets.map((v, i) => `${i === 7 ? "7+" : i}: ${v}`).join(", ")}">
      ${buckets.map((v, i) => `<div class="cbar" title="${v} card${v === 1 ? "" : "s"} at mana value ${i === 7 ? "7 or more" : i}"><span class="cnum num">${v || ""}</span><span class="cfill" style="height:${(v / max * 100).toFixed(1)}%"></span><span class="clabel num">${i === 7 ? "7+" : i}</span></div>`).join("")}
    </div>
  </div>`;
}

// Owned cards with a role, in the build's colors and not already in it: the way to fill a gap.
function roleBrowseHTML(b, role) {
  const bit = DATA.roles.indexOf(role); if (bit < 0) return "";
  const ident = buildIdentity(b), inBuild = new Set(b.cards.map(c => norm(c.name)));
  const hits = [];
  for (const [k, a] of AGG) {
    if (inBuild.has(k) || BASICS.has(k)) continue;
    const c = cardOf(a.name); if (!c || !((c[5] >> bit) & 1)) continue;
    if (ident && [...c[1]].some(ch => ch !== "C" && !ident.has(ch))) continue;
    hits.push({ name: c[0], free: a.free > 0, rank: c[6] || 1e6, st: cardStatus(c[0], 1, buildHome(b)) });
  }
  hits.sort((x, y) => (y.free - x.free) || x.rank - y.rank || x.name.localeCompare(y.name));
  return `<div class="role-browse">
    <p class="small"><strong>${esc(role)}</strong> cards you own${ident ? " in these colors" : ""}${hits.length ? `, free ones first` : ""}:</p>
    ${hits.length ? `<div class="results">${hits.slice(0, 15).map(h => `<button class="bres" data-addname="${esc(h.name)}"><span><strong>${esc(h.name)}</strong> <small>${subWhere(h.st)}</small></span><span class="add">Add</span></button>`).join("")}</div>${hits.length > 15 ? `<p class="muted small">${hits.length - 15} more not shown.</p>` : ""}`
      : `<p class="muted small">None outside this deck.</p>`}
  </div>`;
}

// ------------------------------------------------------------ build share links
async function packBuild(b) {
  const text = JSON.stringify({ n: b.name, c: b.cards.map(c => [c.name, c.qty]), k: b.commanders, ...(b.companion ? { m: b.companion } : {}), ...(sideOf(b).length ? { s: sideOf(b).map(c => [c.name, c.qty]) } : {}), ...(maybeOf(b).length ? { w: maybeOf(b).map(c => [c.name, c.qty]) } : {}), ...(listNote(b) ? { o: listNote(b) } : {}) });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(await new Response(stream).arrayBuffer());
}
async function unpackBuild(s) {
  const stream = new Blob([unb64url(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const o = JSON.parse(await new Response(stream).text());
  const list = l => (Array.isArray(l) ? l : []).map(([name, qty]) => ({ name: String(name), qty: +qty || 1 }));
  return { name: String(o.n || "Shared deck"), cards: list(o.c), commanders: (o.k || []).map(String), companion: o.m ? String(o.m) : null, side: list(o.s), maybe: list(o.w), note: typeof o.o === "string" ? cleanNote(o.o) : "" };
}
let SHARED_BUILD = null;

// ------------------------------------------------------------ keep the screen on while pulling
let wakeLock = null;
async function syncWakeLock() {
  const want = document.visibilityState === "visible" && ((view === "build" && buildMode === "pull" && !!curBuild()) || PICS_NOW.running);
  try {
    if (want && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", syncWakeLock);

// ------------------------------------------------------------ builds (deck builder)
let CUR = null, buildMode = "list", buildQuery = "", buildHidePulled = false;
const openSwaps = new Set(); let showAllSwaps = false;

function loadBuildPrefs() {
  buildGroup = store.get("bt.group") || "type"; buildSort = canonSort(store.get("bt.sort") || "name", ["name", "letter", "color", "ident", "type", "mv", "price"]);
}
// The list itself is read by decks.js (openDecks: from IndexedDB, or brought over from the lists of before 0.95.0),
// which then calls this: the signatures, and which deck is open.
function startBuilds() {
  for (const b of BUILDS) deckTidy(b);
  buildSig.clear(); LAST_STATE.clear();
  stampBuilds(false);
  CUR = store.get("bt.build");
  buildMode = ["pull", "tune"].includes(store.get("bt.buildmode")) ? store.get("bt.buildmode") : "list";
  // The deck that was open. One that is gone leaves none open, and the Workbench with no deck open is the list of
  // your decks (0.96.0; until then the first deck took its place).
  if (!BUILDS.some(b => b.id === CUR)) CUR = null;
}
// Each build's content signature: a build whose content changed gets a fresh "updated" time, which is
// what syncing compares. Changes that arrive from sync (fromSync) are recorded without a new time.
const buildSig = new Map();
// History (engine: recordChange): each local save compares a build's cards, commander, companion and sideboard with
// what they were at the last save, and records the difference. HISTORY_WHY labels the next save's change
// (tuning, regenerating, going back); unlabelled ones are described from the diff.
const LAST_STATE = new Map();
let HISTORY_WHY = null, HIST_ALL = false;
function stampBuilds(bump) {
  let changed = false;
  for (const b of BUILDS) {
    const prev = LAST_STATE.get(b.id);
    deckTidy(b);                                // its status follows what was done to it (engine)
    if (bump) sideClean(b);                     // a card that joined the deck leaves the sideboard
    if (bump) maybeClean(b);                    // the maybeboard: one line per card (a card the deck also holds stays, flagged)
    if (bump && b.hotswap) hotSwapSync(b);      // a hot-swap's edit goes to its core or the version being played
    if (bump && prev) recordChange(b, prev, HISTORY_WHY);
    LAST_STATE.set(b.id, buildState(b));
    const { updated, ...rest } = b, sig = JSON.stringify(rest);
    if (buildSig.get(b.id) !== sig) { if (bump && buildSig.has(b.id)) b.updated = Date.now(); buildSig.set(b.id, sig); changed = true; }
  }
  HISTORY_WHY = null;
  return changed;
}
function saveBuilds(fromSync) {
  const changed = stampBuilds(!fromSync);
  saveDecks();   // decks.js: the list is kept in IndexedDB since 0.95.0
  // **The example's own decks** (0.106.0, decks.js): kept, and that is all. They are no decks of yours: which one is
  // open is remembered apart, none of them counts as a deletion (trackDeletions would read every deck you have as
  // deleted and say so to your other devices), and nothing is synced.
  if (MINE) { if (CUR) store.set("bt.exbuild", CUR); else store.del("bt.exbuild"); picsSoon(5000); return; }
  if (CUR) store.set("bt.build", CUR); else store.del("bt.build");
  const deleted = trackDeletions("b", BUILDS);
  if (!fromSync && (changed || deleted)) syncSoon();
  picsSoon(5000);
}
const curBuild = () => BUILDS.find(b => b.id === CUR) || null;
function setKeep(b, name, on) {
  const rest = (b.keep || []).filter(n => norm(n) !== norm(name));
  b.keep = on ? [...rest, canonical(name)] : rest;
  TUNE_CACHE.clear(); touchBuild();
}
function touchBuild() { const b = curBuild(); if (b) b.updated = Date.now(); saveBuilds(); renderBuild(); }

function uniqueBuildName(name) {
  let n = name, i = 2;
  while (BUILDS.some(b => b.name === n)) n = `${name} (${i++})`;
  return n;
}
// `open` false makes it without switching to it (a deck's list kept for later: deckBuild).
function createBuild({ name, cards = [], commanders = [], companion = null, source = null, side = null, maybe = null, note = "", status = "idea", loc = null, prints = null }, open = true) {
  const b = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: uniqueBuildName(name || "Untitled deck"),
    cards, commanders, ...(companion ? { companion } : {}), ...(side && side.length ? { side } : {}), ...(maybe && maybe.length ? { maybe } : {}), ...(cleanNote(note) ? { note: cleanNote(note) } : {}), source, pulled: {}, updated: Date.now(),
    status, format: DECK_FORMAT, ...(loc ? { loc } : {}) };
  sideClean(b); maybeClean(b);
  if (prints && prints.length) printsAdd(b, prints);   // the printings a pasted list named (0.101.0), for a deck you bring built
  if (open) { BUILDS.unshift(b); CUR = b.id; buildMode = "list"; buildQuery = ""; } else BUILDS.push(b);   // (until 0.96.0 one made unopened became the open deck when there was none)
  saveBuilds();
  return b;
}
// ------------------------------------------------------------ a list's own note
// A note on a build or a saved decklist (0.74.0; Matt, Nov 12: "Notes for decks and boxes should be distinct, because
// decklists can exist and should be able to have notes even if they're not assembled"). It belongs to the list and
// goes where the list goes: a deck's note is its build's (deckBuild makes one when a note is first written, as a new
// name does), a copy of a list takes the note along, and a box's own note (collection.js: locNote) stays with the box.
const cleanNote = text => String(text == null ? "" : text).replace(/\r\n?/g, "\n").trim().slice(0, NOTE_MAX);
const listNote = x => (x && typeof x.note === "string" ? x.note : "");
function setListNote(x, text) {
  const note = cleanNote(text); if (!x || note === listNote(x)) return false;
  if (note) x.note = note; else delete x.note;
  x.updated = Date.now();
  return true;
}
const listNoteHTML = (x, id = "") => (listNote(x) ? `<p class="small loc-note"${id ? ` id="${id}"` : ""}>${esc(listNote(x))}</p>` : "");
// What is in a deck's Notes field (#build-note in its Actions) from the first key until it is saved: when the field
// is left, and when the sheet closes. `of` says whose it is, so it is saved to the deck it was typed for whatever is on
// the screen by then.
let NOTE_TYPING = null;   // { field, of: { build }, text }
const noteField = (id, x, hint) => `<div class="field"><label for="${id}">Notes</label><textarea id="${id}" class="note-field" rows="3" maxlength="${NOTE_MAX}" placeholder="${hint}">${esc(NOTE_TYPING && NOTE_TYPING.field === id ? NOTE_TYPING.text : listNote(x))}</textarea></div>`;
function keepTypedNote(field) {
  const t = NOTE_TYPING; if (!t || (field && t.field !== field)) return;
  NOTE_TYPING = null;
  const b = BUILDS.find(x => x.id === t.of.build);
  if (!setListNote(b, t.text)) return;
  saveBuilds();
  noteRedraw();
}
// ------------------------------------------------------------ a copy of a deck
// Until 0.95.0 a list could also be kept as a "saved deck", a second kind of list that never claimed cards. Every
// list is a deck now and is kept (notes/model.md), so what "Save as deck" did is a copy: a second deck, an Idea, with
// the same list, sideboard, maybeboard and note. `open` false makes it without switching to it.
const copyCards = cards => cards.map(c => ({ name: c.name, qty: c.qty }));
const copyDeck = (x, open = true) => createBuild({ name: x.name, cards: copyCards(x.cards), commanders: [...(x.commanders || [])], companion: x.companion || null, side: copyCards(sideOf(x)), maybe: maybeOf(x).map(c => ({ ...c })), note: listNote(x) }, open);
// "Nov 2" this year, "Nov 2, 2025" before; for the YYYY-MM-DD dates in the deck data.
function dataDate(ymd) {
  const d = new Date(ymd + "T12:00:00Z"); if (isNaN(d)) return ymd;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
function shortDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

function buildFromDeck(d) {
  createBuild({
    name: d.name + (d.theme ? " · " + d.theme.name : ""),
    cards: d.cards.map(i => ({ name: DATA.cards[i][0], qty: 1 })),
    commanders: cmdsOf(d).map(i => DATA.cards[i][0]),
    source: { slug: d.slug, theme: d.theme, name: d.name },
  });
  showView("build"); window.scrollTo({ top: 0 });
  toast("Started a deck from this list");
}

// Reading a decklist (parseDecklist) is the engine's since 0.87.1: it needs no page, and so is checked under Node.

// `to`: false = the deck, true or "side" = the sideboard, "maybe" = the maybeboard.
function addToBuild(name, to = false) {
  const b = curBuild(); if (!b) return;
  name = canonical(name);
  if (to === "maybe") { addToMaybe(b, name); return; }
  if (to) { addToSide(b, name); return; }
  const ex = b.cards.find(c => norm(c.name) === norm(name));
  if (ex && !isBasic(name)) { toast(`${name} is already in this deck`); return; }
  const sj = sideOf(b).findIndex(c => norm(c.name) === norm(name));
  if (sj >= 0 && !anyNumber(name)) { moveToDeck(sj); return; }   // it's in the sideboard: adding it to the deck moves it
  if (ex) ex.qty++; else { b.cards.push({ name, qty: 1 }); if (!isBasic(name) && !isKept(b, name)) b.keep = [...(b.keep || []), name]; }
  touchBuild(); toast(`Added ${name}`);
}
function removeFromBuild(i) {
  const b = curBuild(); if (!b || !b.cards[i]) return;
  const [card] = b.cards.splice(i, 1);
  const wasCmd = isCmd(b, card.name), wasComp = isComp(b, card.name);
  b.commanders = b.commanders.filter(n => norm(n) !== norm(card.name));
  if (wasComp) b.companion = null;
  touchBuild();
  toast(`Removed ${card.name}`, "Undo", () => {
    b.cards.splice(Math.min(i, b.cards.length), 0, card);
    if (wasCmd) b.commanders.push(card.name);
    if (wasComp) b.companion = card.name;
    touchBuild();
  });
}
function swapInBuild(i, name) {
  const b = curBuild(); const old = b && b.cards[i]; if (!old) return;
  if (b.cards.some(c => norm(c.name) === norm(name))) { toast(`${name} is already in this deck`); return; }
  b.cards.splice(i, 1, { name, qty: 1 });
  if (isComp(b, old.name)) b.companion = null;
  const keepBefore = b.keep;
  b.keep = [...(b.keep || []).filter(n => norm(n) !== norm(old.name)), name];
  openSwaps.delete(norm(old.name));
  touchBuild();
  toast(`Swapped ${old.name} for ${name}`, "Undo", () => {
    const j = b.cards.findIndex(c => norm(c.name) === norm(name));
    if (j >= 0) b.cards.splice(j, 1, old);
    b.keep = keepBefore;
    touchBuild();
  });
}

function toggleCommander(i) {
  const b = curBuild(); const c = b && b.cards[i]; if (!c) return;
  if (isCmd(b, c.name)) b.commanders = b.commanders.filter(n => norm(n) !== norm(c.name));
  else b.commanders.push(c.name);
  touchBuild();
}

// ---- A sideboard (0.57.0; Matt, Nov 11: "Yes, agreed."): cards kept with the deck, in its box, and outside the 100
// (engine: sideOf, boxCards, sideClean). Only you move a card in or out of it. A row gets its "to the sideboard" button
// once the build has a sideboard, runs over 100 cards, or you ask for it, so a deck that never has one keeps short rows.
// SIDE_PICK holds a build's id: you asked, or its arrows showed on this visit (renderBuild; 0.105.2, Matt, Nov 19: their
// going when the sideboard empties "shouldn't happen"), until Done. ADD_TO holds where the search adds when that isn't the
// deck ({id, to: "side" | "maybe"}; 0.100.0: the choice "Add to" above the results). Both are for this visit only.
let SIDE_PICK = null, ADD_TO = null;
const addTo = b => (b && ADD_TO && ADD_TO.id === b.id && (ADD_TO.to !== "side" || sideShown(b)) ? ADD_TO.to : "deck");
const addSide = b => addTo(b) === "side";
const deckOver = b => deckCards(b).reduce((n, c) => n + c.qty, 0) > 100;
const sideShown = b => !!b && (SIDE_PICK === b.id || sideOf(b).length > 0 || deckOver(b));
const listSnap = b => ({ cards: copyCards(b.cards), side: b.side ? copyCards(b.side) : null, keep: b.keep ? [...b.keep] : null, maybe: b.maybe ? b.maybe.map(c => ({ ...c })) : null });
function listRestore(b, s) { b.cards = s.cards; if (s.side) b.side = s.side; else delete b.side; if (s.keep) b.keep = s.keep; else delete b.keep; if (s.maybe) b.maybe = s.maybe; else delete b.maybe; }
// A whole line moves, except a card a deck may hold any number of (a basic land): one copy at a time. The two cores
// change the lists and nothing else, for one card (below) or a selection (selDo).
function toSideCore(b, i) {
  const c = b.cards[i], one = anyNumber(c.name) && c.qty > 1, n = one ? 1 : c.qty;
  if (one) c.qty--; else b.cards.splice(i, 1);
  const s = sideOf(b).find(x => norm(x.name) === norm(c.name));
  if (s) s.qty += n; else b.side = [...sideOf(b), { name: c.name, qty: n }];
  if (!one && b.keep) b.keep = b.keep.filter(x => norm(x) !== norm(c.name));   // "kept" is about staying in the deck
  openSwaps.delete(norm(c.name));
}
function toDeckCore(b, j) {
  const c = b.side[j], one = anyNumber(c.name) && c.qty > 1, n = one ? 1 : c.qty;
  if (one) c.qty--; else b.side.splice(j, 1);
  const ex = b.cards.find(x => norm(x.name) === norm(c.name));
  if (ex) ex.qty += n; else b.cards.push({ name: c.name, qty: n });
  if (!isBasic(c.name) && !isKept(b, c.name)) b.keep = [...(b.keep || []), c.name];   // put in by hand, like a card you add
}
function moveToSide(i) {
  const b = curBuild(), c = b && b.cards[i]; if (!c || isCmd(b, c.name) || isComp(b, c.name)) return;
  const was = listSnap(b);
  toSideCore(b, i); touchBuild();
  toast(`Moved ${c.name} to the sideboard`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
function moveToDeck(j) {
  const b = curBuild(), c = b && sideOf(b)[j]; if (!c) return;
  const was = listSnap(b);
  toDeckCore(b, j); touchBuild();
  toast(`Moved ${c.name} to the deck`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
function removeFromSide(j) {
  const b = curBuild(), c = b && sideOf(b)[j]; if (!c) return;
  const was = listSnap(b);
  b.side.splice(j, 1);
  touchBuild();
  toast(`Removed ${c.name} from the sideboard`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
function addToSide(b, name) {
  const s = sideOf(b).find(c => norm(c.name) === norm(name));
  if (!anyNumber(name) && b.cards.some(c => norm(c.name) === norm(name))) { toast(`${name} is in the deck`); return; }
  if (s && !anyNumber(name)) { toast(`${name} is already in the sideboard`); return; }
  if (s) s.qty++; else b.side = [...sideOf(b), { name, qty: 1 }];
  touchBuild(); toast(`Added ${name} to the sideboard`);
}

// ---- The maybeboard (0.100.0; step 5, piece e; engine: maybeOf, maybeAdd, wishList): cards you are thinking about
// for the deck, outside it. A card goes there from the deck or the sideboard (a card's sheet, or "Move to
// maybeboard" for a selection: no button on each row, which has four already), from the search ("Add to"), and
// from a pasted list's Maybeboard, Considering or {noDeck} lists. From there it moves into the deck or comes off.
// The commander, the companion and basic lands aren't offered. A card that is on it and gets into the deck any
// other way stays on it, flagged "in the deck" (Matt, Nov 18), until you take it off.
function toMaybeCore(b, list, i) {
  const src = list === "side" ? b.side : b.cards, c = src && src[i]; if (!c) return;
  src.splice(i, 1);
  if (list !== "side" && b.keep) b.keep = b.keep.filter(x => norm(x) !== norm(c.name));   // "kept" is about staying in the deck
  if (!inMaybe(b, c.name)) b.maybe = [...maybeOf(b), { name: c.name, qty: c.qty }];
  openSwaps.delete(norm(c.name));
}
function maybeToDeckCore(b, j) {
  const c = maybeOf(b)[j]; if (!c) return;
  b.maybe.splice(j, 1);
  if (b.cards.some(x => norm(x.name) === norm(c.name))) return;
  b.cards.push({ name: c.name, qty: anyNumber(c.name) ? c.qty : 1 });
  if (!isBasic(c.name) && !isKept(b, c.name)) b.keep = [...(b.keep || []), c.name];   // put in by hand, like a card you add
}
const canMaybe = (b, name) => !isCmd(b, name) && !isComp(b, name) && !isBasic(name);
function moveToMaybe(i, list = "cards") {
  const b = curBuild(), c = b && (list === "side" ? sideOf(b) : b.cards)[i]; if (!c || (list !== "side" && !canMaybe(b, c.name))) return;
  const was = listSnap(b);
  toMaybeCore(b, list, i); touchBuild();
  toast(`Moved ${c.name} to the maybeboard`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
// Between the sideboard and the maybeboard (0.105.1; Matt, Nov 19: "arrows should be able to move cards between
// sideboard and maybeboard, not just sideboard and deck"). The arrows are a ladder, one list each way: the deck ↓ the
// sideboard ↓ the maybeboard, and ↑ back; a maybeboard card goes up to the sideboard while the deck shows one, else to
// the deck. Each card's details offer every list in words.
function maybeToSideCore(b, j) {
  const c = maybeOf(b)[j]; if (!c) return;
  b.maybe.splice(j, 1);
  const s = sideOf(b).find(x => norm(x.name) === norm(c.name));
  if (s) { if (anyNumber(c.name)) s.qty += c.qty; } else b.side = [...sideOf(b), { name: c.name, qty: c.qty }];
}
function maybeToSide(j) {
  const b = curBuild(), c = b && maybeOf(b)[j]; if (!c) return;
  const was = listSnap(b);
  maybeToSideCore(b, j); touchBuild();
  toast(`Moved ${c.name} to the sideboard`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
function maybeToDeck(j) {
  const b = curBuild(), c = b && maybeOf(b)[j]; if (!c) return;
  const was = listSnap(b);
  maybeToDeckCore(b, j); touchBuild();
  toast(`Moved ${c.name} to the deck`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
function removeFromMaybe(j) {
  const b = curBuild(), c = b && maybeOf(b)[j]; if (!c) return;
  const was = listSnap(b);
  b.maybe.splice(j, 1);
  touchBuild();
  toast(`Removed ${c.name} from the maybeboard`, "Undo", () => { listRestore(b, was); touchBuild(); });
}
function addToMaybe(b, name) {
  if (!anyNumber(name) && b.cards.some(c => norm(c.name) === norm(name))) { toast(`${name} is in the deck`); return; }
  if (!maybeAdd(b, [{ name }]).length) { toast(`${name} is already on the maybeboard`); return; }
  touchBuild(); toast(`Added ${name} to the maybeboard`);
}

// Several cards into the open build at once (the Collection browser's selection, 0.59.0), by the rules of adding one: a
// card already in the deck is left alone, one in the sideboard moves to the deck, a basic adds a copy; into the sideboard,
// a card in either list is left alone. canAdd says which; addMany adds them with one Undo. → how many were added.
function canAdd(b, name, toSide) {
  const inDeck = b.cards.some(c => norm(c.name) === norm(name)), inSideb = inSide(b, name);
  return toSide ? anyNumber(name) || (!inDeck && !inSideb) : isBasic(name) || !inDeck;
}
function addCore(b, names, toSide) {
  const list = [];
  for (const name of names.map(canonical)) {
    if (!canAdd(b, name, toSide)) continue;
    list.push(name);
    const sj = sideOf(b).findIndex(c => norm(c.name) === norm(name)), ex = b.cards.find(c => norm(c.name) === norm(name));
    if (toSide) { if (sj >= 0) b.side[sj].qty++; else b.side = [...sideOf(b), { name, qty: 1 }]; }
    else if (sj >= 0 && !anyNumber(name)) toDeckCore(b, sj);
    else if (ex) ex.qty++;
    else { b.cards.push({ name, qty: 1 }); if (!isBasic(name) && !isKept(b, name)) b.keep = [...(b.keep || []), name]; }
  }
  return list;
}
function addMany(names, toSide) {
  const b = curBuild(); if (!b) return 0;
  const was = listSnap(b), list = addCore(b, names, toSide);
  if (!list.length) return 0;
  TUNE_CACHE.clear(); b.updated = Date.now(); saveBuilds(); rerenderCurrent();
  toast(`Added ${cardsWord(list.length)} to ${toSide ? "the sideboard of " : ""}${b.name}`, "Undo", () => { listRestore(b, was); TUNE_CACHE.clear(); b.updated = Date.now(); saveBuilds(); rerenderCurrent(); }, 8000);
  return list.length;
}

// A list into the open build (0.63.0; Matt, Nov 11: "Anywhere we allow users to add cards, they should be able to add a
// list as well (outside of cases like choosing a commander or something)"). The lines are read as a decklist is
// (parseDecklist) and added by the rules of adding one card: its "Sideboard" section goes to the sideboard, a card
// already in the build is left alone, a basic adds as many copies as its line says. A commander is named only for a
// build that has none. One Undo for the cards; a "Tokens" section goes where a pasted decklist's does (tokensFromList).
// Its Maybeboard, Considering and {noDeck} lists go onto the maybeboard (0.100.0; left out and named until then).
// → false when the text holds no cards or tokens.
let ADD_LIST = null, ADD_LIST_TEXT = "";   // the build whose "Add a list" box is open, and what is written in it
// What is written under "Or paste a decklist" on the start screen, kept through redraws (0.70.1): the Workbench is
// redrawn when prices arrive (0.68.0) or a sync lands, and until then that emptied the field under the person's hands.
let PASTE_TEXT = "";
function addList(text) {
  const b = curBuild(), p = parseDecklist(text); if (!b || (!p.cards.length && !p.side.length && !p.tokens.length && !p.maybe.length)) return false;
  const copies = list => list.flatMap(c => Array(anyNumber(c.name) ? Math.min(c.qty, 99) : 1).fill(c.name));
  const was = listSnap(b), cmds = [...b.commanders], deck = addCore(b, copies(p.cards), false), side = addCore(b, copies(p.side), true);
  const wanted = maybeAdd(b, p.maybe.filter(c => anyNumber(c.name) || !b.cards.some(x => norm(x.name) === norm(c.name)))).length;   // one the deck holds isn't a maybe
  const added = new Set([...deck, ...side].map(norm)), left = [...p.cards, ...p.side].filter(c => !added.has(norm(c.name))).length;
  const unknown = DATA ? [...new Set([...deck, ...side])].filter(n => !cardOf(n) && !isBasic(n)).length : 0;
  if (!b.commanders.length) b.commanders = p.commanders.filter(n => b.cards.some(c => norm(c.name) === norm(n)));
  if (deck.length + side.length) printsAdd(b, p.prints, [...deck, ...side]);   // the printings its lines named (0.101.0: engine), for the cards that came in
  const n = deck.length + side.length, redo = () => { TUNE_CACHE.clear(); b.updated = Date.now(); saveBuilds(); rerenderCurrent(); };
  if (n || wanted) redo();
  const notes = [left ? `${left} already in it` : "", unknown ? `${unknown === 1 ? "1 name isn't a card" : unknown + " names aren't cards"} in today's data` : ""].filter(Boolean).join("; ");
  const where = [side.length ? `${side.length} to the sideboard` : "", wanted ? `${wanted} to the maybeboard` : ""].filter(Boolean).join(", ");
  const lead = n || wanted ? `Added ${cardsWord(n + wanted)} to ${b.name}${where ? ` (${where})` : ""}${notes ? `; ${notes}` : ""}` : p.cards.length + p.side.length + p.maybe.length ? "No cards added: they are all in the build already" : "";
  tokensFromList(p.tokens, lead, "build", n || wanted ? () => { listRestore(b, was); b.commanders = cmds; redo(); } : null);
  return true;
}

// ---- Selecting several cards (0.58.0; Matt, Nov 11: "a select all and select multiple cards within views, and allow any
// action that could be taken with one card to be taken with the group (except maybe search or set as commander, things
// that wouldn't make sense)"). SEL = {id: the build, deck, side: Sets of normalized names}, for this visit, and on only
// while that build's list is on screen. Drawn by the Workbench (a tick per card and per group in every view, the bar,
// the sheet); the group actions are the single-card ones run over the selection, with one Undo.
let SEL = null;
const selOn = b => !!(b && SEL && SEL.id === b.id && buildMode === "list");
const selHas = (list, name) => !!SEL && SEL[list].has(norm(name));
const selCount = () => (SEL ? SEL.deck.size + SEL.side.size : 0);
function selStart(b) { SEL = { id: b.id, deck: new Set(), side: new Set() }; openSwaps.clear(); }
function selSet(list, names, on) { for (const n of names) if (on) SEL[list].add(norm(n)); else SEL[list].delete(norm(n)); }
// Names that have left their list (a move, an Undo, a sync) leave the selection.
function selPrune(b) {
  const deck = new Set(b.cards.map(c => norm(c.name))), side = sideKeys(b);
  for (const k of [...SEL.deck]) if (!deck.has(k)) SEL.deck.delete(k);
  for (const k of [...SEL.side]) if (!side.has(k)) SEL.side.delete(k);
}
// What each group action would touch. Left out as for one card: the commander and companion can't go to the sideboard
// or be kept or swapped out (they always stay), and a basic land has no taste.
function selActions(b) {
  const deck = b.cards.filter(c => SEL.deck.has(norm(c.name))), side = sideOf(b).filter(c => SEL.side.has(norm(c.name)));
  const plain = deck.filter(c => !isCmd(b, c.name) && !isComp(b, c.name)), own = plain.filter(c => !isBasic(c.name));
  return { deck, side, toside: plain, todeck: side, tomaybe: [...plain, ...side].filter(c => !isBasic(c.name)), keep: own.filter(c => !isKept(b, c.name)), unkeep: own.filter(c => isKept(b, c.name)), dismiss: own,
    rm: deck, siderm: side, taste: [...deck.filter(c => !isBasic(c.name) && !isCmd(b, c.name)), ...side.filter(c => !isBasic(c.name))] };
}
// Run one action over the selection: act = toside | todeck | tomaybe | keep | unkeep | dismiss | rm | siderm | taste (arg: the level).
function selDo(act, arg) {
  const b = curBuild(); if (!selOn(b)) return;
  const a = selActions(b), list = a[act] || [], n = list.length; if (!n) return;
  const was = { ...listSnap(b), commanders: [...b.commanders], companion: b.companion || null, why: b.why ? { ...b.why } : null, notHere: b.notHere ? [...b.notHere] : null };
  const prefs = list.map(c => [c.name, prefOf(c.name) ? { ...prefOf(c.name) } : null]), names = new Set(list.map(c => norm(c.name)));
  const at = (l, name) => l.findIndex(c => norm(c.name) === norm(name));
  let said = "", prefsChanged = false, swapped = 0;
  if (act === "toside") { for (const c of list) toSideCore(b, at(b.cards, c.name)); said = `Moved ${cardsWord(n)} to the sideboard`; }
  else if (act === "todeck") { for (const c of list) toDeckCore(b, at(b.side, c.name)); said = `Moved ${cardsWord(n)} to the deck`; }
  else if (act === "tomaybe") {
    for (const c of list) { const i = at(b.cards, c.name); if (i >= 0) toMaybeCore(b, "cards", i); else toMaybeCore(b, "side", at(sideOf(b), c.name)); }
    said = `Moved ${cardsWord(n)} to the maybeboard`;
  }
  else if (act === "keep") { b.keep = [...(b.keep || []), ...list.map(c => c.name)]; said = `Kept ${cardsWord(n)}`; }
  else if (act === "unkeep") { b.keep = (b.keep || []).filter(x => !names.has(norm(x))); said = `Stopped keeping ${cardsWord(n)}`; }
  else if (act === "rm") {
    b.cards = b.cards.filter(c => !names.has(norm(c.name))); b.commanders = b.commanders.filter(x => !names.has(norm(x)));
    if (b.companion && names.has(norm(b.companion))) b.companion = null;
    said = `Removed ${cardsWord(n)}`;
  } else if (act === "siderm") { b.side = b.side.filter(c => !names.has(norm(c.name))); said = `Removed ${cardsWord(n)} from the sideboard`; }
  else if (act === "dismiss") {
    prefsChanged = true;
    for (const c of list) { setPref(c.name, { dismissed: dismissCount(c.name) + 1 }); if (swapOut(b, c.name)) swapped++; }
    said = swapped === n ? `Swapped out ${cardsWord(n)}` : swapped ? `Swapped out ${cardsWord(swapped)}, removed ${n - swapped}` : `Removed ${cardsWord(n)}`;
  } else if (act === "taste") {
    // Never, on a generated build, swaps out the deck's cards you haven't kept, as it does for one card.
    prefsChanged = true;
    const gen = b.source && b.source.kind === "generated";
    for (const c of list) { setTaste(c.name, arg); if (arg === -2 && gen && at(b.cards, c.name) >= 0 && !isKept(b, c.name)) { swapOut(b, c.name); swapped++; } }
    said = `${cardsWord(n)}: ${tasteName(arg)}${swapped ? `, ${swapped} swapped out` : ""}`;
  } else return;
  SEL.deck.clear(); SEL.side.clear();
  TUNE_CACHE.clear(); GEN_IDEAS.clear();
  touchBuild();
  toast(said, "Undo", () => {
    listRestore(b, was); b.commanders = was.commanders; b.companion = was.companion;
    for (const k of ["why", "notHere"]) if (was[k]) b[k] = was[k]; else delete b[k];
    if (prefsChanged) for (const [name, prev] of prefs) restorePref(name, prev);
    TUNE_CACHE.clear(); GEN_IDEAS.clear(); touchBuild();
  }, 8000);
}

function buildSearch(q) {
  const b = curBuild(); q = norm(q);
  if (!b || q.length < 2) return [];
  const inBuild = new Set(b.cards.map(c => norm(c.name))), side = sideKeys(b), maybe = new Set(maybeOf(b).map(c => norm(c.name)));
  const seen = new Set(), out = [];
  const consider = name => {
    const k = norm(name);
    if (seen.has(k) || !k.includes(q)) return;
    seen.add(k);
    out.push({ name: canonical(name), k, owned: AGG.get(k), starts: k.startsWith(q), inBuild: inBuild.has(k) && !BASICS.has(k), inSide: side.has(k) && !BASICS.has(k), inMaybe: maybe.has(k) && !BASICS.has(k) });
  };
  for (const a of AGG.values()) consider(a.name);
  for (const basic of ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]) consider(basic);
  if (DATA) for (const c of DATA.cards) { if (out.length > 300) break; consider(c[0]); }
  const rank = x => x.owned ? (x.owned.free > 0 ? 0 : 1) : 2;
  out.sort((x, y) => rank(x) - rank(y) || (y.starts - x.starts) || x.name.localeCompare(y.name));
  return out.slice(0, 12);
}

function renderBuildResults() {
  const box = $("#bresults"); if (!box) return;
  const hits = buildSearch(buildQuery);
  if (norm(buildQuery).length < 2) { box.innerHTML = ""; return; }
  // "Add to" (0.100.0) turns the same search into the sideboard's or the maybeboard's: Deck, Sideboard (offered when
  // rows have their sideboard button: sideShown; a tick, "Add to the sideboard", from 0.57.0 until then) or Maybeboard.
  const b = curBuild(), to = addTo(b), toSide = to === "side", toMaybe = to === "maybe";
  const choice = (v, label) => `<button data-addto="${v}" aria-pressed="${to === v}">${label}</button>`;
  const pick = `<div class="field addto" id="bq-addto"><span class="flabel-sm" id="bq-addto-label">Add to</span><div class="seg seg-fill" role="group" aria-labelledby="bq-addto-label">${choice("deck", "Deck")}${sideShown(b) ? choice("side", "Sideboard") : ""}${choice("maybe", "Maybeboard")}</div></div>`;
  box.innerHTML = pick + (hits.length ? hits.map(h => {
    const st = cardStatus(h.name, 1, buildHome(b));
    const where = h.inSide ? "in the sideboard" : st.kind === "here" ? "in this deck" : st.kind === "free" ? esc(stName(st)) : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>` : st.kind === "basic" ? "basic land" : `not owned${DATA && cardOf(h.name) && cardOf(h.name)[3] ? " · " + money(cardOf(h.name)[3]) : ""}`;
    const done = toMaybe ? (h.inBuild ? "In the deck" : h.inSide ? "In sideboard" : h.inMaybe ? "On maybeboard" : "") : toSide ? (h.inBuild ? "In the deck" : h.inSide ? "In sideboard" : "") : h.inBuild ? "In build" : "";
    return done
      ? `<div class="bres done"><span><strong>${esc(h.name)}</strong> <small>${where}</small></span><span class="muted small">${done}</span></div>`
      : `<button class="bres" data-addname="${esc(h.name)}"${toSide ? " data-addside" : toMaybe ? " data-addmaybe" : ""}><span><strong>${esc(h.name)}</strong> <small>${where}${!toMaybe && !toSide && h.inMaybe ? " · on the maybeboard" : ""}</small></span><span class="add">${toMaybe ? "To maybeboard" : toSide ? "To sideboard" : h.inSide ? "Move to deck" : "Add"}</span></button>`;
  }).join("") : `<p class="muted small">No cards match “${esc(buildQuery)}”.</p>`);
}

function buildStats(b) {
  const s = { total: 0, free: 0, indeck: 0, basic: 0, missing: 0, here: 0, cost: 0 };
  const home = buildHome(b);
  for (const c of b.cards) {
    if (!isComp(b, c.name)) s.total += c.qty;   // the companion is gathered with the deck but isn't one of the 100
    const st = cardStatus(c.name, c.qty, home);
    s[st.kind] += c.qty;
    if (st.kind === "missing") s.cost += ((DATA && cardOf(c.name) ? cardOf(c.name)[3] : 0) || 0) * c.qty;
  }
  return s;
}

// Pull groups for a build; a build made from one of your decks also lists what to take out of it.
function buildPullGroups(b) {
  const home = buildHome(b);
  const all = boxCards(b);   // the sideboard is gathered with the deck: it lives in the same box
  const groups = pullGroups(all.map(c => ({ ...c, cmd: isCmd(b, c.name), comp: isComp(b, c.name) })), home);
  if (home && COLL) {
    const keep = new Set(all.map(c => norm(c.name))), out = new Map();
    for (const e of COLL.entries) if (e.loc === home && !keep.has(norm(e.name))) {
      const name = canonical(e.name), k = norm(name), ex = out.get(k);
      if (ex) ex.qty += e.qty; else out.set(k, { name, qty: e.qty, st: { kind: "out", also: [] }, type: typeOf(name), price: 0 });
    }
    if (out.size) { const g = { kind: "out", title: `Take out of ${locName(home)}`, loc: home, order: -1, items: [...out.values()] }; g.items.sort(pullItemOrder(g)); groups.unshift(g); }
  }
  return groups;
}

// New deck (0.96.0: the Workbench's start screen, under its own heading): the generator, then a list to start from.
// "From one of your decks" went with the list of decks, where every deck is a row. "From a box of cards" (0.97.0):
// a box that holds a deck's cards becomes a Built deck there (collection.js: the sheet "Choose your decks" was).
// "I have this deck built" (0.101.0; Matt, Nov 18, call 4: "Agreed"): the pasted list as a deck, then "Which box did
// it go into?" and the question whether its cards are added, in one go (a built deck you bring, below).
function buildNewPanel() {
  const fromBox = ownColl() && boxDeckChoices().length > 0;
  return `${genPanelHTML()}<div class="panel">
    <h3>${DATA && hasFlags() ? "Or start from a list" : "Start a deck"}</h3>
    ${DATA && DATA.decks.length ? `<p class="small"><strong>From a popular deck</strong> <span class="muted">on EDHREC, ranked by how much of it you own.</span></p>` : ""}
    <div class="actions">${DATA && DATA.decks.length ? `<button class="btn" data-go="decks">Find decks</button>` : ""}<button class="btn" id="build-empty">Start an empty deck</button>${fromBox ? `<button class="btn" id="build-frombox" data-box-from aria-haspopup="dialog">From a box of cards</button>` : ""}</div>
    ${fromBox ? `<p class="muted small">A box that already holds a deck becomes a Built deck, kept where it is.</p>` : ""}
    <div class="field">
      <label for="build-paste">Or paste a decklist (Moxfield, Archidekt, or one card per line)</label>
      <textarea id="build-paste" placeholder="Commander&#10;1 Queen Marchesa&#10;&#10;Deck&#10;1 Sol Ring&#10;1 Swords to Plowshares">${esc(PASTE_TEXT)}</textarea>
    </div>
    <p id="build-paste-msg" class="small warn-text" hidden></p>
    <div class="actions"><button class="btn primary" id="build-paste-go">Start from this list</button>${canBring() ? `<button class="btn" id="build-paste-built" aria-haspopup="dialog">I have this deck built</button>` : ""}</div>
    ${canBring() ? `<p class="muted small" id="build-paste-built-note">“I have this deck built” also asks which box it is in, and can add its cards to your collection.</p>` : ""}
  </div>`;
}

// ------------------------------------------------------------ built builds
// A build is a draft. "Mark as built" means the deck is together, so its cards are moved here too (0.53.0, engine:
// settleDecks): into the deck's location, a new one named after the build when it isn't one of your decks yet, and
// what the deck no longer uses into "To put away", as one change on the record (settleDecks says it, recDo makes
// it), listed under Recent changes with its Undo (changes.js). An example or linked collection only gets the label.
// **Since 0.95.0 the deck then points at that location** (`loc`, its id; `builtLoc`, its name, before), and that is
// what makes the location a deck's. `built` stays as the mark with its date: the banner, and its button ("Got it")
// takes it off without the deck leaving its box. **A deck stays in its location when the location is emptied** (an
// import, cards moved out by hand): only "Mark as built", taking it apart and the banner's "It's taken apart" move
// it, so an Undo of whatever emptied the box finds the deck as it was (until 0.95.0 it became a draft again).
const ownColl = () => !!(COLL && !COLL.example && !COLL.fromLink);
// Where a built deck you bring can add its cards (0.101.0): your own collection, or none here yet (the example is
// showing: the deck's cards start your collection, as a first file would). Not over a link's collection.
const canBring = () => ownColl() || (!REC && !(COLL && COLL.fromLink));
// Your own collection with nothing in it (0.101.1; model.md, "Decks and no collection"; agreed again Nov 18, 22:10):
// nothing says you lack a deck's cards, so none reads "missing". Rows show the price, the tiles Cards and Price, the
// line offers to add the cards, and Assemble and Actions offer nothing that needs a collection (no gather, no buy list).
const collEmpty = () => ownColl() && !COLL.entries.length;
// There, the quiet offer to add a deck's cards (the line under its name, and Assemble) opens "Which box did it go
// into?" and then "Add N cards" (0.101.0, a built deck you bring), as a Built deck's "No location saved…" does. Not
// on a deck that already has its box. The words are a placeholder until Matt writes his own.
const canAddCards = b => collEmpty() && !deckBox(b);
const ADD_CARDS_WORDS = "Have it built? Add its cards";
const locHasCards = loc => !!(COLL && COLL.entries.some(e => e.loc === loc));
function builtMatch(b) {
  const box = deckBox(b);
  if (box) return locHasCards(box) ? box : null;
  if (buildHome(b)) { const ch = deckChanges(b); return ch.add === 0 && ch.out === 0 ? buildHome(b) : null; }
  const target = norm(b.name);
  const hit = ownedDecks().find(d => norm(d.loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, "")) === target || norm(d.loc) === target);
  return hit ? hit.loc : null;
}
// A name for a new deck's location: the one the import would read as a deck (the prefix), and not one in use.
function newDeckLoc(b) {
  const p = deckPrefix();
  return freeLocName(p && !looksLikeDeck(b.name) ? `${p} – ${b.name}` : b.name, b);
}
// A deck's pile (0.98.1; Matt, Nov 18: "these auto-generated locations could be called 'Deck Pile'"): the place its
// first tick in Assemble makes, of kind KIND_PILE (collection.js isPileLoc).
const pileName = b => `Deck pile – ${b.name}`;
const newPileLoc = b => freeLocName(pileName(b), b);
// `base`, or "base (2)" and on: not a name with cards, nor another deck's place, even an emptied one (0.98.0: a first
// tick must not gather into it).
function freeLocName(base, b) {
  const taken = new Set(ownColl() ? COLL.entries.map(e => e.loc) : []); let loc = base, i = 2;   // with no collection of your own no name is in use (the example's boxes aren't yours)
  for (const d of BUILDS) { const box = d !== b && deckBox(d); if (box) taken.add(box); }
  while (taken.has(loc) || loc === PUT_AWAY) loc = `${base} (${i++})`;
  return loc;
}
// The locations a built build fills: its deck (the list and its sideboard), and a hot-swap's Swaps location with the
// other versions' cards.
function builtLists(b, loc) {
  const side = sideKeys(b);   // a sideboard card stays in the deck's box, even when another version of a hot-swap uses it
  const lists = [{ loc, cards: boxCards(b), deck: looksLikeDeck(loc) }], sw = (b.hotswap ? swapsCards(b) : []).filter(c => !side.has(norm(c.name)));
  if (sw.length) lists.push({ loc: swapsLocFor(loc), cards: sw });
  return lists;
}
// Move a built build's cards (again: after its list changed, or a hot-swap switched versions). → the engine's result
// ({change, moves, lacking}), with `kept` and `did` (doChange's answer) when cards moved, and `box`: the location's
// id, one it has or the one this change gives a location it makes. With `when` (it is being marked built), the deck
// points at the location from here on, **before the collection is drawn again**: that is what makes it a deck's.
// `pile`: the deck's pile, when its cards go into another box (0.98.1): a list that wants nothing, so what it holds
// moves into the box (and anything the box doesn't want goes to the put-away list).
// `add` (0.101.0): a built deck you bring. What its place can't get from a box that isn't a deck is added there as
// new copies, in the printings its pasted list named, and no other deck gives a card (engine settleDecks, `opt.add`).
function builtPlan(b, loc, pile = null, add = false) {
  const how = { by: "deck", act: "built", label: b.name, deck: b.id, box: loc, was: deckStand(b) };   // which deck, and how it stood: Recent changes' Undo puts that back (changes.js deckFollows)
  return settleDecks(REC, [...builtLists(b, loc), ...(pile && pile !== loc ? [{ loc: pile, cards: [] }] : [])], how, deckLocs(), null, add ? { add: true, prints: printsOf(b) } : {});
}
function settleBuilt(b, loc, when = null, pile = null, add = false) {
  const r = builtPlan(b, loc, pile, add);
  r.box = locIdOf(loc) || ((r.change.locs || []).find(l => l.name === loc) || {}).id || null;
  if (when && r.box) deckStandSet(b, { status: "built", loc: r.box, built: when });
  if (!r.change.lines.length) return r;
  // A deck this one takes cards from keeps its own list: copied now, while its box still holds every card of it, so
  // that deck can say what it is missing instead of quietly becoming a 99-card deck. r.kept = the builds made for that.
  r.kept = [...new Set(r.moves.map(m => m.from))].filter(from => from !== loc && from !== pile && swapsBase(from) == null && isDeckLoc(from) && !buildForDeck(from)).map(from => deckBuild(from).id);
  r.did = recDo(r.change);
  return r;
}
// `into` = the box the person said the deck went into (the question below); without it, the build's home, or a new
// location named after the build.
// `add` (0.101.0): the answer "Add N cards" to the question below (a built deck you bring). **With no collection of
// your own the deck's cards start one**, as a first file does (import.js takeFile): the record begins here, the
// example goes, and from then on this is the same move as on any collection.
const builtPile = (b, loc) => (ownColl() && deckBox(b) && deckBox(b) !== loc && isPileLoc(deckBox(b)) ? deckBox(b) : null);   // out of its pile (0.98.1)
function markBuilt(b, into = null, withTokens = true, add = false) {
  const was = { stand: deckStand(b), pulled: b.pulled }, when = new Date().toISOString();
  if (add && !ownColl() && canBring()) { REC = recNew(); REC_REV++; exDeckHome(b); setCollection(); }   // the deck made on the example is yours with its cards (decks.js)
  if (!ownColl()) { b.built = when; overhaulBuilt(b); touchBuild(); return; }
  const fresh = add && !COLL.entries.length;   // these are your collection's first cards: the message says so
  const loc = into || buildHome(b) || newDeckLoc(b), pile = builtPile(b, loc);
  // Into a box that holds another deck (one picked in the question below, or the deck an overhaul replaces): that deck
  // keeps its list (Matt, Nov 9: "I don't think we should delete the list"), with no box, and this one is the box's.
  const holder = buildForDeck(loc), prev = holder && holder !== b ? holder : null, prevWas = prev ? { source: prev.source, stand: deckStand(prev) } : null;
  if (prev) { deckLeave(prev); if (prev.source && prev.source.kind === "owned") prev.source = { kind: "kept", was: prev.source }; prev.updated = Date.now(); }
  const r = settleBuilt(b, loc, when, pile, add), moved = r.moves.reduce((n, m) => n + m.qty, 0), brought = r.n.added;
  b.built = when; b.pulled = {};
  overhaulBuilt(b);
  // Its tokens come along (0.64.0): the ones it makes that are recorded elsewhere, when the box is in the collection.
  const tm = withTokens && buildHome(b) === loc ? tokenMoves(b.cards, sideOf(b), loc, isDeckLoc) : [], tn = tm.reduce((n, m) => n + m.n, 0);
  const tokWas = tm.length ? tokenMovesApply(tm, loc) : null;
  if (tokWas) saveTokOwn();
  touchBuild();
  if (!r.did) decksShown();   // no card moved, so nothing drew the collection again: the deck's box is read now
  if (!moved && !brought && !prev && !tn) return;
  const cameIn = r.moves.filter(m => m.to === loc).reduce((n, m) => n + m.qty, 0), away = r.moves.filter(m => m.to === PUT_AWAY).reduce((n, m) => n + m.qty, 0);
  const said = [brought ? `Added ${cardsWord(brought)} to ${locName(loc)}` : "", cameIn ? `${brought ? "moved" : "Moved"} ${cardsWord(cameIn)} into ${brought ? "it" : locName(loc)}` : "", away ? `${cardsWord(away)} to put away` : ""].filter(Boolean).join(", ") || (moved ? `Moved ${cardsWord(moved)}` : `${b.name} is in ${locName(loc)}`);
  toast((moved || brought || prev ? said + (tn ? `, ${tokensWord(tn)} with them` : "") : `Moved ${tokensWord(tn)} into ${locName(loc)}`) + (fresh ? ". Your collection starts with this deck" : "") + (prev ? `. ${prev.name} keeps its list` : ""), "Undo", () => {
    if (tokWas) { tokenCountsSet(tokWas); saveTokOwn(); }
    deckStandSet(b, was.stand);
    if (prev) { prev.source = prevWas.source; deckStandSet(prev, prevWas.stand); prev.updated = Date.now(); }
    if (r.kept && r.kept.length) BUILDS = BUILDS.filter(x => !r.kept.includes(x.id) || (x.history && x.history.length));   // lists copied only for this: their boxes are whole again
    b.pulled = was.pulled || {}; b.updated = Date.now(); saveBuilds();
    if (!recUndo(r.did && r.did.change && r.did.change.id)) decksShown();   // the cards go back; with none moved, the decks' boxes are read again
  }, 8000);
}
// ------------------------------------------------------------ gathering: a tick in Assemble moves the card (0.98.0; step 5, piece d)
// (Matt, Nov 15, call 3: "a deck at Building holds the copies gathered so far"; his five answers of Nov 18 are in
// notes/decisions.md.) In your own collection a tick is a change on the record (engine gatherCard): the row's
// copies go into the deck's place, or, for a card to take out, onto the put-away list.
// **The first tick gives a deck its place**: a new one, named as "Mark as built" names a new box, with nothing
// asked (he pictures it as "the pile of cards on the desk as they're pulled", and it is the same place once the
// deck is built); a deck made to replace one you have (an overhaul: source.home) takes that deck's box, and the
// deck that had it keeps its list with no box, as "Mark as built" did at the end. The deck is Building there.
// **A ticked row stays where it stood, ticked, until Assemble is left** (GATHER.done, as the put-away list keeps
// what was filed: without it the row would jump to "Already in…" under the finger), and unticking it takes its
// change back. Afterwards the card is simply in the deck's place. A run of ticks is one row under Recent changes
// with one Undo (changes.js), and that Undo is why there is no "Clear checkmarks" here.
// **A card with no copy to move** (a basic land the collection doesn't record) keeps a tick that is only a tick
// (`pulled`: engine ticksTidy), and so does every card while the example or a link's collection is showing.
// GATHER = {id (the deck), done: [{name, gkey (its group), g (the group's own fields), it (the row as it stood),
// ids (its changes)}]}.
let GATHER = { id: null, done: [] };
const gatherKey = g => g.kind + "\n" + (g.loc || "");
// This visit's ticks on a deck that still stand (one undone from Recent changes is no longer a tick).
function gatherDone(b) {
  if (GATHER.id !== b.id) GATHER = { id: b.id, done: [] };
  if (!GATHER.done.length || !REC) return GATHER.done;
  const undone = undoneChanges(REC), known = new Set(REC.changes.map(c => c.id));
  GATHER.done = GATHER.done.filter(d => d.ids.every(id => known.has(id) && !undone.has(id)));
  return GATHER.done;
}
// Assemble's groups, with this visit's ticked rows back where they stood (`done` on the row).
function gatherGroups(b) {
  const groups = buildPullGroups(b);
  const done = ownColl() ? gatherDone(b) : []; if (!done.length) return groups;
  const names = new Set(done.map(d => norm(d.name)));
  for (const g of groups) if (g.kind === "here") g.items = g.items.filter(it => !names.has(norm(it.name)));
  for (const d of done) {
    let g = groups.find(x => gatherKey(x) === d.gkey);
    if (!g) { g = { ...d.g, items: [] }; groups.push(g); }
    if (!g.items.some(it => norm(it.name) === norm(d.name))) g.items.push({ ...d.it, done: true });
  }
  const list = groups.filter(g => g.kind !== "here" || g.items.length).sort(pullGroupOrder);
  for (const g of list) g.items.sort(pullItemOrder(g));
  return list;
}
// Where a row's copies come from: the box it names, then the others that hold the card (boxes before decks; a card
// that is free somewhere is never taken out of a deck by a tick).
function gatherFroms(it, place) {
  const a = AGG.get(norm(it.name)), first = it.st.loc; if (!a) return [first];
  const rest = [...a.locs.entries()].filter(([loc, x]) => loc !== first && loc !== place && (it.st.kind === "indeck" || !x.inDeck))
    .sort((x, y) => (x[1].inDeck - y[1].inDeck) || x[0].localeCompare(y[0], undefined, { numeric: true })).map(x => x[0]);
  return [first, ...rest];
}
function gatherTick(b, name, on) {
  const plain = () => { if (on) b.pulled[name] = true; else delete b.pulled[name]; touchBuild(); };
  if (!ownColl() || !REC) { plain(); return; }
  const stood = gatherDone(b).find(d => norm(d.name) === norm(name));
  if (stood) { if (on) renderBuild(); else gatherBack(stood); return; }
  if (!on) { if (b.pulled[name]) plain(); else renderBuild(); return; }
  let g = null, it = null;
  for (const x of buildPullGroups(b)) { const y = x.kind === "here" || x.kind === "missing" ? null : x.items.find(z => z.name === name); if (y) { g = x; it = y; break; } }
  if (!it) { renderBuild(); return; }
  if (g.kind === "basic") { plain(); return; }
  const out = g.kind === "out", box = deckBox(b), home = buildHome(b);   // home without a box of its own: the box of the deck this one replaces
  const place = box || home || newPileLoc(b), pile = !box && !home;   // with neither, a pile of its own (0.98.1)
  // A card taken out goes to the put-away list, or into a hot-swap's Swaps location when another version uses it (as "Mark as built" settles it).
  const toSwaps = out && !!b.hotswap && !sideKeys(b).has(norm(it.name)) && swapsCards(b).some(c => norm(c.name) === norm(it.name));
  const to = !out ? place : toSwaps ? swapsLocFor(place) : PUT_AWAY;
  const prev = !box && home ? buildForDeck(home) : null, takes = prev && prev !== b ? prev : null;
  const how = { by: "deck", act: out ? "takenout" : "gathered", label: b.name, deck: b.id, box: place, was: deckStand(b), ...(takes ? { took: { deck: takes.id, was: deckStand(takes) } } : {}) };
  const r = gatherCard(REC, { name: it.name, qty: it.qty }, out ? [place] : gatherFroms(it, place), to, how, pile ? { deck: true, kind: KIND_PILE } : { deck: !out && looksLikeDeck(place) });
  if (!r.n) { toast(`${it.name} isn't there any more`); renderBuild(); return; }
  // The deck's place, **before the collection is drawn again**: a deck pointing at it is what makes it the deck's.
  const first = !box, id = first ? locIdOf(place) || ((r.change.locs || []).find(l => l.name === place) || {}).id || null : null;
  if (first && takes) { deckLeave(takes); if (takes.source && takes.source.kind === "owned") takes.source = { kind: "kept", was: takes.source }; takes.updated = Date.now(); }
  if (first && id) deckStandSet(b, { status: "building", loc: id });
  b.updated = Date.now();
  const row = { name: it.name, gkey: gatherKey(g), g: { kind: g.kind, title: g.title, loc: g.loc, deck: g.deck, order: g.order }, it: { ...it }, ids: [] };
  GATHER.done.push(row);
  saveBuilds();
  const did = recDo(r.change);
  if (did.change) row.ids.push(did.change.id); else GATHER.done = GATHER.done.filter(x => x !== row);
  if (first && id) toast(takes ? `${b.name} has ${locName(place)} now. ${takes.name} keeps its list` : `This deck's cards are gathered in “${locName(place)}”, under Piles in your collection`);
}
// **"Clear checkmarks" on your own collection** (0.98.2; Matt, Nov 18, 15:42: "that clear all should stay"; it went
// for your own collection in 0.98.0): every tick of a deck being gathered taken back at once, the latest first, as
// unticking each would: each card back where it came from, and the deck as it stood before its first tick
// (changes.js deckFollows: an Idea, or the deck an overhaul took the box from has it again). It asks first, in its
// place (CLEARASK), and its Undo makes the ticks again. With the example showing a tick is a mark, cleared at once.
let CLEARASK = null;   // the deck whose "Clear checkmarks" is asking
const gatherTicks = b => { if (!REC) return []; const undone = undoneChanges(REC); return REC.changes.filter(c => isGather(c.how) && c.how.deck === b.id && !undone.has(c.id)); };
function clearGatherHTML(b, done, own) {
  const ticks = own && REC && deckStatus(b) === "building" ? gatherTicks(b) : [];
  if (own ? !ticks.length && !Object.keys(b.pulled || {}).length : !done) return "";
  if (CLEARASK !== b.id) return `<div class="actions"><button class="btn" id="build-reset-pulled">Clear checkmarks</button></div>`;
  const n = ticks.reduce((t, c) => t + c.lines.reduce((u, l) => u + l.qty, 0), 0);
  return `<div class="del-confirm" id="build-clear-ask"><p>Untick everything? ${n ? `${n === 1 ? "The card gathered goes" : `The ${n} cards gathered go`} back where ${n === 1 ? "it" : "they"} came from, and ` : ""}${esc(b.name)} is an idea again.</p>
    <div class="sheet-pair"><button class="btn" id="build-clear-no">Keep them</button><button class="btn danger" id="build-clear-yes">Clear checkmarks</button></div></div>`;
}
function clearGather(b) {
  const undo = [], ticks = gatherTicks(b), pulled = { ...(b.pulled || {}) }; let n = 0;
  for (const c of ticks.slice().reverse()) {
    const r = undoChange(REC, c.id); if (!r || !r.made.length) continue;
    n += r.made.reduce((t, l) => t + l.qty, 0); undo.push({ c, u: r.change.id }); deckFollows(c.how, true);
  }
  b.pulled = {}; GATHER = { id: null, done: [] }; deckTidy(b); b.updated = Date.now(); saveBuilds();
  if (undo.length) recChanged(); else renderBuild();
  toast(n ? `Sent ${cardsWord(n)} back where they came from` : "Cleared the checkmarks", "Undo", () => {
    for (const { c, u } of undo.slice().reverse()) { const r = undoChange(REC, u); if (r && r.made.length) deckFollows(c.how, false); }
    b.pulled = pulled; deckTidy(b); b.updated = Date.now(); saveBuilds();
    if (undo.length) recChanged(); else renderBuild();
  });
}
// **"Not currently in <box>"** asks under the deck's line (0.98.2; Matt, Nov 18: "a simple 'Yes' / 'Not now' prompt
// to put the deck back in the box", with "It's taken apart" added, agreed: notes/decisions.md): Yes is the move
// "Mark as built" makes (its cards from wherever the collection has them), It's taken apart makes it Deconstructed.
// It replaced the banner "<box> is empty now" (#built-away).
let DECKWARN = null;   // the deck whose question is open
function deckWarnAskHTML(b) {
  const box = ownColl() ? deckBox(b) : null;
  if (DECKWARN !== b.id || !box || deckStatus(b) !== "built" || locHasCards(box)) return "";
  return `<div class="del-confirm" id="deck-back-ask"><p>Put ${esc(b.name)} back in <strong>${esc(locName(box))}</strong>? Its cards move there in your collection, from wherever they are now.</p>
    <div class="sheet-pair"><button class="btn primary" id="deck-back-yes">Yes</button><button class="btn" id="build-apart">It's taken apart</button><button class="btn" id="deck-back-no">Not now</button></div></div>`;
}
// A tick taken back: its change undone, the copy where it came from. A deck whose place this leaves empty, and that
// had none before the tick, stands as it did (changes.js deckFollows, as an Undo from Recent changes).
function gatherBack(d) {
  let made = 0;
  for (const id of d.ids.slice().reverse()) {
    const c = REC.changes.find(x => x.id === id), r = undoChange(REC, id);
    if (r && r.made.length) { made += r.made.length; if (c) deckFollows(c.how, true); }
  }
  GATHER.done = GATHER.done.filter(x => x !== d);
  if (made) recChanged(); else { toast("That card has moved since, and stays where it is"); renderBuild(); }
}

// ---- "Which box did it go into?" (0.56.0; Matt, Nov 11: "Yes, I think that's a good idea"). A build that isn't one of
// your decks yet is asked where its cards went before it's marked built: a new box or binder (named so the import reads
// it as a deck, unless you name it otherwise), or one of your deck boxes, each saying how many of its cards come out.
// Only locations that are decks are offered: a bulk box would be emptied onto the put-away pile. Since 0.73.1 an empty
// box made here is offered too (nothing is in it to empty), and takes the deck as a new box of that name would.
// **Out of a pile** (0.98.1; Matt, Nov 18, 14:18: "Agreed with B, but I think we should keep an option for 'leave as
// pile'"): `mode` "pile" is "Mark as built" on a deck being gathered in its pile, with a new box first (one tap),
// then your empty boxes, then "Leave it as a pile"; "move" is "Put it in a box" (pileToBox, below), the same without
// marking it built or leaving it. Neither offers another deck's box: the pile's cards go where nothing else is.
let WHICHBOX = null;   // {id, pick: "" (a new box) | loc, name, mode: "" | "pile" | "move", step: "" | "add" (the question below), to, needs, direct}
const needsBox = b => ownColl() && !buildHome(b);
// ---- **A built deck you bring** (0.101.0; step 5, piece e2. Matt, Nov 15: a built deck someone brings adds its cards
// after asking; his four answers of Nov 18, 18:56, are in notes/decisions.md). "Mark as built" (and a Built deck's
// "No location saved in your collection") asks one thing more, after "Which box did it go into?", **whenever the
// deck needs cards that aren't free in your collection**: copies in a box that isn't a deck are free, and move as
// before; the rest are in other decks or nowhere. Two answers, each with its numbers. **"Add N cards"** gives the
// deck its own copy of each (his call 3, "Agreed, A": taking a card out of another deck stays a tick in Assemble),
// as one change with the moves, whose Undo also takes back "built". **"Don't add"** is what "Mark as built" did
// until now: the cards other decks hold come out of them, and the ones nobody has stay missing. No question when
// everything is free, nor on "Update box in collection" (a Built deck in its box whose list changed), nor while the
// example or a link's collection is showing a deck made from it, except through the two ways a deck is brought:
// "I have this deck built" on New deck and the "No location saved…" line, which with no collection of your own
// start one from the deck (markBuilt, `fresh`).
// → null when nothing is to ask, else {n (the cards "Add" adds), decks (of those, the ones "Don't add" takes out of
// other decks), none (the ones it leaves missing), fresh (no collection here yet, or one with no card in it: every
// card is new, and the words say the deck starts your collection)}.
const listQty = cards => cards.reduce((n, c) => n + c.qty, 0);
function bringNeeds(b, loc, pile = null) {
  if (!canBring()) return null;
  if (!ownColl()) { const n = builtLists(b, loc).reduce((t, l) => t + listQty(l.cards), 0); return n ? { n, decks: 0, none: n, fresh: true } : null; }
  const a = builtPlan(b, loc, pile, true); if (!a.n.added) return null;
  const plain = builtPlan(b, loc, pile, false);
  return { n: a.n.added, decks: plain.n.decks, none: plain.n.lacking, fresh: !COLL.entries.length };   // (a collection of your own with no card yet reads as none)
}
// The question, in the sheet "Which box did it go into?" as its second step, or by itself for a deck that has its
// place already (`direct`: a deck gathered in a box, an overhaul that takes its deck's box). The words are
// placeholders (Matt's to rewrite); the numbers are the two plans' own.
function bringAskHTML(b, w) {
  const x = w.needs, box = esc(locName(w.to)), n = cardsWord(x.n), side = sideQty(b);
  const why = x.fresh ? `You have no collection here yet. The ${n} of <strong>${esc(b.name)}</strong> can start it, in <strong>${box}</strong>.`
    : `<strong>${esc(b.name)}</strong> needs ${n} that ${!x.decks ? `${x.n === 1 ? "isn't" : "aren't"} in your collection` : !x.none ? `${x.n === 1 ? "is" : "are"} in your other decks` : `aren't free in your collection: ${x.none} you don't have, and ${x.decks} in your other decks`}.`;
  const addSub = x.fresh ? "Your collection starts with this deck" : `The deck gets its own copy of ${x.n === 1 ? "it" : "each"}, in ${box}${x.decks ? ". Nothing leaves your other decks" : ""}`;
  const notSub = x.fresh ? "Only the list is marked built" : [x.decks ? `${x.decks} ${x.decks === 1 ? "comes" : "come"} out of your other decks` : "", x.none ? `${x.none} ${x.none === 1 ? "stays" : "stay"} missing from the deck` : ""].filter(Boolean).join(", ");
  return `<h2 id="whichbox-title" tabindex="-1" autofocus>Add ${x.n === 1 ? "this card" : "these cards"} to your collection?</h2>
    <p class="small" id="wb-add-why">${why}</p>
    ${side ? `<p class="muted small" id="wb-add-side">Its sideboard of ${side} is counted: it is kept in the deck's box.</p>` : ""}
    <div class="menu-list" id="wb-add">
      <button class="menu-item" data-wb-add="1"><span class="mi-text"><strong>Add ${n}</strong><small>${addSub}</small></span></button>
      <button class="menu-item" data-wb-add="0"><span class="mi-text"><strong>Don't add</strong><small>${notSub}</small></span></button>
    </div>
    <div class="sheet-pair"><button class="btn" data-wb-back>${w.direct ? "Cancel" : "Back"}</button></div>`;
}
// The question by itself, for "Mark as built" on a deck that has its place: → whether it was asked.
function askBring(b, loc) {
  const needs = bringNeeds(b, loc, builtPile(b, loc)); if (!needs) return false;
  WHICHBOX = { id: b.id, pick: loc, name: loc, msg: "", tokens: true, mode: "", step: "add", to: loc, needs, direct: true };
  renderWhichBox(); openDlg($("#whichbox"));
  return true;
}
// What putting this build into a deck's box does to the box: how many of its cards stay (they're on the list) and come out.
function boxFit(b, loc) {
  const want = new Map(); for (const c of boxCards(b)) want.set(norm(c.name), (want.get(norm(c.name)) || 0) + c.qty);
  let stay = 0, out = 0;
  for (const e of COLL.entries) if (e.loc === loc) { const k = norm(e.name), w = Math.min(want.get(k) || 0, e.qty); stay += w; out += e.qty - w; want.set(k, (want.get(k) || 0) - w); }
  return { stay, out, total: stay + out };
}
function openWhichBox(b, mode = "") { WHICHBOX = { id: b.id, pick: "", name: newDeckLoc(b), msg: "", tokens: true, mode, step: "" }; renderWhichBox(); openDlg($("#whichbox")); }
function closeWhichBox() { closeDlg($("#whichbox")); WHICHBOX = null; const body = $("#whichbox-body"); if (body) body.innerHTML = ""; }
function renderWhichBox() {
  const body = $("#whichbox-body"), w = WHICHBOX, b = w && BUILDS.find(x => x.id === w.id); if (!body || !b) return;
  if (w.step === "add") { body.innerHTML = bringAskHTML(b, w); return; }
  const own = ownColl();   // with no collection of your own (a deck you bring: 0.101.0) there is only a new box to name
  const pick = (val, on, icon, title, sub) => `<button class="menu-item pick-row" data-wb-pick="${esc(val)}" aria-pressed="${on}">${icon}<span class="mi-text"><strong>${title}</strong><small>${sub}</small></span>${on ? `<span class="mi-check" aria-hidden="true">${MARK.selected}</span>` : ""}</button>`;
  const pile = w.mode ? deckBox(b) : null;
  const boxes = w.mode || !own ? [] : ownedDecks().map(d => { const f = boxFit(b, d.loc), n = deckName(d.loc), box = locName(d.loc);
    return pick(d.loc, w.pick === d.loc, locIconHTML(d.loc, true), esc(box), `${n !== box ? `Holds ${esc(n)} · ` : ""}${f.out ? `${f.out} of its ${cardsWord(f.total)} come out` : `all ${cardsWord(f.total)} stay`}`); });
  const empties = (own ? putAwayPlaces() : []).filter(p => !p.qty && !isPileLoc(p.loc)).map(p => pick(p.loc, w.pick === p.loc, locIconHTML(p.loc, false), esc(locName(p.loc)), "Empty"));
  const leave = w.mode === "pile" && pile ? `<div class="menu-list" id="wb-leave">${pick(pile, w.pick === pile, locIconHTML(pile, true), "Leave it as a pile", `Built, with its cards in “${esc(locName(pile))}”`)}</div>` : "";
  body.innerHTML = `<h2 id="whichbox-title" tabindex="-1" autofocus>Which box did it go into?</h2>
    <p class="muted small">${pile ? `The cards in <strong>${esc(locName(pile))}</strong> move there now${w.mode === "pile" ? ", with any not gathered yet" : ""}.` : own && COLL.entries.length ? `Bulk Tutor moves the cards of <strong>${esc(b.name)}</strong> there now.` : `The box or binder <strong>${esc(b.name)}</strong> is in.`}</p>
    <div class="menu-list">${pick("", w.pick === "", neutralIconHTML("deckbox"), "A new box or binder", "One that isn't in your collection yet")}</div>
    ${w.pick === "" ? `<div class="field"><label for="wb-name">Its name</label><input type="text" id="wb-name" value="${esc(w.name)}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>
      ${own && /ManaBox/.test(COLL.source || "") ? `<p class="muted small" id="wb-manabox">Give the binder the same name in ManaBox, and your next import finds the deck there.</p>` : ""}` : ""}
    ${empties.length ? `<div class="menu-group" id="wb-empties"><h4 class="subhead">An empty box of yours</h4><div class="menu-list">${empties.join("")}</div></div>` : ""}
    ${boxes.length ? `<div class="menu-group"><h4 class="subhead">One of your deck boxes</h4><div class="menu-list">${boxes.join("")}</div>
      <p class="muted small">The deck that's in the box keeps its list, and the cards that come out wait in “${esc(PUT_AWAY)}”.</p></div>` : ""}
    ${leave}${w.mode === "move" || !own ? "" : whichBoxTokensHTML(b, w)}
    <p class="small warn-text" id="wb-msg"${w.msg ? "" : " hidden"}>${esc(w.msg)}</p>
    <div class="sheet-pair"><button class="btn" data-wb-cancel>Cancel</button><button class="btn primary" data-wb-go>${w.mode === "move" ? "Put it there" : "Mark as built"}</button></div>`;
}
// Its tokens go with it (0.64.0; Matt, Nov 11: "they should have the option to copy the tokens too… on by default"):
// offered only when tracking is on and the deck makes tokens recorded somewhere else. A new box holds none yet.
function whichBoxTokensHTML(b, w) {
  const tm = tokenMoves(b.cards, sideOf(b), w.pick || "\u0000", isDeckLoc), n = tm.reduce((s, m) => s + m.n, 0);
  if (!n) return "";
  return `<label class="check wb-tokens"><input type="checkbox" id="wb-tokens"${w.tokens ? " checked" : ""}><span>Move its tokens there too<small class="muted">${n === 1 ? "1 token this deck makes is" : n + " tokens this deck makes are"} recorded somewhere else</small></span></label>`;
}
// A new box's name can't be one already in the collection (pick that box, or mark it as a deck first), nor one the app uses.
function newBoxProblem(name) {
  if (!name) return "Give the box a name.";
  if (name === PUT_AWAY || swapsBase(name) != null) return "That name is one Bulk Tutor uses itself.";
  if (!ownColl()) return "";   // no collection of your own yet: no box has the name
  const hit = COLL.entries.find(e => e.loc === name || locName(e.loc) === name);
  return !hit ? "" : hit.inDeck ? `${name} is one of your deck boxes: pick it from the list.` : `${name} is already in your collection. To put a deck in it, mark it as a deck first (Collection, Choose your decks).`;
}
document.addEventListener("input", e => { if (e.target.id === "wb-name" && WHICHBOX) WHICHBOX.name = e.target.value; });
document.addEventListener("change", e => { if (e.target.id === "wb-tokens" && WHICHBOX) WHICHBOX.tokens = e.target.checked; });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "wb-name") { e.preventDefault(); const go = $("#whichbox [data-wb-go]"); if (go) go.click(); } });
document.addEventListener("close", e => { if (e.target.id === "whichbox" && WHICHBOX) closeWhichBox(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "whichbox") { closeWhichBox(); return; }
  const t = e.target.closest && e.target.closest("[data-wb-pick], [data-wb-cancel], [data-wb-go], [data-wb-add], [data-wb-back]"); if (!t || !WHICHBOX) return;
  const w = WHICHBOX, b = BUILDS.find(x => x.id === w.id);
  // The question's two answers (0.101.0: a built deck you bring), and the way back to the box's name.
  if (t.dataset.wbBack != null) { if (w.direct || !b) { closeWhichBox(); return; } w.step = ""; renderWhichBox(); const go = $("#whichbox [data-wb-go]"); if (go) go.focus(); return; }
  if (t.dataset.wbAdd != null) {
    closeWhichBox(); if (!b) return;
    if (CUR !== b.id) { CUR = b.id; }
    markBuilt(b, w.to, w.tokens, t.dataset.wbAdd === "1");
    const bn = $("#view-build .banner.info"); if (bn) bn.scrollIntoView({ block: "center" });
    return;
  }
  if (t.dataset.wbPick != null) { w.pick = t.dataset.wbPick; w.msg = ""; renderWhichBox(); const again = [...document.querySelectorAll("[data-wb-pick]")].find(x => x.dataset.wbPick === w.pick); if (again) again.focus(); return; }
  if (t.dataset.wbCancel != null || !b) { closeWhichBox(); return; }
  const name = w.pick === "" ? w.name.trim() : w.pick, problem = w.pick === "" ? newBoxProblem(name) : "";
  if (problem) { w.msg = problem; renderWhichBox(); const f = $("#wb-name"); if (f) f.focus(); return; }
  if (w.mode !== "move") {
    // The deck needs cards that aren't free there: the question, as the sheet's second step, before anything moves.
    const needs = bringNeeds(b, name, builtPile(b, name));
    if (needs) { w.step = "add"; w.to = name; w.needs = needs; renderWhichBox(); const h = $("#whichbox-title"); if (h) h.focus(); return; }
  }
  closeWhichBox();
  if (w.mode === "move") { pileToBox(b, name); return; }
  if (CUR !== b.id) { CUR = b.id; }
  markBuilt(b, name, w.tokens);
  const bn = $("#view-build .banner.info"); if (bn) bn.scrollIntoView({ block: "center" });
});
// **Put it in a box** (0.98.1; Matt, Nov 18: "pile should always be able to be placed in boxes manually"): every card
// in a deck's pile goes into a new box or an empty one, and the deck with it, at the status it has (Building keeps
// gathering there). A box with other cards in it isn't offered, since a deck's cards are what its place holds (a pile
// inside a box is an idea: notes/later.md). One change, `how.act` "boxed", with its Undo here and under Recent changes.
function pileToBox(b, into) {
  const pile = ownColl() && REC ? deckBox(b) : null; if (!pile || !isPileLoc(pile) || !into || into === pile) return;
  const was = deckStand(b), cards = new Map();
  for (const e of COLL.entries) if (e.loc === pile) { const k = norm(e.name), x = cards.get(k); if (x) x.qty += e.qty; else cards.set(k, { name: e.name, qty: e.qty }); }
  if (!cards.size) return;
  const how = { by: "deck", act: "boxed", label: b.name, deck: b.id, box: into, was };
  const r = settleDecks(REC, [{ loc: into, cards: [...cards.values()], deck: true }, { loc: pile, cards: [] }], how, deckLocs());
  const id = locIdOf(into) || ((r.change.locs || []).find(l => l.name === into) || {}).id || null; if (!id || !r.moves.length) return;
  deckStandSet(b, { ...was, loc: id }); b.updated = Date.now(); saveBuilds();   // before the collection is drawn again: the deck's place is what makes it the deck's
  const did = recDo(r.change), n = r.moves.reduce((t, m) => t + (m.to === into ? m.qty : 0), 0);
  toast(`Moved ${cardsWord(n)} of ${b.name} into ${locName(into)}`, "Undo", () => {
    deckStandSet(b, was); b.updated = Date.now(); saveBuilds();
    if (!recUndo(did && did.change && did.change.id)) decksShown();
  });
}
const moveLine = m => `<div class="line"><span class="name">${m.qty > 1 ? `<span class="num">${m.qty}×</span> ` : ""}${esc(m.name)}</span></div>`;
// Whether the collection says which printing its copies are (an import from ManaBox does): what "Copy for ManaBox" needs.
const hasPrintsOwned = () => !!COLL && !COLL.example && COLL.entries.some(e => e.set && e.cn);
// A built build's banner (0.95.0: no "Save as deck", since every list is kept, and no "Remove this build" on a deck
// in its box, since the deck is the list). Until 0.89.0 it also said how many of its cards ManaBox didn't know of, and a panel under
// it ("Not in ManaBox yet", with the steps "Record it in ManaBox") listed them: both went on Matt's word of Nov 13
// ("ManaBox becomes just one of many methods of getting a list to import"). The import still says what differs, and
// Actions still has "Copy for ManaBox". "Remove this build" is offered as before: once the app's last file agrees.
function builtBannerHTML(b) {
  // Its box emptied (0.95.0: the deck stays where it is until you say otherwise): its line says "Not currently in
  // <box>" and asks from there (0.98.2: deckWarnAskHTML), in place of the banner that said so here.
  const box = deckBox(b), away = !!b.loc && ownColl() && deckStatus(b) === "built" && !(box && locHasCards(box));
  if (!b.built || away) return "";
  const when = " " + new Date(b.built).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // The banner's button takes the mark "built" off (`b.built`), and is named for what that does (0.101.0; Matt,
  // Nov 18, 22:10: "Back to the Workbench" read as a link somewhere, and the Workbench is no tab's name): on a deck
  // in its box that only puts this note away, the deck stays Built there; on one with no box the deck is an Idea again.
  const back = `<button class="btn" id="build-unbuild">${box ? "Got it" : "Mark as not built"}</button>`;
  if (box) {
    const ch = deckChanges(b);
    const short = ch.add ? ` ${cardsWord(ch.add)} in the list ${ch.add === 1 ? "isn't" : "aren't"} in your collection, so ${ch.add === 1 ? "it isn't" : "they aren't"} counted there.` : "";
    return `<div class="banner info"><span><strong>Built${when}.</strong> Its cards are in <strong>${esc(locName(box))}</strong> here.${short}</span>
      <span class="actions">${back}</span></div>`;
  }
  // A Built deck with no box in your own collection: its line says "No location saved in your collection" and asks
  // which box from there (0.98.2), in place of this banner's ManaBox steps. They stay for the example and a link's.
  if (ownColl()) return "";
  // With no collection of your own (0.101.0) the same line offers to add its cards, which start your collection
  // (and a deck box of the example that happens to share its name is not this deck's).
  if (canBring()) return `<div class="banner info"><span><strong>Built${when}.</strong> Its cards aren't in a collection of yours yet.</span><span class="actions">${back}</span></div>`;
  const home = buildHome(b), match = builtMatch(b);
  const how = home ? `make the same changes to ${esc(home)} in ManaBox` : `make a deck binder for it in ManaBox (for example “${esc(deckPrefix())} – ${esc(b.name)}”) and move these cards into it`;
  return `<div class="banner info"><span><strong>Built${when}.</strong> ${match ? `Your collection now shows it as <strong>${esc(locName(match))}</strong>, so this list has done its job.` : `To keep card locations right, ${how}, then import your collection again.`}</span>
    <span class="actions">${match ? `<button class="btn primary" id="build-retire">Remove this list</button>` : ""}${back}</span></div>`;
}

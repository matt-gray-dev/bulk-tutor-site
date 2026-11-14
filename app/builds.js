"use strict";
// Bulk Tutor, the page's script, part "builds": builds and saved decks (state, saving, editing a list), lists by location and exports, taste, templates, the deck check, the bracket panel, share links, built builds.
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
  const list = [...groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, undefined, { numeric: true }));
  // A box with an order of its own is gone through in that order (0.76.0), the way you flip through it.
  for (const g of list) g.items.sort(g.kind === "missing"
    ? (a, b) => b.price - a.price || a.name.localeCompare(b.name)
    : ((g.kind === "free" || g.kind === "indeck") && locSorter(g.loc)) || ((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name)));
  return list;
}

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
// A deck's own build: the one built into its location (the newest, when an overhaul replaced the deck), else the one
// started from it. It holds the deck's list and its name (0.54.0); a deck that has none yet is its box's cards.
const buildForDeck = loc => BUILDS.find(x => x.builtLoc === loc && x.built) || BUILDS.find(x => x.builtLoc === loc)
  || BUILDS.find(x => !x.builtLoc && x.source && x.source.kind === "owned" && x.source.loc === loc) || null;
// Open the build for one of your decks, reusing it if the deck has one.
function openOwnedDeck(loc) {
  const existing = buildForDeck(loc);
  if (existing) { CUR = existing.id; buildMode = "list"; buildQuery = ""; buildRole = null; saveBuilds(); }
  else buildFromOwnedDeck(loc);
  showView("build"); window.scrollTo({ top: 0 });
  toast(existing ? `Opened your build of ${existing.name}` : `Opened ${curBuild().name} as a build`);
}
// Cards added to and taken out of a deck by its build.
function deckChanges(b) {
  const home = buildHome(b); if (!home || !COLL) return { add: 0, out: 0 };
  const inDeck = new Set(COLL.entries.filter(e => e.loc === home).map(e => norm(e.name)));
  const inBuild = new Set(boxCards(b).map(c => norm(c.name)));   // the box holds the sideboard too
  return { add: [...inBuild].filter(k => !inDeck.has(k)).length, out: [...inDeck].filter(k => !inBuild.has(k)).length };
}

function buildFromOwnedDeck(loc, open = true) { return createBuild({ ...deckListOf(loc), name: deckDefaultName(loc), source: { kind: "owned", loc } }, open); }
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
const bracketJumpText = est => `Bracket ${est.shown} · ${est.set ? "your call" : "estimate"} ${MARK.jump}`;
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
  const j = $("#bracket-jump"); if (j) j.innerHTML = bracketJumpText(bracketEstimate(b));
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
      : `<p class="muted small">None outside this build.</p>`}
  </div>`;
}

// ------------------------------------------------------------ build share links
async function packBuild(b) {
  const text = JSON.stringify({ n: b.name, c: b.cards.map(c => [c.name, c.qty]), k: b.commanders, ...(b.companion ? { m: b.companion } : {}), ...(sideOf(b).length ? { s: sideOf(b).map(c => [c.name, c.qty]) } : {}), ...(listNote(b) ? { o: listNote(b) } : {}) });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(await new Response(stream).arrayBuffer());
}
async function unpackBuild(s) {
  const stream = new Blob([unb64url(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const o = JSON.parse(await new Response(stream).text());
  const list = l => (Array.isArray(l) ? l : []).map(([name, qty]) => ({ name: String(name), qty: +qty || 1 }));
  return { name: String(o.n || "Shared build"), cards: list(o.c), commanders: (o.k || []).map(String), companion: o.m ? String(o.m) : null, side: list(o.s), note: typeof o.o === "string" ? cleanNote(o.o) : "" };
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
function loadBuilds() {
  loadBuildPrefs();
  try { BUILDS = JSON.parse(store.get("bt.builds") || "[]"); } catch { BUILDS = []; }
  if (!Array.isArray(BUILDS)) BUILDS = [];
  stampBuilds(false);
  CUR = store.get("bt.build");
  buildMode = ["pull", "tune"].includes(store.get("bt.buildmode")) ? store.get("bt.buildmode") : "list";
  if (!BUILDS.some(b => b.id === CUR)) CUR = BUILDS.length ? BUILDS[0].id : null;
}
let buildSaveWarned = false;
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
    if (bump) sideClean(b);                     // a card that joined the deck leaves the sideboard
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
  const ok = store.set("bt.builds", JSON.stringify(BUILDS));
  if (CUR) store.set("bt.build", CUR); else store.del("bt.build");
  if (!ok && !buildSaveWarned) { buildSaveWarned = true; toast("This browser won't save builds, so they'll be gone after a reload"); }
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
function createBuild({ name, cards = [], commanders = [], companion = null, source = null, side = null, note = "" }, open = true) {
  const b = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: uniqueBuildName(name || "New build"),
    cards, commanders, ...(companion ? { companion } : {}), ...(side && side.length ? { side } : {}), ...(cleanNote(note) ? { note: cleanNote(note) } : {}), source, pulled: {}, updated: Date.now() };
  sideClean(b);
  if (open) { BUILDS.unshift(b); CUR = b.id; buildMode = "list"; buildQuery = ""; } else { BUILDS.push(b); if (!CUR) CUR = b.id; }
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
const deckNote = loc => listNote(buildForDeck(loc));
// What is in a sheet's Notes field (#deck-note in a deck's Actions, #build-note in a build's) from the first key until
// it is saved: when the field is left, and when the sheet closes. `of` says whose it is, so it is saved to the list
// it was typed for whatever is on the screen by then.
let NOTE_TYPING = null;   // { field, of: { build } | { saved } | { loc }, text }
const noteField = (id, x, hint) => `<div class="field"><label for="${id}">Notes</label><textarea id="${id}" class="note-field" rows="3" maxlength="${NOTE_MAX}" placeholder="${hint}">${esc(NOTE_TYPING && NOTE_TYPING.field === id ? NOTE_TYPING.text : listNote(x))}</textarea></div>`;
function keepTypedNote(field) {
  const t = NOTE_TYPING; if (!t || (field && t.field !== field)) return;
  NOTE_TYPING = null;
  const { build, saved, loc } = t.of;
  if (saved) { if (!setListNote(savedById(saved), t.text)) return; saveSaved(); }
  else {
    // A deck with no build of its own gets one for its first note, and none for an empty field.
    const b = build ? BUILDS.find(x => x.id === build) : loc && isDeckLoc(loc) && (buildForDeck(loc) || cleanNote(t.text)) ? deckBuild(loc) : null;
    if (!setListNote(b, t.text)) return;
    saveBuilds();
  }
  noteRedraw();
}
// ------------------------------------------------------------ saved decks
// Decklists kept in this browser, built or not: favorites, decks you've taken apart, lists to build
// someday. They never claim cards, so they don't change what shows as free or in a deck.
let SAVED = [];
function loadSaved() {
  try { SAVED = JSON.parse(store.get("bt.decks") || "[]"); } catch { SAVED = []; }
  if (!Array.isArray(SAVED)) SAVED = [];
}
let savedWarned = false;
function saveSaved(fromSync) {
  if (!store.set("bt.decks", JSON.stringify(SAVED)) && !savedWarned) { savedWarned = true; toast("This browser won't save decks, so they'll be gone after a reload"); }
  trackDeletions("d", SAVED);
  if (!fromSync) syncSoon();
  picsSoon(5000);
}
const savedById = id => (id && SAVED.find(d => d.id === id)) || null;
const savedFor = b => (b && savedById(b.savedId || (b.source && b.source.kind === "saved" ? b.source.id : null))) || null;
const buildForSaved = id => BUILDS.find(x => x.savedId === id || (x.source && x.source.kind === "saved" && x.source.id === id)) || null;
const copyCards = cards => cards.map(c => ({ name: c.name, qty: c.qty }));
function uniqueSavedName(name) { let n = name, i = 2; while (SAVED.some(d => d.name === n)) n = `${name} (${i++})`; return n; }
function saveDeck({ name, cards, commanders = [], companion = null, from = "", side = null, note = "" }) {
  const d = { id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: uniqueSavedName(name || "Saved deck"),
    cards: copyCards(cards), commanders: [...commanders], ...(companion ? { companion } : {}), ...(side && side.length ? { side: copyCards(side) } : {}), ...(cleanNote(note) ? { note: cleanNote(note) } : {}), from, saved: Date.now() };
  SAVED.unshift(d); saveSaved();
  return d;
}
function savedStats(d) {
  let total = 0, owned = 0, cost = 0;
  for (const c of d.cards) {
    total += c.qty;
    if (cardStatus(c.name, c.qty, null).kind !== "missing") owned += c.qty;
    else cost += ((cardOf(c.name) || [])[3] || 0) * c.qty;
  }
  return { total, owned, cost, pct: total ? Math.floor(owned / total * 100) : 0 };
}
function openSavedDeck(id) {
  const d = savedById(id); if (!d) return;
  const existing = buildForSaved(id);
  if (existing) { CUR = existing.id; buildMode = "list"; buildQuery = ""; buildRole = null; saveBuilds(); }
  else createBuild({ name: d.name, cards: copyCards(d.cards), commanders: [...d.commanders], companion: d.companion || null, side: copyCards(sideOf(d)), note: listNote(d), source: { kind: "saved", id } });
  showView("build"); window.scrollTo({ top: 0 });
  toast(existing ? `Opened your build of ${d.name}` : `Opened ${d.name} as a build`);
}
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
  toast("Started a build from this list");
}

// Reading a decklist (parseDecklist) is the engine's since 0.87.1: it needs no page, and so is checked under Node.

function addToBuild(name, toSide = false) {
  const b = curBuild(); if (!b) return;
  name = canonical(name);
  if (toSide) { addToSide(b, name); return; }
  const ex = b.cards.find(c => norm(c.name) === norm(name));
  if (ex && !isBasic(name)) { toast(`${name} is already in this build`); return; }
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
  if (b.cards.some(c => norm(c.name) === norm(name))) { toast(`${name} is already in this build`); return; }
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
// SIDE_PICK (you asked) and ADD_SIDE (the search adds to the sideboard) hold a build's id, for this visit only.
let SIDE_PICK = null, ADD_SIDE = null;
const addSide = b => !!b && ADD_SIDE === b.id;
const deckOver = b => deckCards(b).reduce((n, c) => n + c.qty, 0) > 100;
const sideShown = b => !!b && (SIDE_PICK === b.id || sideOf(b).length > 0 || deckOver(b));
const listSnap = b => ({ cards: copyCards(b.cards), side: b.side ? copyCards(b.side) : null, keep: b.keep ? [...b.keep] : null });
function listRestore(b, s) { b.cards = s.cards; if (s.side) b.side = s.side; else delete b.side; if (s.keep) b.keep = s.keep; else delete b.keep; }
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
// → false when the text holds no cards or tokens.
const LEFT_OUT_MS = 9000;   // how long a message that names what a decklist left out stays up (0.87.1): it is read once
let ADD_LIST = null, ADD_LIST_TEXT = "";   // the build whose "Add a list" box is open, and what is written in it
// What is written under "Or paste a decklist" on the start screen, kept through redraws (0.70.1): the Workbench is
// redrawn when prices arrive (0.68.0) or a sync lands, and until then that emptied the field under the person's hands.
let PASTE_TEXT = "";
function addList(text) {
  const b = curBuild(), p = parseDecklist(text); if (!b || (!p.cards.length && !p.side.length && !p.tokens.length)) return false;
  const copies = list => list.flatMap(c => Array(anyNumber(c.name) ? Math.min(c.qty, 99) : 1).fill(c.name));
  const was = listSnap(b), cmds = [...b.commanders], deck = addCore(b, copies(p.cards), false), side = addCore(b, copies(p.side), true);
  const added = new Set([...deck, ...side].map(norm)), left = [...p.cards, ...p.side].filter(c => !added.has(norm(c.name))).length;
  const unknown = DATA ? [...new Set([...deck, ...side])].filter(n => !cardOf(n) && !isBasic(n)).length : 0;
  if (!b.commanders.length) b.commanders = p.commanders.filter(n => b.cards.some(c => norm(c.name) === norm(n)));
  const n = deck.length + side.length, redo = () => { TUNE_CACHE.clear(); b.updated = Date.now(); saveBuilds(); rerenderCurrent(); };
  if (n) redo();
  const notes = [left ? `${left} already in it` : "", unknown ? `${unknown === 1 ? "1 name isn't a card" : unknown + " names aren't cards"} in today's data` : ""].filter(Boolean).join("; ");
  const lead = [n ? `Added ${cardsWord(n)} to ${b.name}${side.length ? ` (${side.length} to the sideboard)` : ""}${notes ? `; ${notes}` : ""}` : p.cards.length + p.side.length ? "No cards added: they are all in the build already" : "", leftOutWords(p.out)].filter(Boolean).join(". ");
  tokensFromList(p.tokens, lead, "build", n ? () => { listRestore(b, was); b.commanders = cmds; redo(); } : null, p.out.length ? LEFT_OUT_MS : 0);
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
  return { deck, side, toside: plain, todeck: side, keep: own.filter(c => !isKept(b, c.name)), unkeep: own.filter(c => isKept(b, c.name)), dismiss: own,
    rm: deck, siderm: side, taste: [...deck.filter(c => !isBasic(c.name) && !isCmd(b, c.name)), ...side.filter(c => !isBasic(c.name))] };
}
// Run one action over the selection: act = toside | todeck | keep | unkeep | dismiss | rm | siderm | taste (arg: the level).
function selDo(act, arg) {
  const b = curBuild(); if (!selOn(b)) return;
  const a = selActions(b), list = a[act] || [], n = list.length; if (!n) return;
  const was = { ...listSnap(b), commanders: [...b.commanders], companion: b.companion || null, why: b.why ? { ...b.why } : null, notHere: b.notHere ? [...b.notHere] : null };
  const prefs = list.map(c => [c.name, prefOf(c.name) ? { ...prefOf(c.name) } : null]), names = new Set(list.map(c => norm(c.name)));
  const at = (l, name) => l.findIndex(c => norm(c.name) === norm(name));
  let said = "", prefsChanged = false, swapped = 0;
  if (act === "toside") { for (const c of list) toSideCore(b, at(b.cards, c.name)); said = `Moved ${cardsWord(n)} to the sideboard`; }
  else if (act === "todeck") { for (const c of list) toDeckCore(b, at(b.side, c.name)); said = `Moved ${cardsWord(n)} to the deck`; }
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
  const inBuild = new Set(b.cards.map(c => norm(c.name))), side = sideKeys(b);
  const seen = new Set(), out = [];
  const consider = name => {
    const k = norm(name);
    if (seen.has(k) || !k.includes(q)) return;
    seen.add(k);
    out.push({ name: canonical(name), k, owned: AGG.get(k), starts: k.startsWith(q), inBuild: inBuild.has(k) && !BASICS.has(k), inSide: side.has(k) && !BASICS.has(k) });
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
  // "Add to the sideboard" (0.57.0) turns the same search into the sideboard's: a card can be in one of the two lists.
  // Offered when rows have their sideboard button (sideShown), so a build that has no sideboard keeps the plain search.
  const b = curBuild(), toSide = addSide(b) && sideShown(b);
  const pick = sideShown(b) ? `<label class="check small" id="bq-side-row"><input type="checkbox" id="bq-side"${toSide ? " checked" : ""}> Add to the sideboard, not the deck</label>` : "";
  box.innerHTML = pick + (hits.length ? hits.map(h => {
    const st = cardStatus(h.name, 1, buildHome(b));
    const where = h.inSide ? "in the sideboard" : st.kind === "here" ? "in this deck" : st.kind === "free" ? esc(stName(st)) : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>` : st.kind === "basic" ? "basic land" : `not owned${DATA && cardOf(h.name) && cardOf(h.name)[3] ? " · " + money(cardOf(h.name)[3]) : ""}`;
    const done = toSide ? (h.inBuild ? "In the deck" : h.inSide ? "In sideboard" : "") : h.inBuild ? "In build" : "";
    return done
      ? `<div class="bres done"><span><strong>${esc(h.name)}</strong> <small>${where}</small></span><span class="muted small">${done}</span></div>`
      : `<button class="bres" data-addname="${esc(h.name)}"${toSide ? " data-addside" : ""}><span><strong>${esc(h.name)}</strong> <small>${where}</small></span><span class="add">${toSide ? "To sideboard" : h.inSide ? "Move to deck" : "Add"}</span></button>`;
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
    if (out.size) groups.unshift({ kind: "out", title: `Take out of ${locName(home)}`, loc: home, order: -1, items: [...out.values()].sort(locSorter(home) || ((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name))) });
  }
  return groups;
}

function buildNewPanel() {
  const decks = ownedDecks();
  return `${genPanelHTML()}<div class="panel">
    <h3>${DATA && hasFlags() ? "Or start from a list" : "Start a build"}</h3>
    ${decks.length ? `<p class="small"><strong>From one of your decks</strong> <span class="muted">to tune it: swaps, combos, and a list of what to add and take out.</span></p>
      <div class="results">${decks.map(d => { const n = deckName(d.loc); return `<button class="bres" data-owned="${esc(d.loc)}"><span><strong>${esc(n)}</strong> <small>${n !== locName(d.loc) ? `in ${esc(locName(d.loc))} · ` : ""}${d.count} cards</small></span><span class="add">Open</span></button>`; }).join("")}</div>` : ""}
    ${SAVED.length ? `<p class="small"><strong>From a saved deck</strong> <span class="muted">kept in your decks, built or not.</span></p>
      <div class="results">${SAVED.map(d => { const st = savedStats(d); return `<button class="bres" data-saved="${esc(d.id)}"><span><strong>${esc(d.name)}</strong> <small>${st.pct}% owned${buildForSaved(d.id) ? " · build in progress" : ""}</small></span><span class="add">Open</span></button>`; }).join("")}</div>` : ""}
    ${DATA && DATA.decks.length ? `<p class="small"><strong>From a popular deck</strong> <span class="muted">on EDHREC, ranked by how much of it you own.</span></p>` : ""}
    <div class="actions">${DATA && DATA.decks.length ? `<button class="btn" data-go="decks">Find decks</button>` : ""}<button class="btn" id="build-empty">Start an empty build</button></div>
    <div class="field">
      <label for="build-paste">Or paste a decklist (Moxfield, Archidekt, or one card per line)</label>
      <textarea id="build-paste" placeholder="Commander&#10;1 Queen Marchesa&#10;&#10;Deck&#10;1 Sol Ring&#10;1 Swords to Plowshares">${esc(PASTE_TEXT)}</textarea>
    </div>
    <p id="build-paste-msg" class="small warn-text" hidden></p>
    <div class="actions"><button class="btn primary" id="build-paste-go">Start from this list</button>${BUILDS.length ? `<button class="btn" id="build-cancel">Cancel</button>` : ""}</div>
  </div>`;
}

// ------------------------------------------------------------ built builds
// A build is a draft. "Mark as built" means the deck is together, so its cards are moved here too (0.53.0, engine:
// settleDecks): into the deck's location, a new one named after the build when it isn't one of your decks yet, and
// what the deck no longer uses into "To put away", as one change on the record (settleDecks says it, recDo makes
// it), listed under Recent changes with its Undo (changes.js). An example or linked collection only gets the label.
const ownColl = () => !!(COLL && !COLL.example && !COLL.fromLink);
const locHasCards = loc => !!(COLL && COLL.entries.some(e => e.loc === loc));
function builtMatch(b) {
  if (b.builtLoc) return locHasCards(b.builtLoc) ? b.builtLoc : null;
  if (buildHome(b)) { const ch = deckChanges(b); return ch.add === 0 && ch.out === 0 ? buildHome(b) : null; }
  const target = norm(b.name);
  const hit = ownedDecks().find(d => norm(d.loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, "")) === target || norm(d.loc) === target);
  return hit ? hit.loc : null;
}
// A name for a new deck's location: the one the import would read as a deck (the prefix), and not one in use.
function newDeckLoc(b) {
  const p = deckPrefix(), base = p && !looksLikeDeck(b.name) ? `${p} – ${b.name}` : b.name;
  const taken = new Set(COLL.entries.map(e => e.loc)); let loc = base, i = 2;
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
// ({change, moves, lacking}), with `kept` and `did` (doChange's answer) when cards moved.
function settleBuilt(b, loc) {
  const how = { by: "deck", act: "built", label: b.name, deck: b.id, box: loc, was: { built: b.built || null, builtLoc: b.builtLoc || null } };   // which deck, and how it stood: Recent changes' Undo puts that back (changes.js deckFollows)
  const r = settleDecks(REC, builtLists(b, loc), how, deckLocs());
  if (!r.moves.length) return r;
  // A deck this one takes cards from keeps its own list: copied now, while its box still holds every card of it, so
  // that deck can say what it is missing instead of quietly becoming a 99-card deck. r.kept = the builds made for that.
  r.kept = [...new Set(r.moves.map(m => m.from))].filter(from => from !== loc && swapsBase(from) == null && isDeckLoc(from) && !buildForDeck(from)).map(from => deckBuild(from).id);
  // A new location whose name the import wouldn't read as a deck gets your mark, as if you had switched it on.
  if (!looksLikeDeck(loc) && !locHasCards(loc) && r.moves.some(m => m.to === loc)) { LOCSTYLE.decks[loc] = { ...markEntry(loc), deck: true, at: Date.now() }; saveLocStyle(); }
  r.did = recDo(r.change);
  return r;
}
// `into` = the box the person said the deck went into (the question below); without it, the build's home, or a new
// location named after the build.
function markBuilt(b, into = null, withTokens = true) {
  const was = { built: b.built, builtLoc: b.builtLoc, pulled: b.pulled }, when = new Date().toISOString();
  if (!ownColl()) { b.built = when; overhaulBuilt(b); touchBuild(); return; }
  const marks = JSON.stringify(LOCSTYLE.decks), loc = into || buildHome(b) || newDeckLoc(b), had = new Set(BUILDS.map(x => x.id));
  // Into a box that holds another deck: that deck keeps its list (Matt, Nov 9: "I don't think we should delete the
  // list") as a build of its own with no box, copied now if it had none, and this build becomes the box's deck.
  const prev = into && isDeckLoc(into) && buildForDeck(into) !== b ? deckBuild(into) : null, prevWas = prev ? { source: prev.source, built: prev.built, builtLoc: prev.builtLoc } : null;
  if (prev) {
    delete prev.built; delete prev.builtLoc; if (prev.source && prev.source.kind === "owned") prev.source = { kind: "kept", was: prev.source }; prev.updated = Date.now();
    const { cmd, ...mark } = markEntry(into); if (cmd) { LOCSTYLE.decks[into] = { ...mark, at: Date.now() }; saveLocStyle(); }   // who led the box was about the deck that leaves it
  }
  const r = settleBuilt(b, loc), moved = r.moves.reduce((n, m) => n + m.qty, 0);
  b.built = when; b.pulled = {};
  if (locHasCards(loc)) b.builtLoc = loc;
  overhaulBuilt(b);
  // Its tokens come along (0.64.0): the ones it makes that are recorded elsewhere, when the box is in the collection.
  const tm = withTokens && buildHome(b) === loc ? tokenMoves(b.cards, sideOf(b), loc, isDeckLoc) : [], tn = tm.reduce((n, m) => n + m.n, 0);
  const tokWas = tm.length ? tokenMovesApply(tm, loc) : null;
  if (tokWas) saveTokOwn();
  touchBuild();
  if (!moved && !prev && !tn) return;
  const cameIn = r.moves.filter(m => m.to === loc).reduce((n, m) => n + m.qty, 0), away = r.moves.filter(m => m.to === PUT_AWAY).reduce((n, m) => n + m.qty, 0);
  const said = [cameIn ? `Moved ${cardsWord(cameIn)} into ${locName(loc)}` : "", away ? `${cardsWord(away)} to put away` : ""].filter(Boolean).join(", ") || (moved ? `Moved ${cardsWord(moved)}` : `${b.name} is in ${locName(loc)}`);
  toast((moved || prev ? said + (tn ? `, ${tokensWord(tn)} with them` : "") : `Moved ${tokensWord(tn)} into ${locName(loc)}`) + (prev ? `. ${prev.name} is kept as a build` : ""), "Undo", () => {
    if (tokWas) { tokenCountsSet(tokWas); saveTokOwn(); }
    LOCSTYLE.decks = JSON.parse(marks); saveLocStyle();
    for (const k of ["built", "builtLoc"]) if (was[k]) b[k] = was[k]; else delete b[k];
    if (prev) { prev.source = prevWas.source; for (const k of ["built", "builtLoc"]) if (prevWas[k]) prev[k] = prevWas[k]; else delete prev[k]; prev.updated = Date.now(); }
    const made = [...(r.kept || []), ...(prev && !had.has(prev.id) ? [prev.id] : [])];   // lists copied only for this: their boxes are whole again
    if (made.length) BUILDS = BUILDS.filter(x => !made.includes(x.id) || (x.history && x.history.length));
    b.pulled = was.pulled || {}; b.updated = Date.now(); saveBuilds();
    if (!recUndo(r.did && r.did.change && r.did.change.id)) setCollection();   // the cards go back; with none moved, the marks and the builds are redrawn
  }, 8000);
}
// ---- "Which box did it go into?" (0.56.0; Matt, Nov 11: "Yes, I think that's a good idea"). A build that isn't one of
// your decks yet is asked where its cards went before it's marked built: a new box or binder (named so the import reads
// it as a deck, unless you name it otherwise), or one of your deck boxes, each saying how many of its cards come out.
// Only locations that are decks are offered: a bulk box would be emptied onto the put-away pile. Since 0.73.1 an empty
// box made here is offered too (nothing is in it to empty), and takes the deck as a new box of that name would.
let WHICHBOX = null;   // {id, pick: "" (a new box) | loc, name}
const needsBox = b => ownColl() && !buildHome(b);
// What putting this build into a deck's box does to the box: how many of its cards stay (they're on the list) and come out.
function boxFit(b, loc) {
  const want = new Map(); for (const c of boxCards(b)) want.set(norm(c.name), (want.get(norm(c.name)) || 0) + c.qty);
  let stay = 0, out = 0;
  for (const e of COLL.entries) if (e.loc === loc) { const k = norm(e.name), w = Math.min(want.get(k) || 0, e.qty); stay += w; out += e.qty - w; want.set(k, (want.get(k) || 0) - w); }
  return { stay, out, total: stay + out };
}
function openWhichBox(b) { WHICHBOX = { id: b.id, pick: "", name: newDeckLoc(b), msg: "", tokens: true }; renderWhichBox(); openDlg($("#whichbox")); }
function closeWhichBox() { closeDlg($("#whichbox")); WHICHBOX = null; const body = $("#whichbox-body"); if (body) body.innerHTML = ""; }
function renderWhichBox() {
  const body = $("#whichbox-body"), w = WHICHBOX, b = w && BUILDS.find(x => x.id === w.id); if (!body || !b) return;
  const pick = (val, on, icon, title, sub) => `<button class="menu-item pick-row" data-wb-pick="${esc(val)}" aria-pressed="${on}">${icon}<span class="mi-text"><strong>${title}</strong><small>${sub}</small></span>${on ? `<span class="mi-check" aria-hidden="true">${MARK.selected}</span>` : ""}</button>`;
  const boxes = ownedDecks().map(d => { const f = boxFit(b, d.loc), n = deckName(d.loc), box = locName(d.loc);
    return pick(d.loc, w.pick === d.loc, locIconHTML(d.loc, true), esc(box), `${n !== box ? `Holds ${esc(n)} · ` : ""}${f.out ? `${f.out} of its ${cardsWord(f.total)} come out` : `all ${cardsWord(f.total)} stay`}`); });
  const empties = putAwayPlaces().filter(p => !p.qty).map(p => pick(p.loc, w.pick === p.loc, locIconHTML(p.loc, false), esc(locName(p.loc)), "Empty"));
  body.innerHTML = `<h2 id="whichbox-title" tabindex="-1" autofocus>Which box did it go into?</h2>
    <p class="muted small">Bulk Tutor moves the cards of <strong>${esc(b.name)}</strong> there now.</p>
    <div class="menu-list">${pick("", w.pick === "", neutralIconHTML("deckbox"), "A new box or binder", "One that isn't in your collection yet")}</div>
    ${w.pick === "" ? `<div class="field"><label for="wb-name">Its name</label><input type="text" id="wb-name" value="${esc(w.name)}" maxlength="80" enterkeyhint="done" autocomplete="off"></div>
      <p class="muted small">Give the binder the same name in ManaBox, and your next import finds the deck there.</p>` : ""}
    ${empties.length ? `<div class="menu-group" id="wb-empties"><h4 class="subhead">An empty box of yours</h4><div class="menu-list">${empties.join("")}</div></div>` : ""}
    ${boxes.length ? `<div class="menu-group"><h4 class="subhead">One of your deck boxes</h4><div class="menu-list">${boxes.join("")}</div>
      <p class="muted small">The deck that's in the box keeps its list as a build, and the cards that come out wait in “${esc(PUT_AWAY)}”.</p></div>` : ""}
    ${whichBoxTokensHTML(b, w)}
    <p class="small warn-text" id="wb-msg"${w.msg ? "" : " hidden"}>${esc(w.msg)}</p>
    <div class="sheet-pair"><button class="btn" data-wb-cancel>Cancel</button><button class="btn primary" data-wb-go>Mark as built</button></div>`;
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
  const hit = COLL.entries.find(e => e.loc === name || locName(e.loc) === name);
  return !hit ? "" : hit.inDeck ? `${name} is one of your deck boxes: pick it from the list.` : `${name} is already in your collection. To put a deck in it, mark it as a deck first (Collection, Choose your decks).`;
}
document.addEventListener("input", e => { if (e.target.id === "wb-name" && WHICHBOX) WHICHBOX.name = e.target.value; });
document.addEventListener("change", e => { if (e.target.id === "wb-tokens" && WHICHBOX) WHICHBOX.tokens = e.target.checked; });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "wb-name") { e.preventDefault(); const go = $("#whichbox [data-wb-go]"); if (go) go.click(); } });
document.addEventListener("close", e => { if (e.target.id === "whichbox" && WHICHBOX) closeWhichBox(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "whichbox") { closeWhichBox(); return; }
  const t = e.target.closest && e.target.closest("[data-wb-pick], [data-wb-cancel], [data-wb-go]"); if (!t || !WHICHBOX) return;
  const w = WHICHBOX, b = BUILDS.find(x => x.id === w.id);
  if (t.dataset.wbPick != null) { w.pick = t.dataset.wbPick; w.msg = ""; renderWhichBox(); const again = [...document.querySelectorAll("[data-wb-pick]")].find(x => x.dataset.wbPick === w.pick); if (again) again.focus(); return; }
  if (t.dataset.wbCancel != null || !b) { closeWhichBox(); return; }
  const name = w.pick === "" ? w.name.trim() : w.pick, problem = w.pick === "" ? newBoxProblem(name) : "";
  if (problem) { w.msg = problem; renderWhichBox(); const f = $("#wb-name"); if (f) f.focus(); return; }
  closeWhichBox();
  if (CUR !== b.id) { CUR = b.id; }
  markBuilt(b, name, w.tokens);
  const bn = $("#view-build .banner.info"); if (bn) bn.scrollIntoView({ block: "center" });
});
// After a newer collection arrives (an import here, or another device's by sync): a build whose deck location is gone
// is a draft again. Not on every setCollection: a sync can bring the builds a moment before the collection they go with.
function checkBuiltLocs() {
  if (!ownColl()) return;
  let changed = false;
  for (const b of BUILDS) if (b.builtLoc && !locHasCards(b.builtLoc)) { delete b.builtLoc; delete b.built; b.updated = Date.now(); changed = true; }
  if (changed) saveBuilds();
}
const moveLine = m => `<div class="line"><span class="name">${m.qty > 1 ? `<span class="num">${m.qty}×</span> ` : ""}${esc(m.name)}</span></div>`;
// Whether the collection says which printing its copies are (an import from ManaBox does): what "Copy for ManaBox" needs.
const hasPrintsOwned = () => !!COLL && !COLL.example && COLL.entries.some(e => e.set && e.cn);
// A built build's banner. Until 0.89.0 it also said how many of its cards ManaBox didn't know of, and a panel under
// it ("Not in ManaBox yet", with the steps "Record it in ManaBox") listed them: both went on Matt's word of Nov 13
// ("ManaBox becomes just one of many methods of getting a list to import"). The import still says what differs, and
// Actions still has "Copy for ManaBox". "Remove this build" is offered as before: once the app's last file agrees.
function builtBannerHTML(b) {
  if (!b.built) return "";
  const when = new Date(b.built).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sd = savedFor(b), save = sd ? "" : `<button class="btn" id="build-save-new">Save as deck</button>`, back = `<button class="btn" id="build-unbuild">Back to the Workbench</button>`;
  if (b.builtLoc && locHasCards(b.builtLoc)) {
    const loc = b.builtLoc, pend = pendQty(movesPending(loc)), ch = deckChanges(b);
    const short = ch.add ? ` ${cardsWord(ch.add)} in the list ${ch.add === 1 ? "isn't" : "aren't"} in your collection, so ${ch.add === 1 ? "it isn't" : "they aren't"} counted there.` : "";
    return `<div class="banner info"><span><strong>Built ${when}.</strong> Its cards are in <strong>${esc(locName(loc))}</strong> here.${short}</span>
      <span class="actions">${save}${pend ? "" : `<button class="btn" id="build-retire">Remove this build</button>`}${back}</span></div>`;
  }
  const home = buildHome(b), match = builtMatch(b);
  const how = home ? `make the same changes to ${esc(home)} in ManaBox` : `make a deck binder for it in ManaBox (for example “${esc(deckPrefix())} – ${esc(b.name)}”) and move these cards into it`;
  const keep = sd ? ` The list is saved as <strong>${esc(sd.name)}</strong> in your decks.` : match ? " To keep this list even after the deck is taken apart, save it as a deck first." : "";
  return `<div class="banner info"><span><strong>Built ${when}.</strong> ${match ? `Your collection now shows it as <strong>${esc(locName(match))}</strong>, so this build has done its job.` : `To keep card locations right, ${how}, then import your collection again.`}${keep}</span>
    <span class="actions">${sd ? "" : `<button class="btn${match ? "" : " primary"}" id="build-save-new">Save as deck</button>`}${match ? `<button class="btn primary" id="build-retire">Remove this build</button>` : ""}${back}</span></div>`;
}

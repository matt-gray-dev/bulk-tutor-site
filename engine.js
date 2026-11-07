"use strict";
// Bulk Tutor's engine: the card data model and the deck logic (matching your collection, roles,
// substitutes, your taste, the generator, tuning, deck numbers, templates, the deck check). No DOM,
// no storage, no network. index.html loads it first, as a plain script, and shares its top-level
// state (DATA, LOOKUP, COLL, AGG, PREFS, TEMPLATES, COMBOS, BUILDS); the page fills that state and
// draws the screens. tests/test_engine.py runs it under Node against demo data and, once the fetcher
// has written it, a sample of real Scryfall data (tests/fixtures/real-sample.json).

// The card table: DATA plus a name index. Call setData when new card data arrives.
let COMBOS = null;        // Commander Spellbook combos (combos.json), loaded on demand by the page
let BUILDS = [];          // the person's builds (the page loads and saves them)
function setData(d) {
  DATA = d;
  KEY = d ? d.cards.map(c => norm(c[0])) : [];
  LOOKUP = new Map(KEY.map((k, i) => [k, i]));
}

const COLORS = ["W", "U", "B", "R", "G"];
const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", M: "Multicolor", C: "Colorless" };
const BASICS = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes", "snow-covered plains", "snow-covered island", "snow-covered swamp", "snow-covered mountain", "snow-covered forest", "snow-covered wastes"]);

const norm = s => String(s).split(" // ")[0].normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").trim().toLowerCase();
// ------------------------------------------------------------ state
// Bumped whenever something a remembered result depends on changes (collection, card preferences,
// templates), so cached plans and ideas never outlive it.
let CHANGE = 0;
let DATA = null;          // { version, demo, cards: [[name, colors, type, price]], decks: [...] }
let KEY = [];             // DATA.cards index -> normalized name
let LOOKUP = new Map();   // normalized name -> DATA.cards index
let COLL = null;          // { entries: [{name, qty, loc, inDeck}], source, importedAt, example }
let AGG = new Map();      // normalized name -> { name, qty, free, locs: Map(loc -> {qty, inDeck}) }
const cardOf = name => { const i = LOOKUP.get(norm(name)); return i == null ? null : DATA.cards[i]; };
function aggregate() {
  AGG = new Map();
  if (!COLL) return;
  for (const e of COLL.entries) {
    const k = norm(e.name);
    let a = AGG.get(k);
    if (!a) { a = { name: e.name.split(" // ")[0], qty: 0, free: 0, locs: new Map() }; AGG.set(k, a); }
    a.qty += e.qty;
    if (!a.sid && e.sid) a.sid = e.sid;
    if (!e.inDeck) a.free += e.qty;
    const l = a.locs.get(e.loc) || { qty: 0, inDeck: e.inDeck };
    l.qty += e.qty;
    a.locs.set(e.loc, l);
  }
}

const isBasic = name => BASICS.has(norm(name));
// Where to pull a card from: a free copy if there is one, otherwise the deck it's in.
// For a build made from one of your decks (home), cards already in that deck need no pulling.
function cardStatus(name, qty = 1, home = null) {
  const a = AGG.get(norm(name));
  if (!a) return { kind: isBasic(name) ? "basic" : "missing", also: [] };
  if (home && a.locs.has(home)) return { kind: "here", loc: home, also: [] };
  const locs = [...a.locs.entries()].sort((x, y) => (x[1].inDeck - y[1].inDeck) || x[0].localeCompare(y[0], undefined, { numeric: true }));
  const free = locs.filter(l => !l[1].inDeck);
  if (free.length) return { kind: "free", loc: free[0][0], also: locs.slice(1).map(l => l[0] + (l[1].inDeck ? " (deck)" : "")), short: Math.max(0, qty - a.free) };
  return { kind: "indeck", loc: locs[0][0], also: locs.slice(1).map(l => l[0]), short: Math.max(0, qty - a.qty) };
}

// ------------------------------------------------------------ owned substitutes
// Each card in the card table carries role bits (ramp, removal, ...) from Scryfall Tagger.
// A substitute is a card you own that shares a role, fits the colors, and isn't already in the list.
const ROLE_COUNTED = ["Ramp", "Card draw", "Removal", "Board wipe", "Counterspell", "Tutor", "Recursion", "Protection", "Sac outlet", "Tokens", "Lifegain"];
const ROLE_CORE = new Set(["Ramp", "Card draw", "Removal", "Board wipe"]);
// How much a shared role counts toward a swap. Mana rock/dork refine Ramp; tokens and lifegain are often side effects.
const ROLE_WEIGHT = { "Ramp": 10, "Card draw": 10, "Removal": 10, "Board wipe": 10, "Counterspell": 10, "Tutor": 10,
  "Recursion": 8, "Protection": 8, "Sac outlet": 6, "Tokens": 4, "Lifegain": 3, "Mana rock": 3, "Mana dork": 3 };
const hasRoles = () => !!(DATA && Array.isArray(DATA.roles));
const roleBits = name => { const c = DATA && cardOf(name); return c && c.length > 5 ? c[5] || 0 : 0; };
const popcount = n => { let c = 0; while (n) { n &= n - 1; c++; } return c; };
const roleList = bits => (hasRoles() ? DATA.roles.filter((_, i) => (bits >> i) & 1) : []);

function substitutes(name, { identity = null, exclude = new Set(), limit = 3 } = {}) {
  const target = DATA && cardOf(name), mask = roleBits(name);
  if (!target || !mask) return [];
  const weightOf = bits => Math.max(0, ...DATA.roles.map((r, bit) => ((bits >> bit) & 1 ? ROLE_WEIGHT[r] ?? 5 : 0)));
  const mainJob = Math.min(weightOf(mask), 8);   // a swap must share the card's main job, not just a side effect
  const out = [];
  for (const [k, a] of AGG) {
    if (exclude.has(k) || k === norm(name) || BASICS.has(k) || isBlocked(a.name)) continue;
    const c = cardOf(a.name);
    if (!c || c.length < 6) continue;
    const shared = c[5] & mask;
    if (!shared || weightOf(shared) < mainJob) continue;
    if (identity && [...c[1]].some(ch => ch !== "C" && !identity.has(ch))) continue;
    let score = 0;                                                        // shared jobs, weighted by how central they are
    for (let bit = 0; bit < DATA.roles.length; bit++) {
      const w = ROLE_WEIGHT[DATA.roles[bit]] ?? 5;
      if ((shared >> bit) & 1) score += w;
      else if (((c[5] & ~mask) >> bit) & 1 && w >= 5) score -= 1;          // a little less for unrelated main jobs
    }
    if (c[2] === target[2]) score += 4;                                   // same card type
    score -= Math.min(Math.abs((c[4] || 0) - (target[4] || 0)), 4);       // similar mana value
    if (a.free > 0) score += 6;                                           // free beats pulling from a deck
    if (c[6]) score += Math.max(0, 4 - Math.log10(c[6]));                 // widely played
    out.push({ name: c[0], score, shared, st: cardStatus(c[0]) });
  }
  return out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).slice(0, limit);
}
// ------------------------------------------------------------ preferences: your taste in cards
// Two kinds of signal, kept apart:
// - Taste (`level`), set only by you in the card sheet: Never (−2) · Less (−1) · Neutral (0) · More (1) ·
//   Always (2). Never keeps a card out of the generator, tuning and substitutes; Less and More move its
//   score; Always puts it in every generated deck it fits (when a copy is free to use).
// - Dismissals (`dismissed`), counted by "Not for this build": each lowers the score a little, so one
//   dismissal is a nudge and a card you keep dismissing sinks. The app never turns these into a taste.
// Kept in bt.prefs and synced with builds; each card's entry carries `at`, and the newer entry wins when
// devices merge. `blocked` (0.16.0) is still written as level === −2 so older versions read it.
const TASTE = [[-2, "Never"], [-1, "Less"], [0, "Neutral"], [1, "More"], [2, "Always"]];
let PREFS = { cards: {} };
const prefOf = name => PREFS.cards[norm(name)] || null;
const tasteOf = name => { const p = prefOf(name); return p ? (p.level != null ? p.level : p.blocked ? -2 : 0) : 0; };
const isBlocked = name => tasteOf(name) === -2;
const dismissCount = name => { const p = prefOf(name); return (p && p.dismissed) || 0; };
const tasteName = level => (TASTE.find(t => t[0] === level) || TASTE[2])[1];
// Cards with a taste set or dismissals counted, strongest feelings first.
const markedCards = () => Object.values(PREFS.cards).filter(p => (p.level || 0) !== 0 || p.blocked || p.dismissed > 0)
  .sort((a, b) => Math.abs(b.level || 0) - Math.abs(a.level || 0) || (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
const hiddenCards = markedCards;
// ------------------------------------------------------------ generator: a build from cards you own
// Pick a commander; its rules text suggests themes (fetcher THEME_SPECS → DATA.wants), which the person
// can switch on and off. Every deck gets the usual jobs (GEN_SLOTS) filled first, themed cards first;
// the rest goes to cards that fit the themes or tribe, complete combos, or are simply strong; then
// nonbasic lands that make the right colours and basics in proportion. Scores also lean on popularity
// (Scryfall's EDHREC rank), the mana curve, and the person's own habits (cards they play, cards they
// dismiss). No deck data from any site is needed; an EDHREC average or other source could later add
// one more scoring signal.
const hasThemes = () => !!(DATA && Array.isArray(DATA.themes) && Array.isArray(DATA.cardThemes));
const GEN_SLOTS = [["Ramp", 10], ["Card draw", 10], ["Removal", 8], ["Board wipe", 3], ["Protection", 2]];
const BASIC_FOR = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
const themeNames = bits => (hasThemes() ? DATA.themes.filter((_, i) => (bits >> i) & 1) : []);
function commanderWants(names) {
  let themes = 0; const tribes = [];
  for (const n of names) {
    const i = LOOKUP.get(norm(n)), w = DATA && DATA.wants && i != null ? DATA.wants[String(i)] : null;
    if (!w) continue;
    themes |= w[0] || 0;
    for (const t of w[1] || []) if (!tribes.includes(t)) tribes.push(t);
  }
  return { themes, tribes };
}
// Cards the person chose to play: in their decks or in their builds. A small nudge toward their taste.
function playedCounts() {
  const n = new Map(), bump = k => n.set(k, (n.get(k) || 0) + 1);
  for (const e of COLL && !COLL.example ? COLL.entries : []) if (e.inDeck) bump(norm(e.name));
  for (const b of BUILDS) for (const c of b.cards) bump(norm(c.name));
  return n;
}
function identityOf(names) {
  const s = new Set();
  for (const n of names) { const c = cardOf(n); if (c) for (const ch of c[1]) if (ch !== "C") s.add(ch); }
  return s;
}
const fitsIdentity = (c, ident) => [...c[1]].every(ch => ch === "C" || ident.has(ch));
const legalCard = c => !hasFlags() || ((c[7] & FLAG_LEGAL) && !(c[7] & FLAG_BANNED));
function genScore(i, c, opts, played) {
  const hits = (hasThemes() ? DATA.cardThemes[i] || 0 : 0) & opts.themes;
  const subs = c.length > 8 ? c[8] : [], kws = c.length > 9 ? c[9] : [];
  let tribe = null;
  if (opts.tribes.length) {
    const s = subs.find(x => opts.tribes.includes(x));
    if (s != null) tribe = DATA.subtypes[s];
    else if (DATA.keywords && kws.some(k => DATA.keywords[k] === "Changeling")) tribe = "Changeling";
  }
  let score = c[6] ? Math.max(0, 5 - Math.log10(c[6])) : 0;          // widely played
  score += popcount(hits) * 3 + (tribe ? 4 : 0);                        // fits what the commander wants
  const mv = c[4] || 0;
  if (mv >= 7) score -= 2; else if (mv === 6) score -= 1;              // keep the curve playable
  score -= Math.min(dismissCount(c[0]) * 1.5, 6);                       // dismissed before
  const lv = tasteOf(c[0]); if (lv === 1) score += 3; else if (lv === -1) score -= 3;   // your taste
  if (played.get(norm(c[0]))) score += 0.75;                            // you play it elsewhere
  return { score, hits, tribe };
}
const genLabel = it => [it.tribe, ...themeNames(it.hits)].filter(Boolean).slice(0, 2).join(", ");
// The cards you own that could go in: nonlands and nonbasic lands, scored.
function genPool(opts, exclude = new Set()) {
  const cmds = opts.commanders.map(canonical), cmdKeys = new Set(cmds.map(norm));
  const ident = identityOf(cmds), played = playedCounts(), pool = [], lands = [];
  for (const [k, a] of AGG) {
    if (BASICS.has(k) || cmdKeys.has(k) || exclude.has(k) || isBlocked(a.name)) continue;
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || !legalCard(c) || !fitsIdentity(c, ident)) continue;
    const free = a.free > 0;
    if (!free && !(opts.useDecks && a.qty > 0)) continue;
    const g = genScore(i, c, opts, played);
    const it = { i, c, name: c[0], free, roles: c[5] || 0, hits: g.hits, tribe: g.tribe, score: g.score + (free ? 1 : 0) };
    (c[2] === "L" ? lands : pool).push(it);
  }
  return { cmds, ident, pool, lands };
}
// The jobs to fill first: GEN_SLOTS, with a build's tuned targets (b.targets.roles) taking over, and any
// other role a tune asked for (say, Counterspell 3) added at the end.
function slotsFor(targets, base = GEN_SLOTS) {
  const roles = (targets && targets.roles) || {};
  const slots = base.map(([r, n]) => [r, roles[r] != null ? roles[r] : n]);
  for (const [r, n] of Object.entries(roles)) if (!slots.some(s => s[0] === r)) slots.push([r, n]);
  return slots;
}
// opts: commanders, themes, tribes, useDecks, lands, and optionally keep (names that stay: cards you
// pinned or added by hand), exclude (names never to use: dropped from this build), targets (from tuning).
function generateBuild(opts) {
  const targets = opts.targets || {}, exclude = new Set((opts.exclude || []).map(norm));
  const keepKeys = new Set((opts.keep || []).map(norm).filter(k => !BASICS.has(k)));
  const { cmds, ident, pool, lands } = genPool(opts, new Set([...exclude, ...keepKeys]));
  const tpl = opts.template || null;                       // a template's shape (deckShape), if one was chosen
  const landsTarget = Math.max(28, Math.min(42, targets.lands || opts.lands || (tpl && tpl.lands) || 36));
  const nonlandSlots = 100 - cmds.length - landsTarget, sf = tpl ? nonlandSlots / Math.max(1, tpl.nonland) : 1;
  const bigCap = targets.big != null ? targets.big : tpl ? Math.max(1, Math.round((tpl.curve[6] + tpl.curve[7]) * sf)) : 8;
  // With a template, each mana value gets about as many cards as the template had (scaled).
  const curveWant = tpl ? tpl.curve.map(n => Math.round(n * sf)) : null, curveHave = new Array(8).fill(0);
  const curvePen = it => (curveWant && curveHave[Math.min(it.c[4] || 0, 7)] >= curveWant[Math.min(it.c[4] || 0, 7)] ? 3 : 0);
  const played = playedCounts();
  // Cards you kept go in first, whether or not they'd be picked, and count toward every job they do.
  const kept = [];
  for (const k of keepKeys) {
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || cmds.some(n => norm(n) === k)) continue;
    const g = genScore(i, c, opts, played);
    kept.push({ i, c, name: c[0], free: true, roles: c[5] || 0, hits: g.hits, tribe: g.tribe, score: g.score });
  }
  // Always-include cards that fit, if a copy is free to use (or in another deck, when that's allowed).
  const always = [], alwaysMissing = [];
  for (const p of Object.values(PREFS.cards)) {
    if ((p.level || 0) !== 2) continue;
    const k = norm(p.name); if (keepKeys.has(k) || exclude.has(k) || cmds.some(n => norm(n) === k)) continue;
    const i = LOOKUP.get(k), c = i == null ? null : DATA.cards[i];
    if (!c || !legalCard(c) || !fitsIdentity(c, ident)) continue;
    const it = pool.find(x => x.i === i) || lands.find(x => x.i === i);
    if (it) always.push(it);
    else { const a = AGG.get(k); alwaysMissing.push({ name: c[0], where: a && a.qty > 0 ? [...a.locs.keys()].find(l => a.locs.get(l).inDeck) || "" : "" }); }
  }
  // Combos you could assemble from cards you own plus the commander(s).
  const cmdIdx = new Set(cmds.map(n => LOOKUP.get(norm(n))).filter(x => x != null));
  const comboOf = new Map();
  if (COMBOS && COMBOS.combos) {
    const have = new Set([...pool.map(p => p.i), ...cmdIdx]);
    for (const cb of COMBOS.combos) {
      const cs = cb[1];
      if (cs.length > 4 || !cs.every(x => have.has(x))) continue;
      for (const x of cs) { if (!comboOf.has(x)) comboOf.set(x, []); comboOf.get(x).push(cs); }
    }
  }
  const picked = new Map(), why = {};
  let big = 0;
  const okBig = it => (it.c[4] || 0) < 6 || big < bigCap;
  const take = (it, reason) => { picked.set(it.i, it); why[it.name] = reason; if ((it.c[4] || 0) >= 6) big++; if (it.c[2] !== "L") curveHave[Math.min(it.c[4] || 0, 7)]++; };
  for (const it of kept) if (it.c[2] !== "L") take(it, (opts.whyKept && opts.whyKept[it.name]) || "You kept it");
  for (const it of always) if (it.c[2] !== "L" && picked.size < nonlandSlots) { const r = primaryRole(it.name); take(it, "Always include" + (r ? ` · ${r}` : "")); }
  const comboBonus = it => {
    let best = 0;
    for (const combo of comboOf.get(it.i) || []) {
      const others = combo.filter(x => x !== it.i), got = others.filter(x => picked.has(x) || cmdIdx.has(x)).length;
      best = Math.max(best, got === others.length ? 6 : got ? 2 : 0);
    }
    return best;
  };
  // 1. The jobs every deck needs, themed cards first.
  for (const [role, quota] of slotsFor(targets, tpl ? templateSlots(tpl, ident, sf) : GEN_SLOTS)) {
    const bit = hasRoles() ? DATA.roles.indexOf(role) : -1; if (bit < 0) continue;
    let have = [...picked.values()].filter(p => (p.roles >> bit) & 1).length;
    const cands = pool.filter(p => !picked.has(p.i) && (p.roles >> bit) & 1)
      .sort((x, y) => (y.score + popcount(y.hits)) - (x.score + popcount(x.hits)) || x.name.localeCompare(y.name));
    for (const it of cands) {
      if (have >= quota || picked.size >= nonlandSlots) break;
      if (!okBig(it)) continue;
      const l = genLabel(it); take(it, role + (l ? ` · ${l}` : "")); have++;
    }
  }
  // 1b. With a template: its total interaction, then as many cards on plan (themes or tribe) as it had.
  const fillTo = (want, test, reason) => {
    let have = [...picked.values()].filter(test).length;
    while (have < want && picked.size < nonlandSlots) {
      let best = null, bs = -Infinity;
      for (const it of pool) { if (picked.has(it.i) || !okBig(it) || !test(it)) continue; const v = it.score + comboBonus(it) - curvePen(it); if (v > bs) { best = it; bs = v; } }
      if (!best) break;
      take(best, reason(best)); have++;
    }
  };
  if (tpl) {
    fillTo(Math.round(tpl.interaction * sf), isInteraction, it => `Interaction · ${primaryRole(it.name) || "removal"}`);
    if (opts.themes || (opts.tribes || []).length) fillTo(Math.round(tpl.onPlan * sf), it => it.hits || it.tribe, it => `Fits ${genLabel(it)}`);
  }
  // 2. The rest: what fits the themes and tribe, combos, then the strongest cards left.
  while (picked.size < nonlandSlots) {
    let best = null, bestScore = -Infinity;
    for (const it of pool) {
      if (picked.has(it.i) || !okBig(it)) continue;
      const s = it.score + comboBonus(it) - curvePen(it);
      if (s > bestScore || (s === bestScore && best && it.name < best.name)) { best = it; bestScore = s; }
    }
    if (!best) break;
    const cb = comboBonus(best), l = genLabel(best);
    take(best, cb >= 6 ? "Completes a combo" : l ? `Fits ${l}` : "Strong card");
  }
  const nonlands = picked.size;
  // 3. Lands: nonbasics you own that make the right colours, then basics by how much each colour is used.
  const makes = it => { const lc = DATA.landColors ? DATA.landColors[String(it.i)] : undefined; return lc == null ? null : lc; };
  const landScore = it => { const lc = makes(it); return (lc == null ? ident.size : [...lc].filter(ch => ident.has(ch)).length) * 2 + it.score - (lc === "" ? 1 : 0); };
  const maxNonbasic = Math.round(landsTarget * (ident.size <= 1 ? 0.3 : 0.6));
  const firstLands = [...kept.filter(it => it.c[2] === "L"), ...always.filter(it => it.c[2] === "L")];
  const firstSet = new Set(firstLands.map(it => it.i));
  const landPicks = [...firstLands, ...lands.filter(it => { if (firstSet.has(it.i)) return false; const lc = makes(it); return lc == null || lc === "" || [...lc].some(ch => ident.has(ch) || ch === "C"); })
    .sort((x, y) => landScore(y) - landScore(x) || x.name.localeCompare(y.name))].slice(0, Math.max(maxNonbasic, firstLands.length));
  for (const it of landPicks) {
    const lc = makes(it), colors = lc ? [...lc].filter(ch => ident.has(ch)) : [];
    take(it, keepKeys.has(norm(it.name)) ? (opts.whyKept && opts.whyKept[it.name]) || "You kept it"
      : (tasteOf(it.name) === 2 ? "Always include · " : "") + (colors.length ? `Land · makes ${colors.join("/")}` : "Land"));
  }
  const basicsN = landsTarget - landPicks.length, basics = [];
  if (basicsN > 0) {
    if (!ident.size) basics.push({ name: "Wastes", qty: basicsN });
    else {
      const w = {}; for (const ch of ident) w[ch] = 1;            // every colour gets at least a little
      for (const it of picked.values()) if (it.c[2] !== "L") for (const ch of it.c[1]) if (ch in w) w[ch]++;
      const total = Object.values(w).reduce((a, b) => a + b, 0), share = Object.entries(w).map(([ch, n]) => [ch, n * basicsN / total]);
      const counts = share.map(([ch, x]) => [ch, Math.floor(x), x - Math.floor(x)]);
      let left = basicsN - counts.reduce((a, c) => a + c[1], 0);
      for (const c of [...counts].sort((a, b) => b[2] - a[2])) { if (left <= 0) break; c[1]++; left--; }
      for (const [ch, n] of counts) if (n > 0) basics.push({ name: BASIC_FOR[ch], qty: n });
    }
    for (const x of basics) why[x.name] = "Basic land";
  }
  const cards = [...cmds.map(n => ({ name: n, qty: 1 })), ...[...picked.values()].map(it => ({ name: it.name, qty: 1 })), ...basics];
  for (const n of cmds) why[n] = "Commander";
  return { cards, why, short: Math.max(0, nonlandSlots - nonlands), nonlandSlots, alwaysMissing };
}
// One card to replace a dropped one: the same job if it filled one of the required jobs, otherwise
// something that shares its theme or creature type, otherwise the best fit left. Never a card that
// was already dropped from this build (b.notHere).
// What the generator and tuning need to know about any build: its commander(s), what they want, and
// whether cards from your other decks may be used. A generated build remembers its own choices.
function buildOpts(b) {
  const src = b.source || {}, gen = src.kind === "generated", t = b.tuneOpts || {};
  const cmds = ((gen && src.commanders) || b.commanders).map(canonical);
  const w = gen ? { themes: src.themes || 0, tribes: src.tribes || [] } : commanderWants(cmds);
  return { commanders: cmds, themes: w.themes, tribes: w.tribes, useDecks: t.useDecks != null ? !!t.useDecks : !!src.useDecks, lands: src.lands || 36 };
}
function genReplacement(b, removed) {
  if (!b.commanders.length && !(b.source && b.source.commanders)) return null;
  const opts = buildOpts(b);
  const skip = new Set([...b.cards.map(c => norm(c.name)), norm(removed), ...(b.notHere || []).map(norm)]);
  const { pool, lands } = genPool(opts, skip);
  const old = cardOf(removed); if (!old) return null;
  const list = old[2] === "L" ? lands : pool;
  const reason = (b.why || {})[removed] || "", role = slotsFor(b.targets).map(x => x[0]).find(r => reason.startsWith(r)) || (old[2] !== "L" ? primaryRole(removed) : null);
  const bit = role && hasRoles() ? DATA.roles.indexOf(role) : -1;
  const was = genScore(LOOKUP.get(norm(removed)), old, opts, playedCounts());
  const kin = it => (it.hits & was.hits ? 1 : 0) + (was.tribe && it.tribe === was.tribe ? 1 : 0);
  const cands = list.filter(it => bit < 0 || (it.roles >> bit) & 1).sort((x, y) => kin(y) - kin(x) || y.score - x.score || x.name.localeCompare(y.name));
  const it = cands[0]; if (!it) return null;
  const l = genLabel(it);
  return { name: it.name, why: role ? role + (l ? ` · ${l}` : "") : old[2] === "L" ? "Land" : l ? `Fits ${l}` : "Strong card" };
}
// Cards you don't own that would fit best: an optional shopping list for a generated build.
const GEN_IDEAS = new Map();
function genIdeas(b, limit = 12) {
  const src = b.source || {}; if (src.kind !== "generated" || !DATA) return [];
  const key = b.id + "|" + b.updated + "|" + CHANGE;
  if (GEN_IDEAS.has(key)) return GEN_IDEAS.get(key);
  const opts = { themes: src.themes || 0, tribes: src.tribes || [] }, cmds = src.commanders || b.commanders;
  const ident = identityOf(cmds), played = playedCounts(), inBuild = new Set(b.cards.map(c => norm(c.name))), out = [];
  DATA.cards.forEach((c, i) => {
    if (c[2] === "L" || !legalCard(c) || !fitsIdentity(c, ident) || (hasFlags() && c[7] & FLAG_COMMANDER && cmds.some(n => norm(n) === norm(c[0])))) return;
    const k = norm(c[0]), a = AGG.get(k);
    if (inBuild.has(k) || (a && a.qty > 0) || isBlocked(c[0])) return;
    const g = genScore(i, c, opts, played);
    if (!g.hits && !g.tribe) return;
    out.push({ name: c[0], why: genLabel(g), price: c[3] || 0, score: g.score });
  });
  const res = out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).slice(0, limit);
  GEN_IDEAS.clear(); GEN_IDEAS.set(key, res);
  return res;
}

// ------------------------------------------------------------ tuning: feedback → a few swaps
// Any build can be tuned. Feedback comes from a closed menu: what's been happening in games
// (TUNE_SYMPTOMS) or "more / less" of a job, theme, creature type or lands (TUNE_DIALS). Each turns
// into steps of {add, cut}: a card to bring in from the cards you own, and the card it replaces.
// Steps are simulated one after another on a copy of the deck, so tapping "More removal" twice asks
// for four different cards. Nothing changes until the person applies the swaps they keep ticked.
// Cuts never touch the commander, companion, cards you kept (b.keep), cards you set to Always, cards
// this tune just added, or a card whose job the deck is at or under target for (slotsFor(b.targets)).
// Applying records the resulting counts as the build's targets, which regenerating also follows.
const TUNE_SYMPTOMS = [
  { id: "screw", label: "I miss land drops", hint: "+1 land, +1 cheap ramp",
    ops: () => [{ add: { land: true }, cut: { weak: true } }, { add: { role: "Ramp", maxMv: 2 }, cut: { weak: true, big: true } }] },
  { id: "flood", label: "I draw too many lands", hint: "−1 land, +1 card draw",
    ops: () => [{ add: { role: "Card draw" }, cut: { land: true } }] },
  { id: "empty", label: "I run out of cards", hint: "+2 card draw",
    ops: () => [1, 2].map(() => ({ add: { role: "Card draw" }, cut: { weak: true } })) },
  { id: "slow", label: "I'm too slow", hint: "Expensive cards out, cheaper ones in",
    ops: () => [1, 2, 3].map(() => ({ add: { maxMv: 3 }, cut: { big: true, only: "big" } })) },
  { id: "threats", label: "I can't deal with threats", hint: "+2 removal",
    ops: () => [1, 2].map(() => ({ add: { role: "Removal" }, cut: { weak: true } })) },
  { id: "cmd", label: "My commander keeps dying", hint: "+2 protection",
    ops: () => [1, 2].map(() => ({ add: { role: "Protection" }, cut: { weak: true } })) },
  { id: "theme", label: "The theme doesn't show up", hint: "+3 cards on theme",
    ops: () => [1, 2, 3].map(() => ({ add: { onTheme: true }, cut: { weak: true, offTheme: true } })) },
];
// "More / less" choices: "r:Ramp", "t:3" (theme bit), "y:12" (creature type), "lands".
function tuneDialChoices(b) {
  const out = [["lands", "Lands"]];
  if (hasRoles()) for (const r of ROLE_COUNTED) if (DATA.roles.includes(r)) out.push(["r:" + r, r]);
  if (hasThemes()) DATA.themes.forEach((t, bit) => out.push(["t:" + bit, t]));
  const o = buildOpts(b);
  for (const t of o.tribes || []) out.push(["y:" + t, DATA.subtypes[t]]);
  return out;
}
const dialLabel = (b, key) => (tuneDialChoices(b).find(x => x[0] === key) || [key, key])[1];
function dialOps(key, dir) {
  const [kind, val] = key === "lands" ? ["lands", null] : [key.slice(0, 1), key.slice(2)];
  if (kind === "lands") return [dir > 0 ? { add: { land: true }, cut: { weak: true } } : { add: {}, cut: { land: true } }];
  const twice = op => [op, JSON.parse(JSON.stringify(op))];
  if (kind === "r") return twice(dir > 0 ? { add: { role: val }, cut: { weak: true } } : { add: { notRole: val }, cut: { role: val } });
  if (kind === "t") return twice(dir > 0 ? { add: { theme: +val }, cut: { weak: true, notTheme: +val } } : { add: { notTheme: +val }, cut: { theme: +val } });
  if (kind === "y") return twice(dir > 0 ? { add: { tribe: +val }, cut: { weak: true } } : { add: {}, cut: { tribe: +val } });
  return [];
}
function stepLabel(b, s) {
  if (s.template) { const t = templateById(s.template); return `Closer to ${t ? t.name : "the template"}`; }
  if (s.symptom) return (TUNE_SYMPTOMS.find(x => x.id === s.symptom) || {}).label || s.symptom;
  return `${s.dir > 0 ? "More" : "Less"} ${dialLabel(b, s.dial).toLowerCase()}`;
}
function stepOps(s, b) {
  if (s.template) { const t = templateById(s.template); return t && b ? templateOps(b, t) : []; }
  return s.symptom ? ((TUNE_SYMPTOMS.find(x => x.id === s.symptom) || { ops: () => [] }).ops()) : dialOps(s.dial, s.dir);
}

const TUNE_CACHE = new Map();
const roleBit = r => (hasRoles() ? DATA.roles.indexOf(r) : -1);
const hasRole = (it, r) => { const bit = roleBit(r); return bit >= 0 && ((it.roles >> bit) & 1) === 1; };
const rawThemes = i => (hasThemes() && i != null ? DATA.cardThemes[i] || 0 : 0);
const BASIC_COLOR = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G", wastes: "C" };
const basicColor = name => BASIC_COLOR[norm(name).replace(/^snow-covered /, "")] || null;

// One deck as tuning sees it: nonbasic cards with their scores, plus basic land counts.
// Cards in a combo the deck already has (every piece, commander included) are never cut.
function comboPieces(b) {
  const out = new Set(); if (!COMBOS || !COMBOS.combos) return out;
  const have = new Set(b.cards.map(c => LOOKUP.get(norm(c.name))).filter(i => i != null));
  for (const cb of COMBOS.combos) if (cb[1].every(i => have.has(i))) for (const i of cb[1]) out.add(i);
  return out;
}
function tuneDeck(b, opts) {
  const played = playedCounts(), items = [], basics = new Map(), combo = comboPieces(b);
  const cmdKeys = new Set(opts.commanders.map(norm));
  for (const c of deckCards(b)) {
    const k = norm(c.name);
    if (cmdKeys.has(k)) continue;
    if (isBasic(c.name)) { basics.set(c.name, (basics.get(c.name) || 0) + c.qty); continue; }
    const i = LOOKUP.get(k), card = i == null ? null : DATA.cards[i];
    const g = card ? genScore(i, card, opts, played) : { score: 0, hits: 0, tribe: null };
    items.push({ name: card ? card[0] : c.name, k, i, c: card, qty: c.qty, roles: card ? card[5] || 0 : 0, hits: g.hits, tribe: g.tribe, score: g.score,
      land: card ? card[2] === "L" : false, mv: card ? card[4] || 0 : 0, combo: i != null && combo.has(i),
      locked: isKept(b, c.name) || tasteOf(c.name) === 2 || isComp(b, c.name) || (i != null && combo.has(i)) });
  }
  return { items, basics };
}
const deckLandCount = d => d.items.filter(x => x.land).reduce((n, x) => n + x.qty, 0) + [...d.basics.values()].reduce((n, q) => n + q, 0);
const deckRoleCount = (d, r) => d.items.filter(x => !x.land && hasRole(x, r)).reduce((n, x) => n + x.qty, 0);

// alt: {"in:3": name, "out:3": name} picks a runner-up for swap 3 instead of the first choice.
function tunePlan(b, steps, alt = {}) {
  const key = b.id + "|" + b.updated + "|" + CHANGE + "|" + JSON.stringify(steps) + "|" + JSON.stringify(alt) + "|" + JSON.stringify(b.tuneOpts || {});
  if (TUNE_CACHE.has(key)) return TUNE_CACHE.get(key);
  const opts = buildOpts(b), ident = identityOf(opts.commanders), played = playedCounts();
  const d = tuneDeck(b, opts);
  const skip = new Set([...b.cards.map(c => norm(c.name)), ...(b.notHere || []).map(norm)]);
  const { pool, lands } = genPool(opts, skip);
  const slots = slotsFor(b.targets);
  const target = r => { const s = slots.find(x => x[0] === r); return s ? s[1] : null; };
  const fresh = new Set(), swaps = [], notes = [], used = new Set();
  const nonbasicLands = () => d.items.filter(x => x.land).length;
  const maxNonbasic = Math.round(deckLandCount(d) * (ident.size <= 1 ? 0.3 : 0.6));
  const makes = it => (DATA.landColors ? DATA.landColors[String(it.i)] : undefined);
  // Colour need (spells of each colour) vs sources (lands that make it), for choosing basics.
  const colourGap = () => {
    const need = {}, src = {};
    for (const ch of ident) { need[ch] = 1; src[ch] = 0; }
    for (const x of d.items) if (!x.land && x.c) for (const ch of x.c[1]) if (ch in need) need[ch] += x.qty;
    for (const x of d.items) if (x.land) { const lc = makes(x); if (lc) for (const ch of lc) if (ch in src) src[ch]++; }
    for (const [n, q] of d.basics) { const ch = basicColor(n); if (ch in src) src[ch] += q; }
    return { need, src };
  };
  const cutWhy = (x, spec, r) => spec.land ? (isBasic(x.name) ? `${x.name}: you have the most of these` : "weakest land")
    : spec.role || spec.theme != null || spec.tribe != null ? `${r || "fits it"}` : spec.only === "big" ? `${x.mv} mana` : "";
  function chooseCut(spec, add) {
    if (spec.land) {
      if (deckLandCount(d) <= 30) return { err: "The deck is already at 30 lands, the fewest tuning will go." };
      const bs = [...d.basics].filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      if (bs.length) return { basic: bs[0][0] };
      const ls = d.items.filter(x => x.land && !x.locked && !fresh.has(x.k)).sort((x, y) => x.score - y.score);
      return ls[0] ? { item: ls[0] } : { err: "Every land here is kept." };
    }
    let cands = d.items.filter(x => !x.land && !x.locked && !fresh.has(x.k));
    if (spec.role) cands = cands.filter(x => hasRole(x, spec.role));
    if (spec.theme != null) cands = cands.filter(x => (rawThemes(x.i) >> spec.theme) & 1);
    if (spec.tribe != null) cands = cands.filter(x => x.c && (x.c[8] || []).includes(spec.tribe));
    if (spec.only === "big") { cands = cands.filter(x => x.mv >= 5); if (!cands.length) return { err: "Nothing here costs 5 or more that isn't kept." }; }
    // Don't cut a card whose job the deck needs (at or under target), or one that does the job being added.
    cands = cands.filter(x => {
      if (add.role && hasRole(x, add.role)) return false;
      if (add.theme != null && (rawThemes(x.i) >> add.theme) & 1) return false;
      if (add.onTheme && (x.hits || x.tribe)) return false;
      for (const [r] of slots) if (r !== spec.role && hasRole(x, r) && deckRoleCount(d, r) <= target(r)) return false;
      return true;
    });
    if (!cands.length) return { err: spec.role ? `No ${spec.role.toLowerCase()} card here can go without dropping below what the deck needs.`
      : spec.only === "big" ? "The other cards costing 5 or more are kept or do a job the deck is short on." : "Every other card here is kept or does a job the deck is short on." };
    const val = x => x.score + (spec.offTheme && (x.hits || x.tribe) ? 4 : 0) - (spec.big ? x.mv * 0.6 : 0) + (spec.only === "big" ? -x.mv * 2 : 0);
    cands.sort((x, y) => val(x) - val(y) || x.name.localeCompare(y.name));
    return pickWithAlts(cands, "out:" + swaps.length);
  }
  // The first choice, or the runner-up the person picked; plus two others they could pick instead.
  function pickWithAlts(cands, slot) {
    const want = alt[slot] && cands.find(x => norm(x.name) === norm(alt[slot]));
    const item = want || cands[0];
    return { item, alts: cands.slice(0, 3).filter(x => x !== item).slice(0, 2).map(x => x.name) };
  }
  function chooseIn(spec, cut) {
    if (spec.land) {
      const { need, src } = colourGap();
      if (nonbasicLands() < maxNonbasic) {
        const ls = lands.filter(it => !used.has(it.i)).map(it => { const lc = makes(it); return { it, n: lc == null ? 0 : [...lc].filter(ch => ident.has(ch)).length }; })
          .filter(x => x.n >= Math.min(2, ident.size) && x.n > 0).sort((x, y) => y.n - x.n || y.it.score - x.it.score);
        if (ls[0]) return { item: ls[0].it, why: `land · makes ${[...makes(ls[0].it)].filter(ch => ident.has(ch)).join("/")}` };
      }
      if (!ident.size) return { basic: "Wastes", why: "basic land" };
      const ch = [...ident].sort((x, y) => src[x] / need[x] - src[y] / need[y])[0];
      return { basic: BASIC_FOR[ch], why: `basic land · ${COLOR_NAMES[ch].toLowerCase()} has the fewest sources for what needs it` };
    }
    let cands = pool.filter(it => !used.has(it.i));
    if (spec.role) cands = cands.filter(it => hasRole(it, spec.role));
    if (spec.notRole) cands = cands.filter(it => !hasRole(it, spec.notRole));
    if (spec.maxMv != null) cands = cands.filter(it => (it.c[4] || 0) <= spec.maxMv);
    if (spec.theme != null) cands = cands.filter(it => (rawThemes(it.i) >> spec.theme) & 1);
    if (spec.notTheme != null) cands = cands.filter(it => !((rawThemes(it.i) >> spec.notTheme) & 1));
    if (spec.onTheme) cands = cands.filter(it => it.hits || it.tribe);
    if (spec.tribe != null) cands = cands.filter(it => (it.c[8] || []).includes(spec.tribe) || (DATA.keywords && (it.c[9] || []).some(k => DATA.keywords[k] === "Changeling")));
    if (cut && cut.item && cut.item.mv >= 6) cands = cands.filter(it => (it.c[4] || 0) < cut.item.mv);
    const val = it => it.score + popcount(it.hits) - (spec.maxMv != null ? (it.c[4] || 0) * 0.3 : 0);
    cands.sort((x, y) => val(y) - val(x) || x.name.localeCompare(y.name));
    if (!cands.length) return { err: true };
    const { item: it, alts } = pickWithAlts(cands, "in:" + swaps.length);
    const bits = [spec.role, it.tribe, ...themeNames(it.hits)].filter(Boolean);
    return { item: it, alts, why: [...new Set(bits)].slice(0, 2).join(", ") + (bits.length ? " · " : "") + `${it.c[4] || 0} mana` };
  }
  // Up to three cards you don't own that would do it, when nothing you own does.
  function ideasFor(spec) {
    if (spec.land || !DATA) return [];
    const out = [];
    DATA.cards.forEach((c, i) => {
      if (c[2] === "L" || !legalCard(c) || !fitsIdentity(c, ident) || isBlocked(c[0])) return;
      const k = norm(c[0]); if (skip.has(k) || (AGG.get(k) && AGG.get(k).qty > 0) || opts.commanders.some(n => norm(n) === k)) return;
      const it = { roles: c[5] || 0 };
      if (spec.role && !hasRole(it, spec.role)) return;
      if (spec.maxMv != null && (c[4] || 0) > spec.maxMv) return;
      if (spec.theme != null && !((rawThemes(i) >> spec.theme) & 1)) return;
      if (spec.tribe != null && !(c[8] || []).includes(spec.tribe)) return;
      const g = genScore(i, c, opts, played);
      if (spec.onTheme && !g.hits && !g.tribe) return;
      out.push({ name: c[0], score: g.score });
    });
    return out.sort((x, y) => y.score - x.score).slice(0, 3).map(x => x.name);
  }
  steps.forEach((s, si) => {
    const label = stepLabel(b, s);
    for (const op of stepOps(s, b)) {
      const inPick = op.add && Object.keys(op.add).length ? null : { any: true };
      let cut = chooseCut(op.cut, op.add || {});
      if (cut.err) { notes.push({ step: si, label, text: cut.err }); break; }
      const pick = inPick ? chooseIn({}, cut) : chooseIn(op.add, cut);
      if (pick.err) {
        const ideas = ideasFor(op.add);
        notes.push({ step: si, label, text: `You don't own ${op.add.role ? `another ${op.add.role.toLowerCase()} card` : "another card that fits"}${op.add.maxMv != null ? ` costing ${op.add.maxMv} or less` : ""} in these colours that's free to use.`, ideas });
        break;
      }
      // Apply to the simulated deck.
      const outName = cut.basic || cut.item.name;
      if (cut.basic) d.basics.set(cut.basic, d.basics.get(cut.basic) - 1);
      else d.items.splice(d.items.indexOf(cut.item), 1);
      const inName = pick.basic || pick.item.name;
      if (pick.basic) d.basics.set(pick.basic, (d.basics.get(pick.basic) || 0) + 1);
      else {
        used.add(pick.item.i); fresh.add(norm(inName));
        d.items.push({ ...pick.item, k: norm(inName), qty: 1, land: pick.item.c[2] === "L", mv: pick.item.c[4] || 0, locked: false });
      }
      fresh.add(norm(inName));
      const r = op.cut.role || (op.cut.theme != null ? DATA.themes[op.cut.theme] : op.cut.tribe != null ? DATA.subtypes[op.cut.tribe] : null);
      swaps.push({ step: si, label, out: outName, outWhy: cutWhy(cut.item || { name: outName }, op.cut, r), in: inName, inWhy: pick.why || "",
        outAlts: cut.alts || [], inAlts: pick.alts || [], cutSpec: op.cut, addSpec: op.add || {},
        inSt: cardStatus(inName, 1, buildHome(b)) });
    }
  });
  const res = { swaps, notes, after: d };
  TUNE_CACHE.clear(); TUNE_CACHE.set(key, res);
  return res;
}

// Plain-words reasons, from the same numbers the scores use: what the card does, whether it fits
// the deck's themes or tribe, how widely it's played, whether you play it, and your taste.
function decksWith(name) {
  const a = AGG.get(norm(name)); if (!a) return 0;
  let n = 0; for (const l of a.locs.values()) if (l.inDeck) n++;
  return n;
}
function explainCard(b, name, side, spec = {}) {
  const c = DATA && cardOf(name); if (!c) return [];
  if (isBasic(name)) return [];
  const opts = buildOpts(b), i = LOOKUP.get(norm(name)), g = genScore(i, c, opts, playedCounts());
  const wanted = [...(opts.tribes || []).map(t => DATA.subtypes[t] + "s"), ...themeNames(opts.themes || 0)];
  const fits = [g.tribe, ...themeNames(g.hits)].filter(Boolean);
  const roles = roleList(c[5] || 0).filter(r => ROLE_COUNTED.includes(r));
  const out = [];
  if (side === "out") {
    out.push(spec.only === "big" ? `one of the most expensive cards here (${c[4] || 0} mana)` : spec.land ? "a land the deck can spare" : "scores lowest of the cards that could go");
    if (wanted.length) out.push(fits.length ? `fits ${fits.join(", ")}` : `doesn't fit ${wanted.slice(0, 3).join(" or ")}`);
    out.push(roles.length ? `${roles.join(", ")}: the deck has enough without it` : "does none of the jobs the deck counts");
  } else {
    if (roles.length) out.push(roles.join(", "));
    if (fits.length) out.push(`fits ${fits.join(", ")}`);
    if (c[2] !== "L") out.push(`${c[4] || 0} mana`);
  }
  if (c[6]) out.push(`EDHREC rank ${c[6].toLocaleString()}`);
  const nd = decksWith(name);
  out.push(nd ? `in ${nd} of your decks` : "in none of your decks");
  const lv = tasteOf(name), dn = dismissCount(name);
  if (lv === 1 || lv === -1) out.push(`you set it to ${tasteName(lv)}`);
  if (dn) out.push(`dismissed ${dn}×`);
  return out;
}

// Apply the ticked swaps; the counts they produce become the build's targets.
// Changes the build in place and returns its state from before, for Undo; the caller saves.
function tuneApply(b, plan, off, steps) {
  const before = { cards: b.cards.map(c => ({ ...c })), why: { ...(b.why || {}) }, targets: b.targets ? JSON.parse(JSON.stringify(b.targets)) : null };
  const keep = plan.swaps.filter((_, i) => !off.has(i));
  b.why = { ...(b.why || {}) };
  for (const s of keep) {
    const oi = b.cards.findIndex(c => norm(c.name) === norm(s.out));
    if (oi < 0) continue;
    if (b.cards[oi].qty > 1) b.cards[oi].qty--; else { b.cards.splice(oi, 1); delete b.why[s.out]; }
    const ex = b.cards.find(c => norm(c.name) === norm(s.in));
    if (ex) ex.qty++; else b.cards.push({ name: s.in, qty: 1 });
    if (!isBasic(s.in)) b.why[s.in] = `Tuned: ${s.label}${s.inWhy ? " · " + s.inWhy : ""}`;
  }
  // Targets: the count after tuning for each job, theme, land or curve the applied steps touched.
  // Asking for more never sets a target below the usual quota; asking for less never raises one.
  const opts = buildOpts(b), d = tuneDeck(b, opts), t = { ...(b.targets || {}), roles: { ...((b.targets || {}).roles || {}) } };
  const old = slotsFor(b.targets), oldTarget = r => { const x = old.find(s => s[0] === r); return x ? x[1] : null; };
  const set = (cur, after, more) => cur == null ? after : more ? Math.max(after, cur) : Math.min(after, cur);
  const touched = new Set(keep.map(s => s.step));
  for (const si of touched) {
    const s = steps[si]; if (!s) continue;
    if (s.template) {                       // moving toward a template adopts its numbers as targets
      const tp = templateById(s.template); if (!tp) continue;
      t.lands = tp.shape.lands;
      for (const [r, n] of templateSlots(tp.shape, identityOf(opts.commanders))) t.roles[r] = n;
      continue;
    }
    for (const op of stepOps(s, b)) {
      if (op.add && op.add.role) t.roles[op.add.role] = set(oldTarget(op.add.role), deckRoleCount(d, op.add.role), true);
      if (op.cut && op.cut.role) t.roles[op.cut.role] = set(oldTarget(op.cut.role), deckRoleCount(d, op.cut.role), false);
      if (op.add && op.add.land) t.lands = set(b.targets && b.targets.lands, deckLandCount(d), true);
      if (op.cut && op.cut.land) t.lands = set(b.targets && b.targets.lands, deckLandCount(d), false);
      if (op.cut && op.cut.only === "big") t.big = d.items.filter(x => !x.land && x.mv >= 6).length;
    }
  }
  b.targets = t;
  TUNE_CACHE.clear(); GEN_IDEAS.clear();
  return before;
}

// ------------------------------------------------------------ deck numbers: lands, colours, jobs
// Chance of at least k lands among n cards drawn from a library of N with K lands (hypergeometric).
function atLeast(N, K, n, k) {
  const lc = (a, b) => { if (b < 0 || b > a) return -Infinity; let s = 0; for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i); return s; };
  let p = 0; const tot = lc(N, n);
  for (let i = k; i <= Math.min(n, K); i++) p += Math.exp(lc(K, i) + lc(N - K, n - i) - tot);
  return Math.min(1, p);
}
// ------------------------------------------------------------ mana costs and symbols
// decks.json "manaCosts" (format 3): one string per card in Scryfall notation, "{2}{W}{U/P}", split
// cards "{1}{R} // {2}{U}", "" for none (lands). Older data has no costs: costOf returns null.
const costOf = name => { if (!DATA || !DATA.manaCosts) return null; const i = LOOKUP.get(norm(name)); return i == null ? null : DATA.manaCosts[i] || ""; };
// "{2}{W/U} // {R}" -> ["2", "W/U", "//", "R"]
const costSymbols = cost => (String(cost || "").match(/\{[^}]+\}|\/\//g) || []).map(t => t === "//" ? "//" : t.slice(1, -1));
// How much of each colour a cost asks for: a plain symbol counts 1; a hybrid or Phyrexian symbol, which
// can be paid another way, counts 1/2 for each colour in it. Split cards count both halves.
function pipCounts(cost) {
  const out = {};
  for (const sym of costSymbols(cost)) {
    const parts = sym.split("/"), cols = parts.filter(p => "WUBRG".includes(p) && p.length === 1);
    if (!cols.length) continue;
    const soft = parts.length > 1;
    for (const ch of cols) out[ch] = (out[ch] || 0) + (soft ? 0.5 : 1);
  }
  return out;
}

function manaNumbers(b) {
  const opts = buildOpts(b), ident = identityOf(opts.commanders), d = tuneDeck(b, opts);
  const N = d.items.reduce((n, x) => n + x.qty, 0) + [...d.basics.values()].reduce((n, q) => n + q, 0);
  const lands = deckLandCount(d), ramp = deckRoleCount(d, "Ramp");
  const need = {}, src = {}; let unknown = 0;
  for (const ch of ident) { need[ch] = 0; src[ch] = 0; }
  // Coloured symbols in the deck's costs per colour (with cost data), and cards that need each colour.
  const pips = {}, hasCosts = !!DATA.manaCosts;
  for (const ch of ident) pips[ch] = 0;
  for (const x of d.items) if (!x.land && x.c) {
    for (const ch of x.c[1]) if (ch in need) need[ch] += x.qty;
    if (hasCosts) for (const [ch, n] of Object.entries(pipCounts(DATA.manaCosts[x.i] || ""))) if (ch in pips) pips[ch] += n * x.qty;
  }
  for (const x of d.items) if (x.land) {
    const lc = DATA.landColors ? DATA.landColors[String(x.i)] : undefined;
    if (lc == null) unknown++; else for (const ch of lc) if (ch in src) src[ch]++;
  }
  for (const [n, q] of d.basics) { const ch = basicColor(n); if (ch in src) src[ch] += q; }
  return { N, lands, ramp, ident, need, pips, hasCosts, src, unknown, hasLandData: !!DATA.landColors,
    play4: N >= 10 ? atLeast(N, lands, 10, 4) : 0, draw4: N >= 11 ? atLeast(N, lands, 11, 4) : 0,
    open: N >= 7 ? atLeast(N, lands, 7, 2) - atLeast(N, lands, 7, 5) : 0, slots: slotsFor(b.targets), d };
}
// ------------------------------------------------------------ templates: a deck's shape, reused
// "Use as template" on any deck (yours in ManaBox, a saved deck, a build) records its shape, not its
// cards: lands, curve, creatures, how many cards do each job, total interaction (removal, counterspells
// and wipes as one budget), and how many cards are "on plan" (fit its commander's themes or tribe).
// Generating with a template fills those numbers for a different commander: a goblin deck's shape
// becomes an elf deck's. Colours matter less than they seem, because one card counts toward every job it
// does (an elf that makes mana fills a ramp slot and an elf slot), and a deck without blue gets its
// template's counterspells as removal. Kept in bt.templates; synced in builds.json and backups.
const JOB_ROLES = ["Ramp", "Card draw", "Removal", "Board wipe", "Counterspell", "Protection", "Tutor", "Recursion"];
const INTERACTION = ["Removal", "Counterspell", "Board wipe"];
let TEMPLATES = [];
const templateById = id => (id && TEMPLATES.find(t => t.id === id)) || null;
const isInteraction = it => INTERACTION.some(r => hasRole(it, r));
// What a deck is built around: its commander's themes and tribe, or else the creature type or theme
// it has most of (8 cards or more).
function deckPlan(cards, commanders) {
  const w = commanders.length ? commanderWants(commanders.map(canonical)) : { themes: 0, tribes: [] };
  if (w.themes || w.tribes.length) return w;
  const cmdKeys = new Set(commanders.map(norm)), types = new Map(), themes = new Map();
  for (const x of cards) {
    if (cmdKeys.has(norm(x.name))) continue;
    const i = LOOKUP.get(norm(x.name)), c = i == null ? null : DATA.cards[i]; if (!c || c[2] === "L") continue;
    for (const t of c[2] === "C" ? c[8] || [] : []) types.set(t, (types.get(t) || 0) + 1);
    const th = rawThemes(i); for (let bit = 0; th >> bit; bit++) if ((th >> bit) & 1) themes.set(bit, (themes.get(bit) || 0) + 1);
  }
  const tribe = [...types].sort((a, b) => b[1] - a[1])[0], theme = [...themes].sort((a, b) => b[1] - a[1])[0];
  if (tribe && tribe[1] >= 8) return { themes: 0, tribes: [tribe[0]] };
  if (theme && theme[1] >= 8) return { themes: 1 << theme[0], tribes: [] };
  return { themes: 0, tribes: [] };
}
const planLabel = p => [...(p.tribes || []).map(t => DATA.subtypes[t] + "s"), ...themeNames(p.themes || 0)].join(", ");
function deckShape(cards, commanders, companion = null) {
  const plan = deckPlan(cards, commanders);
  const fake = { cards, commanders, companion, keep: [] };
  const opts = { commanders: commanders.map(canonical), themes: plan.themes, tribes: plan.tribes, useDecks: false };
  const d = tuneDeck(fake, opts), nl = d.items.filter(x => !x.land);
  const curve = new Array(8).fill(0); let sum = 0, n = 0;
  for (const x of nl) { curve[Math.min(x.mv, 7)] += x.qty; sum += x.mv * x.qty; n += x.qty; }
  const roles = {}; for (const r of JOB_ROLES) roles[r] = deckRoleCount(d, r);
  const count = f => nl.filter(f).reduce((t, x) => t + x.qty, 0);
  return { lands: deckLandCount(d), nonland: n, curve, avgMv: n ? +(sum / n).toFixed(2) : 0, roles,
    interaction: count(isInteraction), creatures: count(x => x.c && x.c[2] === "C"),
    onPlan: count(x => x.hits || x.tribe), plan: planLabel(plan), colours: identityOf(commanders).size };
}
function templateSummary(sh) {
  return [`${sh.lands} lands`, `average mana value ${sh.avgMv}`, `${sh.roles.Ramp || 0} ramp`, `${sh.roles["Card draw"] || 0} card draw`,
    `${sh.interaction} interaction`, sh.plan ? `${sh.onPlan} on plan (${sh.plan})` : ""].filter(Boolean).join(" · ");
}
// The jobs a template asks for, scaled to this deck's size; counterspells become removal without blue.
function templateSlots(sh, ident, sf = 1) {
  const out = new Map();
  for (const r of JOB_ROLES) { const n = Math.round((sh.roles[r] || 0) * sf); if (n > 0) out.set(r, n); }
  if (ident && !ident.has("U") && out.has("Counterspell")) { out.set("Removal", (out.get("Removal") || 0) + out.get("Counterspell")); out.delete("Counterspell"); }
  return [...out];
}
// Ops that move a build toward a template: a couple of swaps per gap, at most eight in all.
function templateOps(b, t) {
  const sh = t.shape, opts = buildOpts(b), d = tuneDeck(b, opts), ops = [];
  const push = (n, op) => { for (let k = 0; k < Math.min(n, 2) && ops.length < 8; k++) ops.push(JSON.parse(JSON.stringify(op))); };
  const landGap = sh.lands - deckLandCount(d);
  if (landGap > 0) push(landGap, { add: { land: true }, cut: { weak: true } });
  if (landGap < 0) push(-landGap, { add: {}, cut: { land: true } });
  for (const [r, n] of templateSlots(sh, identityOf(opts.commanders))) {
    const gap = n - deckRoleCount(d, r);
    if (gap > 0) push(gap, { add: { role: r }, cut: { weak: true } });
    else if (gap < -1) push(-gap - 1, { add: { notRole: r }, cut: { role: r } });
  }
  const on = d.items.filter(x => !x.land && (x.hits || x.tribe)).reduce((t2, x) => t2 + x.qty, 0);
  if ((opts.themes || (opts.tribes || []).length) && sh.onPlan - on > 1) push(sh.onPlan - on, { add: { onTheme: true }, cut: { weak: true, offTheme: true } });
  return ops;
}
// ------------------------------------------------------------ build helpers: owned decks, deck check, curve, roles
const FLAG_LEGAL = 1, FLAG_BANNED = 2, FLAG_COMMANDER = 4, FLAG_PARTNER = 8, FLAG_ANY_NUMBER = 16;
const hasFlags = () => !!(DATA && DATA.cards.length && DATA.cards[0].length > 7);
const flagsOf = name => { const c = DATA && cardOf(name); return c && c.length > 7 ? c[7] : null; };

// ------------------------------------------------------------ companions
// A companion starts outside the game: it isn't one of the 100, must fit the commander's colors,
// and the starting deck (commander included) must meet its condition. One per deck.
// These bits come with data that lists "companion" in DATA.facts (fetcher card_flags).
const FLAG_COMPANION = 32, FLAG_REPEATS_SYMBOL = 64, FLAG_ACTIVATED = 128;
const T = { creature: 256, artifact: 512, enchantment: 1024, planeswalker: 2048, instant: 4096, sorcery: 8192, battle: 16384, land: 32768, kindred: 65536 };
const T_PERMANENT = T.creature | T.artifact | T.enchantment | T.planeswalker | T.battle | T.land;
const T_NONLAND = T.creature | T.artifact | T.enchantment | T.planeswalker | T.instant | T.sorcery | T.battle | T.kindred;
const hasFacts = () => !!(DATA && Array.isArray(DATA.facts) && DATA.facts.includes("companion"));
const CODE_BITS = { C: T.creature, A: T.artifact, E: T.enchantment, P: T.planeswalker, I: T.instant, S: T.sorcery, B: T.battle, L: T.land };
// Card types as bits: exact with the new data, from the one-letter type code before it.
const typeBits = name => { const f = flagsOf(name); return hasFacts() && f != null ? f & (T_PERMANENT | T_NONLAND) : CODE_BITS[typeOf(name)] || 0; };
const mvOf = name => (isBasic(name) ? 0 : ((cardOf(name) || [])[4] || 0));
const subtypesOf = name => { const c = cardOf(name); return c && c.length > 8 && DATA.subtypes ? c[8].map(i => DATA.subtypes[i]) : []; };
const COMPANIONS = {
  "gyruda, doom of depths": { short: "Gyruda", rule: "every card has an even mana value", bad: n => mvOf(n) % 2 !== 0 },
  "jegantha, the wellspring": { short: "Jegantha", rule: "no card's mana cost has the same symbol twice", needsFacts: true, bad: n => !!((flagsOf(n) || 0) & FLAG_REPEATS_SYMBOL),
    byHand: "make sure no card's mana cost repeats a symbol (like {W}{W}, {X}{X} or {W/U}{W/U})" },
  "kaheera, the orphanguard": { short: "Kaheera", rule: "every creature card is a Cat, Elemental, Nightmare, Dinosaur or Beast", needsSubtypes: true,
    byHand: "make sure every creature card is a Cat, Elemental, Nightmare, Dinosaur or Beast",
    bad: n => !!(typeBits(n) & T.creature) && !subtypesOf(n).some(t => ["Cat", "Elemental", "Nightmare", "Dinosaur", "Beast"].includes(t)) },
  "keruga, the macrosage": { short: "Keruga", rule: "every nonland card has mana value 3 or more", bad: n => !(typeBits(n) & T.land) && !isBasic(n) && mvOf(n) < 3 },
  "lurrus of the dream-den": { short: "Lurrus", rule: "every permanent card has mana value 2 or less", bad: n => (!!(typeBits(n) & T_PERMANENT) || isBasic(n)) && mvOf(n) > 2 },
  "obosh, the preypiercer": { short: "Obosh", rule: "every nonland card has an odd mana value", bad: n => !(typeBits(n) & T.land) && !isBasic(n) && mvOf(n) % 2 !== 1 },
  "umori, the collector": { short: "Umori", rule: "every nonland card shares a card type", needsFacts: true, whole: true,
    byHand: "make sure every nonland card shares a card type (all creatures, for example)" },
  "zirda, the dawnwaker": { short: "Zirda", rule: "every permanent card has an activated ability", needsFacts: true, likely: true,
    bad: n => (!!(typeBits(n) & T_PERMANENT) || isBasic(n)) && !isBasic(n) && !((flagsOf(n) || 0) & FLAG_ACTIVATED),
    byHand: "make sure every permanent card has an activated ability" },
  "yorion, sky nomad": { never: "Yorion can't be a companion in Commander: its condition needs a deck of more than 100 cards." },
  "lutri, the spellchaser": { never: "Lutri is banned as a companion in Commander (since February 9, 2026). It can still be one of the 100." },
};
const isCompanionCard = name => (hasFacts() ? !!((flagsOf(name) || 0) & FLAG_COMPANION) : !!COMPANIONS[norm(name)]);
const isComp = (b, name) => !!(b && b.companion && norm(b.companion) === norm(name));
const deckCards = b => b.cards.filter(c => !isComp(b, c.name));   // the 100 (or fewer), without the companion

function companionChecks(b) {
  const comp = b.companion, items = [];
  if (!comp) return items;
  const card = b.cards.find(c => isComp(b, c.name));
  if (!card) return items;
  const rule = COMPANIONS[norm(comp)];
  items.push({ ok: true, text: `Companion: ${comp} (outside the 100)` });
  if (!isCompanionCard(comp)) { items.push({ ok: false, text: `${comp} doesn't have Companion` }); return items; }
  if (isCmd(b, comp)) items.push({ ok: false, text: "Your companion can't also be your commander" });
  if (card.qty > 1) items.push({ ok: false, text: "Only one copy of your companion" });
  if (rule && rule.never) { items.push({ ok: false, text: rule.never }); return items; }
  if (!rule) { items.push({ ok: null, text: `${comp}'s companion condition isn't checked here. Check it by hand.` }); return items; }
  const deck = deckCards(b).map(c => c.name);
  const name = rule.short || comp;
  if ((rule.needsFacts && !hasFacts()) || (rule.needsSubtypes && !(DATA && DATA.subtypes))) { items.push({ ok: null, text: `${name}'s condition isn't checked until the next data refresh: ${rule.byHand}. Your commander counts too.` }); return items; }
  if (rule.whole) {   // Umori: one card type shared by every nonland card
    const nonland = deck.filter(n => !(typeBits(n) & T.land) && !isBasic(n) && cardOf(n));
    let shared = T_NONLAND; for (const n of nonland) shared &= typeBits(n);
    if (shared || !nonland.length) { items.push({ ok: true, text: `${name}: ${rule.rule}` }); return items; }
    const counts = Object.entries(T).map(([k, bit]) => [k, nonland.filter(n => typeBits(n) & bit).length]).sort((a, c) => c[1] - a[1]);
    const [best, bit] = [counts[0][0], T[counts[0][0]]];
    items.push({ ok: false, text: `${name}: ${rule.rule}. Most are ${best === "sorcery" ? "sorceries" : best + "s"}; these aren't`, list: nonland.filter(n => !(typeBits(n) & bit)) });
    return items;
  }
  const offenders = deck.filter(n => (cardOf(n) || isBasic(n)) && rule.bad(n));
  if (!offenders.length) items.push({ ok: true, text: rule.likely ? `${name}: every permanent card seems to have an activated ability` : `${name}: ${rule.rule}` });
  else if (rule.likely) items.push({ ok: null, text: `${name}: ${rule.rule}. These look like they don't (worth a check)`, list: offenders });
  else items.push({ ok: false, text: `${name}: ${rule.rule}. These don't`, list: offenders });
  return items;
}
const buildHome = b => (b && b.source && b.source.kind === "owned" ? b.source.loc : null);
const typeOf = name => (DATA && cardOf(name) ? cardOf(name)[2] : (isBasic(name) ? "L" : "O"));

// Deck binders in the collection: the decks you already have.
function ownedDecks() {
  const decks = new Map();
  for (const e of (COLL ? COLL.entries : [])) {
    if (!e.inDeck) continue;
    decks.set(e.loc, (decks.get(e.loc) || 0) + e.qty);
  }
  return [...decks].map(([loc, count]) => ({ loc, count })).sort((a, b) => a.loc.localeCompare(b.loc));
}
function ownedDeckList(loc) {
  const cards = new Map();
  for (const e of COLL.entries) if (e.loc === loc) {
    const name = canonical(e.name), k = norm(name);
    const ex = cards.get(k); if (ex) ex.qty += e.qty; else cards.set(k, { name, qty: e.qty });
  }
  // A binder named after its commander ("Deck – Queen Marchesa") tells us which card leads it.
  const bare = norm(loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, ""));
  const cmd = [...cards.values()].filter(c => norm(c.name) === bare || norm(c.name).startsWith(bare + ","));
  return { name: loc.replace(/^\s*deck\s*[-–—:·]?\s*/i, "") || loc, cards: [...cards.values()], commanders: cmd.slice(0, 1).map(c => c.name) };
}
function deckCheck(b) {
  const items = [];
  const total = deckCards(b).reduce((n, c) => n + c.qty, 0);
  const ident = buildIdentity(b);
  items.push(total === 100 ? { ok: true, text: "100 cards" } : { ok: false, text: `${total} cards; a Commander deck has exactly 100` });
  if (!b.commanders.length) items.push({ ok: false, text: "No commander chosen. Tap ★ on a card to set it." });
  else if (hasFlags()) {
    const f = b.commanders.map(n => flagsOf(n));
    if (b.commanders.length > 2) items.push({ ok: false, text: "More than two commanders" });
    else if (b.commanders.length === 2) {
      const ok = f.every(x => x == null || (x & FLAG_PARTNER)) && f.some(x => x == null || (x & FLAG_COMMANDER));
      items.push(ok ? { ok: true, text: "Partner commanders" } : { ok: false, text: "These two can't share command (each needs Partner, Friends forever, a Background, or similar)" });
    } else {
      const ok = f[0] == null || (f[0] & FLAG_COMMANDER);
      items.push(ok ? { ok: true, text: `${b.commanders[0]} can be your commander` } : { ok: false, text: `${b.commanders[0]} can't be a commander` });
    }
  }
  const dupes = b.cards.filter(c => c.qty > 1 && !isBasic(c.name) && !((flagsOf(c.name) || 0) & FLAG_ANY_NUMBER)).map(c => c.name);
  items.push(dupes.length ? { ok: false, text: "More than one copy", list: dupes } : { ok: true, text: "One copy of each card" });
  if (ident) {
    const outside = b.cards.filter(c => { const card = DATA && cardOf(c.name); return card && [...card[1]].some(ch => ch !== "C" && !ident.has(ch)); }).map(c => c.name);
    items.push(outside.length ? { ok: false, text: "Outside your commander's colors", list: outside } : { ok: true, text: "Everything fits the commander's colors" });
  }
  if (hasFlags()) {
    const banned = b.cards.filter(c => (flagsOf(c.name) || 0) & FLAG_BANNED).map(c => c.name);
    const illegal = b.cards.filter(c => { const f = flagsOf(c.name); return f != null && !(f & FLAG_LEGAL) && !(f & FLAG_BANNED) && !isBasic(c.name); }).map(c => c.name);
    items.push(banned.length ? { ok: false, text: "Banned in Commander", list: banned } : { ok: true, text: "No banned cards" });
    if (illegal.length) items.push({ ok: false, text: "Not legal in Commander", list: illegal });
  }
  items.push(...companionChecks(b));
  const unknown = DATA ? b.cards.filter(c => !cardOf(c.name) && !isBasic(c.name)).map(c => c.name) : [];
  if (unknown.length) items.push({ ok: null, text: "Not recognized, so not checked", list: unknown });
  return items;
}
// Cards you kept in a build (b.keep): tuning and regenerating never take them out. Cards you add or
// swap in by hand are kept automatically; the commander and companion always stay.
const isKept = (b, name) => (b.keep || []).some(n => norm(n) === norm(name));
const canonical = name => (DATA && cardOf(name) ? cardOf(name)[0] : name);
const isCmd = (b, name) => b.commanders.some(n => norm(n) === norm(name));

function buildIdentity(b) {
  const set = new Set();
  for (const n of b.commanders) { const c = DATA && cardOf(n); if (c) for (const ch of c[1]) if (ch !== "C") set.add(ch); }
  return b.commanders.length ? set : null;
}
function primaryRole(name) {
  let best = null, w = -1;
  for (const r of roleList(roleBits(name))) if (ROLE_COUNTED.includes(r) && (ROLE_WEIGHT[r] ?? 5) > w) { best = r; w = ROLE_WEIGHT[r] ?? 5; }
  return best;
}

// ------------------------------------------------------------ build history
// Every change to a build's cards, commander or companion is kept as a diff in b.history (newest last):
// { at, why?, add: [[name, qty]], cut: [[name, qty]], cmd?: [before[], after[]], comp?: [before, after] }.
// A diff can be undone (applyChange with undo = true), so going back to any point replays the undos.
const HISTORY_MAX = 30, HISTORY_MERGE_MS = 10 * 60 * 1000;
function buildState(b) {
  const cards = {};
  for (const c of b.cards || []) cards[c.name] = (cards[c.name] || 0) + (c.qty || 1);
  return { cards, cmd: [...(b.commanders || [])], comp: b.companion || null };
}
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function stateDiff(a, b) {
  const add = [], cut = [];
  for (const [n, q] of Object.entries(b.cards)) { const d = q - (a.cards[n] || 0); if (d > 0) add.push([n, d]); }
  for (const [n, q] of Object.entries(a.cards)) { const d = q - (b.cards[n] || 0); if (d > 0) cut.push([n, d]); }
  const out = { add, cut };
  if (!sameList(a.cmd, b.cmd)) out.cmd = [a.cmd, b.cmd];
  if ((a.comp || null) !== (b.comp || null)) out.comp = [a.comp || null, b.comp || null];
  return add.length || cut.length || out.cmd || out.comp ? out : null;
}
function applyChange(state, d, undo = false) {
  const cards = { ...state.cards };
  const [plus, minus] = undo ? [d.cut, d.add] : [d.add, d.cut];
  for (const [n, q] of plus) cards[n] = (cards[n] || 0) + q;
  for (const [n, q] of minus) { const left = (cards[n] || 0) - q; if (left > 0) cards[n] = left; else delete cards[n]; }
  return { cards, cmd: d.cmd ? [...d.cmd[undo ? 0 : 1]] : [...state.cmd], comp: d.comp ? d.comp[undo ? 0 : 1] : state.comp };
}
// Record a change from `before` to b's current state. An unlabelled change soon after another unlabelled
// one is merged into it, and an unlabelled change that exactly reverses the latest one (an Undo) removes
// that entry. A labelled one ("Went back to…") is always kept, so it can be undone in turn.
function recordChange(b, before, why, now = Date.now()) {
  const after = buildState(b), d = stateDiff(before, after);
  if (!d) return false;
  const h = b.history || (b.history = []), last = h[h.length - 1];
  if (last && now - last.at < HISTORY_MERGE_MS) {
    const beforeLast = applyChange(before, last, true), net = stateDiff(beforeLast, after);
    if (!net && !why) { h.pop(); return true; }               // undone (an Undo is unlabelled; going back isn't)
    if (!why && !last.why) { h[h.length - 1] = { at: now, ...net }; return true; }
  }
  h.push({ at: now, ...(why ? { why } : {}), ...d });
  if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  return true;
}
// The state just before history entry j: the current state with entries j..last undone.
function stateBefore(b, j) {
  let s = buildState(b);
  for (let i = (b.history || []).length - 1; i >= j; i--) s = applyChange(s, b.history[i], true);
  return s;
}
// Put a state back on a build, keeping the order of cards that stay.
function restoreState(b, s) {
  const left = { ...s.cards }, cards = [];
  for (const c of b.cards) if (left[c.name]) { cards.push({ ...c, qty: left[c.name] }); delete left[c.name]; }
  for (const [name, qty] of Object.entries(left)) cards.push({ name, qty });
  b.cards = cards; b.commanders = [...s.cmd]; b.companion = s.comp || null;
}
// A short description for an entry without a label.
function changeLabel(d) {
  if (d.why) return d.why;
  const names = l => l.map(([n, q]) => q > 1 ? `${q} ${n}` : n);
  if (d.add.length === 1 && d.cut.length === 1 && d.add[0][1] === 1 && d.cut[0][1] === 1) return `Swapped ${d.cut[0][0]} for ${d.add[0][0]}`;
  if (d.add.length && !d.cut.length) return d.add.length <= 2 ? `Added ${names(d.add).join(" and ")}` : `Added ${d.add.reduce((n, x) => n + x[1], 0)} cards`;
  if (d.cut.length && !d.add.length) return d.cut.length <= 2 ? `Removed ${names(d.cut).join(" and ")}` : `Removed ${d.cut.reduce((n, x) => n + x[1], 0)} cards`;
  if (d.add.length || d.cut.length) return `Changed ${d.add.length + d.cut.length} cards`;
  if (d.cmd) return d.cmd[1].length ? `Commander: ${d.cmd[1].join(" and ")}` : "Unset the commander";
  return d.comp && d.comp[1] ? `Companion: ${d.comp[1]}` : "Unset the companion";
}

// ------------------------------------------------------------ sample hand
// The library a game starts with: every card but the commanders and the companion, one entry per copy.
function libraryOf(b) {
  const out = [];
  for (const c of deckCards(b)) if (!isCmd(b, c.name)) for (let i = 0; i < (c.qty || 1); i++) out.push(c.name);
  return out;
}
function shuffled(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// A fresh hand: shuffle, draw seven. London mulligan: after the nth mulligan, n cards go to the bottom,
// except that Commander's first mulligan is free.
function dealHand(b, mulligans = 0, rnd = Math.random) {
  const lib = shuffled(libraryOf(b), rnd);
  return { lib: lib.slice(7), hand: lib.slice(0, 7), drawn: 0, mull: mulligans, toBottom: Math.max(0, mulligans - 1) };
}
const isLandCard = name => isBasic(name) || typeOf(name) === "L";
function handCounts(hand) { const lands = hand.filter(isLandCard).length; return { lands, spells: hand.length - lands }; }

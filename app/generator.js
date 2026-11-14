"use strict";
// Bulk Tutor, the page's script, part "generator": the generator screen: "What can I build?", the dials, playstyles and hot-swap choices.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ generator: the screen
let GEN = { q: "", cmds: [], themes: 0, tribes: [], tribeOptions: [], useDecks: false, lands: 36, partner: false, busy: false, template: "", pop: POP_DEFAULT, mana: "", style: "", lean: "", hs: false, hsIds: [] };
const genReset = () => { GEN = { q: "", cmds: [], themes: 0, tribes: [], tribeOptions: [], useDecks: GEN.useDecks, lands: GEN.lands, partner: false, busy: false, template: GEN.template, pop: GEN.pop, mana: GEN.mana, style: GEN.style, lean: GEN.lean, hs: GEN.hs, hsIds: [] }; };
// The Meta-to-Jank dial (engine POP_NOTCHES): one line per notch under the control, from Matt's definitions (Nov 9).
const POP_HINTS = [
  "Cards so good that nearly every deck in these colours runs them.",
  "Cards that see a lot of play: the usual picks.",
  "Cards that see occasional play, picked for how well they fit your commander.",
  "Cards most players have never heard of, picked for how well they fit. Still a full set of ramp, card draw and removal.",
];
// Below Popular, a second choice: whether the mana that goes in first (engine reliableMana) follows the dial too, or is the
// most played you own (Matt's words for the two, Nov 9). At Meta and Popular both pick the same cards, so it isn't shown.
const MANA_CHOICES = [["", "Follows the dial", "The mana that goes in first (mana rocks, mana dorks and land-fetching spells) is picked the way the dial says, so no Sol Ring here."],
  ["best", "Best you own", "The mana that goes in first is the most played you own, like Sol Ring, whatever the dial says."]];
function popDialHTML(notch, attr, mana, manaAttr) {
  if (!hasPop()) return "";
  const m = mana === "best" ? "best" : "";
  return `<p class="small"><strong>Meta to jank</strong> <span class="muted">${esc(POP_HINTS[notch])}</span></p>
      <div class="seg seg-fill" role="group" aria-label="Meta to jank">${POP_NOTCHES.map((n, k) => `<button ${attr}="${k}" aria-pressed="${notch === k}">${n}</button>`).join("")}</div>
      ${manaAttr && notch > POP_DEFAULT ? `<p class="small"><strong>Mana</strong> <span class="muted">${esc(MANA_CHOICES.find(c => c[0] === m)[2])}</span></p>
      <div class="seg seg-fill" role="group" aria-label="Mana">${MANA_CHOICES.map(([k, name]) => `<button ${manaAttr}="${k}" aria-pressed="${m === k}">${name}</button>`).join("")}</div>` : ""}`;
}
// Playstyles (engine PLAYSTYLES): how the deck treats the table. One line per choice under the control.
const STYLE_HINTS = {
  "": "No lean either way: the usual jobs, plus whatever fits your commander.",
  aggressive: "Attack early and often: evasion, haste, extra combats, anthems and more creatures. Fewer board wipes and big spells.",
  political: "Work the table: goad, forced attacks, voting, the monarch, gifts and deals.",
  defensive: "Make attacking you a bad idea: fogs, attack taxes, deterrents, protection and lifegain, and more board wipes.",
  control: "Answer everything: more removal, board wipes and card draw, fewer creatures, and counterspells if you're in blue.",
  combo: "Win with combos from your cards: complete combos count double, plus tutors and protection to find and keep them.",
};
// The playstyle choice (Balanced plus each playstyle, three to a row), and "Lean into" once there's a theme or tribe too.
// so: styleOptions() for these cards (Matt, Nov 9: only what's realistic). Choices your cards can't really play are greyed,
// with a line each saying why; `keep` is a choice never greyed (a build's own playstyle).
const lcFirst = t => t ? t[0].toLowerCase() + t.slice(1) : t;
function styleOffHTML(lines) {
  return lines.length ? `<ul class="style-off muted small">${lines.map(([n, w]) => `<li><strong>${esc(n)}:</strong> ${esc(lcFirst(w))}</li>`).join("")}</ul>` : "";
}
function leanHTML(lean, leanAttr) {
  return `<p class="small"><strong>Lean into</strong> <span class="muted">${lean === "style" ? "the playstyle: cards that play this way count a little more than ones that fit the theme." : "the theme: cards that fit it count a little more than ones that play this way."}</span></p>
      <div class="seg seg-fill" role="group" aria-label="Lean into">${[["", "Theme"], ["style", "Playstyle"]].map(([k, n]) => `<button ${leanAttr}="${k}" aria-pressed="${(lean || "") === k}">${n}</button>`).join("")}</div>`;
}
const styleChoices = () => [["", "Balanced"], ...PLAYSTYLES.map(x => [x.id, x.name])];
// Whether a choice is offered, and why not: { ok, why }.
function styleAvail(so, id) {
  if (!so) return { ok: true, why: "" };
  if (!id) return so.balanced;
  return so.styles.find(x => x.id === id) || { ok: true, why: "" };
}
// The choice to use: the one picked if it's offered, otherwise what Balanced turned out to be, or the first offered.
function styleInUse(so, picked) {
  if (!so || styleAvail(so, picked).ok) return picked || "";
  if (so.balanced.ok) return "";
  return so.balanced.like || (so.styles.find(x => x.ok) || { id: "" }).id;
}
function styleDialHTML(style, lean, plan, attr, leanAttr, so = null, keep = null) {
  if (!hasStyles()) return "";
  const off = styleChoices().filter(([k]) => k !== keep && !styleAvail(so, k).ok);
  return `<p class="small"><strong>Playstyle</strong> <span class="muted">${esc(STYLE_HINTS[style || ""] || "")}</span></p>
      <div class="seg seg-grid" role="group" aria-label="Playstyle">${styleChoices().map(([k, n]) => {
        const no = off.some(x => x[0] === k);
        return `<button ${attr}="${k}" aria-pressed="${(style || "") === k}"${no ? " disabled" : ""}>${n}</button>`; }).join("")}</div>
      ${styleOffHTML(off.map(([k, n]) => [n, styleAvail(so, k).why]))}
      ${style && plan ? leanHTML(lean, leanAttr) : ""}`;
}
// The generator's options as they stand (no playstyle: styleOptions and hot-swaps add their own).
const genOptsNow = () => ({ commanders: GEN.cmds.map(canonical), themes: GEN.themes, tribes: GEN.tribes, useDecks: GEN.useDecks, lands: GEN.lands, pop: GEN.pop, ...(GEN.mana === "best" && GEN.pop > POP_DEFAULT && hasPop() ? { mana: "best" } : {}) });
const hsNames = ids => ids.map(hsName).join(", ").replace(/, ([^,]*)$/, " and $1");
// One deck or a hot-swap (Matt, Nov 9): a hot-swap is the same deck in two or three playstyles, a shared core plus swaps.
function genStyleHTML() {
  if (!hasStyles()) return "";
  const o = genOptsNow(), so = styleOptions(o), plan = !!(GEN.themes || GEN.tribes.length);
  const mode = `<p class="small"><strong>One deck or a hot-swap</strong> <span class="muted">${GEN.hs ? "A hot-swap is one deck in two or three playstyles: the cards they share, plus a few swaps you keep in a Swaps binder and switch in Assemble." : "One deck in one playstyle."}</span></p>
      <div class="seg seg-fill" role="group" aria-label="One deck or a hot-swap">${[[0, "One deck"], [1, "Hot-swap"]].map(([k, n]) => `<button data-gen-hs="${k}" aria-pressed="${GEN.hs === !!k}">${n}</button>`).join("")}</div>`;
  if (!GEN.hs) return mode + styleDialHTML(styleInUse(so, GEN.style), GEN.lean, plan, "data-gen-style", "data-gen-lean", so);
  const offered = styleChoices().filter(([k]) => styleAvail(so, k).ok).map(([k]) => k);
  GEN.hsIds = GEN.hsIds.filter(k => offered.includes(k));
  const ids = GEN.hsIds, opts = { ...o, lean: GEN.lean }, check = ids.length >= 2 ? hotSwapCheck(opts, ids) : null;
  // A choice that would make the swaps too few or too many is greyed too, saying which.
  const blocked = new Map();
  if (ids.length && ids.length < 3) for (const k of offered) if (!ids.includes(k)) { const c = hotSwapCheck(opts, [...ids, k]); if (!c.ok) blocked.set(k, `with ${hsNames(ids)}, ${lcFirst(c.why)}`); }
  const off = styleChoices().filter(([k]) => !styleAvail(so, k).ok).map(([k, n]) => [n, styleAvail(so, k).why]);
  const offB = styleChoices().filter(([k]) => blocked.has(k)).map(([k, n]) => [n, blocked.get(k)]);
  const full = ids.length >= 3;
  const status = !check ? `<p class="muted small">Pick two or three playstyles.</p>`
    : check.ok ? `<p class="small"><strong>${esc(hsNames(ids))}</strong>: ${ids.length > 2 ? "up to " : ""}<span class="num">${check.swaps}</span> swaps per switch</p>`
    : `<p class="small">${esc(check.why)}.</p>${check.swaps > HOTSWAP_MAX ? `<div class="actions"><button class="btn" data-gen="separate">Build them as separate decks</button></div>` : ""}`;
  return mode + `<p class="small"><strong>Playstyles</strong> <span class="muted">Each version keeps its own ramp, removal and the rest.</span></p>
      <div class="seg seg-grid" role="group" aria-label="Playstyles">${styleChoices().map(([k, n]) => {
        const on = ids.includes(k), no = !on && (!offered.includes(k) || blocked.has(k) || full);
        return `<button data-gen-style="${k}" aria-pressed="${on}"${no ? " disabled" : ""}>${n}</button>`; }).join("")}</div>
      ${status}${styleOffHTML([...off, ...offB])}
      ${plan && ids.some(Boolean) ? leanHTML(GEN.lean, "data-gen-lean") : ""}`;
}
function genCommanderList(q) {
  if (!DATA || !hasFlags()) return [];
  const nq = norm(q || ""), out = [];
  DATA.cards.forEach((c, i) => {
    if (!(c[7] & FLAG_COMMANDER) || !legalCard(c)) return;
    if (GEN.partner && !(c[7] & FLAG_PARTNER)) return;
    if (GEN.cmds.some(n => norm(n) === norm(c[0]))) return;
    const a = AGG.get(norm(c[0])), owned = !!(a && a.qty > 0);
    if (nq ? !norm(c[0]).includes(nq) : !owned) return;
    out.push({ name: c[0], colors: c[1], owned, rank: c[6] || 1e9 });
  });
  return out.sort((x, y) => (y.owned - x.owned) || x.rank - y.rank || x.name.localeCompare(y.name)).slice(0, 8);
}
function genResultsHTML() {
  if (!GEN.q && !GEN.partner) return "";   // your own commanders are in "What can I build?" above the search
  const list = genCommanderList(GEN.q);
  if (!list.length) return `<p class="muted small">${GEN.q ? "No commanders match." : "None of your cards can be a commander yet. Search for any commander above."}</p>`;
  return list.map(x => `<button class="bres" data-gen-pick="${esc(x.name)}"><span><strong>${esc(x.name)}</strong> <small>${pips(x.colors)} ${x.owned ? "in your collection" : "not in your collection"}</small></span><span class="add">Choose</span></button>`).join("");
}
// "What can I build?" (engine buildableCommanders): your commanders, best fit first; tapping one opens the generator for it.
const FIT_SHOWN = 5;
let FIT_ALL = false;
function fitLine(x) {
  // The count is for the wants the line names; with more wants than two, the wider count follows.
  const parts = [x.plan ? `${x.onNamed} of your cards fit ${x.plan}${x.more && x.onPlan > x.onNamed ? `, ${x.onPlan} counting its other ${x.more === 1 ? "theme" : "themes"}` : ""}`
    : "no theme in its text, so it's built from your strongest cards"];
  if (x.gaps.length) parts.push(`short on ${x.gaps.map(r => r.toLowerCase()).join(", ")}`);
  if (x.short) parts.push(`not enough cards for a full deck (${x.short} short)`);
  if (x.inDeck) parts.push(`it's in ${x.inDeck}`);
  return parts.join(" · ");
}
function fitListHTML() {
  const list = buildableCommanders({ useDecks: GEN.useDecks });
  if (!list.length) return `<p class="muted small">None of your cards can be a commander yet. Search for any commander below.</p>`;
  const shown = FIT_ALL ? list : list.slice(0, FIT_SHOWN);
  return `<div class="results" id="fit-list">${shown.map(x => `<button class="bres" data-gen-pick="${esc(x.name)}"><span><strong>${esc(x.name)}</strong> <small>${pips(x.colors)} ${esc(fitLine(x))}</small></span><span class="add">Build</span></button>`).join("")}</div>
    ${list.length > FIT_SHOWN ? `<div class="actions"><button class="btn link" data-fit-more>${FIT_ALL ? "Show fewer" : `Show all ${list.length}`}</button></div>` : ""}`;
}
function genPanelHTML() {
  if (!DATA || !hasFlags()) return "";
  const hidden = hiddenCards();
  const lvText = { "-2": "Never", "-1": "Less", "1": "More", "2": "Always" };
  const hiddenHTML = hidden.length ? `<details class="gen-hidden"><summary class="small">Your card preferences <span class="num">(${hidden.length})</span></summary>
      <p class="muted small">Set them in any card's details. Never and Less, plus cards you've dismissed, are suggested less; More and Always, more.</p>
      <div class="results">${hidden.map(p => { const lv = p.level != null ? p.level : p.blocked ? -2 : 0;
        return `<div class="bres"><span><strong>${esc(p.name)}</strong> <small>${[lv ? lvText[String(lv)] : "", p.dismissed ? `dismissed ${p.dismissed}×` : ""].filter(Boolean).join(" · ")}</small></span><button class="btn link" data-gen-unhide="${esc(p.name)}">${lv === -2 ? "Allow again" : "Reset"}</button></div>`; }).join("")}</div></details>` : "";
  const search = `<div class="field"><label for="gen-q">${GEN.partner ? "Partner" : "Commander"}</label><input type="search" id="gen-q" placeholder="${GEN.partner ? "Search partners" : "Search commanders"}" autocomplete="off" value="${esc(GEN.q)}"></div>
      <div class="results" id="gen-results">${genResultsHTML()}</div>`;
  const tplList = TEMPLATES.length ? `<details class="gen-hidden"><summary class="small">Your templates <span class="num">(${TEMPLATES.length})</span></summary>
      <div class="results">${TEMPLATES.map(t => `<div class="bres"><span><strong>${esc(t.name)}</strong> <small>${esc(templateSummary(t.shape))}</small></span><button class="btn link" data-tpl-del="${esc(t.id)}">Delete</button></div>`).join("")}</div></details>` : "";
  if (!GEN.cmds.length) return `<div class="panel" id="what-can">
      <h3>What can I build?</h3>
      <p class="muted small">Commanders you own, ranked by how well your own cards fit them. Pick one and Bulk Tutor builds a deck from your collection: the usual ramp, card draw and removal, plus cards that fit what it does.</p>
      ${fitListHTML()}
      <label class="check"><input type="checkbox" data-gen="decks"${GEN.useDecks ? " checked" : ""}> Also count cards that are in your other decks</label>
      <div class="field"><label for="gen-q">Or any commander</label><input type="search" id="gen-q" placeholder="Search commanders" autocomplete="off" value="${esc(GEN.q)}"></div>
      <div class="results" id="gen-results">${genResultsHTML()}</div>
      ${tplList}${hiddenHTML}</div>`;
  const cmdNames = GEN.cmds.map(esc).join(" + "), first = cardOf(GEN.cmds[0]);
  const canPartner = GEN.cmds.length === 1 && first && first[7] & FLAG_PARTNER;
  const themes = hasThemes() ? `<p class="small"><strong>Themes</strong> <span class="muted">${GEN.themes ? `found in ${GEN.cmds.length > 1 ? "their" : "its"} rules text.` : "none found in the rules text."} Switch any on or off.</span></p>
      <div class="roles">${DATA.themes.map((t, bit) => `<button class="tag-btn" data-gen-theme="${bit}" aria-pressed="${!!((GEN.themes >> bit) & 1)}">${esc(t)}</button>`).join("")}</div>`
    : `<p class="muted small">Themes appear after the next data refresh; for now the deck is built from the usual jobs and your strongest cards.</p>`;
  const tribes = GEN.tribeOptions.length ? `<p class="small"><strong>Creature types</strong></p>
      <div class="roles">${GEN.tribeOptions.map(t => `<button class="tag-btn" data-gen-tribe="${t}" aria-pressed="${GEN.tribes.includes(t)}">${esc(DATA.subtypes[t])}</button>`).join("")}</div>` : "";
  const template = GEN.hs ? "" : TEMPLATES.length ? `<div class="field"><label for="gen-template">Shape it like</label><select id="gen-template"><option value="">The usual numbers</option>${TEMPLATES.map(t => `<option value="${esc(t.id)}"${GEN.template === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        ${templateById(GEN.template) ? `<p class="muted small">${esc(templateSummary(templateById(GEN.template).shape))}. The new deck aims for the same numbers, with ${esc(planLabel({ themes: GEN.themes, tribes: GEN.tribes }) || "its own cards")} as the plan.</p>` : ""}`
        : `<p class="muted small">Tip: “Use as template” on a deck you like (in a build’s Actions, or on one of your decks) lets you generate new decks in the same shape.</p>`;
  const styleBlock = genStyleHTML();   // first: it drops hot-swap playstyles that are no longer offered, which the plan line names
  // Generate first (0.86.0; Matt, Nov 12, the review's step 7): the commander, a line on what will be built, Meta to
  // jank ("should definitely stay outside the fold") and Generate. Everything else waits under "More options", which
  // stays open once someone opens it (the folds' own memory, `bt.fold`), and is open while a hot-swap is being
  // chosen: its playstyles are picked in there, and Generate waits for them.
  return `<div class="panel">
      <h3>Generate a deck for ${cmdNames}</h3>
      ${GEN.partner ? search : canPartner ? `<div class="actions"><button class="btn" data-gen="partner">Add a partner</button></div>` : ""}
      <p class="small" id="gen-plan">${genPlanHTML()}</p>
      ${popDialHTML(GEN.pop, "data-gen-pop", GEN.mana, "data-gen-mana")}
      <div class="actions"><button class="btn primary" data-gen="go"${GEN.busy || (GEN.hs && !(GEN.hsIds.length >= 2 && hotSwapCheck({ ...genOptsNow(), lean: GEN.lean }, GEN.hsIds).ok)) ? " disabled" : ""}>${GEN.busy ? "Generating…" : GEN.hs ? "Generate hot-swap" : "Generate build"}</button><button class="btn" data-gen="back">Choose another commander</button></div>
      <details class="gen-more" data-fold="genmore"${GEN.hs || foldOpen("genmore", false) ? " open" : ""}><summary>More options</summary>
      <div class="gen-more-body">
      ${themes}${tribes}
      ${styleBlock}
      ${template}
      <label class="check"><input type="checkbox" data-gen="decks"${GEN.useDecks ? " checked" : ""}> Also use cards that are in your other decks</label>
      <div class="field narrow"><label for="gen-lands">Lands</label><input type="number" id="gen-lands" min="28" max="42" inputmode="numeric" value="${GEN.lands}"></div>
      </div></details>
      ${hiddenHTML}</div>`;
}
// What Generate will build, in a line, each part under the name its control has under "More options" (Matt, Nov 12:
// "just call it Playstyle if that's what it's describing. Seems more consistent that way"): creature types, themes,
// the playstyle that will really be built (or the hot-swap's), the lands, and the choices that aren't the usual ones.
function genPlanParts() {
  const tribes = GEN.tribes.map(t => tribePlural(DATA.subtypes[t])), themes = themeNames(GEN.themes);
  const tpl = GEN.hs ? null : templateById(GEN.template);
  return [
    tribes.length ? ["Creature types", tribes.join(", ")] : null,
    themes.length ? ["Themes", themes.join(", ")] : tribes.length ? null : ["Themes", "none, so your strongest cards"],
    !hasStyles() ? null : GEN.hs ? ["Hot-swap", GEN.hsIds.length ? hsNames(GEN.hsIds) : "pick two or three playstyles"] : ["Playstyle", hsName(styleInUse(styleOptions(genOptsNow()), GEN.style))],
    ["Lands", String(GEN.lands)],
    tpl ? ["Shaped like", tpl.name] : null,
    GEN.useDecks ? ["Other decks' cards", "used too"] : null,
  ].filter(Boolean);
}
const genPlanHTML = () => genPlanParts().map(([k, v]) => `<span class="gen-part"><strong>${k}</strong> <span class="muted">${esc(v)}</span></span>`).join(" · ");
function genPick(name) {
  name = canonical(name);
  if (GEN.partner) { GEN.cmds.push(name); GEN.partner = false; } else GEN.cmds = [name];
  GEN.q = "";
  const w = commanderWants(GEN.cmds);
  GEN.themes = w.themes; GEN.tribes = [...w.tribes];
  const own = [];
  for (const n of GEN.cmds) { const c = cardOf(n); if (c && c.length > 8 && c[7] & T.creature) for (const t of c[8]) if (!own.includes(t)) own.push(t); }
  GEN.tribeOptions = [...w.tribes, ...own.filter(t => !w.tribes.includes(t))];
  renderBuild();
}
async function genGo() {
  if (!GEN.cmds.length || GEN.busy) return;
  GEN.busy = true; renderBuild();
  try { if (combosState === "idle") await loadCombos(); } catch {}
  if (GEN.hs) return genGoHotSwap();
  const st = hasStyles() ? styleOf(styleInUse(styleOptions(genOptsNow()), GEN.style)) : null;
  const opts = { ...genOptsNow(), ...(st ? { style: st.id, ...(GEN.lean === "style" ? { lean: "style" } : {}) } : {}) };
  const tpl = templateById(GEN.template);
  const res = generateBuild({ ...opts, template: tpl ? tpl.shape : null });
  const short = GEN.cmds[0].split(",")[0];
  const lean = [st ? st.name.toLowerCase() : "", GEN.pop !== POP_DEFAULT && hasPop() ? POP_NOTCHES[GEN.pop].toLowerCase() : ""].filter(Boolean).map(x => `, ${x}`).join("");
  const b = createBuild({ name: `${short} (generated${lean}${tpl ? ` like ${tpl.name}` : ""})`, cards: res.cards, commanders: opts.commanders, source: { kind: "generated", ...opts } });
  if (tpl) { b.templateId = tpl.id; b.targets = { lands: GEN.lands, roles: Object.fromEntries(templateSlots(tpl.shape, identityOf(opts.commanders))) }; }
  b.why = res.why; if (res.short) b.genShort = res.short;
  if (res.alwaysMissing && res.alwaysMissing.length) b.alwaysMissing = res.alwaysMissing;
  saveBuilds();
  genReset(); buildMode = "list"; renderBuild(); window.scrollTo({ top: 0 });
  const n = res.cards.reduce((t, c) => t + c.qty, 0);
  toast(res.short ? `Generated ${n} cards; your collection ran short by ${res.short}` : `Generated a ${n}-card deck from your collection`);
}
// A hot-swap: one build holding every version; b.cards is the first playstyle picked, the others wait in Swaps.
function genGoHotSwap() {
  const ids = [...GEN.hsIds], o = genOptsNow(), lean = GEN.lean === "style" ? { lean: "style" } : {};
  const res = hotSwapGenerate({ ...o, ...lean }, ids);
  if (!res.ok) { GEN.busy = false; renderBuild(); toast(res.why); return; }
  const active = ids[0], short = GEN.cmds[0].split(",")[0];
  const pop = GEN.pop !== POP_DEFAULT && hasPop() ? `, ${POP_NOTCHES[GEN.pop].toLowerCase()}` : "";
  const b = createBuild({ name: `${short} (hot-swap: ${ids.map(k => hsName(k).toLowerCase()).join(" / ")}${pop})`, cards: hotSwapCards(res, active), commanders: o.commanders,
    source: { kind: "generated", ...o, ...(active ? { style: active } : {}), ...lean } });
  b.hotswap = { styles: ids, active, core: res.core, packages: res.packages, whys: res.whys };
  b.why = { ...res.whys[active] }; if (res.short[active]) b.genShort = res.short[active];
  if (res.alwaysMissing && res.alwaysMissing.length) b.alwaysMissing = res.alwaysMissing;
  saveBuilds();
  genReset(); buildMode = "list"; renderBuild(); window.scrollTo({ top: 0 });
  toast(`Generated a hot-swap: ${hsNames(ids)}, ${res.swaps} swaps per switch`);
}
// Too different to swap quickly: the same picks as separate builds instead.
function genGoSeparate() {
  const ids = [...GEN.hsIds], o = genOptsNow(), short = GEN.cmds[0].split(",")[0];
  for (const k of ids) {
    const opts = { ...o, ...(k ? { style: k, ...(GEN.lean === "style" ? { lean: "style" } : {}) } : {}) }, res = generateBuild(opts);
    const pop = GEN.pop !== POP_DEFAULT && hasPop() ? `, ${POP_NOTCHES[GEN.pop].toLowerCase()}` : "";
    const b = createBuild({ name: `${short} (generated${k ? `, ${hsName(k).toLowerCase()}` : ""}${pop})`, cards: res.cards, commanders: o.commanders, source: { kind: "generated", ...opts } });
    b.why = res.why; if (res.short) b.genShort = res.short;
  }
  saveBuilds();
  genReset(); buildMode = "list"; renderBuild(); window.scrollTo({ top: 0 });
  toast(`Made ${ids.length} separate builds: ${hsNames(ids)}`);
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-gen], [data-gen-pick], [data-gen-theme], [data-gen-tribe], [data-gen-unhide], [data-gen-pop], [data-gen-mana], [data-gen-style], [data-gen-lean], [data-gen-hs], [data-fit-more]");
  if (!t) return;
  if (t.dataset.genPick) { FIT_ALL = false; return genPick(t.dataset.genPick); }
  if (t.hasAttribute("data-fit-more")) { FIT_ALL = !FIT_ALL; return renderBuild(); }
  if (t.dataset.genPop != null) { GEN.pop = +t.dataset.genPop; return renderBuild(); }
  if (t.dataset.genMana != null) { GEN.mana = t.dataset.genMana; return renderBuild(); }
  if (t.dataset.genHs != null) { GEN.hs = t.dataset.genHs === "1"; return renderBuild(); }
  if (t.dataset.genStyle != null) {
    const k = t.dataset.genStyle;
    if (!GEN.hs) GEN.style = k;
    else if (GEN.hsIds.includes(k)) GEN.hsIds = GEN.hsIds.filter(x => x !== k);
    else if (GEN.hsIds.length < 3) GEN.hsIds = [...GEN.hsIds, k];
    return renderBuild();
  }
  if (t.dataset.genLean != null) { GEN.lean = t.dataset.genLean; return renderBuild(); }
  if (t.dataset.genTheme != null) { GEN.themes ^= 1 << +t.dataset.genTheme; return renderBuild(); }
  if (t.dataset.genTribe != null) { const x = +t.dataset.genTribe; GEN.tribes = GEN.tribes.includes(x) ? GEN.tribes.filter(y => y !== x) : [...GEN.tribes, x]; return renderBuild(); }
  if (t.dataset.genUnhide) { setPref(t.dataset.genUnhide, { dismissed: 0, level: 0 }); GEN_IDEAS.clear(); return renderBuild(); }
  switch (t.dataset.gen) {
    case "go": genGo(); break;
    case "separate": genGoSeparate(); break;
    case "back": genReset(); renderBuild(); break;
    case "partner": GEN.partner = true; GEN.q = ""; renderBuild(); setTimeout(() => $("#gen-q") && $("#gen-q").focus(), 0); break;
  }
});
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-tpl-del]"); if (!t) return;
  const i = TEMPLATES.findIndex(x => x.id === t.dataset.tplDel); if (i < 0) return;
  const [gone] = TEMPLATES.splice(i, 1); saveTemplates(); if (GEN.template === gone.id) GEN.template = ""; renderBuild();
  toast(`Deleted the template “${gone.name}”`, "Undo", () => { gone.updated = Date.now(); TEMPLATES.splice(i, 0, gone); saveTemplates(); renderBuild(); });
});
document.addEventListener("input", e => {
  if (e.target.id === "gen-q") { GEN.q = e.target.value; const r = $("#gen-results"); if (r) r.innerHTML = genResultsHTML(); }
});
document.addEventListener("change", e => {
  if (e.target.dataset && e.target.dataset.gen === "decks") { GEN.useDecks = e.target.checked; if (!GEN.cmds.length) renderBuild(); else genPlanShow(); }
  if (e.target.id === "gen-lands") { GEN.lands = Math.max(28, Math.min(42, parseInt(e.target.value, 10) || 36)); genPlanShow(); }
  if (e.target.id === "gen-template") { GEN.template = e.target.value; const t = templateById(GEN.template); if (t) GEN.lands = Math.max(28, Math.min(42, t.shape.lands)); renderBuild(); }
});
// The plan line again after a choice that doesn't redraw the panel (the lands field keeps its focus).
function genPlanShow() { const el = $("#gen-plan"); if (el) el.innerHTML = genPlanHTML(); }
function genIdeasHTML(b) {
  const ideas = genIdeas(b); if (!ideas.length) return "";
  return `<div class="panel"><div class="section-head"><h3>Cards you don't own that would fit</h3></div>
    <div class="results">${ideas.map(x => `<button class="bres" data-sheet="idea" data-card="${esc(x.name)}"><span><strong>${esc(x.name)}</strong> <small>${esc(x.why)}${x.price ? " · " + money(x.price) : ""}</small></span><span class="add">Look</span></button>`).join("")}</div></div>`;
}
// "Not for this build" (dismiss: suggested a little less from now on) and "Never suggest" (block),
// on a generated build: the card makes way for the next best one. Both can be undone from the toast.
function restorePref(name, prev) { PREFS.cards[norm(name)] = { ...(prev || { name: canonical(name), dismissed: 0, blocked: false, level: 0 }), at: Date.now() }; savePrefs(); GEN_IDEAS.clear(); }
// One card makes way for the next best one (or just leaves, when nothing can replace it), and isn't suggested for this
// build again. Changes the build only: the caller records the dismissal or the taste, saves and offers Undo. → the
// replacement, or null.
function swapOut(b, name) {
  const i = b.cards.findIndex(c => norm(c.name) === norm(name)); if (i < 0) return null;
  b.notHere = [...(b.notHere || []), name];
  b.keep = (b.keep || []).filter(n => norm(n) !== norm(name));
  const rep = genReplacement(b, name);
  b.cards.splice(i, 1, ...(rep ? [{ name: rep.name, qty: 1 }] : []));
  b.why = { ...(b.why || {}) }; delete b.why[name]; if (rep) b.why[rep.name] = rep.why;
  return rep;
}
function genDrop(i, block) {
  const b = curBuild(); if (!b || !b.cards[i]) return;
  const name = b.cards[i].name, prev = prefOf(name) ? { ...prefOf(name) } : null;
  const beforeCards = b.cards.map(c => ({ ...c })), beforeWhy = { ...(b.why || {}) };
  setPref(name, block ? { level: -2 } : { dismissed: dismissCount(name) + 1 });
  GEN_IDEAS.clear();
  if (block && !(b.source && b.source.kind === "generated")) {      // a deck you made yourself keeps it
    rerenderCurrent();
    toast(`${name} won't be suggested again`, "Undo", () => { restorePref(name, prev); rerenderCurrent(); });
    return;
  }
  const beforeNotHere = [...(b.notHere || [])], beforeKeep = [...(b.keep || [])];
  const rep = swapOut(b, name);
  saveBuilds(); renderBuild();
  toast(rep ? `Swapped ${name} for ${rep.name}` : `Removed ${name}`, "Undo", () => {
    b.cards = beforeCards; b.why = beforeWhy; b.notHere = beforeNotHere; b.keep = beforeKeep; restorePref(name, prev); saveBuilds(); renderBuild();
  });
}

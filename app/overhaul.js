"use strict";
// Bulk Tutor, the page's script, part "overhaul": rapid overhauls, and hot-swaps in Assemble.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ rapid overhauls (Matt, Nov 9)
// Actions → Overhaul: keep most of a build's cards and lean into another theme, tribe or commander (engine overhaulOptions,
// overhaulSteps). You pick how many cards change (OVERHAUL.steps, 20 by default, or Fresh) and see how many fit the new plan at
// each. The result is a new build linked to the original (b.overhaul = {from, fromName, swaps, settled?}); the original stays as
// it was. Marking the overhaul built unmarks the original and asks what to keep of it: a build or a saved deck, never deleted.
let OH = null;   // the open sheet: { id: build id, tab: "plan" | "cmd", target: {kind, label, commanders, themes, tribes} | null, step, all }
const ohHome = b => buildHome(b) || (b.built ? builtMatch(b) : null) || null;
const firstName = n => String(n || "").split(",")[0];
function openOverhaul() { const b = curBuild(); if (!b) return; OH = { id: b.id, tab: "plan", target: null, step: null, all: false, as: "new" }; renderOverhaul(); openDlg($("#overhaul")); }
function closeOverhaul() { OH = null; closeDlg($("#overhaul")); const body = $("#overhaul-body"); if (body) body.innerHTML = ""; }
function renderOverhaul() {
  const body = $("#overhaul-body"), b = curBuild(); if (!body || !OH) return;
  if (!b || b.id !== OH.id) { closeOverhaul(); return; }
  const home = ohHome(b);
  if (!OH.target) {
    const o = overhaulOptions(b, home);
    const tabs = `<div class="seg seg-fill" role="group" aria-label="Lean into">${[["plan", "Theme or tribe"], ["cmd", "Commander"]].map(([k, n]) => `<button data-oh-tab="${k}" aria-pressed="${OH.tab === k}">${n}</button>`).join("")}</div>`;
    let list;
    if (OH.tab === "plan") {
      const ok = o.plans.filter(p => p.ok), off = o.plans.filter(p => !p.ok);
      list = (ok.length ? `<div class="results" id="oh-plans">${ok.map(p => `<button class="bres" data-oh-plan="${o.plans.indexOf(p)}"><span><strong>${esc(p.label)}</strong> <small>up to <span class="num">${p.fresh}</span> cards on plan · <span class="num">${p.before}</span> now</small></span><span class="add">Pick</span></button>`).join("")}</div>`
        : `<p class="muted small">None of the other themes or tribes have enough of your cards to lean into.</p>`)
        + (off.length ? `<details class="gen-hidden"><summary class="small">Not offered <span class="num">(${off.length})</span></summary>${styleOffHTML(off.map(p => [p.label, p.why]))}</details>` : "");
    } else {
      const ok = o.commanders.filter(c => c.ok), off = o.commanders.filter(c => !c.ok), shown = OH.all ? ok : ok.slice(0, 5);
      list = (ok.length ? `<div class="results" id="oh-cmds">${shown.map(c => `<button class="bres" data-oh-cmd="${o.commanders.indexOf(c)}"><span><strong>${esc(c.name)}</strong> <small>${pips(c.colors)} ${c.plan ? esc(c.plan) + " · " : ""}could keep <span class="num">${c.stay}</span> of these cards${c.inDeck ? ` · in ${esc(c.inDeck)}` : ""}</small></span><span class="add">Pick</span></button>`).join("")}</div>
          ${ok.length > 5 ? `<div class="actions"><button class="btn link" data-oh-all>${OH.all ? "Show fewer" : `Show all ${ok.length}`}</button></div>` : ""}`
        : `<p class="muted small">None of your other commanders that share a colour have enough of your cards for a deck.</p>`)
        + (off.length ? `<details class="gen-hidden"><summary class="small">Not offered <span class="num">(${off.length})</span></summary>${styleOffHTML(off.map(c => [c.name, c.why]))}</details>` : "");
    }
    body.innerHTML = `<h2 id="overhaul-title" tabindex="-1" autofocus>Overhaul</h2>
      <p class="muted small">Keep most of ${esc(b.name)} and lean into something else. You choose how many cards change; ramp, card draw and removal stay at their usual numbers. The original build stays as it is.</p>
      ${tabs}${list}
      <div class="sheet-pair"><button class="btn" data-oh-close>Close</button></div>`;
    return;
  }
  const t = OH.target, s = overhaulSteps(b, t, home), planned = !!(t.themes || t.tribes.length);
  if (OH.step == null || OH.step >= s.steps.length) OH.step = s.def;
  const st = s.steps[OH.step], plan = planned ? (t.kind === "cmd" ? planLabel({ themes: t.themes, tribes: t.tribes }) : t.label) : "";
  const canVer = versionsOk(b, t, st.swaps); if (!canVer) OH.as = "new";
  const stepName = x => x.fresh ? "Fresh" : x.fewest ? "Fewest" : String(x.swaps);
  body.innerHTML = `<h2 id="overhaul-title" tabindex="-1" autofocus>Overhaul into ${esc(t.kind === "cmd" ? firstName(t.label) : t.label)}</h2>
    ${planned ? `<p class="muted small">${esc(b.name)} has <span class="num">${s.before}</span> ${s.before === 1 ? "card" : "cards"} that fit ${esc(plan)} now.</p>` : ""}
    <p class="small"><strong>How many cards change</strong></p>
    <div class="seg seg-fill" role="group" aria-label="How many cards change" id="oh-steps">${s.steps.map((x, j) => `<button data-oh-step="${j}" aria-pressed="${j === OH.step}">${stepName(x)}</button>`).join("")}</div>
    <p class="small" id="oh-summary"><strong class="num">${st.swaps}</strong> ${st.swaps === 1 ? "card changes" : "cards change"}${planned ? `, and <strong class="num">${st.plan}</strong> ${st.plan === 1 ? "card fits" : "cards fit"} ${esc(plan)}` : ""}.${st.fresh ? (s.steps.length > 1 ? " A whole new deck from your cards." : " That's already all a fresh build changes.") : ` A fresh build would change ${s.fresh.swaps}${planned ? ` for ${s.fresh.plan} on plan` : ""}.`}</p>
    ${st.fewest ? `<p class="muted small">Cards outside ${esc(firstName(t.commanders[0]))}'s colours have to go, so this is the fewest.</p>` : ""}
    ${st.short ? `<p class="small warn-text">Your collection runs ${cardsWord(st.short)} short of a full deck.</p>` : ""}
    ${canVer ? `<p class="small"><strong>Keep it as</strong> <span class="muted">${OH.as === "version" ? `A second version of this build: switch between them in Assemble, with the cards not in use kept in “${esc(swapsLocName(b))}”.` : "A new build. This one stays as it is."}</span></p>
      <div class="seg seg-fill" role="group" aria-label="Keep it as" id="oh-as">${[["new", "A new build"], ["version", "A version of this build"]].map(([k, n]) => `<button data-oh-as="${k}" aria-pressed="${OH.as === k}">${n}</button>`).join("")}</div>` : ""}
    <div class="sheet-pair"><button class="btn" data-oh-back>Back</button><button class="btn primary" data-oh-go>${OH.as === "version" ? "Add the version" : "Make the overhaul"}</button></div>`;
}
renderOverhaul = withFocus(renderOverhaul, "#overhaul");
function overhaulGo() {
  const b = curBuild(); if (!b || !OH || !OH.target) return;
  const t = OH.target, s = overhaulSteps(b, t, ohHome(b)), st = s.steps[OH.step != null ? OH.step : s.def], { keep, exclude, targets, ...src } = s.opts;
  if (OH.as === "version" && versionsOk(b, t, st.swaps)) {
    const { short, alwaysMissing, ...hs } = overhaulVersions(b, st, t, t.label);
    b.hotswap = hs; touchBuild(); closeOverhaul(); window.scrollTo({ top: 0 });
    toast(`Added ${t.label} as a version: ${cardsWord(st.swaps)} to switch`, "Assemble", () => { buildMode = "pull"; store.set("bt.buildmode", buildMode); renderBuild(); window.scrollTo({ top: 0 }); });
    return;
  }
  const name = t.kind === "cmd" ? `${firstName(src.commanders[0])} (overhaul of ${firstName(b.commanders[0] || b.name)})` : `${firstName(src.commanders[0])} (overhaul: ${t.label.toLowerCase()})`;
  // The sideboard comes along as it is: the overhaul never used its cards (overhaulOpts), and they aren't "dropped" ones.
  const nb = createBuild({ name, cards: st.cards, commanders: src.commanders, side: copyCards(sideOf(b)), source: { kind: "generated", ...src } });
  const sk = sideKeys(b), dropped = exclude.filter(n => !sk.has(norm(n)));
  nb.why = st.why; if (keep.length) nb.keep = [...keep]; if (dropped.length) nb.notHere = dropped; if (targets) nb.targets = JSON.parse(JSON.stringify(targets));
  if (st.short) nb.genShort = st.short; if (st.alwaysMissing && st.alwaysMissing.length) nb.alwaysMissing = st.alwaysMissing;
  nb.overhaul = { from: b.id, fromName: b.name, swaps: st.swaps };
  saveBuilds(); closeOverhaul(); renderBuild(); window.scrollTo({ top: 0 });
  toast(`Made an overhaul of ${b.name}: ${cardsWord(st.swaps)} change`, "Assemble", () => { buildMode = "pull"; store.set("bt.buildmode", buildMode); renderBuild(); window.scrollTo({ top: 0 }); });
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("#overhaul button");
  if (!t) { if (e.target.id === "overhaul") closeOverhaul(); return; }
  const ds = t.dataset, b = curBuild();
  if (ds.ohClose != null) return closeOverhaul();
  if (ds.ohGo != null) return overhaulGo();
  if (ds.ohTab) { OH.tab = ds.ohTab; return renderOverhaul(); }
  if (ds.ohAll != null) { OH.all = !OH.all; return renderOverhaul(); }
  if (ds.ohBack != null) { OH.target = null; OH.step = null; return renderOverhaul(); }
  if (ds.ohStep != null) { OH.step = +ds.ohStep; return renderOverhaul(); }
  if (ds.ohAs) { OH.as = ds.ohAs; return renderOverhaul(); }
  if (!b) return;
  const o = overhaulOptions(b, ohHome(b));
  if (ds.ohPlan != null) { const p = o.plans[+ds.ohPlan]; OH.target = { kind: p.kind, label: p.label, commanders: buildOpts(b).commanders, themes: p.themes, tribes: p.tribes }; }
  else if (ds.ohCmd != null) { const c = o.commanders[+ds.ohCmd], w = commanderWants([c.name]); OH.target = { kind: "cmd", label: c.name, commanders: [c.name], themes: w.themes, tribes: w.tribes }; }
  else return;
  OH.step = null; renderOverhaul();
});
// Under an overhaul's header: where it came from (and a way back to the original); once it's built, what to keep of the original.
function overhaulNoteHTML(b) {
  const oh = b.overhaul; if (!oh) return "";
  const orig = BUILDS.find(x => x.id === oh.from);
  if (b.built) return orig && !oh.settled ? `<div class="banner info" id="oh-prompt"><span><strong>${esc(orig.name)}</strong> is now this deck, so it isn't built any more. Keep its list as a build, or move it to your saved decks?</span>
      <span class="actions"><button class="btn" data-oh-keep="build">Keep as a build</button><button class="btn" data-oh-keep="saved">Move to saved decks</button></span></div>` : "";
  const home = buildHome(b);
  return `<p class="muted small oh-note">An overhaul of <strong>${esc(oh.fromName)}</strong>: ${cardsWord(oh.swaps)} change.${home ? ` Assemble lists what to take out of ${esc(locName(home))} and what to put in.` : ""}${orig ? ` <button class="btn link small" data-oh-open="${esc(orig.id)}">Open the original</button>` : ""}</p>`;
}
// Marking an overhaul built: the original deck is now this one, so the original isn't built any more (Matt, Nov 9).
function overhaulBuilt(b) {
  const orig = b.overhaul && BUILDS.find(x => x.id === b.overhaul.from);
  if (orig && orig.built) { delete orig.built; orig.updated = Date.now(); }
}
// The prompt's answer: keep the original's list as a build (no longer tied to the deck), or move it to saved decks (undoable).
function overhaulKeep(b, how) {
  const oh = b.overhaul, i = oh ? BUILDS.findIndex(x => x.id === oh.from) : -1; if (i < 0) return;
  const orig = BUILDS[i];
  if (how === "build") {
    delete orig.built; delete orig.builtLoc;
    if (orig.source && orig.source.kind === "owned") orig.source = { kind: "kept", was: orig.source };
    else if (orig.source && orig.source.home) delete orig.source.home;
    orig.updated = Date.now(); oh.settled = "build"; touchBuild(); toast(`Kept “${orig.name}” as a build`);
    return;
  }
  const had = savedFor(orig), d = had || saveDeck({ name: orig.name, cards: orig.cards, commanders: orig.commanders, companion: orig.companion, side: sideOf(orig), from: "build" });
  BUILDS.splice(i, 1); oh.settled = "saved"; touchBuild();
  toast(`Moved “${orig.name}” to your saved decks`, "Undo", () => {
    orig.updated = Date.now(); BUILDS.splice(Math.min(i, BUILDS.length), 0, orig); delete oh.settled;
    if (!had) { SAVED = SAVED.filter(x => x.id !== d.id); saveSaved(); }
    touchBuild();
  });
}

// ------------------------------------------------------------ hot-swaps in Assemble (Matt, Nov 9)
// "Switch to" another version lists what goes into Swaps and what comes out of it; "Done" plays it (undoable, and in Changes).
// Below the usual list, the other versions' cards, to gather once into the Swaps binder.
let HS_TO = null, HS_TO_ID = null;     // the version picked to switch to, and for which build
const qtySum = l => l.reduce((t, c) => t + c.qty, 0);
// The binder to keep the swaps in: named after the deck once it's built, otherwise after the commander.
const swapsLocName = b => swapsLocFor(builtMatch(b) || (b.commanders[0] || b.name).split(",")[0]);
function hsAssembleHTML(b) {
  const hs = b.hotswap;
  if (HS_TO_ID !== b.id || HS_TO == null || !(HS_TO in hs.packages) || HS_TO === hs.active) { HS_TO = HS_TO_ID === b.id && HS_TO !== hs.active && HS_TO in hs.packages ? HS_TO : null; HS_TO_ID = b.id; }
  const others = hs.styles.filter(k => k !== hs.active), loc = swapsLocName(b);
  const row = c => `<div class="line"><span class="name">${c.qty > 1 ? `<span class="num">${c.qty}×</span> ` : ""}${esc(c.name)}</span></div>`;
  let plan = "";
  if (HS_TO != null) {
    const p = swapPlan(b, HS_TO);
    plan = `<div class="hs-plan">
        <div><h4 class="subhead">Take out <span class="muted small">into ${esc(loc)} · <span class="num">${qtySum(p.out)}</span></span></h4><div class="list">${p.out.map(row).join("")}</div></div>
        <div><h4 class="subhead">Put in <span class="muted small">from ${esc(loc)} · <span class="num">${qtySum(p.in)}</span></span></h4><div class="list">${p.in.map(row).join("")}</div></div>
      </div>
      <div class="actions"><button class="btn primary" data-hs-done="${esc(HS_TO)}">Done: playing ${esc(hsLabel(hs, HS_TO))}</button></div>`;
  }
  return `<div class="panel" id="hs-panel">
      <div class="section-head"><h3>${hs.versions ? "Versions" : "Hot-swap"}</h3><span class="muted small">playing ${esc(hsLabel(hs, hs.active))}</span></div>
      <p class="muted small">The cards this version doesn't use live in a binder named “${esc(loc)}” (“${esc(loc.replace(" · ", " "))}” works too), so they count as in use. Switch to:</p>
      <div class="seg seg-fill" role="group" aria-label="Switch to">${others.map(k => `<button data-hs-to="${esc(k)}" aria-pressed="${HS_TO === k}">${esc(hsLabel(hs, k))}</button>`).join("")}</div>
      ${plan}</div>`;
}
function hsSwapsPanelHTML(b) {
  const cards = swapsCards(b); if (!cards.length) return "";
  const loc = swapsLocName(b);
  return `<details class="panel" id="hs-swaps"><summary class="section-head"><h3>For ${esc(loc)}</h3><span class="muted small num">${qtySum(cards)}</span></summary>
      <p class="muted small">The other versions' cards. Gather them once into ${esc(loc)}; after that, switching only moves cards between it and the deck.</p>
      ${groupsHTML(pullGroups(cards, null))}</details>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-hs-to], [data-hs-done]"); if (!t) return;
  const b = curBuild(); if (!b || !b.hotswap) return;
  if (t.dataset.hsTo != null) { HS_TO = HS_TO === t.dataset.hsTo ? null : t.dataset.hsTo; HS_TO_ID = b.id; return renderBuild(); }
  const to = t.dataset.hsDone, was = b.hotswap.active;
  const name = id => hsLabel(b.hotswap, id);
  HISTORY_WHY = `Switched to ${name(to)}`;
  if (!hotSwapSwitch(b, to)) return;
  // A built deck's cards follow the switch here (0.53.0): between the deck and its Swaps location.
  const follow = () => { if (b.builtLoc && ownColl() && locHasCards(b.builtLoc)) settleBuilt(b, b.builtLoc); };
  HS_TO = null; saveBuilds(); follow(); renderBuild();
  toast(`Playing ${name(to)}. Move the cards in ManaBox too, so your collection matches.`, "Undo", () => { HISTORY_WHY = `Switched back to ${name(was)}`; hotSwapSwitch(b, was); saveBuilds(); follow(); renderBuild(); });
});

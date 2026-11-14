"use strict";
// Bulk Tutor, the page's script, part "tune": tuning: the screen for build mode "tune".
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ tuning: the screen (build mode "tune")
function tuneMainHTML(b) {
  if (TUNE.id !== b.id) TUNE = tuneFresh(b.id);
  if (!DATA || !hasRoles()) return `<div class="panel"><h3>Tune this deck</h3><p class="muted">Tuning needs card roles, which come with the card data. Try again after the next data refresh.</p></div>`;
  if (!b.commanders.length) return `<div class="panel"><h3>Tune this deck</h3><p class="muted">Choose a commander first (${MARK.commander} on a card in Edit list), so tuning knows the deck's colours.</p></div>`;
  if (combosState === "idle") loadCombos().then(() => { TUNE_CACHE.clear(); if (view === "build" && buildMode === "tune") renderBuild(); }).catch(() => {});
  const choices = tuneDialChoices(b);
  if (!choices.some(c => c[0] === TUNE.dial)) TUNE.dial = choices[0][0];
  const opts = buildOpts(b), gen = b.source && b.source.kind === "generated";
  const plan = TUNE.steps.length ? tunePlan(b, TUNE.steps, TUNE.alt) : null;
  const n = plan ? plan.swaps.filter((_, i) => !TUNE.off.has(i)).length : 0;
  const where = st => st.kind === "free" ? esc(stName(st)) : st.kind === "indeck" ? `<span class="warn">in deck: ${esc(stName(st))}</span>` : st.kind === "basic" ? "basic land" : st.kind === "here" ? "in this deck" : "";
  const asked = TUNE.steps.length ? `<p class="small tune-asked"><strong>You asked for:</strong> ${TUNE.steps.map((s, i) => `<span class="chip">${esc(stepLabel(b, s))} <button class="chip-x" data-tune-undo="${i}" aria-label="Remove “${esc(stepLabel(b, s))}”">${MARK.removeRow}</button></span>`).join(" ")}</p>` : "";
  const swapsHTML = plan ? `<div class="panel" id="tune-plan">
      <div class="section-head"><h3>Suggested swaps</h3><span class="muted small num">${plan.swaps.length}</span></div>
      ${asked}
      ${plan.swaps.length ? `<div class="tune-swaps">${plan.swaps.map((s, i) => tuneSwapHTML(b, s, i, where)).join("")}</div>` : ""}
      ${plan.notes.map(x => `<p class="small"><strong>${esc(x.label)}:</strong> ${esc(x.text)}${x.ideas && x.ideas.length ? ` <span class="muted">Cards that would: ${x.ideas.map(esc).join(", ")}.</span>` : ""}</p>`).join("")}
      <div class="actions split"><button class="btn primary" data-tune="apply"${n ? "" : " disabled"}>Apply ${n ? `${n} ${n === 1 ? "swap" : "swaps"}` : "swaps"}</button><button class="btn" data-tune="clear">Start over</button></div>
    </div>` : "";
  const always = Object.values(PREFS.cards).filter(p => p.level === 2 && !b.cards.some(c => norm(c.name) === norm(p.name)))
    .map(p => cardOf(p.name)).filter(c => c && legalCard(c) && fitsIdentity(c, identityOf(opts.commanders)));
  const alwaysHTML = always.length ? `<p class="small"><strong>Your Always cards that fit but aren't here</strong></p>
    <div class="results">${always.map(c => { const st = cardStatus(c[0], 1, buildHome(b)); return `<button class="bres" data-addname="${esc(c[0])}"><span><strong>${esc(c[0])}</strong> <small>${where(st) || "not in your collection"}</small></span><span class="add">Add</span></button>`; }).join("")}</div>` : "";
  return `<div class="panel">
      <h3>Tune this deck</h3>
      <p class="muted small">Pick what's been happening in your games, or what you want more or less of. Each tap suggests a few swaps from cards you own; nothing changes until you apply them. Cards you kept, your Always cards and combo pieces stay put.</p>
      <p class="small"><strong>What's been happening?</strong></p>
      <div class="results">${TUNE_SYMPTOMS.filter(x => x.id !== "theme" || opts.themes || (opts.tribes || []).length).map(x => `<button class="bres" data-tune-symptom="${x.id}"><span><strong>${esc(x.label)}</strong> <small>${esc(x.hint)}</small></span><span class="add">Suggest</span></button>`).join("")}</div>
      <p class="small"><strong>More or less of something</strong></p>
      <div class="field"><label for="tune-dial">Job, theme or lands</label><select id="tune-dial">${choices.map(([k, l]) => `<option value="${esc(k)}"${k === TUNE.dial ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="actions split"><button class="btn" data-tune-dial="-1">Less</button><button class="btn" data-tune-dial="1">More</button></div>
      ${TEMPLATES.length ? `<p class="small"><strong>Compare with a template</strong></p>
        <div class="field"><label for="tune-template">Template</label><select id="tune-template"><option value="">None</option>${TEMPLATES.map(t => `<option value="${esc(t.id)}"${b.templateId === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        ${templateById(b.templateId) ? `<div class="actions"><button class="btn" data-tune-closer="${esc(b.templateId)}">Move closer to it</button></div>` : ""}` : ""}
      <label class="check"><input type="checkbox" data-tune="decks"${opts.useDecks ? " checked" : ""}> Also use cards that are in your other decks</label>
      ${alwaysHTML}
      ${gen ? `<p class="small"><strong>Regenerate</strong> <span class="muted">builds the deck again with today's collection, your taste and the targets your tuning set. Kept cards stay; cards you dropped stay out.</span></p>
        <div class="actions"><button class="btn" data-tune="regen">Regenerate this build</button></div>
        ${hasPop() ? `${popDialHTML(opts.pop, "data-tune-pop", opts.mana, "data-tune-mana")}<p class="muted small">Picking another notch${opts.pop > POP_DEFAULT ? " or mana choice" : ""} regenerates the deck.</p>` : ""}
        ${!hasStyles() ? "" : b.hotswap ? `<p class="small"><strong>${b.hotswap.versions ? "Versions" : "Hot-swap"}</strong> <span class="muted">${esc(hsLabels(b.hotswap, b.hotswap.styles))}, playing ${esc(hsLabel(b.hotswap, b.hotswap.active))}. Switch versions in Assemble. Regenerating builds every version again with its own ${b.hotswap.versions ? "plan" : "playstyle"}.</span></p>`
          : `${styleDialHTML(opts.style, opts.lean, !!(opts.themes || (opts.tribes || []).length), "data-tune-style", "data-tune-lean", styleOptions(opts), opts.style || "")}<p class="muted small">Picking another playstyle regenerates the deck with it.</p>`}` : ""}
    </div>${swapsHTML}`;
}
function tuneSwapHTML(b, s, i, where) {
  const open = TUNE.open.has(i), off = TUNE.off.has(i);
  const altBtns = (names, side) => names.map(n => `<button class="swap-opt" data-tune-alt="${side}:${i}" data-with="${esc(n)}"><strong>${esc(n)}</strong></button>`).join("");
  const why = open ? `<div class="tune-why" id="tune-why-${i}">
      <p class="small"><strong>Why ${esc(s.out)} goes:</strong> ${explainCard(b, s.out, "out", s.cutSpec).map(esc).join(" · ") || esc(s.outWhy || "a land the deck can spare")}</p>
      ${s.outAlts.length ? `<p class="small muted">Take out instead:</p><div class="actions">${altBtns(s.outAlts, "out")}</div>` : ""}
      <p class="small"><strong>Why ${esc(s.in)} comes in:</strong> ${[esc(s.label), ...explainCard(b, s.in, "in", s.addSpec).map(esc), where(s.inSt)].filter(Boolean).join(" · ")}</p>
      ${s.inAlts.length ? `<p class="small muted">Bring in instead:</p><div class="actions">${altBtns(s.inAlts, "in")}</div>` : ""}
    </div>` : "";
  return `<div class="tune-swap${off ? " off" : ""}">
    <div class="tune-row">
      <label class="tune-pick"><input type="checkbox" data-tune-swap="${i}"${off ? "" : " checked"} aria-label="Swap ${esc(s.out)} for ${esc(s.in)}">
        <span class="tune-pair"><span class="tune-out"><small class="eyebrow">Out</small> <strong>${esc(s.out)}</strong>${s.outWhy ? `<small class="muted">${esc(s.outWhy)}</small>` : ""}</span>
        <span class="tune-arrow" aria-hidden="true">${MARK.becomes}</span>
        <span class="tune-in"><small class="eyebrow">In</small> <strong>${esc(s.in)}</strong><small class="muted">${[esc(s.inWhy), where(s.inSt)].filter(Boolean).join(" · ")}</small></span></span>
      </label>
      <button class="info-btn" data-tune-why="${i}" aria-expanded="${open}" aria-controls="tune-why-${i}" aria-label="Why this swap" title="Why this swap">${MARK.info}</button>
    </div>${why}</div>`;
}
function tuneAddStep(step) {
  const b = curBuild(); if (!b) return;
  if (TUNE.id !== b.id) TUNE = tuneFresh(b.id);
  TUNE.steps.push(step);
  renderBuild();
  const p = $("#tune-plan"); if (p) p.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
// Regenerate a generated build. prev: the source fields a dial just changed, as they were (so Undo restores them), and label: what changed.
function tuneRegenerate(b, prev, label) {
  const src = b.source || {}, before = { cards: b.cards.map(c => ({ ...c })), why: { ...(b.why || {}) }, genShort: b.genShort, hotswap: b.hotswap ? JSON.parse(JSON.stringify(b.hotswap)) : null };
  const tpl = src.kind === "generated" ? templateById(b.templateId) : null;
  const opts = { ...buildOpts(b), lands: (b.targets && b.targets.lands) || src.lands || 36, keep: b.keep || [], exclude: [...(b.notHere || []), ...sideOf(b).map(c => c.name)], targets: b.targets, whyKept: b.why, template: tpl ? tpl.shape : null };
  let res;
  if (b.hotswap && b.hotswap.versions) {
    // An overhaul's versions: the first plan afresh, then the overhaul from it at about the same number of swaps.
    const hs = b.hotswap, h = versionsRegenerate(b, { ...opts, template: null });
    Object.assign(hs, { core: h.core, packages: h.packages, whys: h.whys });
    res = { cards: hotSwapCards(h, hs.active), why: { ...h.whys[hs.active] }, short: h.short[hs.active], alwaysMissing: h.alwaysMissing };
  } else if (b.hotswap) {
    // Every version again, each with its own playstyle's quotas (tuned job targets would flatten them; lands still count).
    const hs = b.hotswap, h = hotSwapGenerate({ ...opts, targets: b.targets && b.targets.lands ? { lands: b.targets.lands } : undefined, template: null }, hs.styles);
    Object.assign(hs, { core: h.core, packages: h.packages, whys: h.whys });
    res = { cards: hotSwapCards(h, hs.active), why: { ...h.whys[hs.active] }, short: h.short[hs.active], alwaysMissing: h.alwaysMissing };
  } else res = generateBuild(opts);
  b.cards = res.cards; b.why = res.why; if (res.short) b.genShort = res.short; else delete b.genShort;
  b.alwaysMissing = res.alwaysMissing && res.alwaysMissing.length ? res.alwaysMissing : undefined;
  TUNE_CACHE.clear(); GEN_IDEAS.clear(); TUNE = tuneFresh(b.id);
  const lean = label ? ` ${label}` : "";
  HISTORY_WHY = "Regenerated" + lean; saveBuilds(); renderBuild();
  toast(`Regenerated this build${lean}`, "Undo", () => {
    b.cards = before.cards; b.why = before.why; if (before.genShort) b.genShort = before.genShort; else delete b.genShort;
    if (before.hotswap) b.hotswap = before.hotswap;
    for (const [k, v] of Object.entries(prev || {})) { if (v == null) delete src[k]; else src[k] = v; }
    saveBuilds(); renderBuild();
  });
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-tune], [data-tune-symptom], [data-tune-dial], [data-tune-undo], [data-tune-why], [data-tune-alt], [data-tune-closer], [data-tune-pop], [data-tune-mana], [data-tune-style], [data-tune-lean]");
  if (!t) return;
  const b = curBuild(); if (!b) return;
  if (t.dataset.tunePop != null) {
    const src = b.source || {}, k = +t.dataset.tunePop, was = src.pop != null ? src.pop : POP_DEFAULT;
    if (src.kind !== "generated" || k === was) return;
    src.pop = k; return tuneRegenerate(b, { pop: was }, `at ${POP_NOTCHES[k]}`);
  }
  if (t.dataset.tuneMana != null) {
    const src = b.source || {}, k = t.dataset.tuneMana === "best" ? "best" : "", was = src.mana === "best" ? "best" : "";
    if (src.kind !== "generated" || k === was) return;
    if (k) src.mana = k; else delete src.mana;
    return tuneRegenerate(b, { mana: was || undefined }, k ? "with the best mana you own" : "with mana that follows the dial");
  }
  if (t.dataset.tuneStyle != null || t.dataset.tuneLean != null) {
    const src = b.source || {}; if (src.kind !== "generated") return;
    const prev = { style: src.style, lean: src.lean };
    if (t.dataset.tuneStyle != null) { const k = t.dataset.tuneStyle; if ((src.style || "") === k) return; if (k) src.style = k; else delete src.style; }
    else { const k = t.dataset.tuneLean; if ((src.lean || "") === k) return; if (k) src.lean = k; else delete src.lean; }
    const st = styleOf(src.style);
    return tuneRegenerate(b, prev, t.dataset.tuneStyle != null ? (st ? `as ${st.name.toLowerCase()}` : "as balanced") : `leaning into the ${src.lean === "style" ? "playstyle" : "theme"}`);
  }
  if (t.dataset.tuneSymptom) return tuneAddStep({ symptom: t.dataset.tuneSymptom });
  if (t.dataset.tuneCloser) return tuneAddStep({ template: t.dataset.tuneCloser });
  if (t.dataset.tuneDial) return tuneAddStep({ dial: TUNE.dial, dir: +t.dataset.tuneDial });
  if (t.dataset.tuneUndo != null) { TUNE.steps.splice(+t.dataset.tuneUndo, 1); TUNE.off = new Set(); TUNE.alt = {}; TUNE.open = new Set(); return renderBuild(); }
  if (t.dataset.tuneWhy != null) { const i = +t.dataset.tuneWhy; if (TUNE.open.has(i)) TUNE.open.delete(i); else TUNE.open.add(i); return renderBuild(); }
  if (t.dataset.tuneAlt) {
    // A runner-up replaces this swap's card; later swaps are worked out again around it.
    const [side, i] = t.dataset.tuneAlt.split(":"), n = +i;
    for (const k of Object.keys(TUNE.alt)) if (+k.split(":")[1] > n) delete TUNE.alt[k];
    TUNE.alt[side + ":" + n] = t.dataset.with;
    renderBuild(); return;
  }
  switch (t.dataset.tune) {
    case "apply": {
      const plan = tunePlan(b, TUNE.steps, TUNE.alt), n = plan.swaps.filter((_, i) => !TUNE.off.has(i)).length; if (!n) return;
      const before = tuneApply(b, plan, TUNE.off, TUNE.steps);
      HISTORY_WHY = `Tuned: ${n} ${n === 1 ? "swap" : "swaps"}`; saveBuilds();
      TUNE = tuneFresh(b.id); renderBuild(); window.scrollTo({ top: 0 });
      toast(`Applied ${n} ${n === 1 ? "swap" : "swaps"}`, "Undo", () => { b.cards = before.cards; b.why = before.why; if (before.targets) b.targets = before.targets; else delete b.targets; TUNE_CACHE.clear(); saveBuilds(); renderBuild(); });
      break;
    }
    case "clear": TUNE = tuneFresh(b.id); renderBuild(); break;
    case "regen": tuneRegenerate(b); break;
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "tune-dial") TUNE.dial = t.value;
  else if (t.id === "tune-template") { const b = curBuild(); if (!b) return; if (t.value) b.templateId = t.value; else delete b.templateId; saveBuilds(); renderBuild(); }
  else if (t.dataset && t.dataset.tuneSwap != null) { const i = +t.dataset.tuneSwap; if (t.checked) TUNE.off.delete(i); else TUNE.off.add(i); renderBuild(); }
  else if (t.dataset && t.dataset.tune === "decks") { const b = curBuild(); if (!b) return; b.tuneOpts = { ...(b.tuneOpts || {}), useDecks: t.checked }; TUNE_CACHE.clear(); saveBuilds(); renderBuild(); }
});

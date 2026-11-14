"use strict";
// Bulk Tutor, the page's script, part "filing": filing rules (where cards go when you put them away): keeping them, how a rule reads, Settings' Filing rules, and the sheet that adds or changes one.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ filing rules (0.70.0, the review's step 6)
// Matt, Nov 11: "something like email apps sorting rules, where cards being imported, removed from decks, or moved can
// optionally be automatically sorted by those rules. Maybe just a sequential style, 'if a card has x characteristic,
// put it in this spot'." The rules and how a copy is read against them are the engine's (RULES, setRules, ruleFits,
// ruleFor, rulesSkipped); the put-away list asks the engine where each card goes (putAwayPlan) and draws it
// (putaway.js). Here: bt.rules, synced in builds.json and backups as `rules`, the newer set winning whole (`at`).
// A rule's place is a location as the import names it, like every other record of a location; screens draw locName.
function loadRules() { try { setRules(JSON.parse(store.get("bt.rules") || "null")); } catch { setRules(null); } }
function saveRules(fromSync) { store.set("bt.rules", JSON.stringify(RULES)); if (!fromSync) syncSoon(); }
function changeRules(list, rest = RULES.rest) { setRules({ list, rest, at: Date.now() }); saveRules(); }
const rulesAny = () => RULES.list.length > 0 || !!RULES.rest;

// What a rule reads, in the order the sheet offers it, and each one's choices.
const RULE_FIELDS = [["price", "Price"], ["type", "Card type"], ["color", "Color"], ["mv", "Mana value"], ["name", "Name"], ["set", "Set of your copy"], ["rar", "Rarity of your copy"], ["foil", "Finish of your copy"]];
const RULE_OPS = { price: [["ge", "is at least"], ["lt", "is under"]], mv: [["ge", "is at least"], ["le", "is at most"], ["eq", "is exactly"]], name: [["starts", "starts with"], ["has", "contains"]] };
const RULE_TYPE_CHOICES = [["basic", "Basic land"], ...["C", "I", "S", "A", "E", "P", "B", "L"].map(t => [t, TYPE_SINGULAR[t]])];
const RULE_COLOR_CHOICES = ["W", "U", "B", "R", "G", "M", "C"].map(c => [c, COLOR_NAMES[c]]);
const RULE_FOIL_CHOICES = [["foil", "Foil"], ["non", "Not foil"]];
const RULE_HINTS = {
  price: () => `Your copy's own printing and finish, in ${CUR_NAME[CURRENCY]}. A card with no price fits no price rule.`,
  type: () => "A basic land is also a land: put the rule for basic lands above one for lands.",
  color: w => (w && w.by === "id" ? "Every color in the card's cost and rules text, as Commander counts it: a Mountain is red, a Boros Signet is multicolor, and a land that makes no colored mana is colorless."
    : "The colors in the card's cost, so every land is colorless. Color identity reads lands by the colors they make."),
  mv: () => "Lands are left out.",
  name: () => "Capitals and accents don't matter.",
  set: () => "The set your import names for each copy.",
  rar: () => "The rarity of the printing you have.",
  foil: () => "Foil takes etched foils too.",
};
// A rule in words, as plain text (escape it where it is drawn: a name rule holds what was typed).
function ruleText(r) {
  if (!r) return "Everything else";
  const v = r.v;
  if (r.f === "price") return r.op === "lt" ? `Under ${money(v)}` : `${money(v)} or more`;
  if (r.f === "type") return v === "basic" ? "Basic lands" : TYPE_NAMES[v] || "Cards";
  if (r.f === "color") return r.by === "id" ? `Color identity: ${(COLOR_NAMES[v] || v).toLowerCase()}` : `${COLOR_NAMES[v] || v} cards`;
  if (r.f === "mv") return `Mana value ${v}${r.op === "le" ? " or less" : r.op === "eq" ? "" : " or more"}`;
  if (r.f === "name") return `Name ${r.op === "has" ? "contains" : "starts with"} “${v}”`;
  if (r.f === "set") { const n = setName(v), code = String(v).toUpperCase(); return `From ${n}${n !== code ? ` (${code})` : ""}`; }
  if (r.f === "rar") return `${RARITY_NAMES[v] || v} printings`;
  if (r.f === "foil") return v === "foil" ? "Foils" : "Cards that aren't foil";
  return "";
}
const ruleById = id => (id === "rest" ? null : RULES.list.find(r => r.id === id) || null);
const RULE_STATE = { deck: loc => `${locName(loc)} holds a deck now`, gone: loc => `${locName(loc)} isn't in your collection` };
// The sets among your copies, newest first (the browser's copy filters list them the same way).
function ruleSets() {
  const sets = new Set(); for (const e of COLL ? COLL.entries : []) if (e.set) sets.add(e.set);
  const when = code => { const s = setOf(code); return s ? s.released : ""; };
  return [...sets].sort((a, b) => when(b).localeCompare(when(a)) || setName(a).localeCompare(setName(b)));
}

// ---- Settings › Filing rules: the rules in order (a row opens its rule; the arrows move it), "Everything else", and
// what the rules would do with the cards already in your boxes (engine rulesTrial), so a rule can be seen to match
// how you file before any card passes through the pile.
function filingRowHTML(r, i, skipped) {
  const sk = skipped.get(r.id), last = RULES.list.length - 1, text = ruleText(r);
  return `<li class="rule-row${sk ? " skipped" : ""}" data-rule="${esc(r.id)}">
    <button class="rule-main" data-rule-edit="${esc(r.id)}" aria-label="Rule ${i + 1}: ${esc(text)}, to ${esc(locName(r.to))}. Change it">
      <span class="rule-n num" aria-hidden="true">${i + 1}</span>
      <span class="rule-text"><strong>${esc(text)}</strong><small>${MARK.becomes} ${esc(locName(r.to))}</small>${sk ? `<small class="warn-text">Passed over: ${esc(RULE_STATE[sk](r.to))}</small>` : ""}</span></button>
    <button class="icon" data-rule-up="${esc(r.id)}" aria-label="Move rule ${i + 1} up"${i ? "" : " disabled"}>${MARK.sortUp}</button>
    <button class="icon" data-rule-down="${esc(r.id)}" aria-label="Move rule ${i + 1} down"${i < last ? "" : " disabled"}>${MARK.sortDown}</button></li>`;
}
function filingTrialHTML() {
  if (!rulesAny() || !ownColl()) return "";
  const t = rulesTrial(); if (!t.total) return "";
  const n = x => x.toLocaleString();
  return `<p class="muted small" id="rule-trial">Tried on the <span class="num">${n(t.total)}</span> ${t.total === 1 ? "card" : "cards"} in your boxes and binders: <span class="num">${n(t.same)}</span> ${t.same === 1 ? "is" : "are"} already where these rules would put ${t.same === 1 ? "it" : "them"}${t.placed - t.same ? `, <span class="num">${n(t.placed - t.same)}</span> would go somewhere else` : ""}${t.none ? `, and no rule fits <span class="num">${n(t.none)}</span>` : ""}. Rules only place cards that are in “${esc(PUT_AWAY)}”: nothing asks you to move a card that is already put away.</p>`;
}
// Rules name your own boxes, so they are set up on your own collection, not on the example or one opened from a link.
const rulesOffered = () => ownColl() || rulesAny();
function filingPanelHTML() {
  const places = ownColl() ? putAwayPlaces() : [];
  if (!ownColl() && !rulesAny()) return `<p class="muted small" id="rule-none">Filing rules send the cards you put away to the right box or binder: by price, type, color and more. Import your collection to set them up.</p>`;
  const skipped = new Map(rulesSkipped().map(s => [s.id, s.state])), rest = RULES.rest, restGone = rest && skipped.get("rest");
  return `<p class="muted small">Where cards go when you put them away. For each card, the first rule that fits decides. A card no rule fits goes back where it came from, or beside another copy.</p>
    ${RULES.list.length ? `<ol class="rule-list">${RULES.list.map((r, i) => filingRowHTML(r, i, skipped)).join("")}</ol>` : ""}
    <div class="actions"><button class="btn" data-rule-add${RULES.list.length >= RULE_MAX || !ownColl() ? " disabled" : ""}>Add a rule</button></div>
    <div class="field"><label for="rule-rest">Everything else goes to</label>
      <select id="rule-rest" class="fselect"><option value="">Where it came from, or beside another copy</option>
        ${restGone ? `<option value="${esc(rest)}" selected>${esc(locName(rest))}</option>` : ""}
        ${places.map(p => `<option value="${esc(p.loc)}"${rest === p.loc ? " selected" : ""}>${esc(locName(p.loc))}</option>`).join("")}</select></div>
    ${restGone ? `<p class="small warn-text" id="rule-rest-msg">Passed over: ${esc(RULE_STATE[restGone](rest))}.</p>` : ""}
    ${filingTrialHTML()}`;
}
// Redraw the panel alone (the rest of Settings keeps its fields and scroll), then give the keyboard back.
function renderFiling(focusSel) {
  const el = $("#rules-panel"); if (!el) return;
  el.innerHTML = filingPanelHTML();
  const f = focusSel && $(focusSel); if (f) try { f.focus({ preventScroll: true }); } catch {}
}
function openFilingRules() {
  showView("settings");
  const el = $("#rules-set"); if (el) { el.scrollIntoView({ block: "start" }); const h = el.querySelector("h3"); if (h) { h.tabIndex = -1; try { h.focus({ preventScroll: true }); } catch {} } }
}
document.addEventListener("change", e => {
  if (e.target.id !== "rule-rest") return;
  changeRules(RULES.list, e.target.value);
  renderFiling("#rule-rest");
});
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-rules-open], [data-rule-add], [data-rule-edit], [data-rule-up], [data-rule-down]"); if (!t || t.disabled) return;
  const d = t.dataset;
  if (d.rulesOpen != null) { openFilingRules(); return; }
  if (d.ruleAdd != null) { openRuleSheet(null); return; }
  if (d.ruleEdit != null) { openRuleSheet(d.ruleEdit); return; }
  const id = d.ruleUp != null ? d.ruleUp : d.ruleDown, by = d.ruleUp != null ? -1 : 1, list = [...RULES.list], i = list.findIndex(r => r.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  changeRules(list);
  // The arrow that was pressed, on the rule's new row; the other one when this arrow is now at the end of the list.
  const row = `.rule-row[data-rule="${CSS.escape(id)}"]`, same = by < 0 ? "[data-rule-up]" : "[data-rule-down]", other = by < 0 ? "[data-rule-down]" : "[data-rule-up]";
  renderFiling();
  const f = $(`${row} ${same}:not(:disabled)`) || $(`${row} ${other}`); if (f) try { f.focus({ preventScroll: true }); } catch {}
});

// ---- The sheet that adds a rule or changes one (#rule). RULEED = {id (null = a new rule), f, op, v, to, msg}: `v`
// is kept as the fields hold it (text), and becomes the rule's value when it is saved (engine canonRule decides
// whether it is one).
let RULEED = null;
const RULE_NEW_BOX = "\u0001new";   // the "Put it in" choice that asks for a new box's name (0.72.0): the box is made when the rule is saved
const ruleDefaults = f => ({ by: "", op: RULE_OPS[f] ? RULE_OPS[f][0][0] : "", v: f === "type" ? "basic" : f === "color" ? "W" : f === "rar" ? "r" : f === "foil" ? "foil" : f === "set" ? ruleSets()[0] || "" : "" });
function openRuleSheet(id) {
  const r = id ? ruleById(id) : null; if (id && !r) return;
  const places = putAwayPlaces();
  RULEED = r ? { id: r.id, f: r.f, op: r.op || "", v: String(r.v), by: r.by || "", to: r.to, msg: "" } : { id: null, f: "price", ...ruleDefaults("price"), to: places.length === 1 ? places[0].loc : "", msg: "" };
  renderRuleSheet(); openDlg($("#rule"));
}
function closeRuleSheet() { closeDlg($("#rule")); RULEED = null; const body = $("#rule-body"); if (body) body.innerHTML = ""; }
function ruleValueHTML(w) {
  const sel = (id, label, choices, cur) => `<select id="${id}" class="fselect" aria-label="${label}">${choices.map(([k, name]) => `<option value="${esc(k)}"${String(cur) === String(k) ? " selected" : ""}>${esc(name)}</option>`).join("")}</select>`;
  const ops = RULE_OPS[w.f] ? sel("rule-op", "How it compares", RULE_OPS[w.f], w.op) : "";
  if (w.f === "price") return `<div class="rule-pair">${ops}<label class="buy-upto"><span>${curSign()}</span><input type="number" id="rule-v" value="${esc(w.v)}" min="0.01" step="0.01" inputmode="decimal" enterkeyhint="done" aria-label="Price, in ${CUR_NAME[CURRENCY]}"></label></div>`;
  if (w.f === "mv") return `<div class="rule-pair">${ops}<input type="number" id="rule-v" value="${esc(w.v)}" min="0" max="20" step="1" inputmode="numeric" enterkeyhint="done" aria-label="Mana value"></div>`;
  if (w.f === "name") return `<div class="rule-pair">${ops}<input type="text" id="rule-v" value="${esc(w.v)}" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="Text in the name"></div>`;
  if (w.f === "type") return sel("rule-v", "Card type", RULE_TYPE_CHOICES, w.v);
  if (w.f === "color") return `${sel("rule-v", "Color", RULE_COLOR_CHOICES, w.v)}<div class="seg seg-fill" role="group" aria-label="Which colors" id="rule-by">${[["", "Card's own color"], ["id", "Color identity"]].map(([k, name]) => `<button data-rule-by="${k}" aria-pressed="${(w.by || "") === k}">${name}</button>`).join("")}</div>`;
  if (w.f === "rar") return sel("rule-v", "Rarity", Object.entries(RARITY_NAMES), w.v);
  if (w.f === "foil") return sel("rule-v", "Finish", RULE_FOIL_CHOICES, w.v);
  const sets = ruleSets(); if (w.v && !sets.includes(w.v)) sets.unshift(w.v);
  if (!sets.length) return `<p class="muted small" id="rule-nosets">Your import doesn't name the set of any copy, so there is no set to choose.</p>`;
  return sel("rule-v", "Set", sets.map(s => { const n = setName(s), code = s.toUpperCase(); return [s, n !== code ? `${n} (${code})` : n]; }), w.v);
}
function renderRuleSheet() {
  const body = $("#rule-body"), w = RULEED; if (!body || !w) return;
  const places = putAwayPlaces(), state = w.to && !places.some(p => p.loc === w.to) ? rulePlaceState(w.to) : "";
  body.innerHTML = `<h2 id="rule-title" tabindex="-1" autofocus>${w.id ? "Change this rule" : "Add a filing rule"}</h2>
    <div class="field"><label for="rule-f">When a card's</label>
      <select id="rule-f" class="fselect">${RULE_FIELDS.map(([k, name]) => `<option value="${k}"${w.f === k ? " selected" : ""}>${name}</option>`).join("")}</select></div>
    <div class="field" id="rule-value">${ruleValueHTML(w)}<p class="muted small" id="rule-hint">${RULE_HINTS[w.f](w)}</p></div>
    <div class="field"><label for="rule-to">Put it in</label>
      <select id="rule-to" class="fselect"><option value=""${w.to || w.fresh ? "" : " selected"}>Choose a box or binder</option>
        ${state ? `<option value="${esc(w.to)}"${w.fresh ? "" : " selected"}>${esc(locName(w.to))}</option>` : ""}
        ${places.map(p => `<option value="${esc(p.loc)}"${!w.fresh && w.to === p.loc ? " selected" : ""}>${esc(locName(p.loc))}${p.qty ? "" : " (empty)"}</option>`).join("")}
        <option value="${RULE_NEW_BOX}"${w.fresh ? " selected" : ""}>A new box or binder…</option></select>
      ${w.fresh ? `<input type="text" id="rule-new" value="${esc(w.name || "")}" maxlength="80" enterkeyhint="done" autocomplete="off" aria-label="The new box's name" placeholder="Its name">` : ""}
      <p class="muted small">${state && !w.fresh ? `<span class="warn-text">${esc(RULE_STATE[state](w.to))}, so this rule is passed over.</span> ` : ""}A deck's box isn't offered: cards in one count as part of that deck.</p></div>
    <p class="small warn-text" id="rule-msg"${w.msg ? "" : " hidden"}>${esc(w.msg)}</p>
    <div class="sheet-pair"><button class="btn" data-re-cancel>Cancel</button><button class="btn primary" data-re-save>${w.id ? "Save" : "Add the rule"}</button></div>
    ${w.id ? `<button class="btn link danger" data-re-del>Remove this rule</button>` : ""}`;
}
const RULE_NEEDS = { price: "Give a price above zero.", mv: "Give a mana value from 0 to 20.", name: "Type part of a name.", set: "Choose a set." };
function ruleFromSheet() {
  const w = RULEED;
  let box = null;
  if (w.fresh) { box = newPlace((w.name || "").trim()); if (box.problem) return { problem: box.problem, at: "#rule-new" }; }
  else if (!w.to) return { problem: "Choose where the cards go." };
  const to = box ? box.loc : w.to;
  if (w.f === "mv" && !/^\s*\d{1,2}\s*$/.test(String(w.v))) return { problem: RULE_NEEDS.mv };
  const rule = canonRule({ id: w.id || "r" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), f: w.f, op: w.op, v: w.v, by: w.by, to });
  return rule ? { rule, box } : { problem: RULE_NEEDS[w.f] || "That rule can't be read." };
}
document.addEventListener("input", e => { if (RULEED && e.target.id === "rule-v") RULEED.v = e.target.value; else if (RULEED && e.target.id === "rule-new") RULEED.name = e.target.value; });
document.addEventListener("change", e => {
  const w = RULEED, id = e.target.id; if (!w || !["rule-f", "rule-op", "rule-v", "rule-to"].includes(id)) return;
  if (id === "rule-op") w.op = e.target.value;
  else if (id === "rule-v") w.v = e.target.value;
  else if (id === "rule-to") {
    w.fresh = e.target.value === RULE_NEW_BOX; if (!w.fresh) w.to = e.target.value;
    w.msg = ""; renderRuleSheet(); const f = $(w.fresh ? "#rule-new" : "#rule-to"); if (f) f.focus();
  }
  else { w.f = e.target.value; Object.assign(w, ruleDefaults(w.f)); w.msg = ""; renderRuleSheet(); const f = $("#rule-f"); if (f) f.focus(); }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && (e.target.id === "rule-v" || e.target.id === "rule-new") && RULEED) { e.preventDefault(); if (e.target.id === "rule-v") RULEED.v = e.target.value; else RULEED.name = e.target.value; const go = $("#rule [data-re-save]"); if (go) go.click(); } });
document.addEventListener("close", e => { if (e.target.id === "rule" && RULEED) closeRuleSheet(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "rule") { closeRuleSheet(); return; }
  const t = e.target.closest && e.target.closest("[data-re-cancel], [data-re-save], [data-re-del], [data-rule-by]"); if (!t || !RULEED) return;
  const w = RULEED, d = t.dataset, was = { list: RULES.list, rest: RULES.rest };
  if (d.ruleBy != null) { w.by = d.ruleBy; renderRuleSheet(); const f = $(`#rule-by [data-rule-by="${w.by}"]`); if (f) f.focus(); return; }
  if (d.reCancel != null) { closeRuleSheet(); return; }
  if (d.reDel != null) {
    const gone = ruleById(w.id);
    closeRuleSheet();
    if (!gone) return;
    changeRules(was.list.filter(r => r.id !== gone.id)); renderFiling("[data-rule-add]");
    toast(`Removed the rule “${ruleText(gone)}”`, "Undo", () => { changeRules(was.list, was.rest); renderFiling(); });
    return;
  }
  const r = ruleFromSheet();
  if (r.problem) { w.msg = r.problem; renderRuleSheet(); const f = $(r.at || (w.to || w.fresh ? "#rule-v" : "#rule-to")); if (f) f.focus(); return; }
  if (r.box && r.box.fresh) makeBox(r.box);   // the rule's new box joins the collection, empty
  closeRuleSheet();
  changeRules(w.id ? was.list.map(x => (x.id === w.id ? r.rule : x)) : [...was.list, r.rule]);
  renderFiling(`[data-rule-edit="${CSS.escape(r.rule.id)}"]`);
});

"use strict";
// Bulk Tutor, the page's script, part "tokens": the tokens a deck makes and the markers it uses (engine: deckTokens,
// cardTokens), listed under a build's cards, at the end of Assemble, on a deck's screen and in a card's details.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ tokens.json (data format 13; markers 14)
// Loaded the first time a screen wants it. Its address names its version (the weekly build writes it, like the picture
// IDs), so the saved copy answers when there is one.
let tokensState = "idle";   // idle | loading | ready | failed
let tokensWaiting = [];     // what to do once the file is here (or has failed): fn(ready)
function loadTokens() {
  if (tokensState !== "idle" || !FILES().tokens || !DATA) return;
  tokensState = "loading";
  dataFetch(dataUrl("tokens.json"), undefined, false).then(r => r.ok ? r.json() : null)
    .then(j => { tokensState = setTokens(j) ? "ready" : "failed"; })
    .catch(() => { tokensState = "failed"; })
    .then(() => { paintTokens(); const w = tokensWaiting; tokensWaiting = []; w.forEach(fn => fn(tokensReady())); });
}
// Run `fn(ready)` with the tokens loaded: now when they are, else when the file arrives; `false` when there is none.
function whenTokens(fn) {
  if (tokensReady()) { fn(true); return; }
  if (!tokensOffered()) { fn(false); return; }
  tokensWaiting.push(fn); loadTokens();
  if (tokensState !== "loading") { tokensWaiting = tokensWaiting.filter(x => x !== fn); fn(tokensReady()); }
}
// Whether this data can list tokens at all (it has the file, and it hasn't failed to load).
const tokensOffered = () => !!(FILES().tokens && DATA && tokensState !== "failed");

// ------------------------------------------------------------ one token or marker
// Matt, Nov 11: "We can skip images for the tokens, we only need to list the tokens' card details." So a line is the
// name and size, then colour and type, then its text; a long text (a dungeon's rooms) folds away.
const TOKEN_LONG = 180;
const tokenKind = t => [t.marker || t.copy ? "" : tokenColors(t), t.type].filter(Boolean).join(" · ");
function tokenFaceHTML(f, t, first) {
  const type = first ? tokenKind(t) : f.type === "Card" ? "" : f.type.replace(/^Token\s*/, "");   // a marker's "Card" says nothing
  const text = f.text ? `<div class="tok-text ctext">${rulesHTML(f.text)}</div>` : "";
  return `<div class="tok-face"><div class="tok-name"><strong>${esc(f.name)}</strong>${f.pt ? ` <span class="num">${esc(f.pt)}</span>` : ""}</div>
    ${type ? `<div class="muted small">${esc(type.charAt(0).toUpperCase() + type.slice(1))}</div>` : ""}
    ${f.text.length > TOKEN_LONG ? `<details class="tok-more"><summary class="btn link small">What it says</summary>${text}</details>` : text}</div>`;
}
// The cards that make it, each opening its details; ones that are only in the sideboard say so. Matt, Nov 11 (it was
// 14 names for Orc Army in one of his boxes): "limited to as many as fit in one [line] alongside the 'and x more'.
// Clicking the 'and x more' should expand to the full list, with an option to collapse it again." Every name is in the
// markup; `fitBy` hides the ones past the line once the row has a width.
const tokByOpen = new Set();   // the tokens whose "From" is opened out, for this visit
function tokenByHTML(r) {
  const link = n => `<button class="btn link small" data-sheet="token" data-card="${esc(n)}">${esc(n)}</button>`;
  const names = [...r.by.map(link), ...r.side.map(n => `${link(n)} <span class="muted">(sideboard)</span>`)];
  return names.length ? `<div class="tok-by muted small" data-by="${esc(r.token.id)}"${tokByOpen.has(r.token.id) ? " data-open" : ""}>From ${names.map(h => `<span class="by-item">${h}<span class="by-sep">${BY_SEP}</span></span>`).join("")} <button class="btn link small" data-by-more hidden></button></div>` : "";
}
const BY_SEP = "\u2060, ";   // a word joiner first: a line never starts with the comma (a name is a button, which a line may break after)
const BY_GAP = 8;   // px kept between the last name and "and N more": the space between them, and rounding
function fitBy(el, again) {
  const w = el.clientWidth;
  if (!w || (!again && el._byW === w)) return;   // not on screen (a folded section), or fitted at this width already
  const items = [...el.querySelectorAll(".by-item")], more = el.querySelector("[data-by-more]"), n = items.length;
  const show = (k, label, open) => {
    items.forEach((it, i) => { it.hidden = i >= k; it.classList.toggle("last", i === k - 1); });
    more.hidden = !label; more.textContent = label;
    if (label) more.setAttribute("aria-expanded", open ? "true" : "false");
  };
  el.removeAttribute("data-fitted");   // unfitted, the row is one line that doesn't wrap: measure it so
  show(n, `and ${n} more`);
  const left = el.getBoundingClientRect().left, moreW = more.getBoundingClientRect().width + BY_GAP;
  const ends = items.map(it => it.getBoundingClientRect().right - it.lastElementChild.getBoundingClientRect().width - left);   // each name's end without its comma
  let k = 0;
  while (k < n && ends[k] + moreW <= w) k++;
  const open = el.hasAttribute("data-open");
  if (ends[n - 1] <= w + 0.5) show(n, "");   // every name fits the line: nothing to open or close
  else if (open) show(n, "Show fewer", true);
  else show(Math.max(k, 1), `and ${n - Math.max(k, 1)} more`, false);   // one name always shows, wrapping if it must
  el.toggleAttribute("data-wide", !more.hidden && open);
  el.setAttribute("data-fitted", "");
  el._byW = w;
}
const fitBys = again => document.querySelectorAll("[data-by]").forEach(el => fitBy(el, again));
// A row is fitted as soon as it is drawn (before the screen paints), when its section unfolds, when the window changes
// width, and when the fonts arrive (names get wider or narrower).
try { new MutationObserver(() => fitBys()).observe(document.body, { childList: true, subtree: true }); } catch {}
document.addEventListener("toggle", () => fitBys(), true);
window.addEventListener("resize", () => fitBys());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitBys(true));
document.addEventListener("click", e => {
  const more = e.target.closest("[data-by-more]");
  if (!more) return;
  const el = more.closest("[data-by]"), id = el.dataset.by;
  if (tokByOpen.has(id)) tokByOpen.delete(id); else tokByOpen.add(id);
  document.querySelectorAll("[data-by]").forEach(x => { if (x.dataset.by === id) { x.toggleAttribute("data-open", tokByOpen.has(id)); fitBy(x, true); } });
});
// With tracking on, a token's row says where you have it, or that it is missing; while "I have some" is open, a
// missing one has a tick instead.
function tokenHaveHTML(r, picking) {
  if (!r.have) return "";
  if (r.have.length) {
    const total = r.have.reduce((s, h) => s + h.n, 0);
    return `<div class="tok-own small"><span class="tok-yes" aria-hidden="true">${MARK.pass}</span> You have <span class="num">${total}</span>: ${r.have.map(h => `${esc(tokPlace(h.loc))}${r.have.length > 1 ? ` <span class="num">(${h.n})</span>` : ""}`).join(", ")}</div>`;
  }
  return picking ? `<label class="check small tok-own"><input type="checkbox" data-tok-tick="${esc(r.token.id)}"${tokPick.ids.has(r.token.id) ? " checked" : ""}> I have this one</label>`
    : `<div class="tok-own small tok-miss">Missing</div>`;
}
const tokenRowHTML = (r, picking) => `<li class="tok" data-token="${esc(r.token.id)}">${r.token.faces.map((f, n) => tokenFaceHTML(f, r.token, !n)).join("")}${tokenHaveHTML(r, picking)}${tokenByHTML(r)}</li>`;

// ------------------------------------------------------------ a deck's tokens and markers
// One line for each token the deck makes, whatever number of them (Matt: "just one line for each the deck makes with no
// quantity tracked at that level"), Copy last; then the markers under their own heading (his word, for "non-cards like
// monarch and the ring"); then the cards whose tokens Scryfall doesn't list. Nothing when the deck makes and uses none.
function tokensPanelHTML(cards, side, kind) {
  if (!tokensOffered()) return "";
  const d = deckTokens(cards, side);
  if (!d) { loadTokens(); return ""; }
  if (!d.tokens.length && !d.markers.length && !d.unlisted.length) return "";
  // Tracking (0.61.0): off, the list offers it in Matt's words; on, it says which tokens are missing and takes
  // "I have them all" (his "one-tap that adds all") or "I have some" (his words: tick the ones owned, then save).
  const own = TOKOWN.on ? deckTokensOwned(d) : null, picking = !!(own && own.missing && tokPick && tokPick.key === tokPickKey(kind));
  const rows = own ? own.rows : d.tokens;
  const acts = !own || !own.missing ? "" : picking ? `<p class="muted small">Tick the ones you own, then save.</p>`
    : `<div class="actions tok-acts"><button class="btn" data-tok-have="all">I have them all</button><button class="btn" data-tok-have="some">I have some</button></div>`;
  const pickEnd = picking ? `<div class="actions tok-acts"><button class="btn primary" data-tok-pick="save">Save</button><button class="btn" data-tok-pick="cancel">Cancel</button></div>` : "";
  const track = TOKOWN.on || !d.tokens.length ? "" : `<p class="small tok-track"><button class="btn link" data-tok-track>Track the tokens you own</button></p>`;
  const tools = picking ? "" : `<p class="small tok-tools"><button class="btn link" data-tok-copy>Copy this list</button></p><div class="tok-copy-out"></div>`;
  const unlisted = d.unlisted.length ? `<p class="muted small tok-unlisted">${d.unlisted.length === 1 ? "One more card makes" : `${d.unlisted.length} more cards make`} tokens, with no details listed for them: ${d.unlisted.map(n => `<button class="btn link small" data-sheet="token" data-card="${esc(n)}">${esc(n)}</button>`).join(", ")}.</p>` : "";
  return `<details class="panel fold tokens-panel" data-fold="tokens"${foldOpen("tokens", true) ? " open" : ""}>
      <summary class="section-head"><h3>Tokens this deck makes</h3><span class="muted small num">${d.tokens.length}</span>${own && own.missing ? `<span class="small tok-miss">${own.missing} missing</span>` : ""}</summary>
      ${acts}
      ${d.tokens.length ? `<ul class="tok-list">${rows.map(r => tokenRowHTML(r, picking)).join("")}</ul>${pickEnd}${track}` : `<p class="muted small">${d.unlisted.length ? "None with details listed." : "This deck makes no tokens."}</p>`}
      ${unlisted}
      ${d.markers.length ? `<div class="loc-head tok-markers"><h3>Markers</h3><span class="muted small num">${d.markers.length}</span></div>
        <ul class="tok-list" data-markers>${d.markers.map(r => tokenRowHTML(r)).join("")}</ul>` : ""}
      ${d.tokens.length || d.markers.length ? tools : ""}
    </details>`;
}
// Where a screen wants the list: the open build (its sideboard's cards are in the box too), or the deck on screen.
function tokensSource(kind) {
  if (kind === "build") { const b = curBuild(); return b ? { cards: b.cards, side: sideOf(b) } : null; }
  if (kind === "browse") { if (!browseIsDeck()) return null; const all = browseCards(); return { cards: all.filter(c => !c.side), side: all.filter(c => c.side) }; }
  return null;
}
// A host is a place a list is drawn and redrawn: "build" and "browse" for what a deck makes, "box" for the tokens kept
// in the location on screen, "loose" (Settings) for the ones not in a box.
function tokensHostInner(kind) {
  if (kind === "box") return BROWSE.loc != null && !savedById(BROWSE.saved) ? tokensOwnHTML(BROWSE.loc) : "";
  if (kind === "loose") return tokensOwnHTML("");
  const src = tokensSource(kind);
  return src ? tokensPanelHTML(src.cards, src.side, kind) : "";
}
const tokensHostHTML = kind => `<div class="tokens-host" data-tokens-host="${kind}">${tokensHostInner(kind)}</div>`;

// ------------------------------------------------------------ the tokens you own (0.61.0; engine: TOKOWN, tokenSet, tokensIn…)
// Matt, Nov 11: a switch in Settings, synced, off to start; "a one-tap that adds all, and a separate way to add a
// subset, maybe just 'I have some' and then checking off the ones owned before they're saved"; a box's list "can use a
// similar list and allow manual entry". Kept in bt.tokens, apart from the collection: an import never touches them.
let tokPick = null;   // {key, ids: Set of token ids} while "I have some" is open for that deck
const tokPickKey = kind => kind === "build" ? "build:" + ((curBuild() || {}).id || "") : "browse:" + (BROWSE.saved || "") + ":" + (BROWSE.loc == null ? "" : BROWSE.loc);
function loadTokOwn() { try { setTokOwn(JSON.parse(store.get("bt.tokens") || "null")); } catch { setTokOwn(null); } }
function saveTokOwn(fromSync) { store.set("bt.tokens", JSON.stringify(TOKOWN)); if (!fromSync) syncSoon(); }
function setTokTrack(on) { TOKOWN.on = !!on; TOKOWN.at = Date.now(); tokPick = null; saveTokOwn(); paintTokens(); const sw = $("#tok-track"); if (sw) sw.checked = TOKOWN.on; }
const tokPlace = loc => loc ? locName(loc) : "not in a box";
// Where a deck's tokens are recorded: the box the deck is in, or nowhere in particular.
function tokensHome(kind) {
  if (kind === "build") { const b = curBuild(); return (b && buildHome(b)) || ""; }
  return BROWSE.loc != null && !savedById(BROWSE.saved) ? BROWSE.loc : "";
}
// Record tokens at a location, with one Undo for the lot: `sets` = [[token or {id, rec}, count]].
function tokensRecord(loc, sets, said, also) {
  const before = sets.map(([t]) => { const r = tokensIn(loc).find(x => x.id === t.id || (x.token && x.token === t)); return [t, r ? r.n : 0]; });
  const put = list => { const at = Date.now(); for (const [t, n] of list) tokenSet(loc, t, n, at); saveTokOwn(); paintTokens(); };
  put(sets);
  if (said) toast(said, "Undo", () => { put(before); if (also) also(); }, also ? 8000 : undefined);   // `also`: what else the message's Undo takes back
}
const tokenTitle = (t, rec) => t ? t.faces.map(f => f.name).join(" // ") + (t.pt ? " " + t.pt : "") : rec.name + (rec.pt ? " " + rec.pt : "");
// What a location holds, each with its count to change, and a field to add one by name ("allow manual entry").
function tokenOwnedRowHTML(r) {
  const t = r.token, name = t ? t.faces.map(f => f.name).join(" // ") : r.rec.name, pt = t ? t.pt : r.rec.pt, title = tokenTitle(t, r.rec);
  const more = t ? tokenBriefMore(t, true) : esc(capFirst([tokenColors(r.rec), r.rec.type].filter(Boolean).join(" · ")));
  return `<li class="tok tok-owned" data-token="${esc(r.id)}"><div class="tok-face"><div class="tok-name"><strong>${esc(name)}</strong>${pt ? ` <span class="num">${esc(pt)}</span>` : ""}</div>
      ${more ? `<div class="muted small">${more}</div>` : ""}${t ? "" : `<div class="muted small">Not in today's card data; kept as you recorded it.</div>`}</div>
    <span class="qty"><button class="icon" data-tok-step="-1" aria-label="One fewer ${esc(title)}">${MARK.fewer}</button><span class="num">${r.n}</span><button class="icon" data-tok-step="1" aria-label="One more ${esc(title)}">${MARK.more}</button></span></li>`;
}
function tokensOwnHTML(loc) {
  if (!TOKOWN.on || !tokensOffered()) return "";
  if (!tokensReady()) { loadTokens(); return ""; }
  const rows = tokensIn(loc), total = rows.reduce((s, r) => s + r.n, 0), fold = loc ? "tokens-own" : "tokens-loose";
  return `<details class="panel fold tokens-panel tokens-own" data-fold="${fold}" data-tok-loc="${esc(loc)}"${foldOpen(fold, true) ? " open" : ""}>
      <summary class="section-head"><h3>${loc ? "Tokens kept here" : "Tokens not in a box"}</h3><span class="muted small num">${total}</span></summary>
      <label class="search-field">${SEARCH_ICON}<input type="search" class="tok-add" aria-label="Add a token" placeholder="Add a token (Soldier, Treasure, 1/1 white…)" autocomplete="off" enterkeyhint="search"></label>
      <div class="results tok-results"></div>
      ${rows.length ? `<ul class="tok-list">${rows.map(tokenOwnedRowHTML).join("")}</ul>` : `<p class="muted small tok-none">${loc ? "No tokens recorded here yet." : "None. Tokens you say you have for a build that isn't in a box are listed here."}</p>`}
      ${tokPaste === loc ? tokPasteHTML() : `<p class="small tok-tools"><button class="btn link" data-tok-paste="open">Add a list</button>${rows.length ? `<button class="btn link" data-tok-copy>Copy this list</button>` : ""}</p><div class="tok-copy-out"></div>`}
    </details>`;
}
// Many tokens share a name, so each result shows its details and nothing is guessed.
const TOKEN_HITS = 12;
function paintTokenResults(input) {
  const out = input.closest(".tokens-own").querySelector(".tok-results"), all = tokenSearch(input.value, TOKEN_HITS + 1), hits = all.slice(0, TOKEN_HITS);
  out.innerHTML = hits.length ? hits.map(t => `<button class="result tok-result" data-tok-add="${esc(t.id)}"><span><strong>${esc(t.faces.map(f => f.name).join(" // "))}</strong>${t.pt ? ` <span class="num">${esc(t.pt)}</span>` : ""}</span><span class="where">${tokenBriefMore(t, true) || "Token"}</span></button>`).join("") + (all.length > TOKEN_HITS ? `<p class="muted small tok-narrow">More tokens fit that. Add a size or a colour to narrow it down (${esc(hits[0].name.toLowerCase())} 2/2 white).</p>` : "")
    : input.value.trim() ? `<p class="muted small">No token by that name.</p>` : "";
}
document.addEventListener("input", e => { if (e.target.matches && e.target.matches(".tok-add")) paintTokenResults(e.target); });
document.addEventListener("change", e => {
  const t = e.target;
  if (!t.matches) return;
  if (t.matches("#tok-track")) setTokTrack(t.checked);
  else if (t.matches("[data-tok-tick]") && tokPick) { if (t.checked) tokPick.ids.add(t.dataset.tokTick); else tokPick.ids.delete(t.dataset.tokTick); }
});
document.addEventListener("click", e => {
  const el = e.target.closest("[data-tok-track], [data-tok-have], [data-tok-pick], [data-tok-step], [data-tok-add], [data-tok-copy], [data-tok-paste]");
  if (!el) return;
  const host = el.closest("[data-tokens-host]"), kind = host ? host.dataset.tokensHost : "";
  if (el.matches("[data-tok-copy]")) { tokensCopy(kind, el.closest("[data-tok-loc]")); return; }
  if (el.matches("[data-tok-paste]")) { tokensPasteClick(el, kind); return; }
  if (el.matches("[data-tok-track]")) { setTokTrack(true); toast("Tracking the tokens you own. Settings turns it off.", "Undo", () => setTokTrack(false)); return; }
  if (el.matches("[data-tok-have], [data-tok-pick]")) {
    const src = tokensSource(kind), d = src && deckTokens(src.cards, src.side), missing = d ? deckTokensOwned(d).rows.filter(r => !r.have.length).map(r => r.token) : [];
    if (el.dataset.tokHave === "some") { tokPick = { key: tokPickKey(kind), ids: new Set() }; paintTokens(); return; }
    const mine = el.dataset.tokHave === "all" ? missing : el.dataset.tokPick === "save" && tokPick && tokPick.key === tokPickKey(kind) ? missing.filter(t => tokPick.ids.has(t.id)) : [];
    tokPick = null;
    if (!mine.length) { paintTokens(); return; }
    const home = tokensHome(kind);
    tokensRecord(home, mine.map(t => [t, 1]), `${mine.length === 1 ? "1 token" : mine.length + " tokens"} recorded${home ? " in " + locName(home) : ""}`);
    return;
  }
  const panel = el.closest("[data-tok-loc]"); if (!panel) return;
  const loc = panel.dataset.tokLoc;
  if (el.matches("[data-tok-add]")) {
    const t = tokenOf(el.dataset.tokAdd); if (!t) return;
    const had = tokensIn(loc).find(r => r.token === t);
    tokensRecord(loc, [[t, (had ? had.n : 0) + 1]], `${tokenTitle(t)} added`);
    const f = document.querySelector(`[data-tokens-host="${kind}"] .tok-add`); if (f) f.focus();
    return;
  }
  const id = el.closest("[data-token]").dataset.token, row = tokensIn(loc).find(r => r.id === id), step = +el.dataset.tokStep;
  if (!row) return;
  tokensRecord(loc, [[row.token || { id, rec: row.rec }, row.n + step]], row.n + step > 0 ? "" : `${tokenTitle(row.token, row.rec)} removed`);
  const again = document.querySelector(`[data-tokens-host="${kind}"] [data-token="${id}"] [data-tok-step="${step}"]`); if (again) again.focus();
});

// ------------------------------------------------------------ token lists (0.62.0; engine: tokenLine, tokenLineFind, tokenListLines…)
// Matt, Nov 11: "Anywhere we allow users to add cards, they should be able to add a list as well", tokens included. A
// line is a token as a person would write it (`3 Soldier 1/1 white`, `2 Treasure`); a list's lines are added to what a
// location keeps. A line that fits several tokens, or none, is never guessed: a sheet shows the candidates.
let tokPaste = null;   // the location whose "Add a list" box is open ("" = not in a box), else null
const tokPasteHTML = () => `<div class="tok-paste"><label>A list of tokens, one per line<textarea class="tok-paste-box" placeholder="3 Soldier 1/1 white&#10;2 Treasure&#10;1 Zombie 2/2 black decayed"></textarea></label>
    <p class="muted small">Only the name is needed. A size, a colour or a keyword says which one when several tokens share it.</p>
    <p class="small warn-text tok-paste-msg" hidden></p>
    <div class="actions"><button class="btn primary" data-tok-paste="go">Add these tokens</button><button class="btn" data-tok-paste="cancel">Cancel</button></div></div>`;
function tokensPasteClick(el, kind) {
  const panel = el.closest("[data-tok-loc]"); if (!panel) return;
  const loc = panel.dataset.tokLoc, act = el.dataset.tokPaste, sel = `[data-tokens-host="${kind}"]`;
  if (act === "open") { tokPaste = loc; paintTokens(); const f = document.querySelector(sel + " .tok-paste-box"); if (f) f.focus(); return; }
  if (act === "cancel") { tokPaste = null; paintTokens(); const b = document.querySelector(sel + " [data-tok-paste=open]"); if (b) b.focus(); return; }
  const lines = tokenListLines(panel.querySelector(".tok-paste-box").value);
  if (!lines.length) { const m = panel.querySelector(".tok-paste-msg"); m.textContent = "No tokens found. Write one per line, like “2 Treasure”."; m.hidden = false; return; }
  tokPaste = null;
  tokensTake(loc, lines);
}
// A deck's list says which tokens it makes (no counts: Matt, "no quantity tracked at that level"), with its markers;
// a location's says how many of each it keeps. Both are written as lines a list is read from.
function tokensCopy(kind, panel) {
  const out = `[data-tokens-host="${kind}"] .tok-copy-out`;
  if (panel) {
    const rows = tokensIn(panel.dataset.tokLoc), known = rows.filter(r => r.token).map(r => [r.token, r.n]);
    const old = rows.filter(r => !r.token).map(r => `${r.n} ${[r.rec.name, r.rec.pt, r.rec.colors === "C" ? "" : tokenColors(r.rec)].filter(Boolean).join(" ")}`);
    copyText([tokenListText(known) || "Tokens", ...old].join("\n"), out, `Copied ${tokensWord(rows.reduce((n, r) => n + r.n, 0))}`);
    return;
  }
  const src = tokensSource(kind), d = src && deckTokens(src.cards, src.side); if (!d) return;
  copyText(tokenListText(d.tokens.map(r => [r.token, 0]), d.markers.map(r => r.token)), out, "Copied the token list");
}
const tokensWord = n => n === 1 ? "1 token" : n + " tokens";
// Token lines into a location's tokens. The lines that name a token wait while the sheet asks about the rest, so the
// whole list is recorded at once, with one message and one Undo. `lead` starts the message ("Started a build…").
let TOKASK = null;   // {loc, lead, undo, sure: [[token, n]], ask: [{qty, text, cands, why}], at, markers, skipped} while the sheet is open
function tokensTake(loc, lines, lead = "", undo = null) {
  const r = tokenLinesRead(lines), st = { loc, lead, undo, sure: r.sure, ask: r.ask, at: 0, markers: r.markers, skipped: 0 };
  if (!r.ask.length) { tokensTakeEnd(st); return; }
  TOKASK = st; renderTokAsk(); openDlg($("#tokask"));
}
function tokensTakeEnd(st) {
  const add = new Map();
  for (const [t, n] of st.sure) add.set(t, Math.min(TOKOWN_MAX, (add.get(t) || 0) + n));
  const total = [...add.values()].reduce((a, b) => a + b, 0), had = t => { const r = tokensIn(st.loc).find(x => x.token === t); return r ? r.n : 0; };
  const notes = [st.skipped ? `${st.skipped === 1 ? "1 line" : st.skipped + " lines"} skipped` : "", st.markers ? "markers aren't tracked" : ""].filter(Boolean).join("; ");
  const said = `${st.lead}${total ? `${tokensWord(total)} added${st.loc ? " to " + locName(st.loc) : ", not in a box"}` : "No tokens added"}${notes ? ` (${notes})` : ""}`;
  if (total) tokensRecord(st.loc, [...add.entries()].map(([t, n]) => [t, had(t) + n]), said, st.undo);
  else { paintTokens(); toast(said, st.undo ? "Undo" : null, st.undo, st.undo ? 8000 : 5000); }
}
// The sheet: one line at a time, as it was written, with the tokens it could mean; Skip leaves the line out.
function renderTokAsk() {
  const body = $("#tokask-body"), a = TOKASK; if (!body || !a) return;
  const l = a.ask[a.at], line = `${l.qty > 1 ? l.qty + " " : ""}${l.text}`;
  const why = l.why === "several" ? `${l.cands.length} tokens fit this line. Which one is it?` : l.why === "nofit" ? "No token fits all of this line. Is it one of these?" : l.cands.length ? "No token has this name. Is it one of these?" : "No token has this name.";
  body.innerHTML = `<h2 id="tokask-title" tabindex="-1" autofocus>Which token is it?</h2>
    ${a.ask.length > 1 ? `<p class="muted small num">Line ${a.at + 1} of ${a.ask.length} that need a pick</p>` : ""}
    <p class="tokask-line"><strong>${esc(line)}</strong></p>
    <p class="muted small">${why}</p>
    ${l.cands.length ? `<div class="menu-list">${l.cands.map(t => `<button class="menu-item tokask-pick" data-tokask="${esc(t.id)}"><span class="mi-text"><strong>${esc(t.faces.map(f => f.name).join(" // "))}${t.pt ? ` <span class="num">${esc(t.pt)}</span>` : ""}</strong><small>${tokenWholeMore(t) || "Token"}</small></span></button>`).join("")}</div>` : ""}
    <div class="sheet-pair"><button class="btn" data-tokask="">Skip this line</button>${a.ask.length - a.at > 1 ? `<button class="btn" data-tokask-rest>Skip the rest</button>` : ""}</div>`;
}
// A candidate's details in full: its colour and type, then all of its text without the reminders. The short form used
// in other lists leaves a long text out, and here the text is what tells two tokens apart (four black 1/1 Assassins).
function tokenWholeMore(t) {
  const text = t.faces.map(f => f.text.replace(/\s*\([^()]*\)/g, "").replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join(" // ");
  return rulesInline(capFirst([tokenKind(t), text].filter(Boolean).join(" · ")));
}
function closeTokAsk() {
  const a = TOKASK; if (!a) return;
  TOKASK = null; closeDlg($("#tokask")); const body = $("#tokask-body"); if (body) body.innerHTML = "";
  a.skipped += a.ask.length - a.at;   // closed early: the lines not reached are left out, the rest is recorded
  tokensTakeEnd(a);
}
document.addEventListener("close", e => { if (e.target.id === "tokask" && TOKASK) closeTokAsk(); }, true);
document.addEventListener("click", e => {
  if (e.target.id === "tokask") { closeTokAsk(); return; }
  const el = e.target.closest && e.target.closest("[data-tokask], [data-tokask-rest]"); if (!el || !TOKASK) return;
  const a = TOKASK, l = a.ask[a.at];
  if (el.dataset.tokaskRest != null) { closeTokAsk(); return; }
  const t = el.dataset.tokask ? tokenOf(el.dataset.tokask) : null;
  if (t) a.sure.push([t, l.qty]); else a.skipped++;
  a.at++;
  if (a.at >= a.ask.length) closeTokAsk(); else { renderTokAsk(); const h = $("#tokask-title"); if (h) h.focus(); }
});
// A pasted decklist's "Tokens" section (builds.js, parseDecklist). A build's tokens come from its cards, so there is
// nowhere in the build to put them: agreed with Matt (Nov 11), they are recorded as tokens you own, where the deck's
// tokens go (its box, else not in a box), only when tracking is on; otherwise they are left out and the message says so.
// `lead` is what else happened ("Started a build with 99 cards"; "" when nothing did) and `undo` takes that back: the
// one message carries both, and its Undo undoes both.
function tokensFromList(lines, lead, kind = "build", undo = null, leadMs = 0) {
  const say = (msg, ms) => toast(msg, undo ? "Undo" : null, undo, Math.max(undo ? 8000 : ms || 0, leadMs) || undefined);
  if (!lines.length || !tokensOffered()) { if (lead) say(lead); return; }
  const n = lines.length === 1 ? `${lead ? "Its" : "The"} token line was` : `${lead ? "Its" : "The"} ${lines.length} token lines were`, pre = lead ? lead + ". " : "";
  if (!TOKOWN.on) { say(`${pre}${n} left out: tracking the tokens you own is off.`, 6000); return; }
  whenTokens(ready => { if (ready) tokensTake(tokensHome(kind), lines, pre, undo); else say(`${pre}${n} left out: the token details didn't load.`, 6000); });
}

// ------------------------------------------------------------ a card's own: "Tokens it makes" in its details
// A token in a line: its colour and type, and its text when that is short (as HTML, symbols drawn). `cap` when the
// line stands by itself and not after the token's name.
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
function tokenBriefMore(t, cap) {
  const text = t.faces[0] ? t.faces[0].text.replace(/\s*\([^()]*\)/g, "").replace(/\n/g, " ").trim() : "";
  const more = [tokenKind(t), text.length > 90 ? "" : text].filter(Boolean).join(" · ");
  return more ? rulesInline(cap ? capFirst(more) : more) : "";
}
function tokenBriefHTML(t) {
  const more = tokenBriefMore(t);
  return `<li><strong>${esc(t.faces.map(f => f.name).join(" // "))}</strong>${t.pt ? ` <span class="num">${esc(t.pt)}</span>` : ""}${more ? ` <span class="muted">${more}</span>` : ""}</li>`;
}
// A line of rules text inside a sentence: its symbols drawn, nothing else.
const rulesInline = s => esc(s).replace(/\{[^}]+\}/g, m => manaHTML(m.replace(/&amp;/g, "&"), ""));
function makesHTML(name) {
  if (!tokensOffered()) return "";
  const m = cardTokens(name);
  if (!m) { loadTokens(); return ""; }
  return [m.tokens.length ? `<strong>Tokens it makes</strong><ul class="makes-list">${m.tokens.map(tokenBriefHTML).join("")}</ul>` : "",
    m.unlisted ? `<p class="muted">Makes tokens, with no details listed for them.</p>` : "",
    m.markers.length ? `<strong>Markers</strong><ul class="makes-list" data-markers>${m.markers.map(tokenBriefHTML).join("")}</ul>` : ""].join("");
}

// The file arrived (or didn't): fill in what's on screen.
function paintTokens() {
  document.querySelectorAll("[data-tokens-host]").forEach(el => { el.innerHTML = tokensHostInner(el.dataset.tokensHost); });
  document.querySelectorAll("[data-makes]").forEach(el => { el.innerHTML = makesHTML(el.dataset.name); });
}

"use strict";
// Bulk Tutor, the page's script, part "cardviews": card lists (list, grid, stacks), card text, artists, the full-screen viewer, the card details sheet.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// Show as. Table is offered only where a screen has one (`table`: the collection browser and builds) and the window is 700 px
// wide or more (0.87.0; Matt, Nov 13: List on phones, Table on desktop). Anywhere else (a phone, combos, EDHREC decks) a
// stored "table" shows as List and stays stored, so the same choice is a table again on a wider screen. Ask shownView for
// the view to draw; CARDVIEW is only what was chosen.
const TABLE_FITS = matchMedia("(min-width: 700px)");
const tableOffered = table => !!table && TABLE_FITS.matches;
const shownView = table => CARDVIEW === "table" && !tableOffered(table) ? "list" : CARDVIEW;
const imageView = () => CARDVIEW === "grid" || CARDVIEW === "stacks";
function viewToggleHTML(table) {
  const names = { list: "List", grid: "Grid", stacks: "Stacks", ...(tableOffered(table) ? { table: "Table" } : {}) }, cur = shownView(table);
  return `<div class="seg seg-sm" role="group" aria-label="Show cards as">${Object.keys(names)
    .map(v => `<button data-cardview="${v}" aria-pressed="${cur === v}">${names[v]}</button>`).join("")}</div>`;
}

// A tick box the app draws (selecting several cards, 0.58.0): on a card it sits in the caption or the name bar, never on
// the picture (Scryfall's image guidelines); on a group's heading it selects the group. Their state is painted by selPaint.
const tickHTML = () => `<span class="tick" aria-hidden="true"></span>`;
// The group a card or a group's box belongs to, in any view; and making every tick under `root` follow has(list, name):
// cards (a row's checkbox, a tile, a name bar, a table row), then each group's box (all, some, none). → the cards on screen.
const selGroupOf = el => el.closest("details.grp, section.cgroup, section.stack, section.bgroup, tbody");
function paintTicks(root, has) {
  const set = (t, state) => { if (!t) return; t.className = "tick" + (state === true ? " on" : state ? " some" : ""); t.textContent = state === true ? MARK.pass : state ? MARK.under : ""; };
  const cards = [...root.querySelectorAll("[data-pick]")];
  for (const el of cards) {
    const on = has(el.dataset.pick, el.dataset.card), box = el.querySelector("input[data-sel-box]");
    el.classList.toggle("on", on);
    if (box) box.checked = on; else { el.setAttribute(el.tagName === "TR" ? "aria-selected" : "aria-pressed", String(on)); set(el.querySelector(".tick"), on); }
  }
  root.querySelectorAll("[data-sel-grp]").forEach(btn => {
    const items = [...selGroupOf(btn).querySelectorAll("[data-pick]")], n = items.filter(el => el.classList.contains("on")).length;
    const state = n && n === items.length ? true : n ? "some" : false;
    btn.setAttribute("aria-pressed", state === true ? "true" : state ? "mixed" : "false"); set(btn.querySelector(".tick"), state);
  });
  return cards;
}
const grpTickHTML = label => `<button class="grp-tick" data-sel-grp aria-pressed="false" aria-label="Select all in ${esc(label)}">${tickHTML()}</button>`;
// groups: [{ title, tick?, items: [{ name, qty, sub, tone, i, mv, pick? }] }]; ctx names the click behavior. `pick` ("deck"
// or "side") makes a card selectable: a tap ticks it (the Workbench's listener), and `tick` puts a tick on the group.
function cardGroupsHTML(groups, ctx) {
  if (CARDVIEW === "grid") {
    return groups.map(g => `<section class="cgroup">
      ${g.title ? `<div class="loc-head">${g.tick ? grpTickHTML(g.title) : ""}<h3>${esc(g.title)}</h3><span class="muted small num">${g.items.reduce((n, x) => n + (x.qty || 1), 0)}</span></div>` : ""}
      <div class="cgrid">${g.items.map(it => tileCell(`<button class="ctile${it.tone ? " " + it.tone : ""}" data-sheet="${ctx}" data-card="${esc(it.name)}"${it.i != null ? ` data-i="${it.i}"` : ""}${it.pick ? ` data-pick="${it.pick}" aria-pressed="false"` : ""} aria-label="${esc(it.name)}">
        ${imgTag(it.name)}${it.qty > 1 || it.sub || it.pick ? `<span class="ccap">${it.pick ? tickHTML() : ""}${it.qty > 1 ? `<span class="num">${it.qty}×</span>${it.sub ? " · " : ""}` : ""}${it.sub || ""}</span>` : ""}</button>`, it.name)).join("")}</div>
    </section>`).join("");
  }
  return `<div class="stacks">${groups.map(g => {
    const last = g.items[g.items.length - 1];
    return `<section class="stack">
      <div class="stack-head">${g.tick ? grpTickHTML(g.title || "Cards") : ""}<strong>${esc(g.title || "Cards")}</strong><span class="muted small num">${g.items.reduce((n, x) => n + (x.qty || 1), 0)}</span></div>
      <div class="stack-bars">${g.items.map(it => `<button class="sbar${it.tone ? " " + it.tone : ""}" data-sheet="${ctx}" data-card="${esc(it.name)}"${it.i != null ? ` data-i="${it.i}"` : ""}${it.pick ? ` data-pick="${it.pick}" aria-pressed="false"` : ""}>
        <span class="sname">${it.pick ? tickHTML() : ""}${it.qty > 1 ? `<span class="num">${it.qty}×</span> ` : ""}${esc(it.name)}</span>${it.mv != null ? `<span class="smv num">${it.mv}</span>` : ""}</button>`).join("")}</div>
      <div class="stack-peek">${last ? imgTag(last.name) + flipBtnHTML(last.name, "peek-flip") : ""}</div>
    </section>`;
  }).join("")}</div>`;
}
// Hovering or focusing a name in a stack shows that card's image under the stack.
function peekStack(bar) {
  const peek = bar.closest(".stack") && bar.closest(".stack").querySelector(".stack-peek");
  if (!peek || peek.dataset.cur === bar.dataset.card) return;
  peek.dataset.cur = bar.dataset.card; peek.innerHTML = imgTag(bar.dataset.card) + flipBtnHTML(bar.dataset.card, "peek-flip"); paintImgs();
  bar.parentElement.querySelectorAll(".sbar.cur").forEach(x => x.classList.remove("cur")); bar.classList.add("cur");
}
document.addEventListener("pointerover", e => { const bar = e.target.closest && e.target.closest(".sbar"); if (bar && e.pointerType !== "touch") peekStack(bar); });
document.addEventListener("focusin", e => { const bar = e.target.closest && e.target.closest(".sbar"); if (bar) peekStack(bar); });

// Turn a list of { name, qty } into status-tagged items for image views.
function statusItem(name, qty, home, extra = {}) {
  const st = cardStatus(name, qty, home), card = DATA && cardOf(name);
  const sub = st.kind === "free" ? esc(stName(st)) : st.kind === "here" ? "in this deck" : st.kind === "indeck" ? `in deck: ${esc(stName(st))}`
    : st.kind === "basic" ? "basic land" : `missing${card && card[3] ? " · " + money(card[3]) : ""}`;
  return { name, qty, sub, tone: st.kind === "missing" ? "missing" : st.kind === "indeck" ? "indeck" : "", mv: card && card[2] !== "L" ? card[4] || 0 : null, ...extra };
}

// ------------------------------------------------------------ card text
// One entry per face that has its own text (split, adventure, double-faced cards), else the card itself.
function cardFaces(c) {
  const f = x => ({ name: x.name || "", cost: x.mana_cost || "", type: x.type_line || "", text: x.oracle_text || "",
    pt: x.power != null ? `${x.power}/${x.toughness}` : x.loyalty != null ? `Loyalty ${x.loyalty}` : x.defense != null ? `Defense ${x.defense}` : "" });
  const faces = (c.card_faces || []).filter(x => x.oracle_text != null || x.type_line);
  return faces.length > 1 ? faces.map(f) : [f(c)];
}
// Rules text with {T}, {2}{R} and the like as symbols, one paragraph per line, reminder text muted.
function rulesHTML(text) {
  const inline = s => esc(s).replace(/\{[^}]+\}/g, m => manaHTML(m.replace(/&amp;/g, "&"), ""))
    .replace(/\([^()]*\)/g, m => `<span class="rem">${m}</span>`);
  return String(text || "").split("\n").filter(Boolean).map(l => `<p>${inline(l)}</p>`).join("");
}
function cardTextHTML(name) {
  const k = norm(name), faces = TEXT.get(k);
  if (faces === undefined) return `<p class="muted small">Loading the card's text…</p>`;
  if (!faces && LOOKUP_FAILED.has(k)) return `<p class="muted small">${offline() ? "You're offline, and this card's text isn't saved on this device yet." : "The card's text didn't load."}</p>
    <div class="actions"><button class="btn" data-text-retry="${esc(name)}">Try again</button></div>`;
  if (!faces) return `<p class="muted small">Scryfall has no text for this card.</p>`;
  const many = faces.length > 1;
  return faces.map(f => `<div class="face">${many ? `<div><span class="fname">${esc(f.name)}</span> ${manaHTML(f.cost)}</div>` : ""}
    <div class="tl">${esc(f.type)}</div>${rulesHTML(f.text)}${f.pt ? `<div class="pt">${esc(f.pt)}</div>` : ""}</div>`).join("");
}
// Forget a failed lookup so the card is asked for again (its image too, if that failed with it).
function retryFailed(name) {
  const k = norm(name), b = shardOf(name);
  if (b != null && SHARDS.get(b) === "failed") SHARDS.delete(b);
  if (!LOOKUP_FAILED.has(k)) return;
  LOOKUP_FAILED.delete(k); if (TEXT.get(k) === null) TEXT.delete(k);
  if (IMG.get(k) === null) IMG.delete(k);
}
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-text-retry]");
  if (!t) return;
  const name = t.dataset.textRetry, box = t.closest("[data-textk]");
  retryFailed(name);
  if (box) { delete box.dataset.done; box.innerHTML = cardTextHTML(name); }
  const pic = document.querySelector(`#sheet .sheet-img`); if (pic && !pic.querySelector("img")) pic.innerHTML = imgTag(name);
  needText(name);
});
// The connection is back (the "online" event, the site's data answering again, or the app coming back to the front):
// forget what failed for want of one, then fill in the pictures on screen and the text of an open card.
function netBack() {
  if (navigator.onLine === false) return;
  if (PICS_NOW.waiting) picsSoon(500);
  let any = false;
  for (const [b, st] of [...SHARDS]) if (st === "failed") { SHARDS.delete(b); any = true; }
  for (const [k, d] of [...IMG_DOWN]) if (!stillDown(d)) { forgetDown(k); any = true; }
  if (!any) return;
  document.querySelectorAll("[data-textk]").forEach(box => {
    if (!box.querySelector("[data-text-retry]")) return;
    const name = box.dataset.name;
    retryFailed(name); delete box.dataset.done; box.innerHTML = cardTextHTML(name); needText(name);
  });
  paintImgs();
}
// Card text from our own text files when the data has them; from Scryfall otherwise (older data, demo
// data, a card the file lacks, or a file that didn't load).
function needText(name) {
  const k = norm(name);
  if (TEXT.has(k)) return;
  const b = shardOf(name);
  if (b != null) { const st = SHARDS.get(b); if (!st) { loadShard(b); return; } if (st === "loading") return; }
  lookupCard(name);
}
function lookupCard(name, sid) {
  const k = norm(name);
  if (imgQueue.has(k) || imgInflight.has(k)) return;
  sid = sid || (noDirect.has(k) ? null : sidFor(name));
  imgQueue.set(k, sid ? { id: sid } : { name: String(name).split(" // ")[0] });
  clearTimeout(imgTimer); imgTimer = setTimeout(flushImgs, 40);
}
// Who painted the art you're looking at. Your own printing (from the import) may not be the default one:
// when the card has more than one artwork, that printing's artist is looked up once.
// The artist readers (artistIdx, artistName, artistSpellings, artistProfile) live in engine.js.
function artistsOf(name) { return artistIdx(name).all.map(artistName).filter(Boolean); }
function shownArtist(name) {
  const k = norm(name), sid = noDirect.has(k) ? null : sidFor(name), ai = artistIdx(name);
  const lead = ai.lead.map(artistName).filter(Boolean);
  if (sid) {
    if (PRINT_ARTIST.has(sid)) return { names: PRINT_ARTIST.get(sid).split(" & ") };
    if (ai.all.length === 1) return { names: lead };
    if (lead.length && idsState === "ready" && defaultId(name) === sid) return { names: lead };
    if (lead.length && waitForIds()) return { pending: true };
    return { pending: true, lookup: sid };
  }
  if (lead.length) return { names: lead };
  if (PRINT_ARTIST.has("n:" + k)) return { names: PRINT_ARTIST.get("n:" + k).split(" & ") };
  return { pending: true };   // old data: comes with the text lookup
}
function artistHTML(name) {
  const a = shownArtist(name);
  if (a.lookup && !LOOKUP_FAILED.has(norm(name))) lookupCard(name, a.lookup);
  return a.names && a.names.length ? "Illustrated by " + a.names.map(n => `<button class="btn link" data-artist="${esc(artistKey(n))}" title="About ${esc(n)}">${esc(n)}</button>`).join(" &amp; ") : "";
}
// An artist by index when the data knows them, else by the name a lookup gave ("n:Name").
const artistKey = n => { const a = artistByName(n); return a == null ? "n:" + n : String(a); };
function paintText() {
  document.querySelectorAll("[data-textk]").forEach(el => {
    if (el.dataset.done || !TEXT.has(el.dataset.textk)) return;
    el.dataset.done = "1"; el.innerHTML = cardTextHTML(el.dataset.name);
  });
  document.querySelectorAll("[data-artk]").forEach(el => { if (!el.innerHTML) el.innerHTML = artistHTML(el.dataset.name); });
}
// "Show them" in an artist's profile searches your collection for their cards.
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-artist-search]");
  if (!t) return;
  closeSheet(); openBrowse(null); BROWSE.q = t.dataset.artistSearch; renderBrowse();
});

// The card sheet can step from a card to its artist and on to their cards; Back retraces the steps.
// SHEET_NOW is what the sheet shows ({card: [ctx, name, i]} or {artist: key}); SHEET_TRAIL holds
// earlier steps, newest last, and starts empty each time the sheet opens.
let SHEET_NOW = null, SHEET_TRAIL = [];
const sheetStepName = s => s.card ? s.card[1] : s.artist.startsWith("n:") ? s.artist.slice(2) : artistName(+s.artist);
const sheetBackHTML = () => SHEET_TRAIL.length ? `<button class="btn link sheet-back" data-sheet-back>${MARK.backTo} Back to ${esc(sheetStepName(SHEET_TRAIL[SHEET_TRAIL.length - 1]))}</button>` : "";
// After a step, focus goes to the top of the new page (Back), not lost on the replaced content.
const sheetFocusTop = () => { const el = $("#sheet [data-sheet-back]") || $("#sheet button"); if (el) el.focus({ preventScroll: true }); $("#sheet").scrollTop = 0; };
function sheetGo(fn) { if (SHEET_NOW && $("#sheet").open) SHEET_TRAIL.push(SHEET_NOW); fn(); sheetFocusTop(); }
function sheetBack() {
  const s = SHEET_TRAIL.pop(); if (!s) return closeSheet();
  if (s.card) openSheet(...s.card); else openArtist(s.artist);
  sheetFocusTop();
}
const scryfallArtistUrl = n => "https://scryfall.com/search?q=" + encodeURIComponent(`a:"${n}"`);
function openArtist(key) {
  const dlg = $("#sheet"), body = $("#sheet-body");
  const known = !String(key).startsWith("n:"), a = known ? +key : null;
  const p = known ? artistProfile(a) : null, name = known ? p.name : String(key).slice(2);
  SHEET_NOW = { artist: String(key) };
  const nums = p && p.cards ? `<p class="artist-nums"><span><strong class="num">${p.cards.toLocaleString()}</strong> ${p.cards === 1 ? "card" : "cards"}</span>${p.artworks != null ? `<span><strong class="num">${p.artworks.toLocaleString()}</strong> ${p.artworks === 1 ? "artwork" : "artworks"}</span>` : ""}</p>` : "";
  const top = p && p.top.length ? `<div class="artist-sec"><h3>Most played</h3>
      <div class="cgrid artist-top">${p.top.map(c => artTileHTML(c.name, a)).join("")}</div>
      <p class="muted small">By EDHREC rank. Tap one to see it larger.<span data-art-note${p.top.some(c => !c.lead && artistPrint(c.name, a) == null) ? "" : " hidden"}> “Another printing”: their art is on a printing other than the one pictured.</span></p></div>` : "";
  const owned = !known ? "" : !COLL ? "" : p.owned
    ? `<div class="artist-sec"><h3>In your collection</h3><p>${p.owned === 1 ? "1 card" : `${p.owned.toLocaleString()} cards`} they illustrated, in any printing. <button class="btn link" data-artist-search="${esc(name)}">Show ${p.owned === 1 ? "it" : "them"}</button></p></div>`
    : `<div class="artist-sec"><h3>In your collection</h3><p class="muted">None of their cards yet.</p></div>`;
  body.innerHTML = `<div class="sheet-info wide artist">
      ${sheetBackHTML()}
      <h2>${esc(name)}</h2>
      ${p && p.aka.length ? `<p class="muted small">Also credited as ${p.aka.map(esc).join(", ")}</p>` : ""}
      ${nums}${top}${owned}
      ${!known && COLL ? `<p><button class="btn link" data-artist-search="${esc(name)}">Find their cards in your collection</button></p>` : ""}
      <p><a href="${esc(scryfallArtistUrl(name))}" target="_blank" rel="noopener">All their cards on Scryfall ↗</a></p>
      <div class="sheet-pair">${SHEET_TRAIL.length ? `<button class="btn" data-sheet-back>Back</button>` : ""}<button class="btn" data-sheet-act="close">Close</button></div>
    </div>`;
  paintImgs();
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  dlg.scrollTop = 0;
}
// The artist's own printing of a card: the default one when the art there is theirs, else one Scryfall
// search (paced like the image lookups, remembered for the visit). Returns the Scryfall ID, null when
// there's none to show, or undefined while the search runs (onFound is called when it lands).
const ARTIST_PRINTS = new Map();   // "artist|norm name" -> ID | null | Promise
function artistPrint(name, a, onFound) {
  if (artistIdx(name).lead.includes(a)) return defaultId(name);
  const key = a + "|" + norm(name), got = ARTIST_PRINTS.get(key);
  if (typeof got === "string" || got === null) return got;
  if (!got) ARTIST_PRINTS.set(key, searchPrint(name, artistName(a))
    .then(id => { ARTIST_PRINTS.set(key, id); return id; }, () => { ARTIST_PRINTS.delete(key); return null; }));   // failed: asked again next time
  if (onFound) ARTIST_PRINTS.get(key).then(id => { if (id) onFound(id); });
  return undefined;
}
async function searchPrint(name, artist) {
  const wait = Math.max(imgLastCall + IMG_GAP, imgCoolUntil) - Date.now(); if (wait > 0) await sleep(wait);
  imgLastCall = Date.now();
  const q = `!"${String(name).replace(/"/g, "")}" a:"${String(artist).replace(/"/g, "")}"`;
  const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=art&order=released&dir=asc`, { headers: { "Accept": "application/json" } });
  if (r.status === 404) return null;   // Scryfall found no such printing
  if (r.status === 429) { imgCoolUntil = Date.now() + Math.max(IMG_RETRY_MS, (+r.headers.get("Retry-After") || 0) * 1000); throw new Error("429"); }
  if (!r.ok) throw new Error(String(r.status));
  const c = ((await r.json()).data || [])[0];
  return (c && c.id) || null;
}
const printImgHTML = (id, name) => { const back = showsBack(name); return `<span class="cimg" data-pid="${esc(id)}" data-name="${esc(name)}"><img src="${esc(faceUrl(directImg(id, "normal"), back))}" alt="${esc(back ? backName(name) : name)}" loading="lazy" decoding="async"></span>`; };
// A tile in "Most played": the artist's own printing when it's known; the usual one, labelled, until then.
function artTileHTML(name, a) {
  const id = artistPrint(name, a, () => {
    const btn = document.querySelector(`#sheet [data-art-tile="${a}|${CSS.escape(norm(name))}"]`); if (!btn) return;
    const el = btn.parentElement.classList.contains("ccell") ? btn.parentElement : btn;
    el.outerHTML = artTileHTML(name, a);
    const note = $("#sheet [data-art-note]"); if (note && !$("#sheet .artist-top em")) note.hidden = true;
  });
  const label = !id && !artistIdx(name).lead.includes(a);
  return tileCell(`<button class="ctile" data-art-tile="${a}|${esc(norm(name))}" data-card="${esc(name)}" aria-label="${esc(name)}, larger">${id ? printImgHTML(id, name) : imgTag(name)}<span class="ccap">${esc(name)}${label ? " <em>(another printing)</em>" : ""}</span></button>`, name);
}

// ------------------------------------------------------------ full-screen image viewer
// The whole card (Scryfall's large image) or only its art (art_crop). Art crops come in as many shapes
// as there are frames, so the picture is fitted whole into the screen, never cropped further or covered.
// Scryfall asks that an art crop shows its artist and copyright nearby: the caption always does.
// Opened from an artist's top cards (their own printing, with Card details) and from a card's picture.
const VIEW = { name: "", id: null, fallback: null, artists: [], mode: "card", details: false, token: 0 };
function viewUrl(size) {
  const back = showsBack(VIEW.name);
  if (VIEW.id) return faceUrl(directImg(VIEW.id, size), back);
  const u = VIEW.fallback && /cards\.scryfall\.io\/(small|normal|large)\//.test(VIEW.fallback) ? VIEW.fallback.replace(/\/(small|normal|large)\//, `/${size}/`) : size === "normal" ? VIEW.fallback : null;
  return faceUrl(u, back);
}
function openViewer(o) {
  Object.assign(VIEW, { name: o.name, id: o.id || null, fallback: o.fallback || null, artists: o.artists || [], details: !!o.details });
  if (o.mode) VIEW.mode = o.mode;   // from a card's picture: the card; from an artist's cards: whatever you chose last
  if (!viewUrl("art_crop")) VIEW.mode = "card";
  renderViewer();
  const dlg = $("#viewer");
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
function closeViewer() { const dlg = $("#viewer"); if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }
function renderViewer() {
  const art = !!viewUrl("art_crop");
  const back = showsBack(VIEW.name);
  $("#viewer-body").innerHTML = `<div class="viewer-head"><h2>${esc(back ? backName(VIEW.name) : VIEW.name)}</h2></div>
    <div class="viewer-pic" data-viewer-pic></div>
    <div class="viewer-foot">
      ${hasBack(VIEW.name) ? `<div class="seg seg-fill" role="group" aria-label="Face"><button data-viewer="front" aria-pressed="${!back}">Front</button><button data-viewer="back" aria-pressed="${back}">Back</button></div>` : ""}
      ${art ? `<div class="seg seg-fill" role="group" aria-label="Show"><button data-viewer="card" aria-pressed="${VIEW.mode === "card"}">Card</button><button data-viewer="art" aria-pressed="${VIEW.mode === "art"}">Art only</button></div>` : ""}
      <p class="viewer-credit">${VIEW.artists.length ? `Illustrated by ${VIEW.artists.map(esc).join(" &amp; ")} · ` : ""}™ &amp; © Wizards of the Coast</p>
      <div class="sheet-pair">${VIEW.details ? `<button class="btn" data-viewer="details">Card details</button>` : ""}<button class="btn" data-viewer="close">Close</button></div>
    </div>`;
  showViewerPic();
}
// The normal-size image (usually already loaded) shows at once; the large one or the art replaces it.
function showViewerPic() {
  const box = $("#viewer [data-viewer-pic]"); if (!box) return;
  const art = VIEW.mode === "art", want = viewUrl(art ? "art_crop" : "large"), first = art ? null : viewUrl("normal"), token = ++VIEW.token;
  const shown = showsBack(VIEW.name) ? backName(VIEW.name) : VIEW.name, alt = art ? `Art of ${shown}` : shown;
  box.innerHTML = first ? `<img class="vcard" src="${esc(first)}" alt="${esc(alt)}">` : `<p class="viewer-wait">Loading the art…</p>`;
  if (!want || want === first) return;
  const img = new Image(); img.alt = alt; img.className = art ? "vart" : "vcard"; img.decoding = "async";
  img.onload = () => { if (VIEW.token === token) box.replaceChildren(img); };
  img.onerror = () => { if (VIEW.token === token && art) box.innerHTML = `<p class="viewer-wait">Scryfall has no art-only image for this card.</p>`; };
  img.src = want;
}
document.addEventListener("click", e => {
  const tile = e.target.closest && e.target.closest("[data-art-tile]");
  if (tile) {
    const a = +tile.dataset.artTile.split("|")[0], name = tile.dataset.card, lead = artistIdx(name).lead.includes(a);
    const id = artistPrint(name, a, found => {   // their printing arrived while the viewer shows the usual one
      if ($("#viewer").open && VIEW.name === name && VIEW.id !== found) { Object.assign(VIEW, { id: found, artists: [artistName(a)] }); renderViewer(); }
    });
    return openViewer({ name, id, fallback: (IMG.get(norm(name)) || {}).normal, details: true,
      artists: id || lead ? [artistName(a)] : (shownArtist(name).names || []) });
  }
  const pic = e.target.closest && e.target.closest("[data-viewer-open]");
  if (pic) {
    if (!pic.querySelector("img")) return;   // nothing to enlarge yet
    const name = pic.dataset.viewerOpen, k = norm(name), v = IMG.get(k);
    return openViewer({ name, id: v && v.direct ? sidFor(name) || defaultId(name) : null, fallback: v && v.normal, artists: shownArtist(name).names || [], mode: "card" });
  }
  const t = e.target.closest && e.target.closest("[data-viewer]"); if (!t) return;
  const act = t.dataset.viewer;
  if (act === "close") closeViewer();
  else if (act === "card" || act === "art") { VIEW.mode = act; renderViewer(); }
  else if (act === "front" || act === "back") { setFlip(VIEW.name, act === "back"); renderViewer(); }   // the pictures behind turn too
  else if (act === "details") { closeViewer(); sheetGo(() => openSheet("artist", VIEW.name)); }
});

document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-artist], [data-sheet-back]");
  if (!t) return;
  if (t.hasAttribute("data-sheet-back")) return sheetBack();
  sheetGo(() => openArtist(t.dataset.artist));
});

// ------------------------------------------------------------ card details sheet
// What a card costs to buy: its cheapest printing ("from", once the data says which that is).
const lowKnown = () => !!(PRICE_DOC && Array.isArray(CURRENCY === "eur" ? PRICE_DOC.lowEur : PRICE_DOC.low));
const buyPriceText = name => { const p = priceOf(name); return p ? `${lowKnown() ? "from " : ""}${money(p)}` : ""; };
// Your copies in one location, each by what the import says of it (0.68.0): set and number, finish, condition,
// language, and its own price. Nothing for a copy whose import names no printing.
const condWords = c => String(c || "").split("_").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
function copiesHTML(name, loc) {
  const lines = [];
  for (const c of ownCopies(name)) {
    const e = c.e; if (e.loc !== loc || !e.set) continue;
    const p = copyPrint(e);
    const what = [`${esc(p.setName)}${p.cn ? ` <span class="num">#${esc(p.cn)}</span>` : ""}`, p.foil === "etched" ? "etched foil" : p.foil ? "foil" : "", esc(condWords(p.cond)), p.lang ? esc(p.lang.toUpperCase()) : "",
      c.own ? `<span class="num">${money(c.price)}</span>` : ""].filter(Boolean).join(" · ");
    lines.push(`<li>${what}${e.qty > 1 ? ` <span class="num">×${e.qty}</span>` : ""}</li>`);
  }
  return lines.length ? `<ul class="copy-list muted" data-copies>${lines.join("")}</ul>` : "";
}
function openSheet(ctx, name, i, mode = "") {
  const dlg = $("#sheet"), body = $("#sheet-body");
  dlg.dataset.ctx = ctx || ""; dlg.dataset.i = i != null ? String(i) : "";
  if (!dlg.open) SHEET_TRAIL = [];
  SHEET_NOW = { card: [ctx, name, i] };
  const card = DATA && cardOf(name), a = AGG.get(norm(name)), b = curBuild();
  if (card) retryFailed(name);   // a lookup that failed earlier gets another go
  const locs = a ? [...a.locs.entries()].sort((x, y) => (x[1].inDeck - y[1].inDeck) || x[0].localeCompare(y[0], undefined, { numeric: true })) : [];
  const roles = hasRoles() ? roleList(roleBits(name)).filter(r => ROLE_COUNTED.includes(r)) : [];
  const inBuild = b && b.cards.some(c => norm(c.name) === norm(name)), inSideboard = b && !inBuild && inSide(b, name);
  let actions = "";
  if (ctx === "build" && b && i != null && b.cards[i]) {
    const c = b.cards[i], st = cardStatus(c.name, c.qty, buildHome(b));
    const subs = hasRoles() && !isCmd(b, c.name) && (st.kind === "missing" || st.kind === "indeck")
      ? substitutes(c.name, { identity: buildIdentity(b), exclude: new Set([...b.cards.map(x => norm(x.name)), ...sideKeys(b)]) }) : [];
    const why = b.why && b.why[c.name], kept = isKept(b, c.name);
    const prefBtns = !isCmd(b, c.name) && !isBasic(c.name) && !isComp(b, c.name)
      ? `<div class="actions"><button class="btn" data-sheet-act="keep" data-i="${i}" aria-pressed="${kept}">${kept ? `Kept ${MARK.pass}` : "Keep"}</button><button class="btn" data-sheet-act="dismiss" data-i="${i}">Not for this build</button></div>
        <p class="muted small">${kept ? "Kept: tuning and regenerating won't take it out. " : "“Keep” stops tuning and regenerating from taking it out. "}“Not for this build” swaps in a card that does the same job and suggests this one a little less from now on.</p>` : "";
    actions = `${why ? `<p class="small"><strong>Why it's here:</strong> ${esc(why)}</p>` : ""}<div class="actions"><button class="btn" data-sheet-act="cmd" data-i="${i}">${isCmd(b, c.name) ? "Unset commander" : "Make commander"}</button>${isCompanionCard(c.name) ? `<button class="btn" data-sheet-act="comp" data-i="${i}">${isComp(b, c.name) ? "Unset companion" : "Make companion"}</button>` : ""}
      ${isCmd(b, c.name) || isComp(b, c.name) ? "" : `<button class="btn" data-sheet-act="toside" data-i="${i}">Move to sideboard</button>`}
      <button class="btn danger" data-sheet-act="rm" data-i="${i}">Remove from build</button></div>${prefBtns}
      ${subs.length ? `<p class="small muted">Swap for a card you own:</p><div class="actions">${subs.map(x => `<button class="swap-opt" data-sheet-act="swap" data-i="${i}" data-with="${esc(x.name)}"><strong>${esc(x.name)}</strong><small>${subWhere(x.st)}</small></button>`).join("")}</div>` : ""}`;
  } else if (ctx === "side" && b && i != null && sideOf(b)[i]) {
    // A sideboard card (i = its place in b.side): back to the deck, or out of the sideboard.
    actions = `<p class="small muted">In the sideboard of ${esc(b.name)}: kept with the deck, outside the 100.</p>
      <div class="actions"><button class="btn primary" data-sheet-act="todeck" data-i="${i}">Move to deck</button><button class="btn danger" data-sheet-act="siderm" data-i="${i}">Remove from sideboard</button></div>`;
  } else if (b && !b.built) {
    actions = inBuild ? `<p class="small muted">Already in ${esc(b.name)}.</p>` : inSideboard ? `<p class="small muted">In the sideboard of ${esc(b.name)}.</p>`
      : `<div class="actions"><button class="btn primary" data-sheet-act="add" data-card="${esc(name)}">Add to ${esc(b.name)}</button></div>`;
  }
  if (card && !isBasic(name) && !(ctx === "build" && b && isCmd(b, name))) actions += tasteSegHTML(card[0]);
  // In the collection browser a card can be removed from the collection (addcards.js, 0.83.0); with several copies,
  // which one is asked in place of the other actions (mode "rm").
  if (ctx === "browse") actions = mode === "rm" && canRemoveHere(name) ? rmChooserHTML(name) : actions + rmButtonHTML(name);
  body.innerHTML = `${SHEET_TRAIL.length ? `<div class="sheet-top">${sheetBackHTML()}</div>` : ""}<div class="sheet-pic"><button class="sheet-img" data-viewer-open="${esc(name)}" aria-label="${esc(name)}, larger">${imgTag(name)}</button>${flipBtnHTML(name, "sheet-flip")}</div>
    <div class="sheet-info">
      <h2>${esc(name)}</h2>
      <p class="muted small">${card ? [TYPE_SINGULAR[card[2]], card[2] !== "L" ? (costOf(name) ? `${manaHTML(costOf(name))} <span class="num">(${card[4] || 0})</span>` : `mana value ${card[4] || 0}`) : "", buyPriceText(name)].filter(Boolean).join(" · ") : ""}</p>
      ${card ? `<p>${pips(card[1])}</p>` : ""}
      ${card ? `<div class="ctext" data-textk="${esc(norm(name))}" data-name="${esc(name)}" aria-live="polite">${cardTextHTML(name)}</div>
        <p class="small muted" data-artk data-name="${esc(name)}">${artistHTML(name)}</p>` : ""}
      ${roles.length ? `<p class="small">Roles: ${roles.map(esc).join(", ")}</p>` : ""}
      ${card ? `<div class="small makes" data-makes data-name="${esc(name)}">${makesHTML(name)}</div>` : ""}
      ${card && formatsOffered() ? `<div class="formats small" data-formats data-name="${esc(name)}">${formatsHTML(name)}</div>` : ""}
      <div class="small"><strong>Where it is</strong>${locs.length
        ? `<ul class="where-list">${locs.map(([loc, l]) => `<li>${locIconHTML(loc, l.inDeck, null, "sm")}${esc(locName(loc))}${l.qty > 1 ? ` <span class="num">×${l.qty}</span>` : ""}${l.inDeck ? ` <span class="tag-deck">IN A DECK</span>${placeName(loc, true) !== locName(loc) ? ` <span class="muted">${esc(placeName(loc, true))}</span>` : ""}` : ""}${copiesHTML(name, loc)}</li>`).join("")}</ul>`
        : `<p class="muted">Not in your collection.</p>`}</div>
      ${actions}
      ${SHEET_TRAIL.length ? `<div class="sheet-pair"><button class="btn" data-sheet-back>Back</button><button class="btn" data-sheet-act="close">Close</button></div>`
        : `<div class="actions"><button class="btn" data-sheet-act="close">Close</button></div>`}
    </div>`;
  if (card) needText(name);
  if (card && formatsOffered()) loadLegal();
  paintImgs(); paintText();
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
// The card details' Formats block: the shortlist grouped as Legal / Restricted / Banned / Not legal.
function formatsHTML(name) {
  if (!legalReady()) return legalState === "failed" ? "" : `<strong>Formats</strong><p class="muted">Loading…</p>`;
  const g = legalityOf(name), tags = { legal: ["ok", "Legal"], restricted: ["warn", "Restricted"], banned: ["ban", "Banned"], not: ["no", "Not legal"] };
  const lines = Object.keys(tags).filter(k => g[k].length)
    .map(k => `<li><span class="ftag ${tags[k][0]}">${tags[k][1]}</span><span>${g[k].map(f => FORMAT_NAMES[f] || f).join(", ")}</span></li>`);
  return lines.length ? `<strong>Formats</strong><ul class="fmt-list">${lines.join("")}</ul>` : "";
}
function paintFormats() { document.querySelectorAll("[data-formats]").forEach(el => { el.innerHTML = formatsHTML(el.dataset.name); }); }
function closeSheet() { const dlg = $("#sheet"); if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }

function rerenderCurrent() {
  if (view === "build") renderBuild();
  else if (view === "deck" && curDeckIdx != null) openDeck(curDeckIdx, true);
  else if (view === "browse") renderBrowse();
  else if (view === "combos") renderCombos();
}

// A window that crosses 700 px (a phone turned on its side, a narrowed window) gains or loses the Table choice.
if (TABLE_FITS.addEventListener) TABLE_FITS.addEventListener("change", () => rerenderCurrent());

document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-cardview], [data-sheet], [data-sheet-act]");
  if (!t) return;
  if (t.dataset.cardview) { CARDVIEW = t.dataset.cardview; store.set("bt.cardview", CARDVIEW); rerenderCurrent(); return; }
  if (t.dataset.sheet) {
    const go = () => openSheet(t.dataset.sheet, t.dataset.card, t.dataset.i != null ? +t.dataset.i : null);
    if (t.hasAttribute("data-sheet-nav")) sheetGo(go); else go();
    return;
  }
  const act = t.dataset.sheetAct, i = t.dataset.i != null ? +t.dataset.i : null;
  if (act === "close") closeSheet();
  else if (act === "rm") { closeSheet(); removeFromBuild(i); }
  else if (act === "toside") { closeSheet(); moveToSide(i); }
  else if (act === "todeck") { closeSheet(); moveToDeck(i); }
  else if (act === "siderm") { closeSheet(); removeFromSide(i); }
  else if (act === "cmd") { closeSheet(); toggleCommander(i); }
  else if (act === "comp") { closeSheet(); toggleCompanion(i); }
  else if (act === "swap") { closeSheet(); swapInBuild(i, t.dataset.with); }
  else if (act === "add") { closeSheet(); addToBuild(t.dataset.card); rerenderCurrent(); }
  else if (act === "collrm") rmFromSheet(t.dataset.card);
  else if (act === "collrm-no") openSheet("browse", t.dataset.card, null);
  else if (act === "dismiss") { closeSheet(); genDrop(i, false); }
  else if (act === "keep") { const b = curBuild(); if (b && b.cards[i]) { setKeep(b, b.cards[i].name, !isKept(b, b.cards[i].name)); openSheet("build", b.cards[i].name, i); } }
});
// Your taste for a card, from the five-step control in its details. Setting Never on a card in a
// generated build swaps it out, as "Not for this build" does; in a deck you made, it stays.
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-taste], [data-taste-reset]");
  if (!t) return;
  const name = t.dataset.card || t.dataset.tasteReset, prev = prefOf(name) ? { ...prefOf(name) } : null;
  if (t.dataset.tasteReset) { setPref(name, { dismissed: 0 }); }
  else {
    const lv = +t.dataset.taste, b = curBuild();
    if (lv === tasteOf(name)) return;
    const i = b ? b.cards.findIndex(c => norm(c.name) === norm(name)) : -1;
    if (lv === -2 && b && i >= 0 && b.source && b.source.kind === "generated" && !isKept(b, name)) { closeSheet(); return genDrop(i, true); }
    setTaste(name, lv);
    if (lv !== 0) toast(`${name}: ${tasteName(lv)}`, "Undo", () => { restorePref(name, prev); rerenderCurrent(); });
  }
  GEN_IDEAS.clear(); TUNE_CACHE.clear();
  const dlg = $("#sheet"), ctx = dlg && dlg.dataset.ctx, i = dlg && dlg.dataset.i !== "" ? +dlg.dataset.i : null;
  if (dlg && dlg.open) openSheet(ctx, name, i);
  rerenderCurrent();
});
// Tap outside the sheet to close it.
document.addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });

"use strict";
// Bulk Tutor, the page's script, part "about": the version, installing, the theme, About, problem reports, credits and legal lines, files shared into the app.
// index.html loads these files in order, after engine.js; they are plain scripts sharing one global scope.

// ------------------------------------------------------------ version, install, sharing into the app
const APP_VERSION = "0.90.1";   // bump with each batch of changes; shown in About and the footer
const UA = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(UA);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isFramed = window.top !== window;   // embedded in another page: installing there would install that page's site
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderBanners(); });
window.addEventListener("appinstalled", () => { installEvt = null; store.set("bt.install", "done"); renderBanners(); });

function installStepsHTML() {
  if (isStandalone()) return `<p>You're using the installed app.</p>`;
  if (isFramed) return `<p class="muted">Open Bulk Tutor at its own address (your GitHub Pages link) to install it.</p>`;
  if (installEvt) return `<div class="actions"><button class="btn primary" data-install>Install Bulk Tutor</button></div>`;
  if (isIOS) return `<ol class="steps"><li>Open this page in Safari.</li><li>Tap the Share button (a square with an arrow). On newer iPhones it may be under the ••• button.</li><li>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li></ol>`;
  if (isAndroid) return `<ol class="steps"><li>Open this page in Chrome.</li><li>Tap the ⋮ menu.</li><li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li></ol>`;
  return `<p>In Chrome or Edge, click the install icon at the right end of the address bar, or choose <strong>Install Bulk Tutor</strong> from the browser menu. In Safari on a Mac, choose <strong>File → Add to Dock</strong>.</p>`;
}
// On iPhone, a Home Screen app has its own storage, separate from Safari's: offer Dropbox as the bridge.
function showHomeScreenSyncHint() {
  return isIOS && isStandalone() && dbxAvailable() && !dbxConnected() && !DBX.awaitingCode && !store.get("bt.hs-sync") && (!COLL || COLL.example);
}
function showInstallHint() {
  return !isFramed && !isStandalone() && !store.get("bt.install") && (isIOS || isAndroid) && !!COLL && !COLL.example;
}
function installHintHTML() {
  return `<div class="banner info"><span><strong>Add Bulk Tutor to your Home Screen.</strong> It opens like an app and works offline${isIOS ? ", and Safari won't clear your builds and saved decks the way it does for sites you haven't visited in a while" : ""}.</span>
    <span class="actions">${installEvt ? `<button class="btn primary" data-install>Install</button>` : `<button class="btn primary" data-about>Show me how</button>`}<button class="btn" data-install-dismiss>Not now</button></span></div>`;
}
// Theme: "system" follows the device; "light" / "dark" set data-theme on <html>, which the color tokens follow.
const themePref = () => store.get("bt.theme") || "system";
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
const themeSegHTML = () => [["system", "System"], ["light", "Light"], ["dark", "Dark"]]
  .map(([k, label]) => `<button data-theme-pick="${k}" aria-pressed="${themePref() === k}">${label}</button>`).join("");
document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-theme-pick]"); if (!t) return;
  const k = t.dataset.themePick;
  if (k === "system") store.del("bt.theme"); else store.set("bt.theme", k);
  applyTheme(k);
  const seg = $("#theme-seg"); if (seg) seg.innerHTML = themeSegHTML();
});
function openAbout(to) {
  $("#about-body").innerHTML = `<div class="about-head"><h2>Bulk Tutor</h2><span class="beta" aria-hidden="true">Beta</span><span class="muted">Version ${APP_VERSION}</span></div>
    <p>A work in progress, shared with a few friends for testing. Expect rough edges and changes; it isn't ready for public use yet.</p>
    <p class="muted">${dbxConnected() ? "Your collection, builds and saved decks are kept in this browser and synced to your own Dropbox. Nothing goes anywhere else." : "Your collection, builds and saved decks stay in this browser. Nothing is uploaded unless you connect your own Dropbox (Settings, the gear at the top)."}</p>
    <h3>Install it as an app</h3>
    <p>It opens full screen from your Home Screen and works with no connection: your collection, your builds, the card data, combos and every card's text are kept on this device, with pictures for the cards you've looked at. To keep the pictures for all your builds and decks, or your whole collection, see Offline in Settings.${isIOS ? " On iPhone it also keeps your data safe: Safari clears saved data for sites you haven't visited in about a week, but Home Screen apps are exempt." : ""}${isAndroid ? " Once it's installed, you can share a ManaBox export straight to Bulk Tutor from the share menu." : ""}</p>
    ${installStepsHTML()}
    <h3 id="about-prices">Prices</h3>
    <p>Prices come from Scryfall, which carries TCGplayer's market price in US dollars and Cardmarket's in euros. The site refreshes them once a day; Prices in Settings says when, and is where you choose the currency.</p>
    <p>Your own cards are valued by their printing and finish (regular, foil or etched) when your import names them. A copy with no printing named, and any card you don't own, uses the card's cheapest printing.</p>
    <p class="muted">Every price is for a Near Mint copy. Bulk Tutor keeps each copy's condition and language from your import but doesn't price them, so a played copy or one in another language may be worth less, or more, than shown. Treat the values as a guide, not an appraisal.</p>
    <h3>Credits and legal</h3>
    <p>${creditsHTML()}</p>
    <p class="muted">${legalHTML()}</p>
    <p class="muted">${OWN_HTML}</p>
    <h3>Questions or feedback</h3>
    <p>Email Matt at ${contactLink()}. Bug reports, ideas and “this card looks wrong” are all welcome.</p>
    <p class="muted">Something broken? “Report a problem” starts an email with your version, device and setup filled in. If email doesn't open, copy the details instead.</p>
    <div class="actions"><a class="btn" href="${reportMailto()}">Report a problem</a><button class="btn" data-report-copy>Copy problem details</button></div>
    <div id="report-out"></div>
    <div class="actions"><button class="btn" data-about-close>Close</button></div>`;
  const dlg = $("#about");
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  const at = to && $(`#about-${CSS.escape(to)}`); if (at) at.scrollIntoView({ block: "start" });   // "How prices work" opens at Prices
}
function closeAbout() { const dlg = $("#about"); if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }
document.addEventListener("click", async e => {
  if (e.target.id === "about") { closeAbout(); return; }   // tap outside the sheet
  const t = e.target.closest && e.target.closest("[data-about], [data-about-close], [data-install], [data-install-dismiss], [data-hs-dismiss]");
  if (!t) return;
  if (t.hasAttribute("data-about")) openAbout(t.dataset.about);
  else if (t.hasAttribute("data-about-close")) closeAbout();
  else if (t.hasAttribute("data-install-dismiss")) { store.set("bt.install", "dismissed"); renderBanners(); }
  else if (t.hasAttribute("data-hs-dismiss")) { store.set("bt.hs-sync", "dismissed"); renderBanners(); }
  else if (t.hasAttribute("data-install") && installEvt) {
    const evt = installEvt; installEvt = null;
    try { await evt.prompt(); const choice = await evt.userChoice; if (choice && choice.outcome === "accepted") store.set("bt.install", "done"); } catch {}
    closeAbout(); renderBanners();
  }
});
const CONTACT = ["matt", "bulktutor.com"].join("@");
const contactLink = () => `<a href="mailto:${CONTACT}?subject=${encodeURIComponent("Bulk Tutor")}">${CONTACT}</a>`;
const VIEW_NAMES = { build: "Workbench", collection: "Collection", browse: "Collection (browsing)", import: "Import", decks: "Find decks", deck: "Find decks (a deck)", combos: "Combos", settings: "Settings" };
// What a bug report needs, without anything personal beyond counts.
function reportDetails() {
  const os = isIOS ? "iPhone/iPad" : isAndroid ? "Android" : /Mac/.test(UA) ? "Mac" : /Windows/.test(UA) ? "Windows" : /Linux/.test(UA) ? "Linux" : "Other";
  const coll = COLL && !COLL.example ? `${COLL.entries.reduce((n, e) => n + e.qty, 0).toLocaleString()} cards from ${COLL.source}${COLL.importedAt ? `, imported ${shortDate(Date.parse(COLL.importedAt))}` : ""}` : "none (example collection)";
  const s = DBX.state || {};
  return [
    `Bulk Tutor ${APP_VERSION}`,
    `Page: ${VIEW_NAMES[view] || view}`,
    `Device: ${os}, ${isStandalone() ? "installed app" : "browser"}, window ${innerWidth}×${innerHeight}`,
    `Browser: ${UA}`,
    `Card data: ${DATA ? `${DATA.version || "?"}${DATA.demo ? " (demo)" : ""}, ${DATA.decks.length} decks, ${DATA.cards.length.toLocaleString()} cards` : "not loaded"}`,
    `Collection: ${coll}`,
    `Builds: ${BUILDS.length}, saved decks: ${SAVED.length}, card view: ${CARDVIEW}`,
    `Dropbox: ${dbxConnected() ? `connected${s.synced ? `, synced ${ago(s.synced)}` : ""}${DBX.status === "error" ? `, last error: ${DBX.error}` : ""}` : dbxAvailable() ? "not connected" : "not set up"}`,
  ].join("\n");
}
function reportMailto() {
  const body = `What happened?\n\n\nWhat did you expect to happen?\n\n\n---\n${reportDetails()}`;
  return `mailto:${CONTACT}?subject=${encodeURIComponent(`Bulk Tutor problem (${APP_VERSION})`)}&body=${encodeURIComponent(body)}`;
}
document.addEventListener("click", e => {
  if (e.target.closest && e.target.closest("[data-report-copy]")) copyText(reportDetails(), "#report-out", "Copied the problem details");
});
function renderContacts() { document.querySelectorAll("[data-contact]").forEach(el => { el.innerHTML = contactLink(); }); }
// Credits and the Fan Content Policy notice: written once, shown in the footer and in About. The first
// three sentences of the notice are the wording the policy asks for; keep them as they are.
const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
// Credits follow the data that's actually loaded: the fetcher lists the sources a refresh used in
// DATA.credits ("edhrec" decks, "edhrec-ranks" via Scryfall, "spellbook" combos). Scryfall is always
// credited, because the page loads card images and mana symbols from it directly. Demo data is hand-made.
function dataCredits() {
  if (!DATA || DATA.demo) return new Set();
  if (Array.isArray(DATA.credits)) return new Set(DATA.credits);
  return new Set([...(DATA.decks.length ? ["edhrec"] : []), "edhrec-ranks", "spellbook"]);   // data from before 0.20.0
}
function creditsHTML() {
  const c = dataCredits(), parts = [];
  if (c.has("edhrec")) parts.push(`deck data from ${ext("https://edhrec.com", "EDHREC")}`);
  parts.push(`card data${c.has("edhrec-ranks") ? ` (including ${ext("https://edhrec.com", "EDHREC")}'s popularity ranks)` : ""}, prices, card images and mana symbols from ${ext("https://scryfall.com", "Scryfall")}`);
  if (c.has("spellbook")) parts.push(`combos from ${ext("https://commanderspellbook.com", "Commander Spellbook")}`);
  const s = parts.join("; ") + ".";
  return s[0].toUpperCase() + s.slice(1);
}
const OWN_HTML = `All other content © 2026 Bulk Tutor.`;
// The policy's own sentences stay verbatim; the affiliation list names whoever the credits name.
function legalHTML() {
  const c = dataCredits(), names = ["Wizards of the Coast", "Scryfall"];
  if (c.has("edhrec") || c.has("edhrec-ranks")) names.push("EDHREC");
  if (c.has("spellbook")) names.push("Commander Spellbook");
  const list = names.length > 2 ? names.slice(0, -1).join(", ") + " or " + names.at(-1) : names.join(" or ");
  return `Bulk Tutor is unofficial Fan Content permitted under the ${ext("https://company.wizards.com/en/legal/fancontentpolicy", "Fan Content Policy")}. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. This includes the mana symbols, card names, text and images. Bulk Tutor is not affiliated with ${list}.`;
}
function renderLegal() {
  document.querySelectorAll("[data-credits]").forEach(el => { el.innerHTML = creditsHTML(); });
  document.querySelectorAll("[data-own]").forEach(el => { el.innerHTML = OWN_HTML; });
  document.querySelectorAll("[data-legal]").forEach(el => { el.innerHTML = legalHTML(); });
}
renderLegal();
renderContacts();
function renderVersion() {
  const el = $("#footer-ver");
  if (el) el.innerHTML = `Bulk Tutor ${APP_VERSION} beta: a work in progress, shared for testing. <button class="btn link" data-about>About and install</button>`;
}
renderVersion();

// Ask the browser to keep this site's data (builds, saved decks) instead of clearing it under storage pressure.
// Chrome and Safari decide quietly; Firefox would show a prompt, so it's skipped there.
if (navigator.storage && navigator.storage.persist && !/Firefox\//.test(UA)) {
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
}

// Android: a file shared to the installed app arrives via the service worker (manifest share_target),
// which stashes it and opens ?shared=1. Pick it up and run it through the normal import.
async function takeShared() {
  if (!new URLSearchParams(location.search).has("shared")) return null;
  try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
  if (!("caches" in window)) return null;
  try {
    const key = new URL("shared-item", location.href).href;
    let cache = null, res = null;
    for (const name of ["bulk-tutor-share", "binder-brew-share"]) { cache = await caches.open(name); res = await cache.match(key); if (res) break; }
    if (!res) return null;
    await cache.delete(key);
    return { text: await res.text(), name: decodeURIComponent(res.headers.get("x-name") || "Shared file"), kind: res.headers.get("x-kind") || "file" };
  } catch { return null; }
}

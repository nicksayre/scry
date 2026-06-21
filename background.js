// background.js — Scryfall Search (links + selections)

// ----- Configuration -----
const MENU_ID = "scryfall-search";

// Query construction strategy:
//   "freetext"     → grave pact                  (plain name search; recommended)
//   "exact"        → !"grave pact"               (strict exact-name match)
//   "name-words"   → name:grave name:pact        (all words must be in the name)
//   "oracle-words" → (oracle:grave oracle:pact)  (searches RULES text — usually not what you want)
const QUERY_STRATEGY = "freetext";

// Appended to every query.
const QUERY_TAIL = "(game:paper) prefer:best";

// Open the Scryfall tab in the foreground (true) or background (false)?
const OPEN_ACTIVE = true;

// ----- 1. Create the menu item (once) -----
browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: "Search Scryfall for this card",
    contexts: ["link", "selection"] // show on links AND on text selections
  });
});

// ----- 2. Handle clicks -----
browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const query = await resolveQuery(info, tab);
  if (!query) return;

  await browser.tabs.create({
    url: buildScryfallUrl(query),
    active: OPEN_ACTIVE,
    index: tab ? tab.index + 1 : undefined
  });
});

// ----- 3. Decide what to search: selection > link text > URL slug -----
async function resolveQuery(info, tab) {
  // (a) An explicit selection always wins. Covers unlinked card names, and lets
  //     you override a link's text by highlighting just the part you want.
  if (info.selectionText && info.selectionText.trim()) {
    return info.selectionText.replace(/\s+/g, " ").trim();
  }

  // (b) Otherwise, if it's a link, read its anchor text. We inject readLinkText
  //     into the exact frame clicked; running as a content script lets it call
  //     menus.getTargetElement().
  if (info.linkUrl && tab) {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
        func: readLinkText,
        args: [info.targetElementId]
      });
      const text = results && results[0] && results[0].result;
      if (text) return text;
    } catch (err) {
      console.error("Scryfall Search: could not read link text.", err);
    }
  }

  // (c) Last-ditch fallback: derive a name from the link URL itself.
  if (info.linkUrl) return lastPathSegment(info.linkUrl);

  return "";
}

// ----- 4. Injected into the page (content-script context) -----
// Self-contained: may use browser.menus.getTargetElement + the DOM, but cannot
// reference anything from this file's scope.
function readLinkText(targetElementId) {
  let el = browser.menus.getTargetElement(targetElementId);
  while (el && el.nodeName !== "A") el = el.parentElement;
  if (!el) return "";
  let text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) {
    // image-only or icon links: try sensible attributes
    const img = el.querySelector("img[alt]");
    text =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (img && img.getAttribute("alt")) ||
      "";
    text = text.replace(/\s+/g, " ").trim();
  }
  return text;
}

// ----- Helpers (background context) -----
function buildScryfallUrl(rawText) {
  const name = rawText.replace(/\s+/g, " ").trim();
  let q;
  switch (QUERY_STRATEGY) {
    case "exact":
      q = `!"${name}" ${QUERY_TAIL}`;
      break;
    case "name-words":
      q = name.split(" ").map((w) => "name:" + w).join(" ") + " " + QUERY_TAIL;
      break;
    case "oracle-words":
      q = "(" + name.split(" ").map((w) => "oracle:" + w).join(" ") + ") " + QUERY_TAIL;
      break;
    case "freetext":
    default:
      q = `${name} ${QUERY_TAIL}`;
      break;
  }
  const params = new URLSearchParams({ as: "grid", order: "name", q });
  return "https://scryfall.com/search?" + params.toString();
}

function lastPathSegment(urlStr) {
  try {
    const u = new URL(urlStr);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(seg).replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

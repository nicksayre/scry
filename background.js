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

// ----- 3. Decide what to search: link (unless selection overlaps it) > URL slug -----
async function resolveQuery(info, tab) {
  // (a) A link is the primary signal. Resolve in-page so readLinkText can check
  //     whether any current selection actually overlaps the clicked link —
  //     Firefox does not clear a page selection just because you right-click
  //     a different, unrelated link, so info.selectionText can be stale text
  //     that has nothing to do with the link you clicked.
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

  // (b) Plain selection: either there's no link (selection-only context), or
  //     injection failed/was blocked (reader view, PDF viewer, about: pages).
  if (info.selectionText && info.selectionText.trim()) {
    return info.selectionText.replace(/\s+/g, " ").trim();
  }

  // (c) Last-ditch fallback: derive a name from the link URL itself.
  if (info.linkUrl) return lastPathSegment(info.linkUrl);

  return "";
}

// ----- 4. Injected into the page (content-script context) -----
// Self-contained: may use browser.menus.getTargetElement + the DOM, but cannot
// reference anything from this file's scope.
function readLinkText(targetElementId) {
  const target = browser.menus.getTargetElement(targetElementId);
  let el = target;
  while (el && el.nodeName !== "A") el = el.parentElement;

  // An explicit selection overrides the link's text only if it actually
  // overlaps the clicked <a> (e.g. you highlighted just "Grave Pact" inside
  // a decorated link reading "Grave Pact (EDH)"). A selection sitting
  // elsewhere on the page — left over from before you right-clicked this
  // link — does not count, even though Firefox still reports it.
  const win = target && target.ownerDocument && target.ownerDocument.defaultView;
  const sel = win && typeof win.getSelection === "function" ? win.getSelection() : null;
  const selectionText = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
  if (el && selectionText && sel.rangeCount > 0) {
    let overlaps = false;
    for (let i = 0; i < sel.rangeCount; i++) {
      if (sel.getRangeAt(i).intersectsNode(el)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) return selectionText;
  }

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

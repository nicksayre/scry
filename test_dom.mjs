import vm from "node:vm";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const src = fs.readFileSync("../scryfall-search/background.js", "utf8");

// Build a DOM and a registry that maps fake targetElementIds -> nodes,
// emulating browser.menus.getTargetElement().
const dom = new JSDOM(`<!DOCTYPE html><body>
  <a id="plain" href="/c/grave-pact">Grave Pact</a>
  <a id="nested" href="/c/x"><span><b>Smuggler's</b> Copter</span></a>
  <a id="img" href="/c/y"><img alt="Sol Ring" src="s.png"></a>
  <a id="decorated" href="/c/z">Grave Pact (EDH)</a>
  <p id="loose">Some prose mentioning Rhystic Study here.</p>
</body>`);
const doc = dom.window.document;
const registry = {
  1: doc.querySelector("#plain"),
  2: doc.querySelector("#nested").querySelector("b"), // clicked the inner <b>
  3: doc.querySelector("#img").querySelector("img"),  // clicked the <img>
  4: doc.querySelector("#decorated"),
};

// Selects the given element's text content as the page's live selection,
// the way a user highlighting it with the mouse would.
function selectNode(node) {
  const range = doc.createRange();
  range.selectNodeContents(node);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
function clearSelection() {
  dom.window.getSelection().removeAllRanges();
}

const noop = () => {};
const sandbox = {
  console, URL, URLSearchParams,
  browser: {
    runtime: { onInstalled: { addListener: noop } },
    menus: {
      onClicked: { addListener: noop },
      create: noop,
      getTargetElement: (id) => registry[id] || null
    },
    // Emulate executeScript by actually running readLinkText in-process
    // against our jsdom registry (this is what Firefox does in the page).
    scripting: {
      executeScript: async ({ args }) => [{ result: sandbox.readLinkText(args[0]) }]
    },
    tabs: { create: async () => {} }
  }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

let pass = 0, fail = 0;
async function check(name, gotP, want) {
  const got = await gotP;
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        got:  ${JSON.stringify(got)}`); console.log(`        want: ${JSON.stringify(want)}`); fail++; } else pass++;
}

const tab = { id: 7, index: 2 };

// readLinkText: plain anchor
await check("readLinkText: plain anchor", sandbox.readLinkText(1), "Grave Pact");
// readLinkText: click inner element, walk up to <a>, collapse whitespace
await check("readLinkText: nested markup", sandbox.readLinkText(2), "Smuggler's Copter");
// readLinkText: image-only link falls back to alt
await check("readLinkText: image alt fallback", sandbox.readLinkText(3), "Sol Ring");

// resolveQuery: stale/unrelated selection elsewhere on the page does NOT
// override a clicked link -- this is the bug being fixed. Firefox keeps
// reporting the old selection in info.selectionText even though the user
// clearly meant to act on the link they right-clicked.
clearSelection();
selectNode(doc.querySelector("#loose"));
await check("resolveQuery: unrelated selection does not steal a link click",
  sandbox.resolveQuery({ selectionText: "Rhystic Study", linkUrl: "/c/grave-pact", targetElementId: 1, frameId: 0 }, tab),
  "Grave Pact");

// resolveQuery: selection wins only when it overlaps the clicked link itself
// (e.g. highlighting just "Grave Pact" inside a decorated "Grave Pact (EDH)" link)
clearSelection();
selectNode(doc.querySelector("#decorated").firstChild);
await check("resolveQuery: selection overlapping the link still overrides it",
  sandbox.resolveQuery({ selectionText: "Grave Pact (EDH)", linkUrl: "/c/z", targetElementId: 4, frameId: 0 }, tab),
  "Grave Pact (EDH)");
clearSelection();

// resolveQuery: link with no selection -> injected anchor text
await check("resolveQuery: link anchor text",
  sandbox.resolveQuery({ linkUrl: "/c/x", targetElementId: 2, frameId: 0 }, tab),
  "Smuggler's Copter");

// resolveQuery: selection only (unlinked text)
await check("resolveQuery: plain selection",
  sandbox.resolveQuery({ selectionText: "  Rhystic   Study  " }, tab),
  "Rhystic Study");

// resolveQuery: injection yields nothing -> URL slug fallback
const sandbox2blank = { ...sandbox };
await check("resolveQuery: URL slug fallback when no element",
  sandbox.resolveQuery({ linkUrl: "https://edhrec.com/cards/grave-pact", targetElementId: 999, frameId: 0 }, tab),
  "grave pact");

// end-to-end: resolveQuery -> buildScryfallUrl
const q = await sandbox.resolveQuery({ selectionText: "grave pact" }, tab);
await check("end-to-end URL from selection",
  Promise.resolve(sandbox.buildScryfallUrl(q)),
  "https://scryfall.com/search?as=grid&order=name&q=grave+pact+%28game%3Apaper%29+prefer%3Abest");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

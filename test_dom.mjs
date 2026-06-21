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
  <p id="loose">Some prose mentioning Rhystic Study here.</p>
</body>`);
const doc = dom.window.document;
const registry = {
  1: doc.querySelector("#plain"),
  2: doc.querySelector("#nested").querySelector("b"), // clicked the inner <b>
  3: doc.querySelector("#img").querySelector("img"),  // clicked the <img>
};

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

// resolveQuery: selection beats everything
await check("resolveQuery: selection wins over link",
  sandbox.resolveQuery({ selectionText: "Rhystic Study", linkUrl: "/c/grave-pact", targetElementId: 1, frameId: 0 }, tab),
  "Rhystic Study");

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

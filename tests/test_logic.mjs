import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../background.js"), "utf8");

// Mock the WebExtension `browser` global so the top-level listener
// registrations don't throw when the script is evaluated.
function makeSandbox(strategy) {
  let code = src;
  if (strategy) {
    code = code.replace(
      /const QUERY_STRATEGY = "[^"]*";/,
      `const QUERY_STRATEGY = "${strategy}";`
    );
  }
  const noop = () => {};
  const browser = {
    runtime: { onInstalled: { addListener: noop } },
    menus: { onClicked: { addListener: noop }, create: noop, getTargetElement: noop },
    scripting: { executeScript: async () => [] },
    tabs: { create: async () => {} }
  };
  const sandbox = { browser, console, URL, URLSearchParams };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        got:  ${got}`); console.log(`        want: ${want}`); fail++; }
  else pass++;
}
function checkContains(name, got, sub) {
  const ok = typeof got === "string" && got.includes(sub);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        got:  ${got}`); console.log(`        want substring: ${sub}`); fail++; }
  else pass++;
}

// ---- freetext (shipping default) must reproduce the target URL exactly ----
const free = makeSandbox("freetext");
const TARGET = "https://scryfall.com/search?as=grid&order=name&q=grave+pact+%28game%3Apaper%29+prefer%3Abest";
check("freetext exact target URL for 'grave pact'", free.buildScryfallUrl("grave pact"), TARGET);

// whitespace / case normalization
check("freetext normalizes messy whitespace",
  free.buildScryfallUrl("  Grave   Pact \n "),
  "https://scryfall.com/search?as=grid&order=name&q=Grave+Pact+%28game%3Apaper%29+prefer%3Abest");

// apostrophes are preserved & encoded
checkContains("freetext keeps apostrophe (Smuggler's Copter)",
  free.buildScryfallUrl("Smuggler's Copter"), "q=Smuggler%27s+Copter+");

// round-trips: decoding the q param yields the intended query string
function decodeQ(url) { return new URL(url).searchParams.get("q"); }
check("freetext q decodes correctly", decodeQ(free.buildScryfallUrl("grave pact")),
  "grave pact (game:paper) prefer:best");

// ---- exact ----
const exact = makeSandbox("exact");
check("exact q decodes correctly", decodeQ(exact.buildScryfallUrl("grave pact")),
  '!"grave pact" (game:paper) prefer:best');

// ---- name-words ----
const nameW = makeSandbox("name-words");
check("name-words q decodes correctly", decodeQ(nameW.buildScryfallUrl("grave pact")),
  "name:grave name:pact (game:paper) prefer:best");

// ---- oracle-words ----
const oracleW = makeSandbox("oracle-words");
check("oracle-words q decodes correctly", decodeQ(oracleW.buildScryfallUrl("grave pact")),
  "(oracle:grave oracle:pact) (game:paper) prefer:best");

// ---- lastPathSegment ----
check("lastPathSegment slug -> spaced name",
  free.lastPathSegment("https://edhrec.com/cards/grave-pact"), "grave pact");
check("lastPathSegment trailing slash",
  free.lastPathSegment("https://example.com/cards/grave_pact/"), "grave pact");
check("lastPathSegment bad url -> empty",
  free.lastPathSegment("not a url"), "");

// ---- readLinkText is defined & callable in the sandbox ----
checkContains("readLinkText is a function",
  typeof free.readLinkText, "function");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

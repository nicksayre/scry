# Tests for Scryfall Search

Two standalone Node scripts that validate the add-on's pure logic without a browser.
They load `../background.js` into a sandbox with a mocked `browser`
global, then exercise the functions directly.

## Run

```bash
# from the repo root (package.json and node_modules live there, not in tests/)

# 1) URL building + helpers across all four query strategies (no dependencies)
node tests/test_logic.mjs

# 2) DOM-level behavior: link-text extraction + selection-vs-link priority
npm install               # installs jsdom (pinned to a Node 18-compatible major)
node tests/test_dom.mjs

# or run both:
npm test
```

## What they cover

`test_logic.mjs`
- `freetext` strategy reproduces the target Scryfall URL byte-for-byte
- whitespace/case normalization in `buildScryfallUrl`
- correct, decodable `q` for `freetext`, `exact`, `name-words`, `oracle-words`
- `lastPathSegment` slug → spaced name, trailing slash, bad-URL → empty

`test_dom.mjs` (uses jsdom)
- `readLinkText` on a plain anchor, on nested markup (click an inner element),
  and on an image-only link (falls back to `alt`)
- `resolveQuery` priority: a clicked link wins unless the current selection
  actually overlaps that link (e.g. highlighting part of its decorated text);
  an unrelated/stale selection elsewhere on the page does not override the
  link; plain selection when there's no link; URL-slug fallback when no
  element is found
- end-to-end: `resolveQuery` → `buildScryfallUrl`

All 20 assertions pass against the shipped `background.js`.

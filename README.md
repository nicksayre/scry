# Tests for Scryfall Search

Two standalone Node scripts that validate the add-on's pure logic without a browser.
They load `../scryfall-search/background.js` into a sandbox with a mocked `browser`
global, then exercise the functions directly.

## Run

```bash
# from this tests/ folder

# 1) URL building + helpers across all four query strategies (no dependencies)
node test_logic.mjs

# 2) DOM-level behavior: link-text extraction + selection-vs-link priority
npm install jsdom        # one dependency
node test_dom.mjs
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
- `resolveQuery` priority: selection beats link; link anchor text when no
  selection; plain selection; URL-slug fallback when no element is found
- end-to-end: `resolveQuery` → `buildScryfallUrl`

All 19 assertions pass against the shipped `background.js`.

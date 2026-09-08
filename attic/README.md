# Attic

Version 1 of Webin does one thing: it themes a page. This folder holds the modules from
the previous build — the element inspector, the layers tree, the per-element visual
editor, the override engine, the history stack, the responsive viewport tools and the
popup that drove them — along with the tests that covered them.

None of it is shipped: `manifest.json` does not reference it, nothing under `src/`
imports it, and `npm test` does not run it. It is kept because it works and because the
next version is likely to want parts of it back, not because it is dead weight nobody
looked at.

If you bring a module back, note that the shared vocabulary changed with the rewrite:
`data-widt-*` attributes are now `data-webin-*`, `src/storage/schema.js` was replaced by
the much smaller `src/storage/store.js`, and `src/shared/util.js` now carries only the
three helpers version 1 uses.

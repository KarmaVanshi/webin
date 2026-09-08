# Webin — restyle any website

A Chrome extension that re-skins a website in one click, lets you change any single thing
on it by hand, and lets you take the result with you.

Pick a theme, the page changes. Click an element and edit it, and that changes too. Both
are still there on your next visit. When you find a design you like, capture it, and send
it to a friend as a single line of text.

```
Load it:   chrome://extensions → Developer mode → Load unpacked → this folder
Open it:   click the toolbar icon, or Alt+Shift+E
Test it:   npm test          (144 tests, jsdom)
Prove it:  npm run verify    (real Chromium, local fixture + youtube.com)
```

One permission, plus the host access a page restyler cannot do without: `storage` and
`<all_urls>`. Nothing leaves the machine, and nothing is fetched unless you paste a URL
into the importer and confirm it — see [Sharing safely](#sharing-safely).
Listing copy for the Web Store is in [docs/store-listing.md](docs/store-listing.md).

---

## What it does

**Eighteen themes**, in three shelves.

| Essentials | Movements | Dark |
|---|---|---|
| Minimal · Editorial · Sage | Flat · Skeuomorphic · Neumorphic | Midnight · Terminal |
| Reading · Blossom · High Contrast | Glass · Bauhaus · Bold Type · Brutalist · Neon | Nord · Dracula |

The Movements shelf is the point of the collection: each one is a design *position*, not
a colour scheme. Neumorphic brings its dual soft shadow and its single low-contrast
surface. Bauhaus brings hard offset shadows, square corners and 900-weight uppercase
headings. Glass brings a gradient backdrop, translucent panels and a real backdrop blur.
Skeuomorphic brings gradient sheen, layered depth and a grain texture. The palette, the
radius, the shadow treatment, the type and the density all move together, because that
is what makes a movement recognisable.

**Your own themes.** Save the page you are looking at as a theme (*⋯ → Save this page as
a theme*) and wear it anywhere else.

**Themes from anywhere else.** Paste in a shadcn or DaisyUI `:root` block, a VS Code
colour theme, a base16 scheme, a terminal palette, or a design-token file, and Webin reads
it. See [Reading other people's themes](#reading-other-peoples-themes).

**Import, export, share.** Every theme is a small JSON file and a one-line share code.

```
webin:1z:TVBBbgIxDPwKGq5IlABLBb8pi6...
```

Paste that into *⋯ → Import a theme* and you have the sender's exact theme. *Share*
copies the code for the applied theme; *Download applied theme* writes a `.webin.json`
file; *Back up my themes* writes the lot.

---

## Editing one thing at a time

A theme is a decision about the whole page. Sometimes the thing you want to change is one
button.

Switch the panel to **Edit** and the page becomes selectable: hover to highlight, click to
select. The panel turns into an inspector for whatever you picked — layout, spacing,
typography, appearance — and every control changes the page as you touch it. Drag the
selection's grips to resize it, drag the element to move it, double-click text to retype
it, hide it, or take it off the page entirely. Undo is a keystroke away and knows a drag
is one action, not fifty.

Then **Save**, and it comes back next time.

Three things make that last sentence true on a real website:

**It never saves a selector.** `.card` is a guess: classes get reused, regenerated and
renamed. A saved change carries nine independent signals instead — tag, stable attributes,
a fingerprint of the text, the parent's signature, a filtered class list that throws away
anything that looks machine-generated, a structural path, a sibling index — and finding
the element again means scoring every candidate against all of them.

**It refuses to guess.** If the best candidate is weak, or if two candidates score the
same, nothing is applied. The change is parked and the panel offers to let you point at
the right element instead. Applying somebody's saved button width to the wrong button is
worse than applying nothing and saying so.

**It reaches inside components.** A document stylesheet cannot style anything in a shadow
root, and on a site built from web components that is most of what you would want to edit.
The override sheet is a constructed stylesheet adopted into every open root, so it gets
there — and the cascade analysis that decides when `!important` is needed reads those
roots' stylesheets too, rather than concluding that nothing is competing.

Your edits sit on top of whatever theme is applied, and win where the two disagree. Reset
by element, by page, or by site.

---

## Why it works on sites that fight back

Most "dark mode" extensions invert colours and hope. This one reads the page first.

**1. Detection.** Before anything is applied, the page is scanned as it is *rendered* —
not as its CSS was written. A token is only real if it is painted. The weighting is what
matters: the page background is not the most frequent background, it is the one covering
the most area; body text is not the most frequent colour, it is the one covering the most
characters. Out of that comes a small design system: canvas, surface, text, muted text,
accent, border, a spacing rhythm, a radius scale.

**2. Remapping, not overwriting.** A theme is a value→value table built against those
tokens. The canvas stays the canvas, cards stay raised, saturated fills stay buttons,
saturated text stays links, quieter text stays quieter. Every colour that ends up carrying
text goes through a WCAG contrast guarantee on the way out, so a theme can pick a pretty
accent but cannot pick an unreadable one.

**3. Custom properties — this is the YouTube part.** YouTube's real interface lives inside
shadow roots, where a document stylesheet cannot reach. But it paints from about six
hundred custom properties declared on `:root`, and custom properties *do* inherit across
shadow boundaries. Remapping those re-skins tens of thousands of nodes no selector could
ever match. Variables are classified by what the colour does, not what it is called: far
from the canvas is ink, close to it is paper, far from grey is the brand. That test is
polarity-symmetric, which is why an inverse pair — dark text on a light chip inside a dark
site — still comes out the right way round.

**4. Stamping.** What variables cannot reach gets an attribute naming the tokens it uses,
and one rule is written per token. Rules are O(tokens) — a couple of dozen — not
O(elements), however large the page is. The generated sheet is a single constructed
stylesheet, adopted by the document and by every open shadow root, so updating the theme
is one `replaceSync` rather than thousands of DOM writes.

**5. Keeping up.** An infinite feed appends a hundred cards as you scroll and a route
change swaps the whole body without a navigation the browser knows about. A full walk of
YouTube costs a couple of hundred milliseconds, so the observer reports *which subtrees
were inserted* and only those are stamped. Elements that already carry a stamp are left
alone, which is what stops values drifting on each pass.

**6. No flash.** The part of a theme that needs no knowledge of the page — the root
variables and the canvas — is cached per site and injected at `document_start`, before
there is a body. A dark theme does not flash white on load.

**7. Frames too.** The content script runs in iframes, where it wears the theme of the
page it is embedded in rather than its own. An advert that keeps its white background is
the one bright rectangle in an otherwise dark page, and it is the first thing anyone
notices.

**8. Text you can actually read.** Every colour a theme picks for text goes through a WCAG
contrast guarantee, so a theme can choose a pretty accent but not an unreadable one. That
is not sufficient on its own, because it checks the theme's palette against itself. A page
has more background colours than a theme has tokens, and the ones it does not recognise it
leaves alone — so remapped text can land on a background that never moved.

So text is also checked against what is *actually painted behind it*: the real backdrop,
found by walking up until something opaque turns up, with translucent layers composited on
the way rather than scored as though they were solid. Anything still under 4.5:1 is forced
to black or white, whichever wins. It costs two CSS rules for the whole page, and it can be
switched off in the `⋯` menu if you would rather see a theme exactly as written.

Media is never repainted: images, video, canvas, SVG and embeds are excluded by tag, so a
themed YouTube still plays an untouched video.

---

## The interface

One panel, in the corner, with three zones: a header, a gallery, a footer that names what
is applied. Clicking a theme applies it immediately — there is no Apply button, because a
preview you have to confirm is just a slower preview. Everything occasional lives behind
the `⋯` menu. There is no popup; the toolbar icon opens the panel on the page itself,
because a popup would be a second place to look for the same list of themes.

Each card previews its own theme in miniature — palette, corner radius and surface
treatment together — so the gallery tells the truth about what you are about to get.

The panel lives in a closed-off shadow root with `all: initial` at its boundary. The page
cannot style it, and neither can the theme being applied to the page: it has to stay
legible while the site behind it turns into Bauhaus. It has its own light and dark chrome,
independent of both the page and the theme.

Escape closes it. Nothing about the page is modified — remove the theme and the site is
byte-for-byte what the server sent.

---

## Reading other people's themes

Webin's own format is seven named colours and a few numbers. So is almost every other
design system, underneath — which means a shadcn `:root` block, a VS Code colour theme and
a base16 scheme are the same document in different notation.

| Paste in | and Webin reads |
|---|---|
| A CSS `:root` block | shadcn, DaisyUI, Tailwind, Open Props, or anything with custom properties. A `.dark` block becomes a second theme. |
| A VS Code colour theme | the editor background becomes the canvas, the sidebar a raised surface, a button fill the accent. |
| A base16 or base24 scheme | mapped by position, so nothing has to be guessed at all. |
| A terminal palette | iTerm and Windows Terminal, which can carry a whole shelf of them at once. |
| A design-token file | W3C `$value` tokens, Style Dictionary output, Figma Tokens exports. |

Roles are worked out from names, in a deliberate order: shadcn's `--primary` is the brand
and its `--accent` is a muted hover fill, so taking the one actually named "accent" would
turn every imported theme grey. Whatever a file leaves out is derived, and anything derived
is shown to you before it is saved, because a guess you cannot see is a guess you cannot
correct.

You can also paste a URL. That is the one thing Webin does over the network, it happens
only when you ask for it, the request is made by the extension rather than by the page you
are on, and it carries none of your cookies.

---

## Sharing safely

A theme is the only thing this extension saves, and — because themes are meant to be
shared — the only untrusted input it accepts. Anything arriving from outside is rebuilt
from scratch, field by field: unknown keys are dropped, colours must parse, numbers are
clamped, and font stacks are matched against a conservative character set.

That last one is not paranoia. Theme values end up inside a stylesheet injected into every
page, so an unchecked font family is a CSS injection with extra steps:

```js
fontFamily: 'Georgia; } * { background: url(https://evil.example/beacon) } .x {'
// → null. The theme still applies; it just uses the page's own font.
```

Raw CSS backdrops are honoured only from themes the extension ships. Theme names are
escaped, never parsed, and reach the DOM as text. There are tests for each of these.

---

## Layout

```
src/
  bootstrap.js              content-script entry; imports the module graph
  background/               service worker: toolbar click, badge, frame relay
  content/
    runtime.js              composition root — the only file that knows all the others
    tokens.js               what the page's design system actually is
    variables.js            custom property discovery (the YouTube mechanism)
    engine.js               mapping, stamping, CSS generation
    sheets.js               one constructed stylesheet, adopted everywhere
    dom.js                  one tree walk, shared by detection and stamping
    monitor.js              mutations and client-side navigation, cheaply
  themes/
    library.js              the eighteen presets
    capture.js              turning a page you like into a theme
  editor/
    editor.js               composition root for editing — modes, selection, commits
    identity.js             finding an element again tomorrow, without saving a selector
    overrides.js            the five levels of override, and how to take them back
    override-sheet.js       one stylesheet, adopted everywhere, batched per frame
    picker.js, overlay.js   hover, selection, grips, measurements
    interactions.js         drag and resize, in the layout context the element is in
    text-edit.js            editing a text node without touching its element
    history.js              operations, transactions, undo and redo
    cascade.js              what the site's own CSS says, and when to outrank it
    computed.js, geometry.js, layout.js, model.js
  shared/
    theme-format.js         the file format, its validator, and the share codec
    foreign-themes.js       reading a theme some other tool wrote
    color.js                parsing, contrast, and the readability guarantee
    css-values.js           parsing, validating and formatting CSS values
  ui/
    panel.js, panel-css.js  the interface
    inspector.js            what the panel shows when something is selected
    controls.js             the control library the inspector is built from
  storage/                  chrome.storage behind a plain key/value interface

test/        144 tests — format, library, engine, store, panel, identity, editor, journeys
tools/       browser.mjs (a small CDP client) and verify.mjs (the real-browser checks)
fixtures/    a page built the awkward way: custom properties, shadow roots, pushState
attic/       the previous build, kept for reference; the editor above was rebuilt from it
```

---

## Verification

`npm test` runs 144 tests in jsdom, including end-to-end journeys that drive the real panel
controls: apply a theme, reload and find it still there, import a friend's share code,
capture a page, delete a theme, edit an element and find the edit again after a reload, and
hand the panel a hostile theme to see it stay intact.

`npm run verify` launches Chromium with the extension loaded and checks the things jsdom
cannot model. Against the local fixture: shadow DOM restyling, adopted stylesheets,
translucent variables keeping their alpha, content added after the fact, client-side
routing, reload persistence, and all eighteen themes applying on a real engine. Against
youtube.com: variables remapped, search results re-coloured, four thousand elements
stamped, the infinite feed keeping up while scrolling, a watch page surviving client-side
navigation, the video player left alone, and the whole thing coming back after a reload —
then removing cleanly.

The editor gets its own suite there, because jsdom has no layout engine and therefore no
geometry, no hit-testing and nowhere to put a pointer: selecting by clicking, an edit
reaching a real rendered element inside a shadow root, grips that meet the 24px pointer
target WCAG 2.2 asks for, a real drag that resizes, the keyboard doing what the pointer
does, and a saved edit returning after a reload. It writes screenshots to `shots/`.

Add `--headful` to watch it happen, or `--no-network` to skip YouTube.

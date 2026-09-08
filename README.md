# Webin — restyle any website

A Chrome extension that re-skins a website in one click, lets you change any single thing
on it by hand, and lets you take the result with you.

Pick a theme, the page changes. Click an element and edit it, and that changes too. Both
are still there on your next visit. When you find a design you like, capture it, and send
it to a friend as a single line of text.

```
Load it:   chrome://extensions → Developer mode → Load unpacked → this folder
Open it:   click the toolbar icon, or Alt+Shift+E
Test it:   npm test          (166 tests, jsdom)
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
a theme*) and wear it anywhere else. Anything you own can be renamed — hover a card in
*Yours* and use the pencil. Themes arrive named after wherever they came from, which is a
reasonable guess and rarely the name you want on your own shelf.

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
a base16 scheme are the same document in different notation. What follows is that notation
layer in detail.

### Three ways in

All three live behind *⋯ → Import a theme…*, and all three end up in the same place.

**Paste it.** The textarea takes a share code, one of Webin's own `.webin.json` files, or
the raw text of somebody else's theme file. The format is worked out from the content
rather than from a file extension, because when you paste into a textarea there is no
extension to go on — a `.json` that is really a VS Code theme and a `.json` that is really
a base16 scheme need different readers.

**Choose a file.** `.json`, `.jsonc`, `.css`, `.txt`, `.yaml` and `.yml`. It is read in the browser;
nothing is uploaded.

**Fetch an address.** Type a URL and Webin goes and gets it — `example.com/theme.css` is
enough, the scheme is filled in if you leave it off. The request is made by the extension's
service worker rather than by the page you happen to be on, for two reasons: a page's own
CSP governs fetches made from it, so half the web would refuse, and a request issued from
the page's context is a request the page can watch. It carries `credentials: 'omit'`, so it
cannot pull down a logged-in page using your own cookies; it gives up after 15 seconds; and
it refuses anything that is not `http` or `https`. There is no size limit — whatever the
address answers with is read, and the timeout is the only bound on how much that can be.

### Nothing is saved before you have seen it

One theme at a time is also offered under a name you can type over before it is kept; a
collection is not, because naming six themes a field at a time is a form rather than a
choice. Rename any of them afterwards from the gallery.

A share code and a `.webin.json` file are already Webin themes, so they save straight away —
there is nothing to disclose. Anything read out of somebody else's format stops at a
preview first: each theme as a card, and under a disclosure every value that was worked out
rather than read, in the form `accent ← --primary` or `border ← a faint line between text
and background`. A guess you cannot see is a guess you cannot correct.

Whatever you confirm is then rebuilt field by field by the same validator that handles a
share code — see [Sharing safely](#sharing-safely). An adapter never produces a theme, only
a candidate, so a CSS file off the internet gets exactly the treatment a stranger's share
code gets.

### A CSS `:root` block

Take it from shadcn's theme generator, a DaisyUI `@plugin` block, Open Props, or the
`:root` of any stylesheet you like the look of. A Tailwind *config* file is JavaScript
rather than CSS and will not read; its generated stylesheet will.

Both palettes come across. Theme files usually carry a light one and a dark one, so every
rule block whose selector mentions dark — `.dark`, `[data-theme="dark"]`, a
`prefers-color-scheme: dark` media block — is gathered separately and becomes a second
theme with *Dark* appended to its name. Palettes wrapped in `@layer` or `@media` are found,
because the inner rules are what get read.

Colours may be written as `#abc`, `#aabbcc`, `#aabbccdd`, `rgb()`, `hsl()`, `oklch()`,
`oklab()`, a CSS colour name, or shadcn's bare triplet — `221.2 83.2% 53.3%`, three numbers
that are a colour only if you already know they are the inside of an `hsl()` the stylesheet
supplies. `var()` and `color-mix()` are references rather than values and are skipped.

`--radius`, `--radius-box`, `--rounded-box` or `--border-radius` sets the corner radius,
with `rem` and `em` converted at 16px.

### A VS Code colour theme

The file lives inside the extension that ships it:

```
~/.vscode/extensions/<publisher>.<theme>-<version>/themes/*.json
```

Built-in themes live in the app bundle instead, under
`resources/app/extensions/theme-defaults/themes/`. Either way the theme's own repository
usually has the same file, which is the easiest thing to point *Fetch* at.

These files name editor parts rather than design roles, so the mapping is explicit rather
than inferred. Only the `colors` block is read, and the first key present wins:

| Role | Keys tried, in order |
|---|---|
| background | `editor.background` · `editorPane.background` · `tab.activeBackground` |
| surface | `sideBar.background` · `editorWidget.background` · `panel.background` · `activityBar.background` |
| text | `editor.foreground` · `foreground` · `sideBar.foreground` |
| muted text | `descriptionForeground` · `disabledForeground` · `editorLineNumber.foreground` |
| accent | `button.background` · `textLink.foreground` · `focusBorder` · `activityBarBadge.background` |
| on accent | `button.foreground` · `activityBarBadge.foreground` |
| border | `panel.border` · `editorGroup.border` · `contrastBorder` · `input.border` |

A candidate that cannot do its job is passed over for the next key in its row. An editor
gets away with things a page does not: VS Code's high-contrast buttons are black on a black
canvas, told apart by a bright border, so `button.background` would otherwise hand you an
accent nobody can see. An accent with no contrast against the background, or an on-accent
that cannot be read on the accent, falls through — and if nothing in the row works, the role
is derived like any other missing one and reported as derived.

The theme's own `name` and `type` are kept, and shadows are set sharp to suit an editor
palette. `tokenColors` is not read at all: it is most of the file, and most of what you
would recognise a theme by, but a web page has no syntax to highlight. A theme that defines
little beyond `tokenColors` therefore imports with several roles derived, and the preview
will say which.

Many of these files are JSONC — `//` and block comments, and trailing commas — which is
not JSON. They are read anyway. Strict JSON is tried first, so a file that already parses
is never touched; only when that fails are comments taken out and a trailing comma
forgiven. The stripper tracks strings and escapes, because `"$schema":
"vscode://schemas/color-theme"` opens every generated theme file and a line-wise regex
would eat half of it.

Commented-out declarations are read too, which needs saying because it sounds wrong. VS
Code's own *Developer: Generate Color Theme From Current Settings* writes out the whole
resolved palette and then comments out every value that came from a built-in default,
leaving perhaps eleven live declarations behind. Taken literally that file is a theme of
eleven colours and imports with most roles guessed — but the person who exported it was
looking at the whole thing on screen and means to import the whole thing. So the commented
declarations are harvested as well, and anything the file states outright wins over them,
because that is the part its author chose rather than inherited. Prose stays a comment:
only lines shaped like a declaration are revived, and if reviving them yields something
that will not parse, the file is read exactly as it was.

### A base16 or base24 scheme

Take one from the base16 gallery or any `base16-*` repository. Both the YAML these are
published in and the JSON some tools emit are read.

Nothing is guessed here, because the spec fixes what every slot means:

| `base00` | `base01` | `base02` | `base03` | `base05` | `base0D` |
|---|---|---|---|---|---|
| background | surface | border | muted text | text | accent |

`scheme:` names the theme, `author:` is kept, and shadows are set to none.

### A terminal palette

Windows Terminal's `settings.json` holds its palettes in a `schemes` array, and each one
becomes a theme — one file can import a whole shelf at once. An iTerm-style file with
`background`, `foreground` and the sixteen ANSI colours at the top level works the same
way.

`background` and `foreground` are both required; a scheme missing either is skipped rather
than guessed at. `black` or `brightBlack` becomes the raised surface, the first of
`blue` · `brightBlue` · `purple` · `cyan` becomes the accent, and `brightBlack` or `white`
becomes muted text. The result is forced to monospace, square corners and no shadow,
because that is what a terminal palette is.

### A design-token file

W3C DTCG files, Style Dictionary output and Figma Tokens exports are all the same shape.
The tree is walked to a depth of eight looking for `$value`, or for `value` alongside a
`type`, and each path is flattened into a name — `color.brand.primary` becomes
`brand-primary` — which then goes through the same name matching as a CSS variable.

Aliases are not resolved. A token whose value is `{color.blue.500}` or `var(--blue-500)` is
a reference rather than a colour and is skipped, so export a resolved file if your generator
offers one.

### How names become roles

For CSS variables and design tokens the role has to come from the name, and names are the
least trustworthy part of any theme file. Two rules keep it honest.

Matching is **exact** first, never a substring, which is what stops `--primary-foreground`
being read as the accent. Roles claim names in a fixed order, most specific first, each
name going to whichever role asks for it earliest:

| Role | Names, in the order they are tried |
|---|---|
| muted text | `muted-foreground` · `text-muted` · `text-secondary` · `foreground-muted` · `fg-muted` · `neutral-content` · `base-content-secondary` · `description` · `text-dim` · `subtle` · `text-tertiary` · `on-surface-variant` · `nc` |
| on accent | `primary-foreground` · `on-primary` · `primary-content` · `accent-foreground` · `on-accent` · `button-foreground` · `pc` · `ac` |
| background | `background` · `bg` · `base-100` · `canvas` · `page` · `body-bg` · `backdrop` · `surface-0` · `editor-background` · `b1` |
| surface | `card` · `popover` · `panel` · `surface` · `base-200` · `elevated` · `muted` · `secondary` · `surface-1` · `sidebar-background` · `b2` |
| text | `foreground` · `text` · `base-content` · `fg` · `ink` · `body-color` · `on-background` · `on-surface` · `text-primary` · `editor-foreground` · `bc` |
| accent | `primary` · `brand` · `accent` · `link` · `interactive` · `action` · `button-surface` · `button-background` · `button-bg` · `p` · `a` |
| border | `border` · `outline` · `divider` · `base-300` · `rule` · `stroke` · `separator` · `border-color` · `b3` |

Then a second pass, for whatever the first one could not fill. A real site namespaces
everything — Netflix ships `--hcw--local-design--Button-Surface` — so exact matching finds
nothing at all and the page imports as no theme rather than as the theme it plainly is. In
this pass a name counts if one of its **trailing segments** is a name from the table, and
each variable is resolved by its longest recognisable tail, so `Button-Surface` is read as
a button fill before the bare word `surface` can claim it as a panel. Camel humps are split
first, so `Accordion-HeadlineForeground` is read as the three words it is. Because this
pass runs second and only fills what is still empty, an exact name always wins.

A value of `transparent` never fills a role. It is a real declaration, but it names no
colour, so the role is derived instead.

That order is the whole design. In shadcn `--primary` is the brand and `--accent` is a
muted hover fill, so taking the one actually named "accent" at face value would turn every
imported shadcn theme grey — which is why `accent` is resolved late, after the roles with
unambiguous names have taken theirs. For the same reason `muted-foreground` is tested
before `muted`, or a caption colour ends up as a panel fill.

Before matching, prefixes that say nothing about a role are stripped, so `--color-primary`,
`--theme-primary`, `--ui-primary` and `color.primary` are all read as `primary`. Dots,
underscores and spaces all count as hyphens.

### What a file leaves out

Refusing an incomplete file would reject most real ones — a VS Code theme names a hundred
editor colours and not one of the seven roles by these names. So the requirement is only a
background and a text colour, and the rest is derived from what is there:

- a missing background or surface borrows the other
- muted text is the text colour mixed 35% of the way toward the background
- a border is a faint line between text and background, weighted by whether the theme is dark
- an accent, for want of a brand colour, falls back to the text colour
- the colour *on* the accent is whichever of black or white reads better against it

Each of those is reported in the preview as derived. If either the background or the text
colour is missing, nothing is imported and you are told what was missing.

### Afterwards

An imported theme is yours: it sits in the gallery marked as custom, can be applied to any
site, edited, copied as a share code, downloaded, or deleted. An import never overwrites
something you already have — a theme arriving with an id already in use is given a fresh
one rather than replacing yours. Storage holds 80 themes.

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

test/        166 tests — format, library, engine, store, panel, identity, editor, journeys
tools/       browser.mjs (a small CDP client) and verify.mjs (the real-browser checks)
fixtures/    a page built the awkward way: custom properties, shadow roots, pushState
attic/       the previous build, kept for reference; the editor above was rebuilt from it
```

---

## Verification

`npm test` runs 166 tests in jsdom, including end-to-end journeys that drive the real panel
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

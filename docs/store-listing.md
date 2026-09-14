# Chrome Web Store listing

Copy for the developer dashboard.

The store enforces a **single purpose** policy, and the purpose you declare at launch is
the one you are held to. The framing throughout is therefore **"change how a website
looks"**, not "apply themes". Themes are one way the product does that; the visual editor
is another. Neither is the purpose.

That framing was chosen before the editor shipped, and it is why shipping it needed no new
permission, no new purpose statement and no re-acceptance by existing users.

The listing title and the short description below are taken from `manifest.json` — the
store reads them from there, so the two files have to agree.

---

## Title

```
Webin — Restyle any website
```

## Short description (132 character limit; this is 120)

```
Restyle any website in one click, or edit any element by hand. Eighteen designs built in, plus your own to import and share.
```

## Detailed description

```
Webin changes how a website looks.

Pick a design, the page changes. It stays changed on your next visit, and on every page of
that site. Nothing is sent anywhere, and the website itself is never modified — remove the
design and the page is exactly what the server sent.

EIGHTEEN DESIGNS, IN THREE SHELVES

Essentials — Minimal, Editorial, Sage, Reading, Blossom, High Contrast.
Movements — Flat, Skeuomorphic, Neumorphic, Glass, Bauhaus, Bold Type, Brutalist, Neon.
Dark — Midnight, Terminal, Nord, Dracula.

The Movements shelf is the interesting one. Each is a design position rather than a colour
scheme: Neumorphic brings its soft dual shadow and single low-contrast surface, Bauhaus
brings hard offset shadows and square corners, Glass brings translucent panels over a
gradient with a real backdrop blur. The palette, the corner radius, the shadow treatment,
the type and the spacing all move together.

IT READS THE PAGE FIRST

Most appearance extensions invert colours and hope. Webin scans the page as it is actually
rendered and works out what its design system is — which colour is the canvas, which is a
card, which carries body text, which is the brand. Then it remaps those values. The canvas
stays the canvas, cards stay raised, buttons stay accented, links stay links, and every
colour that carries text is checked for contrast on the way out.

That is why it survives sites built out of web components, where most extensions give up.

EDIT ANY ELEMENT BY HAND

A design is a decision about a whole page. Sometimes what you want to change is one button.

Switch to Edit and the page becomes selectable: hover to highlight, click to select. An
inspector opens for whatever you picked — layout, spacing, typography, appearance — and
every control changes the page as you touch it. Drag the handles to resize, drag the
element to move it, double-click text to retype it, or hide it. Undo knows that a drag is
one action rather than fifty. Save, and it is there again next visit.

Two tools sit at the top of the panel. The pencil is the editor working: hover highlights,
click selects, and every control changes the page. The arrow puts it down again — nothing
is highlighted or selected and the site is yours to read and click through. Enter finishes
what you were typing and puts the editor down.

The inspector also lists the CSS the site itself applies to what you picked, rule by rule,
as a browser's Styles pane does — and each rule can be edited right there. Change a value
and your version of the rule takes over, the site's own line struck through beneath it.

Nothing is written into the website. Your changes live in a stylesheet of Webin's own, and
resetting removes every trace of them.

TEXT YOU CAN ACTUALLY READ

A design can pick a pretty colour and still leave text unreadable on a background it did
not recognise. So Webin checks text against what is actually painted behind it, and forces
anything that fails to black or white. You can switch it off if you would rather see a
design exactly as its author wrote it.

MAKE YOUR OWN, AND SHARE IT

Found a site whose design you like? Save the page as a design of your own and wear it
anywhere else.

Every design is a small file and a single line of text. Copy the share code, send it to a
friend, and they paste it in and have your exact design. Export one to a file, or back up
everything you have made.

Webin also reads designs made in other tools: paste in a CSS variable block from shadcn or
DaisyUI, a VS Code colour theme, a base16 scheme, a terminal palette or a design-token
file, and it works out the design from it — showing you what it worked out before saving
anything.

Anything you import is checked before it is saved: colours have to be real colours, and
anything that is not part of a design is dropped.

ONE PANEL, NO CLUTTER

A single card in the corner of the page. Click a design and it applies immediately —
there is no Apply button, because a preview you have to confirm is just a slower preview.
Everything occasional lives behind one menu. Escape closes it.

PRIVATE BY DEFAULT

Everything is stored locally in your browser. Webin has no account, no server and no
analytics, and it sends nothing anywhere.

The one time it uses the network at all is when you paste a web address into the importer
and ask it to fetch a design from there. That request is made by the extension rather than
by the page you are on, and it carries none of your cookies.
```

---

## Single purpose statement

The dashboard asks you to describe the extension's single purpose in one or two sentences.
This is the sentence that decides whether a later update is "the same product" or "a
second product":

```
Webin has one purpose: changing the visual appearance of the web pages a user visits.
Every feature serves it — the built-in designs, capturing a page's design for reuse, and
importing or exporting a design in order to share it.
```

Note what it does **not** say: it does not say "themes". A future release that lets a user
restyle one element by hand, inspect why a heading looks the way it does, or keep a
history of the changes they made is still "changing the visual appearance of web pages".

## Permission justifications

The dashboard asks for one justification per permission. Keep these specific — a vague
answer on `<all_urls>` is the most common reason a broad-permission extension sits in
review.

**Host permissions (`<all_urls>`)**

```
Webin restyles the page the user is currently looking at. The user chooses which sites to
restyle, and the extension cannot know in advance which those will be, so it needs to be
able to run on any site the user opens.

On each page it reads the rendered styles — colours, spacing, corner radii — and, when
the user picks an element to edit, that element's own styles and text, in order to work
out what to remap and to show what it is changing. It injects a stylesheet of its own.
It does not read form fields, credentials or browsing history, and it transmits nothing.
```

**`storage`**

```
Stores the designs the user has saved or imported, and which design is applied to which
site, using chrome.storage.local on the user's own machine. Nothing is synced or uploaded.
```

**`unlimitedStorage`**

```
A saved design may include a background picture the user chose from their own computer,
stored inline as part of the design. A few of those exceed the default local storage
quota, and a save that silently fails is worse than a permission that asks for nothing at
install. Everything stays on the user's machine.
```

**Remote code**: No. Every file the extension runs ships in the package: no CDN, no eval,
no remotely hosted script, and nothing fetched is ever executed.

If asked about network use, the distinction to draw is between code and data. Webin can
fetch a design file — a stylesheet or a JSON theme — but only from an address the user
types and confirms, and what comes back is parsed as data and rebuilt before it is used.
Colours must parse as colours, numbers are clamped, and every CSS declaration a design
carries is checked against an allowlist of visual properties: a value may not contain a
URL or any other function that fetches, a comment, or anything that would end one
declaration and start another. Nothing from the network becomes code, and nothing a
design says can make the browser request anything.

**Isolation from the page**: the extension's panel and editor overlay live in closed
shadow roots. A page can tell that Webin is installed and nothing more — it cannot press
the extension's buttons, read the user's list of designs, or ask the extension to fetch
an address. The service worker answers only the extension's own scripts.

**Data usage disclosures**: none of the categories apply. Webin collects no personally
identifiable information, health information, financial information, authentication
information, personal communications, location, browsing history, or user activity. It
does not sell or transfer user data, because it never collects any. A user-initiated fetch
of a design file sends no user data with it — no cookies, no credentials, no page
contents; only the address the user typed.

---

## What is still on the shelf

The editor has shipped. What has not, and what to keep in mind when it does:

- **Layers tree, responsive breakpoints, per-site profiles, multi-select, copy/paste
  style.** All of these are the same content script doing more, on host permissions
  already held — so no permission warning and no update that disables the extension until
  users re-accept it. The saved-change format already carries the `breakpoint` and `scope`
  fields these need, so they arrive without migrating anyone's data.
- **Extend the detailed description, do not rewrite it.** The purpose statement should not
  need to change. Wanting to change it is the signal that a feature really is a second
  product and belongs in its own listing.
- **Re-check the data disclosures** if anything more ever leaves the machine. A hosted
  gallery of shared designs, or syncing across a user's devices, would change the privacy
  answers. Fetching a file the user asked for does not, and sharing by copy-and-paste does
  not.
- **Privacy policy URL**: `PRIVACY.md` at the repository root is the policy. Put its public
  URL (the GitHub page for the file is enough) in the dashboard's privacy-policy field —
  the form does not strictly require one when no data is collected, but a `<all_urls>`
  extension without one reliably sits in review.
- **Use a staged rollout** for any update that touches the engine, so a mistake reaches a
  fraction of users rather than all of them.

## Before you upload

- `version` in `manifest.json` must increase on every upload, and can never be reused.
- Screenshots: the panel over a real site tells the story better than the panel alone.
  `npm run verify` leaves usable ones in `shots/`, already at the 1280×800 the store
  insists on — it accepts that size or 640×400 and nothing else.
- Review on a `<all_urls>` extension takes days rather than hours, for updates as well as
  for the first submission. Plan releases around that, not around the merge.

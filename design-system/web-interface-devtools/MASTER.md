# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Web Interface DevTools
**Generated:** 2026-09-06 05:32:44
**Category:** Developer Tool / IDE
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 2/10 (Subtle) | Density 9/10 (Dense / Dashboard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E293B` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#334155` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent/CTA | `#22C55E` | `--color-accent` |
| On Accent/CTA | `#0F172A` | `--color-on-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#F8FAFC` | `--color-foreground` |
| Card | `#1B2336` | `--color-card` |
| Card Foreground | `#F8FAFC` | `--color-card-foreground` |
| Muted | `#272F42` | `--color-muted` |
| Muted Foreground | `#94A3B8` | `--color-muted-foreground` |
| Border | `#475569` | `--color-border` |
| Destructive | `#EF4444` | `--color-destructive` |
| On Destructive | `#000000` | `--color-on-destructive` |
| Ring | `#FFFFFF` | `--color-ring` |

**Color Notes:** Code dark + run green

### Typography

- **Heading Font:** JetBrains Mono
- **Body Font:** IBM Plex Sans
- **Mood:** code, developer, technical, precise, functional, hacker
- **Google Fonts:** [JetBrains Mono + IBM Plex Sans](https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 9/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #22C55E;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E293B;
  border: 2px solid #1E293B;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #0F172A;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E293B;
  outline: none;
  box-shadow: 0 0 0 3px #1E293B20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** FAQ/Documentation Landing

- **Conversion Strategy:** Reduce support tickets. Track search analytics. Show related articles. Contact escalation path.
- **CTA Placement:** Search bar prominent + Contact CTA for unresolved questions
- **Section Order:** Hero with search bar > Popular categories > FAQ accordion > Contact/support CTA

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Light mode default
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

---

# Project Deviations from the Generated System

These are deliberate, reasoned departures. Everything not listed here follows MASTER above.

## 1. Pattern section does not apply

The generated pattern ("FAQ/Documentation Landing") is a marketing-page structure.
This product has no landing page — it is a tool overlay injected into arbitrary
third-party websites. The pattern block is ignored. Style, colors, typography and
effects are adopted as generated.

## 2. Two accent roles, not one

The generated palette gives a single accent (`#22C55E`). This interface paints on top
of an unknown host page, so it needs to separate *its own chrome* from *marks it draws
on someone else's canvas*:

| Token | Value | Role |
|---|---|---|
| `--accent` | `#22C55E` | Extension chrome: active tool, primary action, committed/applied state |
| `--selection` | `#6366F1` | Marks drawn on the host page: selection frame, resize handles, measurement labels |

The indigo is the product icon's own colour, so a selection frame on the page reads as
"this tool" rather than as page content. Keeping the green for chrome preserves the
generated "code dark + run green" intent.

## 3. System fonts instead of the Google Fonts CDN

The generated pairing is JetBrains Mono / IBM Plex Sans. Loading those over the network
is rejected: the content script runs on every page the user visits, Build Concept §74
requires minimising network access, and a host page's CSP would block the stylesheet
anyway. The roles are filled by system stacks with the same personality:

- Sans (IBM Plex Sans role): `system-ui, -apple-system, "Segoe UI", Roboto, ...`
- Mono (JetBrains Mono role): `ui-monospace, SFMono-Regular, "SF Mono", Menlo, ...`

All numeric readouts use the mono stack with `font-variant-numeric: tabular-nums` so
values do not jitter while dragging.

## 4. Motion is smaller than the Subtle tier

The Subtle GSAP scroll-reveal preset does not apply — nothing here scrolls into view.
Motion is limited to 120–160ms colour/opacity transitions on hover, focus and panel
state. Overlay geometry never animates: it must track the page exactly, frame for frame.
`prefers-reduced-motion: reduce` drops all of it.

## 5. Stacking

One maximal `z-index` at the shadow host is unavoidable — the overlay must beat any
value the host page uses. Inside the shadow root a disciplined scale applies, per the
`z-index-management` guideline:

```
10  page overlay marks (hover, selection, measurements)
20  docked panels (layers, inspector)
30  toolbar, status bar
50  popovers, menus, notices
```

The host sets `isolation: isolate` so the internal scale is a real, self-contained
stacking context.

## 6. Light chrome by default, dark on request

The generated system is dark-only ("code dark + run green"). The editor ships **light as
the default appearance and dark as a toggle** in the toolbar, because the chrome floats
over arbitrary third-party pages and the overwhelming majority of them are light: a dark
panel against a white page is a harder read than a light one, and it makes the editor
look like a foreign object rather than a layer on the page.

Both appearances live in one sheet in `src/ui/theme.js`. `:host` carries the whole light
palette plus every appearance-independent value (density, type, motion, stacking, page
marks); `:host([data-widt-appearance="dark"])` redefines only the colours, so a token
defined solely in the dark block would be missing until the user toggled — asserted in
`test/ui.test.mjs`. Nothing outside that file may hard-code a colour.

Three values differ from the generated palette because the palette assumed a dark ground:

| Token | Light | Dark | Why |
|---|---|---|---|
| `--accent` | `#15803D` | `#22C55E` | The generated green is 1.9:1 on white; the darker green keeps "run green" and passes 4.5:1 both as text and as a button ground |
| `--danger` | `#DC2626` | `#F87171` | `#EF4444` is only 4.16:1 on the dark panel |
| `--selection-strong` | `#4F46E5` | same | `--selection` stays the icon indigo for outlines, but 11px white on it is 4.47:1, so labels and badges take the deeper indigo |

`--selection`, `--measure` and their on-colours do **not** follow the appearance: they are
read against the host page, whose brightness has nothing to do with the chrome's. The
choice is stored in workspace state (§91), not in customisation data — it is a
convenience, so losing it must never look like losing design work.

`color-scheme` is written on the host's inline style rather than in the sheet, because
the host's `all: initial` outranks any `:host` rule. It is what makes native selects,
scrollbars and colour inputs inside the editor follow the chrome instead of the page.

Every pair listed above is asserted for contrast in `test/ui.test.mjs`, in both
appearances — the same rule the theme presets are held to.

## 7. Target sizes follow the web criterion, not the touch criterion

The 44×44pt / 48×48dp minimums in the skill are scoped to native app UI. This is a
pointer-driven desktop tool at density 9/10, so controls follow WCAG 2.2 AA
`web-target-size`: inline inspector controls are 24px minimum, toolbar and icon buttons
are 28px, and every icon-only control carries an accessible name plus `aria-pressed`
or `aria-selected` state.

---

# Theme Presets

The extension ships six themes that can be applied to *any website* (§49, §87). These are
product content, not chrome: they restyle the page being edited, never the editor.

Palettes come from this skill's own product-palette data (`--domain color`) rather than
being invented, one query per intent:

| Theme | Query | Palette note | Radius | Type | Shadow |
|---|---|---|---|---|---|
| Editorial | `minimal editorial reading` | Editorial black + accent pink | 2px | Serif | none |
| Sage | `warm calm neutral` | Sage neutral + calm teal | 10px | inherit | soft |
| High Contrast | `high contrast bold` | High contrast navy + blue | 4px | inherit | sharp |
| Terminal | `dark mode developer terminal` | Terminal dark + success green | 4px | Mono | none |
| Reading | `focus reading distraction free` | Book brown + page amber | 6px | Serif | none |
| Blossom | `soft pastel friendly` | Soft pink + trust blue | 16px | inherit | soft |

## Contrast is a test, not an intention

Every preset is asserted in `test/themes.test.mjs`, not merely reviewed:

- body text ≥ 4.5:1 against the theme background,
- **muted** text ≥ 4.5:1 as well — muted is still body copy, and the usual failure mode of
  a "soft" theme is muted text that quietly drops to 3:1,
- **the accent ≥ 4.5:1 against both the background and the surface**, because the accent is
  what a link is painted with and a link is body copy,
- **a label on the accent fill ≥ 4.5:1**, for the same reason.

A preset that cannot clear these does not ship. This is the `color-accessible-pairs` and
`contrast-readability` guidance applied to generated output rather than to a mockup.

### The 3:1 bar was the bug

The last two rules used to be a single `text on the accent ≥ 3:1`, and that number is why
four of the six presets shipped with unreadable links. 3:1 is the bar for *large* text and
UI boundaries; a link and a button label are normal-size body copy and owe 4.5:1. Because
the check never looked at the accent in its *text* role at all, Editorial's pink sat at
3.38:1 on its own paper, Reading's amber at 3.07:1, Sage's teal at 3.37:1 and Blossom's
blue at 3.75:1 — every one of them a link a reader has to squint at.

The fix is a distinction the palettes did not previously draw: **the shade that works as a
fill is rarely the shade that works as text on the same paper.** Editorial, Sage, Reading
and Blossom moved to a deeper shade of the identical hue (`#EC4899`→`#BE185D`,
`#0891B2`→`#0E7490`, `#D97706`→`#B45309`, `#0284C7`→`#075985`). Each is the same colour a
reader would name, and each now clears 4.5:1 as link text *and* carries a white label as a
button. High Contrast and Terminal already cleared the bar and were left untouched.

### The guarantee also lives in the engine

Correcting six palettes fixes six palettes. It does nothing for a theme a user captures off
a page, and captured palettes are lifted from real sites that are frequently unreadable
already. So the apply path enforces the same rule independently: every colour that ends up
carrying text goes through `readableOn()` in `src/shared/color.js`, which holds hue and
saturation fixed and moves only lightness until the target ratio is met, searching both
directions and preferring the smaller move. A theme's pink stays pink — it just stops being
illegible. When no shade can reach the target (a mid-grey asked to sit on both black and
white) it returns the most legible shade it found, because some contrast beats none.

The two layers are deliberately redundant and are tested separately. `every preset is
complete and internally legible` guards the shipped palettes so the gallery preview and
the rendered page agree; `every preset leaves every element on the page readable` applies
each preset to a fixture and checks the pairing every element actually ends up with, which
is the only thing a reader experiences.

### Text on an accent fill

A link inside a button is the case that motivates the mark. Left alone it keeps its own
link colour and disappears into the fill behind it, so any element whose nearest *painted*
ancestor background is the accent is stamped `on` during the same tree walk that stamps
tokens, and one rule paints those with `onAccent`.

It has to be a mark rather than a selector. The rule was previously `[bg] *`, which reaches
the entire subtree — so a plain white card nested inside an accent panel had white
on-accent text painted straight through it. CSS cannot express "nearest background
ancestor"; the walk can. An opaque background answers for its whole subtree, and anything
see-through defers to whatever shows through it.

## Serif and mono are stacks, not webfonts

Editorial and Reading specify `Georgia, "Times New Roman", serif`; Terminal specifies the
system mono stack. For the same reason the chrome uses system fonts (deviation 3 above),
a theme must not make the page fetch a webfont: the content script runs everywhere, and a
host page's CSP would block it regardless.

Font remapping deliberately exempts `code`, `pre` and anything whose class suggests an
icon font. Re-facing an icon font replaces glyphs with letters, which is the single most
destructive thing a theme can do to a page.

## Theme marks are separate from selection marks

Theme rules key off `data-widt-tokens`; per-element overrides key off `data-widt-id`. Both
are attribute selectors of equal specificity, and the override sheet is kept last in the
document, so **a hand edit always beats the theme beneath it**. That ordering is asserted
in the theme test suite.

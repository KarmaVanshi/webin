# Web Interface DevTools
## Detailed Product & Technical Concept Specification

**Working title:** Web Interface DevTools  
**Category:** Browser Extension / Visual Web Editor / Frontend Inspection Tool  
**Primary inspiration:** Figma Dev Mode + Figma Design + Browser DevTools  
**Primary principle:** Inspect and visually edit a live website without modifying its original source code.

---

# 1. Product Definition

Web Interface DevTools is a browser extension that turns a live website into an interactive, inspectable, visually editable interface.

The extension sits on top of the rendered webpage and provides a Figma-like workspace for:

1. Inspecting the frontend structure.
2. Understanding the hierarchy of the page.
3. Selecting elements visually.
4. Viewing layout, spacing, typography, color, and CSS properties.
5. Visually changing those properties.
6. Moving and resizing elements.
7. Editing text and selected attributes.
8. Hiding, showing, or removing elements locally.
9. Applying changes to multiple matching elements.
10. Saving modifications locally.
11. Restoring those modifications automatically after reload.
12. Maintaining undo/redo history.
13. Creating different customization profiles for the same website.

The original website is not permanently altered.

Instead, the extension maintains a **local customization layer** that is applied on top of the website whenever the matching page is loaded.

---

# 2. Core Product Philosophy

The extension should be built around one central idea:

> **The website is the canvas, the DOM is the structure, CSS is the design system, and the extension is the editing layer.**

The system should not attempt to screenshot the page and recreate it.

It should inspect the actual rendered frontend.

The relationship is:

```text
Original Website
       |
       v
Rendered DOM + CSS + Browser Layout
       |
       v
Frontend Inspection Engine
       |
       v
Internal Element Model
       |
       +-------------------+
       |                   |
       v                   v
Visual Canvas         Inspector
       |                   |
       +---------+---------+
                 |
                 v
          User Modification
                 |
                 v
          Override Engine
                 |
        +--------+--------+
        |                 |
        v                 v
   Live Preview      Local Storage
```

---

# 3. What the Product Is Not

The first version is not:

- A website builder for creating websites from scratch.
- A replacement for Figma.
- A replacement for Chrome DevTools.
- A source-code editor.
- A backend CMS.
- A website hosting platform.
- An AI website generator.
- An AI design assistant.
- An AI web-page analyzer.
- A web scraping platform.
- A tool that permanently modifies a website's server-side files.

The product is specifically a:

> **Live website inspection and visual customization environment.**

---

# 4. Core User Experience

The intended experience should be extremely visual.

A user opens a website.

They activate the extension.

The extension enters **Inspect / Design Mode**.

The page remains visible.

The user moves the mouse across the page.

The extension highlights the element under the pointer.

Example:

```text
                    LIVE WEBPAGE

        +--------------------------------------+
        |                  HEADER              |
        +--------------------------------------+
        |                                      |
        |             HERO SECTION             |
        |                                      |
        |       +-----------------------+      |
        |       |       BUTTON          |      |
        |       +-----------------------+      |
        |                 ^                    |
        |                 |                    |
        |             selected                |
        +--------------------------------------+
```

When the user clicks the button, the button becomes selected.

The extension displays:

- Selection outline.
- Width.
- Height.
- Position.
- Parent.
- Layout information.
- Typography information.
- Color information.
- Spacing.
- CSS properties.
- Editing controls.

The user can then edit the button visually.

---

# 5. Main Interface

The extension should use a layout similar to a design/devtools environment.

```text
+-------------------------------------------------------------------+
| Web Interface DevTools                         Inspect   Design    |
+-------------------+--------------------------------+--------------+
|                   |                                |              |
|     LAYERS        |                                |  INSPECTOR   |
|                   |                                |              |
| Page              |                                | Selection    |
|  Header           |          LIVE WEBSITE          | Layout       |
|   Logo            |                                | Spacing      |
|   Navigation      |      <visual editing>          | Typography   |
|  Main             |                                | Appearance   |
|   Hero            |                                | Position     |
|   Cards           |                                |              |
|  Footer           |                                |              |
|                   |                                |              |
+-------------------+--------------------------------+--------------+
|                      BOTTOM TOOLBAR                                  |
| Select | Move | Resize | Spacing | Align | Inspect | History | Save |
+-------------------------------------------------------------------+
```

The main regions are:

1. Top toolbar.
2. Layers panel.
3. Live page canvas.
4. Inspector panel.
5. Bottom status/tool bar.

---

# 6. Modes

The product should initially support several connected modes.

## 6.1 Inspect Mode

Purpose:

Understand the structure of an existing webpage.

Capabilities:

- Hover elements.
- Select elements.
- Read dimensions.
- Read computed CSS.
- View DOM hierarchy.
- View parent and child relationships.
- View layout information.
- View typography.
- View visual properties.
- View element identifiers.

Inspect mode should not change anything automatically.

---

## 6.2 Design Mode

Purpose:

Visually modify the page.

Capabilities:

- Drag elements.
- Resize elements.
- Change spacing.
- Change typography.
- Change colors.
- Change borders.
- Change radius.
- Change shadows.
- Change layout.
- Hide/show elements.
- Edit text.
- Modify selected attributes.
- Move elements within supported layout contexts.

Every design operation should immediately update the live page.

---

## 6.3 Responsive Mode

Purpose:

Inspect and modify different viewport configurations.

Examples:

```text
Desktop
1440 x 900

Tablet
768 x 1024

Mobile
390 x 844
```

The system should provide viewport presets and custom viewport sizes.

---

## 6.4 History Mode

Purpose:

Review changes.

Example:

```text
History

1. Selected Hero
2. Changed heading size: 32px -> 40px
3. Changed hero padding: 48px -> 32px
4. Changed button radius: 8px -> 16px
5. Hid banner
```

Users can:

- Undo.
- Redo.
- Revert a specific change.
- Reset all modifications.

---

# 7. Visual Editing System

Visual editing is the core feature.

The system should feel closer to a design tool than a traditional developer console.

---

# 8. Element Hover Detection

When the user moves the pointer over the webpage:

1. The extension detects the element underneath the pointer.
2. It determines the most useful selectable DOM node.
3. It draws a highlight overlay.
4. It displays a small label.

Example:

```text
+--------------------------------+
| <button> Buy Now              |
+--------------------------------+
```

The label could include:

```text
button.buy-now
120 x 44
```

The hover highlight should update continuously without modifying the website DOM unnecessarily.

---

# 9. Element Selection

Clicking an element should create a persistent selection.

Selection should include:

```text
Bounding box
Corner handles
Edge handles
Element label
Dimension labels
Spacing indicators
```

Example:

```text
                    320px
              <------------>

           +--------------------+
           |                    |
      24px |      Content       | 24px
           |                    |
           +--------------------+

                  180px
```

The selection overlay must exist in a separate extension-owned layer.

It must not interfere with the selected website element.

---

# 10. Element Bounding Box

For every selected element, the system should calculate:

- x coordinate.
- y coordinate.
- width.
- height.
- top.
- right.
- bottom.
- left.

The source should be the browser's actual rendered geometry, such as the element bounding rectangle.

The system should account for:

- Scroll position.
- Browser viewport.
- Zoom.
- Device pixel ratio.
- Transforms.
- Fixed elements.
- Sticky elements.

---

# 11. Resize Handles

The selection box should provide resize handles.

Example:

```text
        +-----------------------+
        |                       |
        |                       |
        |                       |
        +-----------------------+
        ^                       ^
        |                       |
      resize                  resize
```

Supported controls:

- Left edge.
- Right edge.
- Top edge.
- Bottom edge.
- Four corners.

The system should distinguish:

### Free resize

Width and height can change independently.

### Proportional resize

Width and height maintain a ratio.

### Axis-constrained resize

Only horizontal or vertical dimension changes.

---

# 12. Dragging / Moving

Users should be able to drag supported elements directly on the canvas.

Dragging should take the element's current layout context into account.

The system should identify whether the element is:

- Static.
- Relative.
- Absolute.
- Fixed.
- Sticky.
- Flex child.
- Grid child.

The system should avoid blindly injecting `position: absolute`.

Instead, the preferred strategy should be:

1. Detect current layout context.
2. Determine what visual movement means in that context.
3. Modify the smallest appropriate set of CSS properties.
4. Preserve responsive behavior where possible.

---

# 13. Spacing Editing

The extension should expose margin, padding, and gap visually.

Example:

```text
             MARGIN
        <-------------->

        +-------------------+
        |     PADDING       |
        |   +-----------+   |
        |   |  CONTENT  |   |
        |   +-----------+   |
        |                   |
        +-------------------+
```

Supported properties:

- margin-top.
- margin-right.
- margin-bottom.
- margin-left.
- padding-top.
- padding-right.
- padding-bottom.
- padding-left.
- gap.
- row-gap.
- column-gap.

Where a layout is Flexbox or Grid, the editor should expose gap before recommending manual margins.

---

# 14. Alignment Controls

A selected element or group should support:

- Align left.
- Align center horizontally.
- Align right.
- Align top.
- Align center vertically.
- Align bottom.

For compatible parent containers, these actions should prefer:

- `justify-content`
- `align-items`
- `align-self`
- `text-align`

rather than arbitrary absolute positioning.

---

# 15. Flexbox Editing

When the selected element's parent is a flex container, the inspector should expose:

```text
Display
Flex

Direction
Row / Column

Wrap
No Wrap / Wrap

Justify Content
Start / Center / End / Space Between / Space Around / Space Evenly

Align Items
Start / Center / End / Stretch

Gap
16px
```

For children:

```text
Flex Grow
Flex Shrink
Flex Basis
Align Self
Order
```

The editor should understand that Flexbox is a layout system, not simply a collection of independent coordinates.

---

# 16. CSS Grid Editing

When a selected element belongs to a grid, expose:

```text
Grid Columns
Grid Rows
Column Gap
Row Gap
Column Start
Column End
Row Start
Row End
```

The system should allow visual modification where practical.

Example:

```text
+------+------+
| A    | B    |
+------+------+
| C           |
+------+------+
```

Dragging a grid item between tracks should translate into valid grid properties instead of arbitrary coordinates.

---

# 17. Typography Editing

Selected text elements should expose:

```text
Font Family
Font Size
Font Weight
Line Height
Letter Spacing
Text Align
Text Transform
Text Decoration
Color
```

Example:

```text
Typography

Font
Inter

Size
32px

Weight
700

Line Height
1.2

Letter Spacing
0px

Align
Left
```

The user should be able to change values visually and immediately see the result.

---

# 18. Direct Text Editing

For editable text nodes, the user should be able to double-click the text.

Example:

```text
Original:
"Welcome to our website"

Double-click

"Welcome to our website"
        ^
      cursor
```

The extension should temporarily provide an editable interaction layer.

When the user commits the edit, the system records:

```text
Original Text:
Welcome to our website

New Text:
Welcome to the new website
```

The local override model should store this modification.

---

# 19. Color Editing

Color properties should be editable through a color picker.

Supported values:

- Hex.
- RGB.
- RGBA.
- HSL where applicable.
- CSS variables where resolvable.

Example:

```text
Text Color
#222222

Background
#FFFFFF

Border
#E5E7EB
```

If a property uses a CSS variable:

```css
color: var(--primary-text);
```

the inspector should show both:

```text
Resolved:
#222222

Source:
var(--primary-text)
```

The user should be able to choose whether to override the resolved value or the variable where safely possible.

---

# 20. Background Editing

Supported:

- Background color.
- Background image.
- Background position.
- Background size.
- Background repeat.
- Gradient inspection where practical.

The MVP should prioritize solid colors.

---

# 21. Border Editing

Controls:

```text
Border Width
Border Style
Border Color
Border Radius
```

Radius editing should support:

- All corners.
- Individual corners.

Example:

```text
Radius
12px

Linked:
[ON]

Top Left
12

Top Right
12

Bottom Right
12

Bottom Left
12
```

---

# 22. Shadow Editing

The inspector should expose:

```text
X
Y
Blur
Spread
Color
Opacity
Inset
```

Example:

```text
box-shadow:
0 4px 20px rgba(...)
```

The UI should preferably use sliders and numeric inputs together.

---

# 23. Visibility Controls

Users should be able to:

- Hide.
- Show.
- Remove locally.
- Restore.

Hide should ideally generate a reversible local override such as:

```css
display: none !important;
```

The original DOM should remain intact when possible.

---

# 24. Local Element Removal

A "remove" operation should be different from "hide".

### Hide

The element remains in the DOM but is not rendered.

### Remove

The extension can locally remove or suppress the element from the rendered page.

The operation must still be reversible.

The original website remains unchanged.

---

# 25. Layers Panel

The left side should behave like a Figma Layers panel.

Example:

```text
PAGE
|
+-- Header
|   |
|   +-- Logo
|   +-- Navigation
|       |
|       +-- Home
|       +-- Products
|       +-- About
|
+-- Main
|   |
|   +-- Hero
|   |   |
|   |   +-- Heading
|   |   +-- Description
|   |   +-- CTA
|   |
|   +-- Product Grid
|       |
|       +-- Product Card
|       +-- Product Card
|       +-- Product Card
|
+-- Footer
```

Selecting an item in the Layers panel should select the corresponding element in the webpage.

Selecting an element on the webpage should reveal and select its node in the Layers panel.

---

# 26. DOM Tree vs Design Tree

The extension should distinguish between:

1. The raw DOM tree.
2. The user-friendly design tree.

The raw DOM may contain:

```text
div
div
span
div
svg
path
div
```

This is technically accurate but visually noisy.

The design tree should attempt to present meaningful nodes.

Example:

```text
Header
Navigation
Hero
Product Card
Button
```

The MVP can initially expose the DOM structure with cleaner labels.

---

# 27. Element Information Model

Every inspectable element should have an internal object.

Example:

```json
{
  "id": "internal-123",
  "tag": "button",
  "classes": ["btn", "primary"],
  "attributes": {
    "type": "button"
  },
  "text": "Buy Now",
  "parentId": "internal-100",
  "children": [],
  "geometry": {
    "x": 120,
    "y": 420,
    "width": 140,
    "height": 44
  },
  "layout": {
    "display": "inline-flex",
    "position": "static"
  },
  "typography": {
    "fontFamily": "Inter",
    "fontSize": "16px",
    "fontWeight": "600"
  },
  "appearance": {
    "background": "#111111",
    "color": "#FFFFFF",
    "borderRadius": "8px"
  }
}
```

This model becomes the bridge between:

- DOM.
- Inspector.
- Visual editor.
- History.
- Persistence.

---

# 28. Inspection Engine

The Inspection Engine is responsible for reading the live website.

It should collect:

## DOM data

- Tag name.
- ID.
- Class list.
- Attributes.
- Parent.
- Children.
- Text content.
- Relevant accessibility attributes.

## Computed CSS

Use browser APIs to retrieve computed values.

Examples:

```text
display
position
width
height
margin
padding
color
background
font
border
box-shadow
opacity
z-index
overflow
```

## Layout data

Determine:

- Flex.
- Grid.
- Block.
- Inline.
- Inline-block.
- Absolute positioning.
- Fixed positioning.
- Sticky positioning.

## Geometry

Use the browser's actual rendered geometry.

---

# 29. Mutation Detection

Modern websites frequently change their DOM after initial page load.

The extension must therefore monitor changes.

Potential mechanisms:

```text
MutationObserver
ResizeObserver
IntersectionObserver
```

The system should detect:

- Added nodes.
- Removed nodes.
- Replaced nodes.
- Attribute changes.
- Layout changes.
- Dynamic content.

The model should be refreshed selectively rather than rebuilding the entire page representation every time.

---

# 30. Shadow DOM

Modern web applications may use Shadow DOM.

The extension should eventually support:

- Open Shadow DOM inspection.
- Open Shadow DOM element selection.
- Shadow DOM style inspection.

Closed Shadow DOM should be treated as a technical boundary and not assumed to be directly inspectable.

The architecture should keep this limitation explicit.

---

# 31. Iframe Handling

Pages may contain iframes.

The extension should distinguish:

```text
Main document
|
+-- iframe
    |
    +-- iframe document
```

Where browser security policies and extension permissions permit access, the extension can create an inspection context inside the frame.

The system must never assume that every iframe can be manipulated as if it were part of the parent document.

---

# 32. Cross-Origin Constraints

The architecture must respect the browser's security model.

Examples:

- Same-origin restrictions.
- Extension host permissions.
- Cross-origin iframes.
- CSP.
- Sandbox restrictions.

The product should provide graceful behavior when a page cannot be fully inspected.

---

# 33. Override Engine

The Override Engine applies user changes without changing the original website files.

There are several levels.

## Level 1: CSS Override

Preferred for visual changes.

Example:

```css
[data-wid="abc123"] {
    width: 380px !important;
    border-radius: 16px !important;
}
```

## Level 2: Attribute Override

For selected attributes.

Example:

```text
aria-label
title
href
```

## Level 3: Text Override

For user-edited text.

## Level 4: DOM Suppression

For hide/remove behavior.

## Level 5: Advanced DOM operations

Potentially introduced later.

---

# 34. Never Depend Only on Classes

A common mistake would be to save:

```text
.card
```

as the permanent selector.

That can fail because:

- Classes may be reused.
- Classes may be dynamically generated.
- Class names may change.
- Multiple elements may match.

The system therefore needs an identity strategy.

---

# 35. Element Identity System

Each saved change should contain multiple matching signals.

Example:

```json
{
  "identity": {
    "tag": "button",
    "textFingerprint": "buy-now",
    "parentSignature": "product-card",
    "classFingerprint": "btn-primary",
    "relativePath": "...",
    "positionHint": 2
  }
}
```

The matcher can score candidates.

Example:

```text
Tag match              +10
Stable attribute       +30
Parent match            +20
Text match              +15
Class match             +10
Relative position       +5
DOM path match          +10
```

The final score determines the most likely target.

This is safer than relying on a single selector.

---

# 36. Stable Selector Generation

Where available, prefer:

1. Unique stable ID.
2. Stable data attribute.
3. Semantic attribute.
4. Stable structural path.
5. Multi-signal signature.

Avoid relying solely on:

```text
nth-child(...)
```

because dynamic content can change the index.

---

# 37. Saved Customization Format

A site customization should be represented as structured data.

Example:

```json
{
  "site": "example.com",
  "path": "/products",
  "profile": "default",
  "changes": [
    {
      "operation": "style",
      "target": {
        "tag": "button",
        "textFingerprint": "buy-now",
        "parentSignature": "product-card"
      },
      "properties": {
        "width": "180px",
        "borderRadius": "16px"
      }
    },
    {
      "operation": "hide",
      "target": {
        "tag": "aside",
        "classFingerprint": "sidebar"
      }
    }
  ]
}
```

---

# 38. Site Matching

Changes should be associated with a website using more than the domain where necessary.

Potential scope:

```text
Domain
Subdomain
Path
Path pattern
```

Example:

```text
example.com
```

could have separate customization sets for:

```text
/
/products
/dashboard
/settings
```

---

# 39. Profiles

Users should be able to create different versions of the same website.

Example:

```text
example.com

Profiles
|
+-- Default
+-- Minimal
+-- Wide Layout
+-- Dark Style
+-- Productivity
```

Each profile has its own changes.

A profile can be enabled or disabled.

---

# 40. Auto-Reapplication

When the website loads:

```text
Page Load
   |
   v
Extension detects site
   |
   v
Load profile
   |
   v
Find matching elements
   |
   v
Apply overrides
   |
   v
Monitor dynamic DOM
   |
   v
Reapply changes if matching elements appear
```

This is essential for modern single-page applications.

---

# 41. Single-Page Application Support

The extension should support applications that change the page without a traditional reload.

Examples of behavior to detect:

- URL changes through History API.
- Client-side routing.
- Dynamic DOM rendering.
- Component replacement.

The system should respond to route changes and re-evaluate applicable saved customizations.

---

# 42. Undo / Redo Architecture

Every modification should create a structured operation.

Example:

```json
{
  "type": "style-change",
  "target": "internal-123",
  "property": "padding",
  "before": "16px",
  "after": "24px"
}
```

Undo:

```text
after -> before
```

Redo:

```text
before -> after
```

The system should avoid storing full page snapshots for every change because that would be expensive and unreliable.

Store operations instead.

---

# 43. Change Transactions

Related changes can be grouped.

Example:

Dragging a card may alter:

```text
width
x position
margin
```

These should be recorded as one user action where appropriate.

History should display:

```text
Moved Product Card
```

rather than three confusing low-level operations.

---

# 44. Reset

The extension should provide:

### Reset selected element

Remove all saved changes for the currently selected element.

### Reset page

Remove all saved changes for the current page.

### Reset site

Remove all saved changes for the website.

### Factory reset extension

Clear local configuration.

---

# 45. Copy / Paste Style

A useful design-tool feature:

```text
Select element A
      |
      v
Copy Style
      |
      v
Select element B
      |
      v
Paste Style
```

The copied style should include configurable categories:

```text
Typography
Colors
Border
Radius
Shadow
Spacing
Layout
```

The user should be able to choose what to paste.

---

# 46. Multi-Selection

The editor should eventually support selecting multiple elements.

Examples:

```text
Card 1
Card 2
Card 3
```

Then:

```text
Set Radius = 16px
```

should apply to all selected elements.

Selection techniques:

- Shift-click.
- Drag selection box where safe.
- Layers panel multi-select.

---

# 47. Multi-Element Editing

When several elements are selected, the inspector should show:

```text
3 Elements Selected

Shared Properties

Radius
12px

Font Size
16px

Background
#FFFFFF
```

If values differ:

```text
Radius
Mixed
```

---

# 48. Repeated Component Editing

A later version should detect repeated patterns.

Example:

```text
Product Card
Product Card
Product Card
Product Card
```

The extension can offer:

> Apply this style to matching elements.

This should initially be rule-based rather than AI-based.

Matching can use:

- Similar DOM structure.
- Similar class signatures.
- Similar dimensions.
- Similar child structure.
- Similar semantic role.

---

# 49. Design Token Detection

The system can scan computed values and identify repeated values.

Example:

```text
Colors

#111111    31 uses
#FFFFFF    18 uses
#E5E7EB    14 uses
#6366F1     9 uses
```

Spacing:

```text
4px
8px
12px
16px
24px
32px
48px
```

Typography:

```text
Inter
16px
18px
24px
32px
48px
```

This is not required for MVP but should be part of the architecture.

---

# 50. Responsive Editing

The system should distinguish between:

```text
Desktop changes
Tablet changes
Mobile changes
```

For example:

```json
{
  "breakpoint": "mobile",
  "properties": {
    "padding": "16px"
  }
}
```

The editor should not automatically create excessive media queries.

It should understand the website's existing breakpoints where possible.

---

# 51. Existing CSS Awareness

The inspector should distinguish between:

```text
Author CSS
Browser default
Inline style
Extension override
```

Example:

```text
WIDTH

Computed:
320px

Source:
Author CSS

Extension Override:
380px
```

This makes the system understandable and trustworthy.

---

# 52. CSS Cascade Awareness

A visual change may fail if another CSS rule has higher specificity.

The editor therefore needs to recognize:

- Specificity.
- `!important`.
- Inline styles.
- Cascade order.
- Inherited values.

The Override Engine should choose the smallest intervention that reliably produces the requested visual result.

---

# 53. CSS Variable Awareness

For websites that use variables:

```css
--primary-color
--spacing-md
--radius-lg
```

the inspector should show them as first-class values.

Example:

```text
Border Radius

Resolved:
12px

Variable:
var(--radius-lg)
```

This creates a more accurate understanding of the site's design system.

---

# 54. Visual Spacing Measurement

When an element is selected, the editor should allow measurement relative to neighboring elements.

Example:

```text
Element A
      |
      | 24px
      v
Element B
```

Potential measurement features:

- Distance to parent.
- Distance to nearest sibling.
- Horizontal distance.
- Vertical distance.

This should work similarly to design inspection tools.

---

# 55. Selection Overlay Architecture

The visual overlay should be extension-owned.

Recommended concept:

```text
Website DOM
    |
    +-- Original page
    |
    +-- Extension overlay
          |
          +-- Hover highlight
          +-- Selection rectangle
          +-- Handles
          +-- Measurement labels
          +-- Tooltips
```

The overlay must:

- Stay above the page.
- Not affect page layout.
- Not trigger unwanted page styles.
- Not become a selectable page element.
- Update during scrolling and resizing.

---

# 56. Scrolling

The extension must account for:

- Window scrolling.
- Nested scroll containers.
- Sticky headers.
- Fixed navigation.
- Horizontal scrolling.

Selection geometry should remain accurate while the user scrolls.

---

# 57. Zoom

The browser can have different zoom factors.

The extension must ensure:

```text
CSS coordinates
+
device pixel ratio
+
browser zoom
```

are correctly accounted for when drawing overlays and handles.

---

# 58. Keyboard Shortcuts

Core shortcuts should be similar to design applications where practical.

Potential examples:

```text
Esc              Deselect
Cmd/Ctrl + Z     Undo
Cmd/Ctrl + Shift + Z
                 Redo

Delete           Hide/remove selected item
Cmd/Ctrl + C     Copy style
Cmd/Ctrl + V     Paste style
Cmd/Ctrl + S     Save changes
Cmd/Ctrl + K     Open commands
```

Shortcuts should not interfere with website behavior when not in an active editing state.

---

# 59. Command Toolbar

A small toolbar can expose the most common tools:

```text
Select
Move
Resize
Text
Spacing
Align
Inspect
```

The toolbar should be context-sensitive.

For example, selecting text exposes text-related controls.

Selecting a grid container exposes grid controls.

---

# 60. Inspector Panel Structure

The Inspector should be organized into collapsible sections.

Example:

```text
INSPECTOR

Selection
  Button

Layout
  Width
  Height
  Position
  Display

Spacing
  Margin
  Padding
  Gap

Typography
  Font
  Size
  Weight
  Line Height
  Letter Spacing

Appearance
  Background
  Color
  Border
  Radius
  Shadow
  Opacity

Advanced
  Classes
  Attributes
  CSS Source
```

---

# 61. Inspector Data Sources

The inspector should clearly separate:

### Computed value

What the browser is actually rendering.

### Declared value

What the site's CSS explicitly declares.

### Override value

What the extension has changed.

Example:

```text
Font Size

Computed
18px

Website CSS
16px

Your Override
18px
```

---

# 62. Edit Value UX

Property controls should support:

- Text inputs.
- Number inputs.
- Unit selectors.
- Sliders.
- Color pickers.
- Dropdowns.
- Toggle buttons.

Example:

```text
Width

[ 320 ] [ px v ]
```

The system should validate values before applying them.

---

# 63. Units

Support common CSS units:

```text
px
%
rem
em
vw
vh
ch
auto
```

The editor should preserve the original unit where possible.

---

# 64. Position Editing

For appropriate elements:

```text
X
Y
```

can be shown.

However, the system should distinguish visual coordinates from CSS positioning rules.

The goal is to preserve the existing layout model.

---

# 65. Constraints

The editor should eventually expose constraints such as:

```text
Left
Center
Right
Top
Bottom
Scale
```

This becomes especially important for responsive behavior.

---

# 66. Element States

The extension should eventually support inspection of:

```text
Default
:hover
:focus
:active
:visited
```

This is difficult on arbitrary websites and should not be a core MVP dependency.

The architecture should allow it later.

---

# 67. Dynamic Content

Websites can replace content after interaction.

Example:

```text
Click button
     |
     v
Modal appears
```

The extension should detect newly inserted elements.

Saved changes for dynamically created elements should be reapplied when their identity matches.

---

# 68. SPA Route Handling

For applications using routes like:

```text
/app
/app/dashboard
/app/settings
```

the extension should monitor navigation.

Potential signals:

- `popstate`.
- `pushState`.
- `replaceState`.
- URL changes.
- DOM mutations.

The system should load the matching page profile.

---

# 69. Storage Architecture

MVP storage should remain local.

Possible architecture:

```text
chrome.storage.local
```

or IndexedDB for more complex datasets.

Storage categories:

```text
Settings
Sites
Profiles
Changes
History
Preferences
```

---

# 70. Storage Example

```json
{
  "sites": {
    "example.com": {
      "profiles": {
        "default": {
          "changes": []
        }
      }
    }
  }
}
```

---

# 71. Performance Requirements

The extension must not make normal browsing unusably slow.

Key performance requirements:

- Avoid continuously traversing the full DOM.
- Use observers selectively.
- Cache inspected nodes.
- Recalculate geometry only when required.
- Batch updates.
- Avoid forcing repeated synchronous layout calculations.
- Avoid excessive overlay DOM creation.

The system should be event-driven.

---

# 72. Large DOM Handling

Some websites have thousands of nodes.

The extension should not build an expensive full object graph immediately.

Recommended approach:

### Initial phase

Build a lightweight tree.

### On selection

Resolve detailed properties for the selected node.

### On expansion

Inspect child nodes as the user expands them.

This provides a more scalable experience.

---

# 73. Memory Management

The extension should avoid retaining stale references to removed DOM nodes.

When nodes are removed:

```text
DOM removed
    |
    v
Internal reference cleaned
    |
    v
Cached data invalidated
```

Use appropriate weak references or cleanup strategies where useful.

---

# 74. Security

The extension will operate on arbitrary websites, so security is critical.

The product should:

- Minimize permissions.
- Avoid unnecessary network access.
- Keep user customization data local by default.
- Never send webpage contents to an external service for MVP.
- Avoid executing arbitrary user-provided scripts by default.
- Separate extension UI from webpage execution context.
- Sanitize any user-entered values.
- Treat page content as untrusted input.

---

# 75. Privacy

The MVP should be local-first.

Default behavior:

```text
Website
    |
    v
Local extension
    |
    v
Local storage
```

No cloud account should be required for core functionality.

No webpage data should be uploaded merely to inspect or customize it.

---

# 76. Browser Permissions

The extension should request only permissions needed for its functionality.

Potential requirements may include access to active tabs and host permissions for pages the user chooses to customize.

The exact permissions depend on the implementation and browser.

The product should communicate permissions clearly.

---

# 77. Browser Extension Architecture

Recommended stack:

```text
TypeScript
React
Vite
Chrome Extension Manifest V3
```

Potential future browser support:

```text
Chrome
Edge
Firefox
Safari
```

The architecture should avoid browser-specific assumptions where possible.

---

# 78. Extension Components

Suggested structure:

```text
src/
|
+-- background/
|   +-- service-worker.ts
|
+-- content/
|   |
|   +-- selector/
|   +-- overlay/
|   +-- inspector-engine/
|   +-- element-model/
|   +-- layout-engine/
|   +-- override-engine/
|   +-- mutation-monitor/
|   +-- visual-editor/
|
+-- devtools/
|   |
|   +-- layers/
|   +-- inspector/
|   +-- design/
|   +-- history/
|   +-- responsive/
|
+-- storage/
|   |
|   +-- site-store/
|   +-- profile-store/
|   +-- history-store/
|
+-- shared/
    |
    +-- types/
    +-- utilities/
```

---

# 79. Extension Contexts

The architecture should distinguish:

## Service Worker

Responsible for:

- Extension lifecycle.
- Commands.
- Messaging.
- Storage coordination where needed.

## Content Script

Responsible for:

- Page interaction.
- DOM inspection.
- Overlay.
- Visual editing.
- Applying changes.

## Extension UI

Responsible for:

- Inspector.
- Layers.
- Toolbar.
- Settings.
- History.
- Profiles.

Communication:

```text
Extension UI
      |
      v
Messaging Layer
      |
      v
Content Script
      |
      v
Live DOM
```

---

# 80. Messaging

Messages should use typed structures.

Example:

```typescript
type Message =
  | {
      type: "SELECT_ELEMENT";
      elementId: string;
    }
  | {
      type: "UPDATE_STYLE";
      elementId: string;
      property: string;
      value: string;
    }
  | {
      type: "UNDO";
    };
```

This creates a predictable communication layer.

---

# 81. Visual Editor Engine

The Visual Editor receives user interactions and converts them into semantic editing operations.

Example:

```text
Mouse Drag
    |
    v
Interaction Engine
    |
    v
Determine Intent
    |
    v
Resize Element
    |
    v
Determine CSS Strategy
    |
    v
Generate Override
    |
    v
Apply + Record
```

The editor should not directly mutate arbitrary styles from mouse events.

---

# 82. Style Mutation Pipeline

Recommended pipeline:

```text
User Input
    |
    v
Validation
    |
    v
Layout Context Analysis
    |
    v
Generate Candidate Change
    |
    v
Preview
    |
    v
Apply
    |
    v
Record History
    |
    v
Persist
```

---

# 83. Preview vs Commit

For drag and resize interactions, the extension should support temporary preview.

Example:

```text
Mouse moving
    |
    v
Preview style
```

When the user releases:

```text
Mouse up
    |
    v
Commit change
```

This avoids creating hundreds of history entries while dragging.

---

# 84. Change Representation

All edits should be represented as operations.

Example:

```json
{
  "id": "change-001",
  "type": "style",
  "target": "internal-123",
  "changes": {
    "width": {
      "before": "320px",
      "after": "380px"
    }
  }
}
```

This provides the foundation for:

- Undo.
- Redo.
- Persistence.
- Reset.
- Conflict handling.

---

# 85. Conflict Handling

A website may change after the user saved a customization.

Example:

```text
User saved:
.button width = 200px

Website later:
.button structure changed
```

The extension should:

1. Attempt to locate the target.
2. Evaluate confidence.
3. Apply if confidence is high.
4. Warn if confidence is low.
5. Never silently apply a risky change to an unrelated element.

Example warning:

```text
Could not confidently identify:
"Buy Now" button

[Choose element] [Skip]
```

---

# 86. Recovery from Broken Matches

Users should have a way to remap a saved change.

Example:

```text
Saved change:
Hero Button Width = 200px

Target no longer found.

[Select replacement element]
```

The user chooses the new element.

The identity signature is updated.

---

# 87. Design System View

A later version can provide a site-wide design overview:

```text
DESIGN SYSTEM

Colors
----------------
Primary       #111111
Secondary     #FFFFFF
Accent        #6366F1

Typography
----------------
Inter
16px
18px
24px
32px
48px

Spacing
----------------
4
8
12
16
24
32
48

Radius
----------------
4
8
12
16
```

This becomes an inspection feature rather than a replacement for a full design system tool.

---

# 88. Page Outline

The extension should be able to summarize page structure visually.

Example:

```text
Page
|
+-- Header
|
+-- Hero
|
+-- Features
|   |
|   +-- Feature
|   +-- Feature
|   +-- Feature
|
+-- Testimonials
|
+-- Footer
```

This helps users understand complex pages before editing them.

---

# 89. Component Candidate Detection

A non-AI rule-based system can detect repeated structures.

Candidate conditions:

- Similar tag structure.
- Similar class structure.
- Similar child count.
- Similar text patterns.
- Similar computed styles.
- Similar dimensions.

Example:

```text
12 structurally similar cards detected.

[Select all]
[Ignore]
```

---

# 90. Apply-to-Matching Elements

A user changes one card:

```text
Radius: 8px -> 16px
```

The extension can offer:

```text
Apply to:
(o) Selected element
( ) Similar elements
( ) All cards in this section
```

This is an important bridge between individual editing and component-level editing.

---

# 91. Saved Workspace State

The extension can remember:

- Last selected element.
- Panel widths.
- Active mode.
- Active profile.
- Expanded layers.
- Viewport preset.

This state should be separate from actual customization changes.

---

# 92. Import / Export

A later version should support exporting a customization.

Example file:

```text
example-com-productivity.webedit.json
```

The export should contain:

- Domain.
- Path.
- Profile.
- Element signatures.
- Changes.
- Version information.

This allows users to back up and move customizations.

---

# 93. No Cloud Requirement

The product should be fully functional without:

- Account creation.
- Login.
- Cloud sync.
- Server-side storage.

Cloud features can be considered later.

---

# 94. MVP Scope

The MVP must be narrow enough to be technically achievable.

## MVP Feature 1: Activate Editing

User clicks the extension.

The extension enters editing mode.

---

## MVP Feature 2: Hover Detection

User hovers any supported page element.

The extension displays a highlight.

---

## MVP Feature 3: Select Element

User clicks the element.

The extension displays:

- Bounding box.
- Element name.
- Dimensions.

---

## MVP Feature 4: Layers

Show a basic DOM/design hierarchy.

---

## MVP Feature 5: Inspector

Display:

- Width.
- Height.
- Margin.
- Padding.
- Display.
- Position.
- Font.
- Font size.
- Weight.
- Color.
- Background.
- Border.
- Radius.
- Shadow.

---

## MVP Feature 6: Visual Editing

At minimum:

- Move.
- Resize.
- Padding.
- Margin.
- Font size.
- Font weight.
- Colors.
- Radius.
- Hide.

---

## MVP Feature 7: Undo/Redo

All committed modifications can be reversed.

---

## MVP Feature 8: Save Locally

Save modifications for the current website.

---

## MVP Feature 9: Reapply on Reload

Reload the page.

The changes return.

---

## MVP Feature 10: Reset

Users can restore the original appearance.

---

# 95. MVP User Journey

```text
1. Open a website.

2. Click Web Interface DevTools.

3. Click "Design".

4. Hover over an element.

5. Click the element.

6. Element becomes selected.

7. Inspector opens.

8. User changes a property.

9. Page updates immediately.

10. User drags/resizes the element.

11. User clicks Save.

12. Extension stores the change.

13. User reloads page.

14. Extension detects the site.

15. Extension identifies the element.

16. Saved change is reapplied.

17. User continues editing.
```

---

# 96. Example MVP Scenario

User visits:

```text
example.com
```

They dislike the sidebar.

They activate the extension.

They click the sidebar.

Inspector:

```text
Element
aside.sidebar

Width
280px

Display
block
```

They click:

```text
Hide
```

The page immediately changes.

The extension records:

```json
{
  "type": "hide",
  "target": "aside.sidebar"
}
```

The user saves.

Later they return.

The extension finds the sidebar and applies the saved hide operation.

---

# 97. Example Visual Redesign Scenario

Original:

```text
CARD

Width: 280px
Radius: 8px
Padding: 16px
Title: 18px
```

User changes:

```text
Width: 360px
Radius: 20px
Padding: 24px
Title: 22px
```

The page immediately previews the result.

The saved customization becomes:

```json
{
  "type": "style",
  "changes": {
    "width": "360px",
    "borderRadius": "20px",
    "padding": "24px",
    "fontSize": "22px"
  }
}
```

---

# 98. User Interface Design Principles

The extension UI should feel:

- Fast.
- Visual.
- Minimal.
- Professional.
- Familiar to Figma users.
- Familiar to DevTools users.
- Non-destructive.
- Reversible.

The user should spend most of their time looking at the website rather than the extension chrome.

---

# 99. Visual Hierarchy of the UI

Primary focus:

```text
LIVE PAGE
```

Secondary:

```text
SELECTED ELEMENT
```

Tertiary:

```text
INSPECTOR
LAYERS
```

The extension should not cover the webpage excessively.

Panels can be:

- Docked.
- Collapsed.
- Resized.

---

# 100. Responsive Extension UI

The extension should support:

### Full desktop editing

Wide inspector and layers panels.

### Compact mode

Minimal panels for smaller screens.

### Popup mode

Quick actions such as:

```text
Inspect
Design
Save
Reset
```

The full workspace should be used for serious editing.

---

# 101. Error States

The system must clearly handle failures.

Example:

```text
Unable to inspect this element.

Reason:
The element is inside a restricted iframe.

[Continue]
```

Another:

```text
Saved customization could not be restored.

[Choose element]
[Skip]
```

Never silently fail.

---

# 102. Unsupported Features

The UI should communicate unsupported scenarios rather than pretending support exists.

Possible examples:

- Closed Shadow DOM.
- Restricted cross-origin iframe.
- Browser-protected page.
- Highly dynamic generated structure.
- Canvas-rendered UI that has no corresponding DOM element.

Example:

```text
This interface is rendered inside a canvas.
DOM-based visual editing is not available for this element.
```

---

# 103. Canvas-Based Websites

Some websites render UI through:

```text
<canvas>
```

In those cases there may be no meaningful DOM element for each visual object.

The first version should focus on regular HTML/CSS interfaces.

Canvas editing can be treated as a separate future system.

---

# 104. SVG Support

SVG should be inspectable.

Potential properties:

```text
Width
Height
Fill
Stroke
Stroke Width
Opacity
ViewBox
```

For nested SVG shapes, the system should allow element selection where possible.

---

# 105. Image Editing Controls

For image elements, expose:

```text
Width
Height
Object Fit
Object Position
Border Radius
Opacity
```

Future support can include replacement with a locally selected image.

This should not be required for MVP.

---

# 106. Accessibility Considerations

The tool should not accidentally destroy accessibility.

When editing, preserve where possible:

- ARIA attributes.
- Semantic elements.
- Accessible names.
- Keyboard focus.
- Contrast.

The extension should visually edit rather than unnecessarily replace semantic HTML.

---

# 107. CSS Property Safety

Not every CSS property should be exposed initially.

Start with predictable visual properties.

Avoid exposing extremely complex properties in the MVP unless the editor can safely represent them.

Examples for later:

```text
clip-path
mask
complex transforms
filter chains
container queries
advanced animation
```

---

# 108. Animation Handling

MVP:

- Read animation-related styles.
- Do not attempt full timeline editing.

Future:

```text
Animation
Duration
Delay
Timing Function
Iteration
Play State
```

A full animation editor is outside the initial scope.

---

# 109. Transform Handling

Transforms such as:

```css
transform: translate(...)
scale(...)
rotate(...)
```

can complicate geometry.

The inspection engine should detect them.

The visual editor should avoid overwriting transforms carelessly.

A future version can offer:

```text
Move
Rotate
Scale
```

as first-class transform controls.

---

# 110. Z-Index and Layering

Selected positioned elements should expose:

```text
z-index
```

A future visual stacking interface can show:

```text
Front
Forward
Backward
Back
```

MVP can provide numeric editing.

---

# 111. Overflow

Useful layout properties:

```text
overflow
overflow-x
overflow-y
```

The inspector should reveal them where relevant.

---

# 112. Scroll Containers

The system should distinguish page scrolling from nested scrolling.

Example:

```text
Page
 |
 +-- Main
      |
      +-- Scroll Container
```

Measurements and element positions must account for nested scroll offsets.

---

# 113. Sticky Elements

Sticky headers can change position during scrolling.

The selection overlay must follow their rendered position rather than relying only on static document coordinates.

---

# 114. Fixed Elements

Fixed elements should be handled relative to the viewport.

Example:

```text
Cookie Banner
Bottom: 0
Position: Fixed
```

The editor should identify this correctly.

---

# 115. Inspecting Computed Layout

The system should provide a "Layout" view that summarizes the layout model.

Example:

```text
Layout

Display
Flex

Direction
Row

Align
Center

Justify
Space Between

Gap
20px

Position
Relative
```

This is one of the main advantages over purely visual website editors.

---

# 116. Technical Inspection View

Advanced users can open a deeper view:

```text
HTML

<button
  class="btn primary"
  type="button"
>
  Buy Now
</button>
```

CSS:

```css
.btn.primary {
  ...
}
```

The source view should initially be read-only.

---

# 117. Read-Only Source vs Override

Important distinction:

```text
SOURCE
Read only

OVERRIDE
Editable
```

This prevents the product from becoming an uncontrolled code editor.

---

# 118. Advanced CSS Editor — Future

A later version can provide:

```css
.custom-selector {
    ...
}
```

This should be clearly separated from visual editing.

Visual editing remains the default path.

---

# 119. Save Semantics

Clicking Save should persist:

- Active site.
- Current page scope.
- Active profile.
- Committed changes.
- Element identity signatures.

Preview-only changes should not be saved until committed.

---

# 120. Autosave

A later version can support autosave.

MVP can require an explicit Save action to reduce accidental persistence.

---

# 121. Local Data Recovery

The extension should protect against corrupt customization data.

Use versioned schemas.

Example:

```json
{
  "schemaVersion": 1
}
```

Future migration functions can upgrade old data.

---

# 122. Data Versioning

Changes should be forward-compatible where possible.

Example:

```text
Schema v1
Schema v2
Schema v3
```

The extension should migrate old configurations rather than simply invalidating them.

---

# 123. Import Validation

Imported customization files should be validated before applying.

Check:

- Schema version.
- Domain.
- Change types.
- Target structure.
- Property values.

Invalid changes should be rejected safely.

---

# 124. Testing Strategy

Testing should exist at multiple levels.

## Unit Tests

Test:

- Identity matching.
- CSS generation.
- History.
- Serialization.
- Validation.
- Layout calculations.

## Integration Tests

Test:

- DOM selection.
- Mutation detection.
- Override application.
- SPA navigation.

## Browser Tests

Test real websites and representative fixtures.

---

# 125. Local Test Fixture Pages

The development project should include local test pages for:

```text
Simple HTML
Flexbox
Grid
Responsive layouts
Nested scrolling
Sticky elements
Fixed elements
SVG
Images
Dynamic DOM
SPA routing
Shadow DOM
iframes
```

This allows predictable regression testing.

---

# 126. Development Phases

## Phase 1 — Inspection Foundation

Build:

- Content script.
- Hover detection.
- Element selection.
- Bounding boxes.
- Basic DOM tree.
- Computed style extraction.

Goal:

> Select any normal HTML element and understand it.

---

## Phase 2 — Inspector

Build:

- Layout panel.
- Typography panel.
- Appearance panel.
- Spacing panel.
- Property editor.

Goal:

> Understand and edit core visual properties.

---

## Phase 3 — Visual Editing

Build:

- Drag.
- Resize.
- Alignment.
- Spacing guides.
- Direct text editing.

Goal:

> Make the interface visually editable.

---

## Phase 4 — Persistence

Build:

- Change model.
- Local storage.
- Element identity.
- Reapplication.
- SPA support.
- Reset.

Goal:

> Changes survive reloads.

---

## Phase 5 — Design Tool Features

Build:

- Multi-select.
- Copy/paste style.
- Apply to matching elements.
- Profiles.
- Responsive editing.
- Design-token overview.

Goal:

> Move from DevTools to a true design customization environment.

---

# 127. Suggested MVP Milestone

The first real milestone should be:

> **"Select any normal website element, visually change it, reload the page, and see the modification come back automatically."**

That one workflow proves the fundamental product.

---

# 128. MVP Acceptance Criteria

The MVP is successful when all of the following work:

### Selection

- Hover highlights the correct element.
- Click selects the correct element.
- Selection remains aligned during scrolling.

### Inspection

- Element dimensions are accurate.
- Core computed CSS properties appear.
- Parent/child relationships are visible.

### Editing

- Width can be changed.
- Height can be changed.
- Padding can be changed.
- Margin can be changed.
- Font size can be changed.
- Font weight can be changed.
- Text color can be changed.
- Background color can be changed.
- Border radius can be changed.
- Element can be hidden.
- Basic movement/resize works.

### Persistence

- Changes can be saved.
- Page reload restores changes.
- SPA route changes are handled.
- Dynamic elements can be matched where possible.

### History

- Undo works.
- Redo works.
- Reset works.

---

# 129. Product Positioning

The product should be positioned as:

> **A Figma-like visual editor for live websites.**

Alternative description:

> **Inspect, understand, and redesign any webpage directly in your browser.**

The product is not trying to compete purely on developer tooling.

Its differentiation is the combination of:

```text
Live DOM inspection
+
Figma-like visual editing
+
Persistent local customization
```

---

# 130. Core Differentiator

The most important feature is not the inspector itself.

Browsers already have inspectors.

The differentiator is:

> **The ability to directly manipulate the live webpage visually and turn those manipulations into persistent local frontend overrides.**

This is the foundation of the product.

---

# 131. Long-Term Vision

The long-term system can turn the web into a universal editable design surface.

```text
ANY WEBSITE
     |
     v
FRONTEND STRUCTURE
     |
     v
INTERACTIVE DESIGN MODEL
     |
     v
VISUAL EDITOR
     |
     v
PERSONAL DESIGN LAYER
     |
     v
PERSONALISED WEB EXPERIENCE
```

The user does not need:

- Source-code access.
- GitHub access.
- Backend access.
- Original Figma file.
- Developer knowledge.

They open the website and visually edit what they see.

---

# 132. Fundamental Architecture

The entire product can ultimately be understood as six systems:

```text
+---------------------------------------------------------+
|                 WEB INTERFACE DEVTOOLS                  |
+---------------------------------------------------------+
|                                                         |
|  1. INSPECTION ENGINE                                  |
|     Reads DOM, CSS, geometry, layout and attributes     |
|                                                         |
|  2. ELEMENT MODEL                                      |
|     Converts frontend structure into editable objects  |
|                                                         |
|  3. VISUAL EDITOR                                      |
|     Selection, drag, resize, spacing and design        |
|                                                         |
|  4. OVERRIDE ENGINE                                    |
|     Converts changes into safe local modifications     |
|                                                         |
|  5. PERSISTENCE ENGINE                                 |
|     Stores and restores customizations                 |
|                                                         |
|  6. HISTORY ENGINE                                     |
|     Undo, redo, reset and change management             |
|                                                         |
+---------------------------------------------------------+
```

These six systems should be developed independently but connected through a shared element model and operation model.

---

# 133. Final Product Principle

The project should always follow this rule:

> **Do not rebuild the website. Inspect the real frontend and place a reversible design layer on top of it.**

The user should feel like:

```text
"I am designing this website."
```

while technically the system is doing:

```text
DOM inspection
+
computed-style analysis
+
layout analysis
+
visual interaction
+
CSS/DOM override generation
+
local persistence
```

That combination is the core concept.

---

# 134. Explicitly Out of Scope for the Initial Version

The following are intentionally excluded from the first release:

- AI.
- Natural-language design commands.
- AI-generated CSS.
- AI component recognition.
- Cloud collaboration.
- Multiplayer editing.
- Full website source-code editing.
- Backend modifications.
- Full animation timeline.
- Full canvas/SVG design suite.
- Server-side website publishing.

The first version should focus on getting one experience exceptionally good:

> **Select a live element → visually edit it → save it locally → see it again after reload.**

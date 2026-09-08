/**
 * Inspector panel (§60, §61).
 *
 * Sections mirror the concept's structure exactly: Selection, Layout, Spacing,
 * Typography, Appearance, Advanced — plus Flex/Grid sections that appear only when the
 * selection is actually in that layout (§15, §16, §59 "context-sensitive").
 *
 * Every editable row can carry a provenance badge, because the panel's job is not just
 * to change values but to explain them (§61).
 */

import {
  numberField, textField, colorField, segmented, selectField, sliderField,
  boxField, section, readonlyRow, sourceBadge, emptyState, iconButton, button, MIXED,
} from './controls.js';
import { escapeHtml, truncate } from '../shared/util.js';
import { parseDimension } from '../shared/css-values.js';
import { toHex, parseColor } from '../shared/color.js';
import { icon } from './icons.js';
import { LayoutKind } from '../content/inspector-engine/layout.js';

const DISPLAY_VALUES = ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'none'];
const POSITION_VALUES = ['static', 'relative', 'absolute', 'fixed', 'sticky'];
const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' },
];

/**
 * @param {object|null} detail  Element record from the model, or null.
 * @param {object} state        { openSections:Set, overrides, breakpoint, multi }
 */
export function renderInspector(detail, state) {
  if (!detail) {
    return emptyState({
      iconName: 'target',
      title: 'Nothing selected',
      body: 'Hover the page to highlight an element, then click to select it. Alt-click reaches the exact node under the pointer.',
    });
  }
  if (state.multi > 1) return renderMulti(detail, state);

  const open = (id) => state.openSections.has(id);
  const context = detail.layoutContext ?? {};

  const sections = [
    renderSelectionHead(detail, state),
    section({ id: 'layout', title: 'Layout', open: open('layout'), body: layoutBody(detail, state) }),
    context.self === LayoutKind.FLEX
      ? section({ id: 'flex', title: 'Flex container', open: open('flex'), body: flexContainerBody(context) })
      : '',
    context.self === LayoutKind.GRID
      ? section({ id: 'grid', title: 'Grid container', open: open('grid'), body: gridContainerBody(context) })
      : '',
    context.isFlexChild
      ? section({ id: 'flex-child', title: 'Flex item', open: open('flex-child'), body: flexChildBody(context) })
      : '',
    context.isGridChild
      ? section({ id: 'grid-child', title: 'Grid item', open: open('grid-child'), body: gridChildBody(context) })
      : '',
    section({ id: 'spacing', title: 'Spacing', open: open('spacing'), body: spacingBody(detail, state) }),
    section({ id: 'typography', title: 'Typography', open: open('typography'), body: typographyBody(detail, state) }),
    section({ id: 'appearance', title: 'Appearance', open: open('appearance'), body: appearanceBody(detail, state) }),
    detail.svg ? section({ id: 'svg', title: 'SVG', open: open('svg'), body: svgBody(detail) }) : '',
    detail.image ? section({ id: 'image', title: 'Image', open: open('image'), body: imageBody(detail) }) : '',
    section({ id: 'advanced', title: 'Advanced', open: open('advanced'), body: advancedBody(detail, state) }),
  ];

  return sections.join('');
}

function renderSelectionHead(detail, state) {
  const { geometry } = detail;
  const overrideCount = Object.values(state.overrides ?? {})
    .reduce((n, group) => n + Object.keys(group).length, 0);

  return `
<div class="widt-selection-head">
  <span class="widt-selection-name" title="${escapeHtml(detail.label)}">${escapeHtml(truncate(detail.label, 30))}</span>
  ${overrideCount ? `<span class="widt-badge widt-badge--accent">${overrideCount} edit${overrideCount === 1 ? '' : 's'}</span>` : ''}
  <span class="widt-selection-meta widt-mono">${Math.round(geometry.width)} × ${Math.round(geometry.height)}</span>
</div>
<div style="display:flex;gap:var(--space-2);padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--hairline)">
  ${iconButton({ name: 'eyeOff', action: 'hide-selected', title: 'Hide element' })}
  ${iconButton({ name: 'trash', action: 'remove-selected', title: 'Remove element locally', danger: true })}
  ${iconButton({ name: 'copy', action: 'copy-style', title: 'Copy style' })}
  ${iconButton({ name: 'paste', action: 'paste-style', title: 'Paste style' })}
  ${iconButton({ name: 'target', action: 'select-parent', title: 'Select parent' })}
  ${iconButton({ name: 'layers', action: 'select-similar', title: 'Select similar elements' })}
  <span style="flex:1"></span>
  ${iconButton({ name: 'reset', action: 'reset-selected', title: 'Reset this element', danger: true })}
</div>`;
}

function layoutBody(detail, state) {
  const { layout } = detail;
  const width = parseDimension(layout.declaredWidth) ?? { number: layout.width, unit: 'px' };
  const height = parseDimension(layout.declaredHeight) ?? { number: layout.height, unit: 'px' };

  return [
    selectField({ label: 'Display', prop: 'display', value: layout.display, options: DISPLAY_VALUES }),
    selectField({ label: 'Position', prop: 'position', value: layout.position, options: POSITION_VALUES }),
    numberField({ label: 'Width', prop: 'width', value: round(width.number), unit: width.unit || 'px' }),
    numberField({ label: 'Height', prop: 'height', value: round(height.number), unit: height.unit || 'px' }),
    provenance(state, 'width'),
    layout.position !== 'static' ? [
      numberField({ label: 'Left', prop: 'left', value: numeric(layout.left), unit: unitOf(layout.left) }),
      numberField({ label: 'Top', prop: 'top', value: numeric(layout.top), unit: unitOf(layout.top) }),
      numberField({ label: 'Z-index', prop: 'z-index', value: layout.zIndex === 'auto' ? '' : layout.zIndex, unit: '', units: [''] }),
    ].join('') : '',
    selectField({ label: 'Overflow', prop: 'overflow', value: layout.overflow, options: ['visible', 'hidden', 'scroll', 'auto', 'clip'] }),
  ].join('');
}

function spacingBody(detail, state) {
  const { spacing, layoutContext } = detail;
  const usesGap = layoutContext?.self === LayoutKind.FLEX || layoutContext?.self === LayoutKind.GRID;

  return [
    boxField({ label: 'Padding', prop: 'padding', values: spacing.padding, linked: state.linked?.padding ?? false }),
    boxField({ label: 'Margin', prop: 'margin', values: spacing.margin, linked: state.linked?.margin ?? false }),
    // Gap is offered before manual margins wherever the layout supports it (§13).
    usesGap
      ? numberField({ label: 'Gap', prop: 'gap', value: numeric(spacing.gap), unit: unitOf(spacing.gap),
          hint: 'Flex and grid space children with gap rather than margins.' })
      : '',
    provenance(state, 'padding'),
  ].join('');
}

function typographyBody(detail, state) {
  const t = detail.typography;
  const size = parseDimension(t.fontSize) ?? { number: 16, unit: 'px' };
  const lineHeight = parseDimension(t.lineHeight);

  return [
    textField({ label: 'Font', prop: 'font-family', value: primaryFont(t.fontFamily), mono: false,
      placeholder: 'inherit' }),
    numberField({ label: 'Size', prop: 'font-size', value: round(size.number), unit: size.unit || 'px', step: 1, min: 1 }),
    selectField({ label: 'Weight', prop: 'font-weight', value: normaliseWeight(t.fontWeight), options: WEIGHTS }),
    lineHeight
      ? numberField({ label: 'Line height', prop: 'line-height', value: round(lineHeight.number), unit: lineHeight.unit, step: 0.1 })
      : textField({ label: 'Line height', prop: 'line-height', value: t.lineHeight, mono: true }),
    numberField({ label: 'Letter sp.', prop: 'letter-spacing', value: numeric(t.letterSpacing), unit: unitOf(t.letterSpacing), step: 0.1 }),
    segmented({ label: 'Align', prop: 'text-align', value: t.textAlign, options: ALIGN_OPTIONS }),
    selectField({ label: 'Transform', prop: 'text-transform', value: t.textTransform, options: ['none', 'uppercase', 'lowercase', 'capitalize'] }),
    colorField({ label: 'Colour', prop: 'color', value: t.color, swatch: hexOf(t.color) }),
    provenance(state, 'color'),
    contrastNote(detail),
  ].join('');
}

function appearanceBody(detail, state) {
  const a = detail.appearance;
  const radius = parseDimension(a.radius.topLeft) ?? { number: 0, unit: 'px' };
  const shadow = a.shadow;

  return [
    colorField({ label: 'Background', prop: 'background-color', value: a.backgroundColor, swatch: hexOf(a.backgroundColor) }),
    sliderField({ label: 'Opacity', prop: 'opacity', value: Math.round(Number(a.opacity) * 100), min: 0, max: 100, suffix: '%' }),
    numberField({ label: 'Radius', prop: 'border-radius', value: round(radius.number), unit: radius.unit || 'px', min: 0 }),
    boxField({ label: 'Corners', prop: 'border-radius-corners', linked: state.linked?.radius ?? true,
      labels: ['TL', 'TR', 'BR', 'BL'],
      values: {
        top: numeric(a.radius.topLeft), right: numeric(a.radius.topRight),
        bottom: numeric(a.radius.bottomRight), left: numeric(a.radius.bottomLeft),
      } }),
    numberField({ label: 'Border', prop: 'border-width', value: a.borderWidth.top, unit: 'px', min: 0 }),
    selectField({ label: 'Style', prop: 'border-style', value: a.borderStyle, options: ['none', 'solid', 'dashed', 'dotted', 'double'] }),
    colorField({ label: 'Border col.', prop: 'border-color', value: a.borderColor, swatch: hexOf(a.borderColor) }),
    shadowBody(shadow),
    provenance(state, 'background-color'),
  ].join('');
}

/** Shadow gets sliders and numbers together, as the concept asks (§22). */
function shadowBody(shadow) {
  if (!shadow) {
    return `<div class="widt-row"><span class="widt-label">Shadow</span>
      <div class="widt-field">${button({ label: 'Add shadow', action: 'add-shadow', name: 'plus' })}</div></div>`;
  }
  return [
    numberField({ label: 'Shadow X', prop: 'shadow-x', value: shadow.x, unit: 'px', step: 1 }),
    numberField({ label: 'Shadow Y', prop: 'shadow-y', value: shadow.y, unit: 'px', step: 1 }),
    sliderField({ label: 'Blur', prop: 'shadow-blur', value: shadow.blur, min: 0, max: 100, suffix: 'px' }),
    sliderField({ label: 'Spread', prop: 'shadow-spread', value: shadow.spread, min: -50, max: 50, suffix: 'px' }),
    colorField({ label: 'Shadow col.', prop: 'shadow-color', value: shadow.color, swatch: hexOf(shadow.color) }),
    segmented({ label: 'Inset', prop: 'shadow-inset', value: String(shadow.inset),
      options: [{ value: 'false', label: 'Outer' }, { value: 'true', label: 'Inner' }] }),
  ].join('');
}

function flexContainerBody(context) {
  const f = context.flex;
  return [
    segmented({ label: 'Direction', prop: 'flex-direction', value: f.direction,
      options: [{ value: 'row', label: 'Row' }, { value: 'column', label: 'Column' }] }),
    segmented({ label: 'Wrap', prop: 'flex-wrap', value: f.wrap,
      options: [{ value: 'nowrap', label: 'No wrap' }, { value: 'wrap', label: 'Wrap' }] }),
    selectField({ label: 'Justify', prop: 'justify-content', value: f.justifyContent,
      options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] }),
    selectField({ label: 'Align', prop: 'align-items', value: f.alignItems,
      options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] }),
    numberField({ label: 'Gap', prop: 'gap', value: numeric(f.gap), unit: unitOf(f.gap), min: 0 }),
  ].join('');
}

function flexChildBody(context) {
  const c = context.child;
  return [
    numberField({ label: 'Grow', prop: 'flex-grow', value: c.flexGrow, unit: '', units: [''], min: 0 }),
    numberField({ label: 'Shrink', prop: 'flex-shrink', value: c.flexShrink, unit: '', units: [''], min: 0 }),
    textField({ label: 'Basis', prop: 'flex-basis', value: c.flexBasis, mono: true }),
    selectField({ label: 'Align self', prop: 'align-self', value: c.alignSelf,
      options: ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'] }),
    numberField({ label: 'Order', prop: 'order', value: c.order, unit: '', units: [''] }),
  ].join('');
}

function gridContainerBody(context) {
  const g = context.grid;
  return [
    textField({ label: 'Columns', prop: 'grid-template-columns', value: g.templateColumns, mono: true,
      hint: `${g.columnCount} column${g.columnCount === 1 ? '' : 's'} resolved` }),
    textField({ label: 'Rows', prop: 'grid-template-rows', value: g.templateRows, mono: true }),
    numberField({ label: 'Col gap', prop: 'column-gap', value: numeric(g.columnGap), unit: unitOf(g.columnGap), min: 0 }),
    numberField({ label: 'Row gap', prop: 'row-gap', value: numeric(g.rowGap), unit: unitOf(g.rowGap), min: 0 }),
  ].join('');
}

function gridChildBody(context) {
  const c = context.child;
  return [
    textField({ label: 'Column', prop: 'grid-column-start', value: c.columnStart, mono: true }),
    textField({ label: 'Row', prop: 'grid-row-start', value: c.rowStart, mono: true }),
    selectField({ label: 'Justify self', prop: 'justify-self', value: c.justifySelf, options: ['auto', 'start', 'center', 'end', 'stretch'] }),
    selectField({ label: 'Align self', prop: 'align-self', value: c.alignSelf, options: ['auto', 'start', 'center', 'end', 'stretch'] }),
  ].join('');
}

function svgBody(detail) {
  const s = detail.svg;
  return [
    colorField({ label: 'Fill', prop: 'fill', value: s.fill, swatch: hexOf(s.fill) }),
    colorField({ label: 'Stroke', prop: 'stroke', value: s.stroke, swatch: hexOf(s.stroke) }),
    numberField({ label: 'Stroke w.', prop: 'stroke-width', value: numeric(s.strokeWidth), unit: unitOf(s.strokeWidth), min: 0 }),
    s.viewBox ? readonlyRow({ label: 'viewBox', value: s.viewBox }) : '',
  ].join('');
}

function imageBody(detail) {
  const i = detail.image;
  return [
    selectField({ label: 'Object fit', prop: 'object-fit', value: i.objectFit, options: ['fill', 'contain', 'cover', 'none', 'scale-down'] }),
    textField({ label: 'Object pos.', prop: 'object-position', value: i.objectPosition, mono: true }),
    i.naturalWidth ? readonlyRow({ label: 'Natural', value: `${i.naturalWidth} × ${i.naturalHeight}` }) : '',
    i.alt != null ? textField({ label: 'Alt text', prop: '@alt', value: i.alt, hint: 'Editing alt text changes what screen readers announce.' }) : '',
  ].join('');
}

/** Classes, attributes and read-only source (§60, §116, §117). */
function advancedBody(detail, state) {
  const classes = detail.classes.length
    ? detail.classes.map((c) => `<code class="widt-badge widt-badge--dim widt-mono">${escapeHtml(c)}</code>`).join(' ')
    : '<span class="widt-readonly">none</span>';

  const editable = ['aria-label', 'title', 'alt', 'placeholder', 'href']
    .filter((name) => detail.attributes[name] != null)
    .map((name) => textField({ label: name, prop: `@${name}`, value: detail.attributes[name], mono: true }))
    .join('');

  const a11y = detail.accessibility;
  const a11yNote = a11y.accessibleName
    ? readonlyRow({ label: 'A11y name', value: truncate(a11y.accessibleName, 40), mono: false })
    : `<p class="widt-hint">This element has no accessible name.</p>`;

  return `
<div class="widt-row"><span class="widt-label">Classes</span>
  <div class="widt-field" style="flex-wrap:wrap;gap:3px">${classes}</div></div>
${editable}
${a11yNote}
${readonlyRow({ label: 'Selector', value: truncate(detail.identity.domPath, 44) })}
<div class="widt-row"><span class="widt-label">Your CSS</span>
  <div class="widt-field">${button({ label: 'View override CSS', action: 'view-css', name: 'inspect' })}</div></div>
<p class="widt-hint">The site's own CSS is shown read-only. Only your overrides are editable (§117).</p>`;
}

/** Multi-selection: shared properties, with differing values shown as "Mixed" (§47). */
function renderMulti(detail, state) {
  const shared = state.shared ?? {};
  const value = (key) => (Object.hasOwn(shared, key) ? shared[key] : MIXED);

  return `
<div class="widt-selection-head">
  <span class="widt-selection-name">${state.multi} elements selected</span>
  <span class="widt-selection-meta">Shared properties</span>
</div>
<div style="display:flex;gap:var(--space-2);padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--hairline)">
  ${iconButton({ name: 'eyeOff', action: 'hide-selected', title: 'Hide all selected' })}
  ${iconButton({ name: 'paste', action: 'paste-style', title: 'Paste style to all' })}
  <span style="flex:1"></span>
  ${iconButton({ name: 'reset', action: 'reset-selected', title: 'Reset all selected', danger: true })}
</div>
${section({ id: 'multi', title: 'Shared properties', open: true, body: [
  numberField({ label: 'Width', prop: 'width', value: value('width'), unit: 'px' }),
  numberField({ label: 'Radius', prop: 'border-radius', value: value('border-radius'), unit: 'px', min: 0 }),
  numberField({ label: 'Font size', prop: 'font-size', value: value('font-size'), unit: 'px', min: 1 }),
  colorField({ label: 'Colour', prop: 'color', value: value('color'), swatch: hexOf(shared.color) }),
  colorField({ label: 'Background', prop: 'background-color', value: value('background-color'), swatch: hexOf(shared['background-color']) }),
].join('') })}`;
}

/** Where a value comes from — the panel's honesty mechanism (§51, §61). */
function provenance(state, property) {
  const info = state.provenance?.[property];
  if (!info) return '';
  const rows = [
    `<div class="widt-row widt-row--readonly"><span class="widt-label">Computed</span>
      <span class="widt-readonly widt-mono">${escapeHtml(info.computed)}</span>${sourceBadge(info.source)}</div>`,
  ];
  // The site's own declaration is worth showing whenever it differs from the computed
  // value, whenever it is !important, and whenever the user has overridden it — in the
  // last two cases it explains why an override behaves the way it does (§52).
  const showDeclared = info.declared
    && (info.declared !== info.computed || info.important || info.source === 'override');
  if (showDeclared) {
    rows.push(`<div class="widt-row widt-row--readonly"><span class="widt-label">Site CSS</span>
      <span class="widt-readonly widt-mono" title="${escapeHtml(info.selector ?? '')}">${escapeHtml(info.declared)}</span>
      ${info.important ? '<span class="widt-badge widt-badge--warn">!important</span>' : ''}</div>`);
  }
  if (info.varRef) {
    rows.push(`<div class="widt-row widt-row--readonly"><span class="widt-label">Variable</span>
      <span class="widt-readonly widt-mono">${escapeHtml(info.varRef)}</span>
      <span class="widt-badge widt-badge--dim">token</span></div>`);
  }
  return rows.join('');
}

/** Warns when an edit has pushed text contrast below the readable threshold (§106). */
function contrastNote(detail) {
  const ratio = detail.contrast;
  if (ratio == null) return '';
  if (ratio >= 4.5) return '';
  return `<p class="widt-hint" style="color:var(--warning)">
    ${icon('warning', 11)} Contrast ${ratio.toFixed(1)}:1 — below the 4.5:1 minimum for body text.</p>`;
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
const numeric = (value) => parseDimension(value)?.number ?? 0;
const unitOf = (value) => parseDimension(value)?.unit || 'px';
const hexOf = (value) => (value ? toHex(parseColor(value)) : '#000000');
const primaryFont = (family) => String(family ?? '').split(',')[0].replace(/["']/g, '').trim();
const normaliseWeight = (w) => (w === 'normal' ? '400' : w === 'bold' ? '700' : String(w));

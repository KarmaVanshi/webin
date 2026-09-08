/**
 * The inspector: what the panel shows when something is selected.
 *
 * Every function here is `(state) -> html string`. Nothing holds state, nothing touches
 * the DOM, and nothing knows what an edit does — controls carry `data-control` and
 * `data-prop`, the panel delegates their events upward, and the editor decides what they
 * mean. That is what makes this file testable without a browser.
 *
 * It is written for a 320-360px column rather than the wide dock the previous build had,
 * so sections are collapsed by default and only what is relevant to the selection is
 * rendered at all: flex controls appear when the parent is a flex container, image
 * controls when the element is an image. An inspector that shows every property of every
 * element is a property list, not an inspector.
 */

import { escapeHtml } from '../shared/util.js';
import { icon } from './icons.js';
import {
  section, numberField, colorField, segmented, selectField, sliderField,
  boxField, iconButton, button, readonlyRow, emptyState,
} from './controls.js';
import { contrastRatio, parseColor } from '../shared/color.js';

const ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' },
];

const WEIGHTS = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '700', label: 'Bold' },
  { value: '900', label: 'Black' },
];

const DISPLAYS = ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none']
  .map((value) => ({ value, label: value }));

/**
 * Splits `16px` into its number and its unit, keeping whatever unit the site used.
 *
 * The number is rounded for display. A computed width is routinely something like
 * `467.641px`, and showing that in an input invites the user to think the third decimal
 * place is meaningful — it is the browser's arithmetic, not their design.
 */
function splitLength(value) {
  const match = String(value ?? '').trim().match(/^(-?[\d.]+)(px|rem|em|%|vw|vh|ch)?$/);
  if (!match) return { value: '', unit: 'px' };
  const number = Number.parseFloat(match[1]);
  return {
    value: Number.isFinite(number) ? String(Math.round(number * 100) / 100) : match[1],
    unit: match[2] ?? 'px',
  };
}

function lengthField(label, prop, raw, extra = {}) {
  const { value, unit } = splitLength(raw);
  return numberField({ label, prop, value, unit, ...extra });
}

/**
 * The contrast warning.
 *
 * Colour alone cannot carry this — a red swatch means nothing to a reader who cannot see
 * that it is red — so the ratio is stated as a number, with an icon, in words.
 */
export function contrastNote(detail) {
  const ink = parseColor(detail?.typography?.color);
  const paper = parseColor(detail?.painted?.background ?? detail?.appearance?.backgroundColor);
  if (!ink || !paper || paper.a < 0.5) return '';

  const ratio = contrastRatio(ink, paper);
  const passes = ratio >= 4.5;
  return `
<div class="webin-note${passes ? '' : ' webin-note--warn'}" role="status">
  ${icon(passes ? 'check' : 'warning', 13)}
  <span><b>${ratio.toFixed(2)}:1</b> — ${passes
    ? 'text here meets WCAG AA.'
    : 'below WCAG AA (4.5:1). This text is hard to read.'}</span>
  ${passes ? '' : '<button type="button" class="webin-btn webin-btn--tiny" data-action="fix-contrast">Fix</button>'}
</div>`;
}

/** The head: what is selected, and the things you do to it as a whole. */
function selectionHead(detail) {
  return `
<div class="webin-selection">
  <div class="webin-selection-id">
    <span class="webin-selection-label" title="${escapeHtml(detail.identity?.domPath ?? '')}">
      ${escapeHtml(detail.label)}</span>
    <span class="webin-selection-size webin-mono">${Math.round(detail.layout.width)} × ${Math.round(detail.layout.height)}</span>
  </div>
  <div class="webin-row webin-row--actions">
    ${iconButton({ name: 'target', action: 'select-parent', title: 'Select the parent element' })}
    ${iconButton({
      name: detail.hidden ? 'eyeOff' : 'eye',
      action: detail.hidden ? 'unhide' : 'hide',
      title: detail.hidden ? 'Show this element' : 'Hide this element',
      pressed: detail.hidden,
    })}
    ${detail.canEditText
      ? iconButton({ name: 'text', action: 'edit-text', title: 'Edit this text' })
      : ''}
    ${iconButton({ name: 'reset', action: 'reset-element', title: 'Undo every change to this element', danger: true })}
  </div>
</div>`;
}

function layoutSection(detail, open) {
  const { layout, context } = detail;
  const positioned = layout.position !== 'static';
  return section({
    id: 'layout',
    title: 'Layout',
    open,
    body: `
      ${selectField({ label: 'Display', prop: 'display', value: layout.display, options: DISPLAYS })}
      ${lengthField('Width', 'width', layout.declaredWidth)}
      ${lengthField('Height', 'height', layout.declaredHeight)}
      ${positioned ? lengthField('Left', 'left', layout.left) : ''}
      ${positioned ? lengthField('Top', 'top', layout.top) : ''}
      ${positioned ? numberField({ label: 'Z-index', prop: 'z-index', value: layout.zIndex, units: [''], unit: '' }) : ''}
      ${readonlyRow({ label: 'Position', value: layout.position })}
      ${context?.parentLayout ? readonlyRow({ label: 'Inside', value: context.parentLayout }) : ''}
    `,
  });
}

function spacingSection(detail, open, linked) {
  const { spacing, context } = detail;
  // A flex or grid parent means gap is the right control, and margins are the wrong one.
  const flexOrGrid = context?.self === 'flex' || context?.self === 'grid';
  return section({
    id: 'spacing',
    title: 'Spacing',
    open,
    body: `
      ${boxField({ label: 'Padding', prop: 'padding', values: spacing.padding, linked: linked.padding })}
      ${boxField({ label: 'Margin', prop: 'margin', values: spacing.margin, linked: linked.margin })}
      ${flexOrGrid ? lengthField('Gap', 'gap', spacing.gap) : ''}
    `,
  });
}

function typeSection(detail, open) {
  const { typography } = detail;
  return section({
    id: 'type',
    title: 'Typography',
    open,
    body: `
      ${lengthField('Size', 'font-size', typography.fontSize)}
      ${selectField({ label: 'Weight', prop: 'font-weight', value: String(Number.parseInt(typography.fontWeight, 10) || 400), options: WEIGHTS })}
      ${lengthField('Line height', 'line-height', typography.lineHeight, { units: ['px', 'em', ''] })}
      ${lengthField('Letter spacing', 'letter-spacing', typography.letterSpacing, { step: 0.1 })}
      ${segmented({ label: 'Align', prop: 'text-align', value: typography.textAlign, options: ALIGNMENTS, compact: true })}
      ${colorField({ label: 'Colour', prop: 'color', value: typography.color })}
      ${contrastNote(detail)}
    `,
  });
}

function appearanceSection(detail, open) {
  const { appearance } = detail;
  const radius = splitLength(appearance.radius.topLeft);
  return section({
    id: 'appearance',
    title: 'Appearance',
    open,
    body: `
      ${colorField({ label: 'Background', prop: 'background-color', value: appearance.backgroundColor })}
      ${numberField({ label: 'Radius', prop: 'border-radius', value: radius.value, unit: radius.unit })}
      ${lengthField('Border width', 'border-width', appearance.borderWidth?.top ?? '0px')}
      ${colorField({ label: 'Border colour', prop: 'border-color', value: appearance.borderColor })}
      ${sliderField({ label: 'Opacity', prop: 'opacity', value: Math.round((Number.parseFloat(appearance.opacity) || 1) * 100), suffix: '%' })}
    `,
  });
}

/** Flex controls, shown only when they would do something. */
function flexSection(detail, open) {
  const context = detail.context;
  if (context?.self !== 'flex') return '';
  return section({
    id: 'flex',
    title: 'Flex',
    open,
    body: `
      ${segmented({
        label: 'Direction',
        prop: 'flex-direction',
        value: context.flex?.direction ?? 'row',
        options: [{ value: 'row', label: 'Row' }, { value: 'column', label: 'Column' }],
        compact: true,
      })}
      ${selectField({
        label: 'Justify',
        prop: 'justify-content',
        value: context.flex?.justifyContent ?? 'flex-start',
        options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']
          .map((value) => ({ value, label: value.replace('flex-', '') })),
      })}
      ${selectField({
        label: 'Align',
        prop: 'align-items',
        value: context.flex?.alignItems ?? 'stretch',
        options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline']
          .map((value) => ({ value, label: value.replace('flex-', '') })),
      })}
    `,
  });
}

/**
 * The whole inspector.
 *
 * @param {object|null} detail from `Editor.detail()`
 * @param {{sections:object, linked:object}} view which sections are open, which box
 *   fields are linked — panel state, not editor state, because it is about looking rather
 *   than about the page.
 */
export function renderInspector(detail, view = {}) {
  if (!detail) {
    return emptyState({
      title: 'Nothing selected',
      body: 'Click anything on the page to select it. Escape deselects.',
      iconName: 'cursor',
    });
  }
  const open = view.sections ?? {};
  const linked = view.linked ?? { padding: true, margin: true };
  return [
    selectionHead(detail),
    layoutSection(detail, open.layout ?? false),
    spacingSection(detail, open.spacing ?? true, linked),
    typeSection(detail, open.type ?? true),
    appearanceSection(detail, open.appearance ?? true),
    flexSection(detail, open.flex ?? false),
  ].join('');
}

/** The editor's toolbar row: modes, history, and saving. */
export function renderEditorBar(state) {
  const history = state.history ?? {};
  return `
<div class="webin-bar">
  ${iconButton({ name: 'undo', action: 'undo', title: 'Undo (⌘Z)' })}
  ${iconButton({ name: 'redo', action: 'redo', title: 'Redo (⇧⌘Z)' })}
  <span class="webin-bar-gap"></span>
  ${state.unmatched ? `<button type="button" class="webin-btn webin-btn--tiny" data-action="show-unmatched">
    ${icon('warning', 12)}${state.unmatched}</button>` : ''}
  ${button({
    label: state.dirty ? 'Save •' : 'Save',
    action: 'save',
    variant: 'primary',
    disabled: !state.dirty,
  })}
</div>`;
}

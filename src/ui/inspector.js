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
 * Whether a property is currently the user's answer rather than the site's (§51, §61).
 *
 * Shorthands count their own longhands: padding written one side at a time is still the
 * padding row having been changed, and reverting it should mean all of it.
 */
function ownProperties(detail) {
  const keys = Object.keys(detail.overrides ?? {});
  return (prop) => keys.some((key) => key === prop || key.startsWith(`${prop}-`));
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
    ${iconButton({
      name: 'levelUp',
      action: 'select-parent',
      title: 'Select the parent element',
      disabled: detail.canSelectParent === false,
    })}
    ${iconButton({
      name: 'levelDown',
      action: 'select-child',
      title: 'Select the first child element',
      disabled: detail.canSelectChild === false,
    })}
    ${iconButton({
      name: 'siblingPrev',
      action: 'select-previous',
      title: 'Select the previous sibling',
      disabled: detail.canSelectPrevious === false,
    })}
    ${iconButton({
      name: 'siblingNext',
      action: 'select-next',
      title: 'Select the next sibling',
      disabled: detail.canSelectNext === false,
    })}
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

/**
 * The CSS the site applies to the selection, as a browser's Styles pane lists it.
 *
 * The rows above say what each property computes to; this says where it came from. The
 * element is named the way the page named it — `button#cta.primary` — and every matching
 * rule follows, most powerful first, each declaration written as the author wrote it and
 * struck through where a stronger one has overridden it. Strikethrough and a dimmed
 * colour together, never the colour alone, since a reader who cannot see the dimming
 * still has the line through the words.
 *
 * Only the site's CSS. What Webin has changed is shown in the rows, marked as yours.
 */
export function stylesBlock(styles) {
  if (!styles) return '';
  const decl = (d) => `<div class="webin-decl${d.overridden ? ' is-overridden' : ''}"${d.overridden ? ' title="Overridden by a stronger rule"' : ''}>
      <span class="webin-decl-prop">${escapeHtml(d.property)}</span><span class="webin-decl-sep">: </span><span class="webin-decl-val">${escapeHtml(d.value)}</span>${d.important ? '<span class="webin-decl-imp"> !important</span>' : ''};</div>`;
  const rule = (r) => `<div class="webin-rule">
    <div class="webin-rule-head">
      <span class="webin-rule-sel">${escapeHtml(r.selector)}</span>
      <span class="webin-rule-src" title="${escapeHtml(r.media ? `${r.media} · ${r.source}` : r.source)}">${escapeHtml(r.source)}</span>
    </div>
    ${r.media ? `<div class="webin-rule-media">${escapeHtml(r.media)}</div>` : ''}
    <div class="webin-rule-body">${r.declarations.map(decl).join('')}</div>
  </div>`;

  const inline = styles.inline?.length
    ? rule({ selector: 'element.style', source: 'inline', media: null, declarations: styles.inline })
    : '';
  const rules = styles.rules.map(rule).join('');
  const empty = !inline && !rules
    ? `<p class="webin-styles-empty">${styles.blocked
      ? 'The stylesheets that style this element are cross-origin, so their rules cannot be read.'
      : 'No site rule matches this element; everything it shows is inherited or the browser\'s own.'}</p>`
    : '';
  const note = styles.blocked && (inline || rules)
    ? `<p class="webin-styles-empty">${styles.blocked} cross-origin stylesheet${styles.blocked === 1 ? '' : 's'} could not be read, so this list may be incomplete.</p>`
    : '';
  return `
<div class="webin-styles">
  <code class="webin-styles-target" title="This element, as the page names it">${escapeHtml(styles.target)}</code>
  ${inline}${rules}${empty}${note}
</div>`;
}

function stylesSection(detail, open) {
  if (!detail.styles) return '';
  const count = detail.styles.rules.length + (detail.styles.inline?.length ? 1 : 0);
  return section({
    id: 'styles',
    title: count ? `Styles · ${count}` : 'Styles',
    open,
    body: stylesBlock(detail.styles),
  });
}

function layoutSection(detail, open) {
  const { layout, context } = detail;
  const positioned = layout.position !== 'static';
  const mine = ownProperties(detail);
  return section({
    id: 'layout',
    title: 'Layout',
    open,
    body: `
      ${selectField({ label: 'Display', prop: 'display', value: layout.display, options: DISPLAYS, overridden: mine('display') })}
      ${lengthField('Width', 'width', layout.declaredWidth, { overridden: mine('width') })}
      ${lengthField('Height', 'height', layout.declaredHeight, { overridden: mine('height') })}
      ${positioned ? lengthField('Left', 'left', layout.left, { overridden: mine('left') }) : ''}
      ${positioned ? lengthField('Top', 'top', layout.top, { overridden: mine('top') }) : ''}
      ${positioned ? numberField({ label: 'Z-index', prop: 'z-index', value: layout.zIndex, units: [''], unit: '', overridden: mine('z-index') }) : ''}
      ${readonlyRow({ label: 'Position', value: layout.position })}
      ${context?.parentLayout ? readonlyRow({ label: 'Inside', value: context.parentLayout }) : ''}
    `,
  });
}

function spacingSection(detail, open, linked) {
  const { spacing, context } = detail;
  // A flex or grid parent means gap is the right control, and margins are the wrong one.
  const flexOrGrid = context?.self === 'flex' || context?.self === 'grid';
  const mine = ownProperties(detail);
  return section({
    id: 'spacing',
    title: 'Spacing',
    open,
    body: `
      ${boxField({ label: 'Padding', prop: 'padding', values: spacing.padding, linked: linked.padding, overridden: mine('padding') })}
      ${boxField({ label: 'Margin', prop: 'margin', values: spacing.margin, linked: linked.margin, overridden: mine('margin') })}
      ${flexOrGrid ? lengthField('Gap', 'gap', spacing.gap, { overridden: mine('gap') }) : ''}
    `,
  });
}

function typeSection(detail, open) {
  const { typography } = detail;
  const mine = ownProperties(detail);
  return section({
    id: 'type',
    title: 'Typography',
    open,
    body: `
      ${lengthField('Size', 'font-size', typography.fontSize, { overridden: mine('font-size') })}
      ${selectField({ label: 'Weight', prop: 'font-weight', value: String(Number.parseInt(typography.fontWeight, 10) || 400), options: WEIGHTS, overridden: mine('font-weight') })}
      ${lengthField('Line height', 'line-height', typography.lineHeight, { units: ['px', 'em', ''], overridden: mine('line-height') })}
      ${lengthField('Letter spacing', 'letter-spacing', typography.letterSpacing, { step: 0.1, overridden: mine('letter-spacing') })}
      ${segmented({ label: 'Align', prop: 'text-align', value: typography.textAlign, options: ALIGNMENTS, compact: true, overridden: mine('text-align') })}
      ${colorField({ label: 'Colour', prop: 'color', value: typography.color, overridden: mine('color') })}
      ${contrastNote(detail)}
    `,
  });
}

function appearanceSection(detail, open) {
  const { appearance } = detail;
  const radius = splitLength(appearance.radius.topLeft);
  const mine = ownProperties(detail);
  return section({
    id: 'appearance',
    title: 'Appearance',
    open,
    body: `
      ${colorField({ label: 'Background', prop: 'background-color', value: appearance.backgroundColor, image: true, overridden: mine('background-image') || mine('background-color') })}
      ${numberField({ label: 'Radius', prop: 'border-radius', value: radius.value, unit: radius.unit, overridden: mine('border-radius') })}
      ${lengthField('Border width', 'border-width', appearance.borderWidth?.top ?? '0px', { overridden: mine('border-width') })}
      ${colorField({ label: 'Border colour', prop: 'border-color', value: appearance.borderColor, overridden: mine('border-color') })}
      ${sliderField({ label: 'Opacity', prop: 'opacity', value: Math.round((Number.parseFloat(appearance.opacity) || 1) * 100), suffix: '%', overridden: mine('opacity') })}
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
 * The tool switch: whether the editor has hold of the page.
 *
 * Two states, so it is two buttons rather than a menu — the point of a mode is that you
 * can see which one you are in without opening anything. It sits at the top right of the
 * edit column, above the selection, because it governs everything below it.
 *
 * The pressed tool is marked three ways: `aria-pressed` for a screen reader, a filled
 * ground for the eye, and the accent colour on top of that — never the colour alone. Both
 * buttons clear the 24px pointer target WCAG 2.2 asks for even though the glyphs inside
 * them are 14px.
 *
 * @param {{tool?:string}} state from `Editor.state()`
 */
function toolSwitch(state) {
  const editing = state.tool === 'edit';
  return `
<div class="webin-tools" role="group" aria-label="Whether Webin is editing the page">
  <div class="webin-tools-set">
    ${iconButton({
      name: 'cursor',
      action: 'tool',
      value: 'point',
      title: 'Arrow — leave the page alone (Enter)',
      pressed: !editing,
    })}
    ${iconButton({
      name: 'pencil',
      action: 'tool',
      value: 'edit',
      title: 'Pencil — highlight, select and change things',
      pressed: editing,
    })}
    ${iconButton({
      name: 'code',
      action: 'tool',
      value: 'code',
      title: 'Code — write the CSS yourself',
      pressed: state.tool === 'code',
    })}
  </div>
</div>`;
}

/**
 * The code tool's two scopes.
 *
 * Two editors rather than one, because they are two different kinds of thing. The first is
 * the selection's own declarations — the inspector's rows, written out, so a property with
 * no widget is still reachable. The second is a stylesheet for the site, where a rule can
 * have a selector of its own and so can say things no click can: a `::before` that does not
 * exist yet, every third row, a narrow screen.
 *
 * Neither is a way past the rules. Both are parsed through the same gate as every widget,
 * and whatever is refused is named underneath rather than silently dropped.
 */
function codeView(detail, view) {
  const state = view.editor ?? {};
  const notes = view.codeErrors ?? {};
  const status = view.codeStatus ?? {};
  const drafts = view.drafts ?? {};
  const label = detail?.label ?? null;

  // A draft outlives a repaint, and for the element pane only while the same element is
  // selected — what was being written for one button is not a draft for another.
  const elementText = drafts.element && drafts.element.key === (detail?.id ?? null)
    ? drafts.element.text
    : (state.elementCss ?? '');
  const siteText = drafts.site ? drafts.site.text : (state.siteCss ?? '');

  // The result of the last apply lives in the pane's own header rather than in a toast:
  // a toast sits over the button that was just pressed, and a message about what you
  // wrote belongs beside what you wrote.
  const hint = (scope, fallback) => (status[scope]
    ? `<span class="webin-hint webin-code-status" role="status">${escapeHtml(status[scope])}</span>`
    : `<span class="webin-hint">${fallback}</span>`);

  return `
<div class="webin-code">
  <section class="webin-code-pane">
    <header class="webin-code-head">
      <span class="webin-label">${label ? `${escapeHtml(label)} — declarations` : 'Selection'}</span>
      ${label ? hint('element', 'applies to this element') : ''}
    </header>
    ${label ? `
    <textarea class="webin-code-area" data-interactive data-code="element" spellcheck="false"
      aria-label="CSS declarations for the selected element"
      placeholder="border-radius: 12px;">${escapeHtml(elementText)}</textarea>
    ${codeNotes(notes.element)}
    <div class="webin-code-actions">
      <span class="webin-hint">⌘Enter applies · Tab indents</span>
      ${button({ label: 'Apply to element', action: 'apply-element-css', variant: 'primary' })}
    </div>
    ${detail?.styles ? `
    <details class="webin-code-ref"${view.sections?.styles === false ? '' : ' open'}>
      <summary class="webin-code-ref-head">What the site already applies</summary>
      ${stylesBlock(detail.styles)}
    </details>` : ''}`
    : `<p class="webin-code-empty">Click something on the page to write CSS for it.</p>`}
  </section>

  <section class="webin-code-pane">
    <header class="webin-code-head">
      <span class="webin-label">This site</span>
      ${hint('site', state.siteRules
        ? `${state.siteRules} rule${state.siteRules === 1 ? '' : 's'} live`
        : 'selectors of your own')}
    </header>
    <textarea class="webin-code-area webin-code-area--tall" data-interactive data-code="site" spellcheck="false"
      aria-label="A stylesheet for this site"
      placeholder="${escapeHtml('.card:hover {\n  transform: translateY(-2px);\n}')}">${escapeHtml(siteText)}</textarea>
    ${codeNotes(notes.site)}
    <div class="webin-code-actions">
      <span class="webin-hint">⌘Enter applies · Tab indents</span>
      ${button({ label: 'Apply to site', action: 'apply-site-css', variant: 'primary' })}
    </div>
  </section>
</div>`;
}

/** What could not be used, and why — named rather than dropped in silence. */
function codeNotes(errors) {
  if (!errors?.length) return '';
  return `<ul class="webin-code-notes">${errors.slice(0, 6)
    .map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
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
  const state = view.editor ?? {};
  // The switch is drawn whether or not anything is selected: arming the pencil first and
  // then clicking the sentence you want is a perfectly ordinary way round.
  const tools = toolSwitch(state);
  if (state.tool === 'code') return tools + codeView(detail, view);
  if (!detail) {
    const editing = state.tool === 'edit';
    return tools + emptyState({
      title: editing ? 'Nothing selected' : 'Not editing',
      body: editing
        ? 'Click anything on the page to select it. Escape deselects, Enter puts the editor down.'
        : 'The page is yours to read and click through. Pick up the pencil to start editing it.',
      iconName: editing ? 'cursor' : 'pencil',
    });
  }
  const open = view.sections ?? {};
  const linked = view.linked ?? { padding: true, margin: true };
  return [
    tools,
    selectionHead(detail),
    stylesSection(detail, open.styles ?? true),
    layoutSection(detail, open.layout ?? false),
    spacingSection(detail, open.spacing ?? true, linked),
    typeSection(detail, open.type ?? true),
    appearanceSection(detail, open.appearance ?? true),
    flexSection(detail, open.flex ?? false),
  ].join('');
}

/** The editor's toolbar row: modes, history, and saving. */
export function renderEditorBar(state, panel = {}) {
  const history = state.history ?? {};
  // Removing your edits belongs here, beside the edits, rather than in the overflow menu —
  // the same reason removing the theme belongs on the Themes tab. They are two different
  // changes to the site and which one you want gone is not the panel's decision.
  const anything = Boolean(panel.editCount || history.depth || state.dirty);
  return `
<div class="webin-bar">
  ${iconButton({ name: 'undo', action: 'undo', title: 'Undo (⌘Z)' })}
  ${iconButton({ name: 'redo', action: 'redo', title: 'Redo (⇧⌘Z)' })}
  <span class="webin-bar-gap"></span>
  ${state.unmatched ? `<button type="button" class="webin-btn webin-btn--tiny" data-action="show-unmatched">
    ${icon('warning', 12)}${state.unmatched}</button>` : ''}
  ${button({
    label: 'Remove edits',
    action: 'reset-site',
    variant: 'danger',
    disabled: !anything,
  })}
  ${button({
    label: state.dirty ? 'Save •' : 'Save',
    action: 'save',
    variant: 'primary',
    disabled: !state.dirty,
  })}
</div>`;
}

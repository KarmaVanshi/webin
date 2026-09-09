/**
 * Inspector control widgets (§62).
 *
 * Rendered as HTML strings and driven by event delegation — there is no framework here.
 * A repaint describes the whole panel every time; the panel then matches that description
 * against what is already on screen rather than rebuilding it, so a control the user is
 * holding survives the repaint its own edit caused.
 *
 * Every control follows the same three rules from the design system:
 *   - a visible label, never a placeholder standing in for one;
 *   - an accessible name and state on any icon-only control;
 *   - a focus ring that is replaced, never removed.
 */

import { escapeHtml } from '../shared/util.js';
import { icon } from './icons.js';
import { LENGTH_UNITS } from '../shared/css-values.js';

/**
 * A control's id, derived from the property it edits (§62).
 *
 * It used to be a counter, so every repaint renamed every field. Nothing looked wrong — a
 * label's `for` was rewritten in the same breath — but the panel finds the control that had
 * focus by id when it repaints, and an id that has just changed finds nothing. The caret
 * left the field on every keystroke that reached the page.
 */
const fieldId = (prop) => `webin-${String(prop ?? 'field').replace(/[^a-zA-Z0-9-]+/g, '-')}`;

/** Mixed-value marker for multi-selection (§47). */
export const MIXED = Symbol('mixed');

const display = (value) => (value === MIXED ? '' : value ?? '');
const mixedAttrs = (value) => (value === MIXED ? ' placeholder="Mixed" data-mixed' : '');

/**
 * Number plus unit — the workhorse of the inspector (§62, §63).
 * The unit select is a real control, so an author's `rem` can be kept as `rem`.
 */
export function numberField({ label, prop, value, unit = 'px', units = LENGTH_UNITS, step = 1, min, max, hint }) {
  const id = fieldId(prop);
  const numeric = value === MIXED ? '' : value;
  return `
<div class="webin-row" data-row="${escapeHtml(prop)}">
  <label class="webin-label" for="${id}">${escapeHtml(label)}</label>
  <div class="webin-field webin-field--number">
    <input class="webin-input webin-mono" id="${id}" type="number" inputmode="decimal"
      data-control="number" data-prop="${escapeHtml(prop)}"
      value="${escapeHtml(numeric)}" step="${step}"
      ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}
      ${mixedAttrs(value)}>
    <select class="webin-unit" data-control="unit" data-prop="${escapeHtml(prop)}"
      aria-label="${escapeHtml(label)} unit">
      ${units.map((u) => `<option value="${u}"${u === unit ? ' selected' : ''}>${u}</option>`).join('')}
    </select>
  </div>
  ${hint ? `<p class="webin-hint">${escapeHtml(hint)}</p>` : ''}
</div>`;
}

/** Free text — font family, grid template, and other values with no numeric form. */
export function textField({ label, prop, value, mono = false, hint, placeholder = '' }) {
  const id = fieldId(prop);
  return `
<div class="webin-row" data-row="${escapeHtml(prop)}">
  <label class="webin-label" for="${id}">${escapeHtml(label)}</label>
  <div class="webin-field">
    <input class="webin-input${mono ? ' webin-mono' : ''}" id="${id}" type="text"
      data-control="text" data-prop="${escapeHtml(prop)}"
      value="${escapeHtml(display(value))}" placeholder="${escapeHtml(placeholder)}"${mixedAttrs(value)}>
  </div>
  ${hint ? `<p class="webin-hint">${escapeHtml(hint)}</p>` : ''}
</div>`;
}

/**
 * Colour: a swatch that opens the native picker, plus the literal value (§19).
 * The text input is what makes `rgba()` and named colours reachable — the native picker
 * alone cannot express alpha.
 */
export function colorField({ label, prop, value, swatch, hint }) {
  const id = fieldId(prop);
  const literal = display(value);
  return `
<div class="webin-row" data-row="${escapeHtml(prop)}">
  <label class="webin-label" for="${id}">${escapeHtml(label)}</label>
  <div class="webin-field webin-field--color">
    <span class="webin-swatch-wrap">
      <input class="webin-swatch" type="color" data-control="color" data-prop="${escapeHtml(prop)}"
        value="${escapeHtml(swatch ?? '#000000')}" aria-label="${escapeHtml(label)} colour picker">
    </span>
    <input class="webin-input webin-mono" id="${id}" type="text"
      data-control="color-text" data-prop="${escapeHtml(prop)}"
      value="${escapeHtml(literal)}" placeholder="${value === MIXED ? 'Mixed' : 'transparent'}"
      aria-label="${escapeHtml(label)} value">
  </div>
  ${hint ? `<p class="webin-hint">${escapeHtml(hint)}</p>` : ''}
</div>`;
}

/** Segmented buttons for small, mutually exclusive sets (alignment, direction). */
export function segmented({ label, prop, value, options, compact = false }) {
  const buttons = options.map((option) => {
    const selected = option.value === value;
    const body = option.icon
      ? `${icon(option.icon, 13)}<span class="webin-sr">${escapeHtml(option.label)}</span>`
      : escapeHtml(option.label);
    return `<button type="button" class="webin-seg${selected ? ' is-on' : ''}" data-interactive
      data-control="segment" data-prop="${escapeHtml(prop)}" data-value="${escapeHtml(option.value)}"
      role="radio" aria-checked="${selected}"
      title="${escapeHtml(option.label)}" aria-label="${escapeHtml(option.label)}">${body}</button>`;
  }).join('');

  return `
<div class="webin-row${compact ? ' webin-row--compact' : ''}" data-row="${escapeHtml(prop)}">
  <span class="webin-label" id="${escapeHtml(prop)}-lbl">${escapeHtml(label)}</span>
  <div class="webin-segmented" role="radiogroup" aria-labelledby="${escapeHtml(prop)}-lbl">${buttons}</div>
</div>`;
}

/** Dropdown for larger closed sets (display, position, font weight). */
export function selectField({ label, prop, value, options, hint }) {
  const id = fieldId(prop);
  const isMixed = value === MIXED;
  return `
<div class="webin-row" data-row="${escapeHtml(prop)}">
  <label class="webin-label" for="${id}">${escapeHtml(label)}</label>
  <div class="webin-field">
    <select class="webin-select" id="${id}" data-control="select" data-prop="${escapeHtml(prop)}">
      ${isMixed ? '<option value="" selected>Mixed</option>' : ''}
      ${options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return `<option value="${escapeHtml(v)}"${!isMixed && v === value ? ' selected' : ''}>${escapeHtml(l)}</option>`;
      }).join('')}
    </select>
  </div>
  ${hint ? `<p class="webin-hint">${escapeHtml(hint)}</p>` : ''}
</div>`;
}

/** Slider paired with a numeric readout — the concept asks for both together (§22). */
export function sliderField({ label, prop, value, min = 0, max = 100, step = 1, suffix = '' }) {
  const id = fieldId(prop);
  const numeric = value === MIXED ? min : Number(value ?? min);
  return `
<div class="webin-row" data-row="${escapeHtml(prop)}">
  <label class="webin-label" for="${id}">${escapeHtml(label)}</label>
  <div class="webin-field webin-field--slider">
    <input class="webin-range" id="${id}" type="range" data-control="range" data-prop="${escapeHtml(prop)}"
      min="${min}" max="${max}" step="${step}" value="${numeric}">
    <output class="webin-output webin-mono" for="${id}">${value === MIXED ? 'Mixed' : `${numeric}${suffix}`}</output>
  </div>
</div>`;
}

/** Four-up box editor for margin, padding and radius corners (§13, §21). */
export function boxField({ label, prop, values, linked = false, labels = ['T', 'R', 'B', 'L'], unit = 'px' }) {
  const sides = ['top', 'right', 'bottom', 'left'];
  const inputs = sides.map((side, i) => `
    <span class="webin-box-cell">
      <input class="webin-input webin-input--tiny webin-mono" type="number" step="1"
        data-control="box" data-prop="${escapeHtml(prop)}" data-side="${side}"
        value="${escapeHtml(values[side] === MIXED ? '' : values[side] ?? 0)}"
        aria-label="${escapeHtml(label)} ${side}"${mixedAttrs(values[side])}>
      <span class="webin-box-tag" aria-hidden="true">${labels[i]}</span>
    </span>`).join('');

  return `
<div class="webin-row webin-row--box" data-row="${escapeHtml(prop)}">
  <div class="webin-box-head">
    <span class="webin-label">${escapeHtml(label)}</span>
    <button type="button" class="webin-icon-btn${linked ? ' is-on' : ''}" data-interactive
      data-control="link" data-prop="${escapeHtml(prop)}"
      aria-pressed="${linked}" aria-label="Link ${escapeHtml(label)} sides"
      title="${linked ? 'Sides linked' : 'Sides independent'}">${icon(linked ? 'link' : 'unlink', 13)}</button>
  </div>
  <div class="webin-box-grid" data-unit="${escapeHtml(unit)}">${inputs}</div>
</div>`;
}

/** Icon-only action button. Always carries an accessible name and, where stateful, a state. */
export function iconButton({ name, action, title, pressed = null, danger = false, value = '' }) {
  return `<button type="button" class="webin-icon-btn${danger ? ' is-danger' : ''}${pressed ? ' is-on' : ''}"
    data-interactive data-action="${escapeHtml(action)}" ${value ? `data-value="${escapeHtml(value)}"` : ''}
    title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"
    ${pressed === null ? '' : `aria-pressed="${pressed}"`}>${icon(name, 14)}</button>`;
}

/** Labelled push button. */
export function button({ label, action, name = null, variant = 'default', value = '', disabled = false }) {
  return `<button type="button" class="webin-btn webin-btn--${variant}" data-interactive
    data-action="${escapeHtml(action)}" ${value ? `data-value="${escapeHtml(value)}"` : ''}
    ${disabled ? 'disabled' : ''}>${name ? icon(name, 13) : ''}<span>${escapeHtml(label)}</span></button>`;
}

/** A read-only row that reports a value the editor does not offer to change (§117). */
export function readonlyRow({ label, value, mono = true, source = null }) {
  return `
<div class="webin-row webin-row--readonly">
  <span class="webin-label">${escapeHtml(label)}</span>
  <span class="webin-readonly${mono ? ' webin-mono' : ''}">${escapeHtml(value ?? '—')}</span>
  ${source ? `<span class="webin-source" data-source="${escapeHtml(source)}">${escapeHtml(source)}</span>` : ''}
</div>`;
}

/**
 * Collapsible inspector section (§60).
 * Progressive disclosure keeps a dense panel legible: the sections a user is not editing
 * cost them no vertical space.
 */
export function section({ id, title, open = true, body, actions = '' }) {
  return `
<section class="webin-section" data-section="${escapeHtml(id)}">
  <h3 class="webin-section-head">
    <button type="button" class="webin-section-toggle" data-interactive data-action="toggle-section"
      data-value="${escapeHtml(id)}" aria-expanded="${open}">
      <span class="webin-caret${open ? ' is-open' : ''}" aria-hidden="true">${icon('chevron', 11)}</span>
      <span>${escapeHtml(title)}</span>
    </button>
    ${actions}
  </h3>
  <div class="webin-section-body"${open ? '' : ' hidden'}>${body}</div>
</section>`;
}

/**
 * Source provenance badge (§51, §61).
 * The honesty mechanism: it says where a value came from, so an override is never
 * confused with what the site actually declares.
 */
export function sourceBadge(source) {
  const map = {
    override: { label: 'Yours', tone: 'accent' },
    inline: { label: 'Inline', tone: 'warn' },
    author: { label: 'Site CSS', tone: 'dim' },
    default: { label: 'Default', tone: 'dim' },
  };
  const entry = map[source] ?? map.default;
  return `<span class="webin-badge webin-badge--${entry.tone}">${entry.label}</span>`;
}

/** Empty state with guidance rather than a blank panel. */
export function emptyState({ title, body, iconName = 'cursor' }) {
  return `
<div class="webin-empty">
  <span class="webin-empty-icon" aria-hidden="true">${icon(iconName, 22)}</span>
  <p class="webin-empty-title">${escapeHtml(title)}</p>
  <p class="webin-empty-body">${escapeHtml(body)}</p>
</div>`;
}

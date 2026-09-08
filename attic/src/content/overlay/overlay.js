/**
 * The selection overlay (§9, §11, §13, §54, §55, §56, §113, §114).
 *
 * Lives entirely in the extension's shadow root, so it adds nothing to the page's layout
 * and cannot be styled or selected by the page (§55).
 *
 * All marks are positioned in *viewport* coordinates from `getBoundingClientRect`, which
 * is already correct for transforms, nested scroll containers, sticky headers and fixed
 * elements alike — the alternative, caching document coordinates, drifts the moment any
 * of those move (§56, §113, §114).
 */

import { escapeHtml, rafThrottle, truncate } from '../../shared/util.js';
import { boxModel, measureNeighbours } from '../inspector-engine/geometry.js';
import { labelFor } from '../element-model/model.js';

/** The eight resize grips (§11). */
export const HANDLES = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize', axis: 'both' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize', axis: 'vertical' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize', axis: 'both' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize', axis: 'horizontal' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize', axis: 'both' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize', axis: 'vertical' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize', axis: 'both' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize', axis: 'horizontal' },
];

export class Overlay {
  #root;
  #view;
  #hover = null;
  #selected = [];
  #showMeasurements = false;
  #showSpacing = false;
  #resizable = true;
  #sync;

  /** @param {ShadowRoot|HTMLElement} container The marks layer inside the shadow root. */
  constructor(container, { view = window } = {}) {
    this.#view = view;
    this.#root = container;
    this.#root.innerHTML = TEMPLATE;
    this.#sync = rafThrottle(() => this.#render(), view.requestAnimationFrame?.bind(view));
  }

  /** Element under the pointer (§8). Passing null clears the highlight. */
  setHover(element) {
    if (this.#hover === element) return;
    this.#hover = element;
    this.#sync();
  }

  /** Current selection (§9, §46). */
  setSelection(elements) {
    this.#selected = elements.filter(Boolean);
    this.#sync();
  }

  setResizable(enabled) {
    this.#resizable = enabled;
    this.#sync();
  }

  /** Neighbour distance readouts (§54). */
  setMeasurements(enabled) {
    this.#showMeasurements = enabled;
    this.#sync();
  }

  /** Padding and margin bands (§13). */
  setSpacing(enabled) {
    this.#showSpacing = enabled;
    this.#sync();
  }

  /** Re-reads geometry. Called on scroll, resize and mutation. */
  sync() {
    this.#sync();
  }

  hide() {
    this.#root.querySelector('.widt-marks').hidden = true;
  }

  show() {
    this.#root.querySelector('.widt-marks').hidden = false;
  }

  /** Hit-tests a pointer event against the resize handles. */
  handleAt(x, y) {
    for (const node of this.#root.querySelectorAll('.widt-handle')) {
      const r = node.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return HANDLES.find((h) => h.id === node.dataset.handle) ?? null;
      }
    }
    return null;
  }

  destroy() {
    this.#sync.cancel();
    this.#root.innerHTML = '';
  }

  #render() {
    const marks = this.#root.querySelector('.widt-marks');
    if (!marks || marks.hidden) return;

    this.#renderHover();
    this.#renderSelection();
  }

  #renderHover() {
    const box = this.#root.querySelector('.widt-hover');
    const label = this.#root.querySelector('.widt-hover-label');
    const element = this.#hover;

    // A hovered element that is also selected needs no second outline.
    if (!element || !element.isConnected || this.#selected.includes(element)) {
      box.hidden = true;
      label.hidden = true;
      return;
    }

    const rect = element.getBoundingClientRect();
    box.hidden = false;
    place(box, rect);

    label.hidden = false;
    label.innerHTML =
      `<span class="widt-hover-name">${escapeHtml(truncate(labelFor(element), 34))}</span>` +
      `<span class="widt-hover-size widt-mono">${Math.round(rect.width)} × ${Math.round(rect.height)}</span>`;
    placeLabel(label, rect, this.#view);
  }

  #renderSelection() {
    const layer = this.#root.querySelector('.widt-selection-layer');
    const primary = this.#selected[0];

    if (!primary || !primary.isConnected) {
      layer.innerHTML = '';
      return;
    }

    const parts = [];
    // Secondary selections get a plain outline; only the primary carries handles (§47).
    for (const element of this.#selected.slice(1)) {
      if (!element.isConnected) continue;
      parts.push(`<div class="widt-sel widt-sel--secondary" style="${styleFor(element.getBoundingClientRect())}"></div>`);
    }

    const rect = primary.getBoundingClientRect();
    parts.push(this.#spacingMarkup(primary, rect));
    parts.push(`<div class="widt-sel" style="${styleFor(rect)}"></div>`);

    if (this.#resizable && this.#selected.length === 1) {
      parts.push(this.#handleMarkup(rect));
    }
    parts.push(this.#dimensionMarkup(primary, rect));
    if (this.#showMeasurements) parts.push(this.#measurementMarkup(primary, rect));

    layer.innerHTML = parts.join('');
  }

  #handleMarkup(rect) {
    return HANDLES.map((h) => {
      const left = rect.left + rect.width * h.x;
      const top = rect.top + rect.height * h.y;
      return `<div class="widt-handle" data-handle="${h.id}" data-interactive
        style="left:${left}px;top:${top}px;cursor:${h.cursor}"></div>`;
    }).join('');
  }

  #dimensionMarkup(element, rect) {
    const label = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    const below = rect.bottom + 24 < this.#view.innerHeight;
    const top = below ? rect.bottom + 6 : Math.max(4, rect.top - 22);
    const left = Math.max(4, Math.min(rect.left, this.#view.innerWidth - 110));
    return `<div class="widt-dims widt-mono" style="left:${left}px;top:${top}px">${label}</div>`;
  }

  /** Padding and margin bands, drawn the way a design tool shows the box model (§13). */
  #spacingMarkup(element, rect) {
    if (!this.#showSpacing) return '';
    const box = boxModel(element, this.#view);
    const m = box.margin;
    const p = box.padding;

    const margin = `<div class="widt-band widt-band--margin" style="${styleFor({
      left: rect.left - m.left, top: rect.top - m.top,
      width: rect.width + m.left + m.right, height: rect.height + m.top + m.bottom,
    })}"></div>`;

    const padding = `<div class="widt-band widt-band--padding" style="${styleFor({
      left: rect.left + p.left, top: rect.top + p.top,
      width: Math.max(0, rect.width - p.left - p.right),
      height: Math.max(0, rect.height - p.top - p.bottom),
    })}"></div>`;

    return margin + padding;
  }

  /** Distances to the nearest siblings and to the parent's content box (§54). */
  #measurementMarkup(element, rect) {
    const gaps = measureNeighbours(element, this.#view);
    const parts = [];
    const add = (side, value) => {
      if (value == null || value <= 0) return;
      const label = `${value}`;
      if (side === 'top') {
        parts.push(rule(rect.left + rect.width / 2, rect.top - value, 0, value, 'v', label));
      } else if (side === 'bottom') {
        parts.push(rule(rect.left + rect.width / 2, rect.bottom, 0, value, 'v', label));
      } else if (side === 'left') {
        parts.push(rule(rect.left - value, rect.top + rect.height / 2, value, 0, 'h', label));
      } else if (side === 'right') {
        parts.push(rule(rect.right, rect.top + rect.height / 2, value, 0, 'h', label));
      }
    };
    add('top', gaps.top);
    add('bottom', gaps.bottom);
    add('left', gaps.left);
    add('right', gaps.right);
    return parts.join('');
  }
}

/** One measurement line plus its numeric badge. */
function rule(x, y, width, height, axis, label) {
  const line = axis === 'h'
    ? `left:${x}px;top:${y}px;width:${width}px;height:1px`
    : `left:${x}px;top:${y}px;width:1px;height:${height}px`;
  const badge = axis === 'h'
    ? `left:${x + width / 2}px;top:${y}px;transform:translate(-50%,-50%)`
    : `left:${x}px;top:${y + height / 2}px;transform:translate(-50%,-50%)`;
  return `<div class="widt-rule" style="${line}"></div>
    <div class="widt-rule-badge widt-mono" style="${badge}">${label}</div>`;
}

function styleFor(rect) {
  return `left:${rect.left}px;top:${rect.top}px;width:${Math.max(0, rect.width)}px;height:${Math.max(0, rect.height)}px`;
}

function place(node, rect) {
  node.style.cssText = styleFor(rect);
}

/** Keeps the hover label on screen — above the element, or below when there is no room. */
function placeLabel(node, rect, view) {
  const above = rect.top > 26;
  const top = above ? rect.top - 24 : Math.min(rect.bottom + 4, view.innerHeight - 24);
  const left = Math.max(2, Math.min(rect.left, view.innerWidth - node.offsetWidth - 2));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

const TEMPLATE = `
<div class="widt-marks">
  <div class="widt-hover" hidden></div>
  <div class="widt-hover-label" hidden></div>
  <div class="widt-selection-layer"></div>
</div>`;

export const overlayCss = /* css */ `
.widt-marks { position: absolute; inset: 0; z-index: var(--z-marks); pointer-events: none; }

.widt-hover {
  position: absolute;
  border: 1px solid var(--selection);
  background: var(--selection-dim);
  border-radius: 1px;
}

.widt-hover-label {
  position: absolute;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: 340px;
  padding: 2px var(--space-3);
  background: var(--selection-strong);
  color: var(--on-selection);
  font-size: var(--text-micro);
  font-weight: 500;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  box-shadow: var(--shadow-pop);
}
.widt-hover-name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.widt-hover-size { opacity: 0.75; flex: none; }

.widt-sel {
  position: absolute;
  outline: 1.5px solid var(--selection);
  outline-offset: -1px;
  border-radius: 1px;
}
.widt-sel--secondary { outline-width: 1px; outline-style: dashed; }

.widt-handle {
  position: absolute;
  width: 9px;
  height: 9px;
  margin: -5px 0 0 -5px;
  background: var(--on-selection);
  border: 1.5px solid var(--selection);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.widt-handle:hover { background: var(--selection); }

.widt-dims {
  position: absolute;
  padding: 1px var(--space-3);
  background: var(--selection-strong);
  color: var(--on-selection);
  font-size: var(--text-micro);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  box-shadow: var(--shadow-pop);
}

.widt-band { position: absolute; pointer-events: none; }
.widt-band--margin { background: rgba(245, 158, 11, 0.16); outline: 1px dashed rgba(245, 158, 11, 0.5); }
.widt-band--padding { background: rgba(34, 197, 94, 0.14); outline: 1px dashed rgba(34, 197, 94, 0.45); }

.widt-rule { position: absolute; background: var(--measure); }
.widt-rule-badge {
  position: absolute;
  padding: 0 3px;
  background: var(--measure);
  color: var(--on-measure);
  font-size: 10px;
  font-weight: 600;
  border-radius: 2px;
  white-space: nowrap;
}
`;

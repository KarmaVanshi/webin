/**
 * Drag and resize gestures (§11, §12, §16, §81, §82, §83).
 *
 * The rule this module exists to enforce: a mouse movement is never written straight to
 * a style. It becomes an *intent*, the layout context decides what that intent means in
 * this element's own layout language, and only then is a minimal set of properties
 * generated (§81).
 *
 * Preview and commit are separate. Everything during the drag is a preview — applied to
 * the page but never recorded — and one transaction is committed at pointer-up, so a
 * fifty-frame drag produces one history entry (§83).
 */

import { Emitter } from '../../shared/util.js';
import { analyse, movementStrategy, resizeCapability } from '../inspector-engine/layout.js';
import { parseDimension, formatDimension } from '../../shared/css-values.js';
import { labelFor } from '../element-model/model.js';

/** Pointer travel before a press becomes a drag — prevents accidental nudges. */
const DRAG_THRESHOLD = 3;

export class Interactions extends Emitter {
  #doc;
  #view;
  #gesture = null;

  constructor({ doc = document, view = window } = {}) {
    super();
    this.#doc = doc;
    this.#view = view;
  }

  get active() {
    return this.#gesture !== null;
  }

  get kind() {
    return this.#gesture?.kind ?? null;
  }

  /** Starts a resize from one of the eight grips (§11). */
  beginResize(element, handle, event) {
    const style = this.#view.getComputedStyle(element);
    const context = analyse(element, this.#view);
    const capability = resizeCapability(context, style);
    if (!capability.horizontal && !capability.vertical) {
      this.emit('refused', { element, reason: capability.reason });
      return false;
    }

    const rect = element.getBoundingClientRect();
    this.#gesture = {
      kind: 'resize',
      element,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rect,
      ratio: rect.height === 0 ? 1 : rect.width / rect.height,
      units: {
        width: unitOf(style.width, element.parentElement, 'width', this.#view),
        height: unitOf(style.height, element.parentElement, 'height', this.#view),
      },
      capability,
      moved: false,
      label: `Resized ${labelFor(element)}`,
    };
    this.#listen();
    return true;
  }

  /** Starts a free drag of the element itself (§12). */
  beginDrag(element, event) {
    const style = this.#view.getComputedStyle(element);
    const context = analyse(element, this.#view);
    const strategy = movementStrategy(context);

    this.#gesture = {
      kind: 'drag',
      element,
      context,
      strategy,
      startX: event.clientX,
      startY: event.clientY,
      startRect: element.getBoundingClientRect(),
      base: baseOffsets(style, strategy),
      moved: false,
      label: `Moved ${labelFor(element)}`,
    };
    this.#listen();
    return true;
  }

  /** Cancels the gesture and asks the caller to restore the pre-gesture values. */
  cancel() {
    const gesture = this.#gesture;
    if (!gesture) return;
    this.#unlisten();
    this.#gesture = null;
    this.emit('cancel', { element: gesture.element });
  }

  #listen() {
    this.#doc.addEventListener('pointermove', this.#onMove, { capture: true });
    this.#doc.addEventListener('pointerup', this.#onUp, { capture: true });
    this.#doc.addEventListener('keydown', this.#onKey, { capture: true });
  }

  #unlisten() {
    this.#doc.removeEventListener('pointermove', this.#onMove, { capture: true });
    this.#doc.removeEventListener('pointerup', this.#onUp, { capture: true });
    this.#doc.removeEventListener('keydown', this.#onKey, { capture: true });
  }

  #onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  };

  #onMove = (event) => {
    const gesture = this.#gesture;
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    gesture.moved = true;

    const properties = gesture.kind === 'resize'
      ? this.#resizeProperties(gesture, dx, dy, event)
      : this.#dragProperties(gesture, dx, dy, event);

    if (properties) this.emit('preview', { element: gesture.element, properties });
  };

  #onUp = (event) => {
    const gesture = this.#gesture;
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    this.#unlisten();
    this.#gesture = null;

    if (!gesture.moved) {
      this.emit('cancel', { element: gesture.element });
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const properties = gesture.kind === 'resize'
      ? this.#resizeProperties(gesture, dx, dy, event)
      : this.#dragProperties(gesture, dx, dy, event);

    this.emit('commit', { element: gesture.element, properties: properties ?? {}, label: gesture.label });
  };

  /**
   * Resize (§11).
   * Shift constrains the aspect ratio; the grip's own axis constrains everything else.
   */
  #resizeProperties(gesture, dx, dy, event) {
    const { handle, startRect, capability, units } = gesture;
    const horizontal = handle.axis !== 'vertical' && capability.horizontal;
    const vertical = handle.axis !== 'horizontal' && capability.vertical;

    // A west or north grip moves the far edge, so the delta inverts.
    const signX = handle.x === 0 ? -1 : handle.x === 1 ? 1 : 0;
    const signY = handle.y === 0 ? -1 : handle.y === 1 ? 1 : 0;

    let width = horizontal ? Math.max(1, startRect.width + dx * signX) : startRect.width;
    let height = vertical ? Math.max(1, startRect.height + dy * signY) : startRect.height;

    if (event.shiftKey && horizontal && vertical) {
      // Proportional: the dominant axis drives the other.
      if (Math.abs(dx) > Math.abs(dy)) height = width / gesture.ratio;
      else width = height * gesture.ratio;
    }

    const properties = {};
    if (horizontal) properties.width = toUnit(width, units.width);
    if (vertical) properties.height = toUnit(height, units.height);
    return properties;
  }

  /**
   * Drag (§12).
   * The strategy comes from the layout context, so this never blindly injects
   * `position: absolute` — the failure mode the concept calls out explicitly.
   */
  #dragProperties(gesture, dx, dy, event) {
    const { strategy, base, element } = gesture;

    // Shift locks to the dominant axis.
    let moveX = dx;
    let moveY = dy;
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) moveY = 0;
      else moveX = 0;
    }

    if (strategy.kind === 'grid') {
      return this.#gridPlacement(element, gesture, moveX, moveY);
    }

    if (strategy.kind === 'offset') {
      return {
        left: formatDimension(base.left + moveX),
        top: formatDimension(base.top + moveY),
      };
    }

    // Flow and flex children move by margin, which keeps them in their layout (§12).
    return {
      'margin-left': formatDimension(base.marginLeft + moveX),
      'margin-top': formatDimension(base.marginTop + moveY),
    };
  }

  /**
   * Grid placement (§16).
   * A dragged grid item snaps to whichever track the pointer is over, producing valid
   * grid properties instead of arbitrary coordinates.
   */
  #gridPlacement(element, gesture, moveX, moveY) {
    const parent = element.parentElement;
    if (!parent) return null;
    const parentStyle = this.#view.getComputedStyle(parent);
    const parentRect = parent.getBoundingClientRect();

    const columns = trackEdges(parentStyle.gridTemplateColumns, Number.parseFloat(parentStyle.columnGap) || 0);
    const rows = trackEdges(parentStyle.gridTemplateRows, Number.parseFloat(parentStyle.rowGap) || 0);
    if (!columns.length && !rows.length) return null;

    const pointX = gesture.startRect.left + moveX - parentRect.left + parent.scrollLeft;
    const pointY = gesture.startRect.top + moveY - parentRect.top + parent.scrollTop;

    const properties = {};
    if (columns.length) properties['grid-column-start'] = String(trackIndexAt(columns, pointX) + 1);
    if (rows.length) properties['grid-row-start'] = String(trackIndexAt(rows, pointY) + 1);
    return properties;
  }
}

/** Computed grid templates resolve to a pixel list; turn that into cumulative edges. */
export function trackEdges(template, gap) {
  if (!template || template === 'none') return [];
  const sizes = template.trim().split(/\s+/).map((v) => Number.parseFloat(v)).filter(Number.isFinite);
  const edges = [];
  let offset = 0;
  for (const size of sizes) {
    edges.push(offset);
    offset += size + gap;
  }
  return edges;
}

/** Which track a coordinate falls in. */
export function trackIndexAt(edges, position) {
  let index = 0;
  for (let i = 0; i < edges.length; i += 1) if (position >= edges[i]) index = i;
  return Math.max(0, Math.min(index, edges.length - 1));
}

/** The offsets a drag adds to, read once at gesture start. */
function baseOffsets(style, strategy) {
  const n = (v) => Number.parseFloat(v) || 0;
  return strategy.kind === 'offset'
    ? { left: n(style.left), top: n(style.top), marginLeft: n(style.marginLeft), marginTop: n(style.marginTop) }
    : { left: 0, top: 0, marginLeft: n(style.marginLeft), marginTop: n(style.marginTop) };
}

/**
 * The unit a dimension should be written back in (§63).
 * Percentages are preserved by converting against the containing block, so resizing a
 * fluid element keeps it fluid instead of freezing it to a pixel width.
 */
function unitOf(declared, parent, axis, view) {
  const parsed = parseDimension(declared);
  if (parsed?.unit === '%' && parent) {
    const parentRect = parent.getBoundingClientRect();
    const basis = axis === 'width' ? parentRect.width : parentRect.height;
    if (basis > 0) return { unit: '%', basis };
  }
  return { unit: 'px', basis: 1 };
}

function toUnit(pixels, unitInfo) {
  if (unitInfo.unit === '%') return formatDimension((pixels / unitInfo.basis) * 100, '%');
  return formatDimension(pixels, 'px');
}

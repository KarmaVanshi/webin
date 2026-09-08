/**
 * Rendered geometry (§10, §56, §57, §112, §113, §114).
 *
 * Every number here comes from the browser's own layout — never from parsing CSS.
 * getBoundingClientRect already accounts for transforms, zoom and nested scrolling, so
 * the work is converting between the frames the rest of the app needs and knowing which
 * frame a given element actually lives in.
 */

/** Viewport-relative box, as the browser reports it. */
export function viewportRect(element) {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
}

/**
 * Document-relative box.
 * Fixed elements are excluded: they do not move with the document, so adding scroll
 * offsets to them would make the overlay drift away as the user scrolls (§114).
 */
export function documentRect(element, view = window) {
  const r = element.getBoundingClientRect();
  const fixed = isFixed(element, view);
  const dx = fixed ? 0 : view.scrollX;
  const dy = fixed ? 0 : view.scrollY;
  return {
    x: r.left + dx, y: r.top + dy, width: r.width, height: r.height,
    top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy, left: r.left + dx,
  };
}

/**
 * The frame the overlay must draw in for this element.
 * A fixed element is pinned to the viewport, so its highlight has to be too — otherwise
 * a sticky header's outline slides off as the page scrolls (§113, §114).
 */
export function overlayFrame(element, view = window) {
  return isFixed(element, view) ? 'viewport' : 'document';
}

/** True when the element, or an ancestor it is painted with, is position: fixed. */
export function isFixed(element, view = window) {
  let node = element;
  while (node && node.nodeType === 1) {
    if (view.getComputedStyle(node).position === 'fixed') return true;
    node = node.parentElement;
  }
  return false;
}

/** True when the element is position: sticky and currently stuck away from its flow spot. */
export function isSticky(element, view = window) {
  return view.getComputedStyle(element).position === 'sticky';
}

/** Device pixel ratio and zoom, so handle sizes stay physically constant (§57). */
export function displayMetrics(view = window) {
  const dpr = view.devicePixelRatio || 1;
  // visualViewport.scale is pinch-zoom; the ratio of outer to inner width approximates
  // browser zoom on desktop. Both matter for keeping 8px handles looking like 8px.
  const pinch = view.visualViewport?.scale ?? 1;
  return { dpr, pinch, scrollX: view.scrollX, scrollY: view.scrollY };
}

/** Nearest ancestor that actually scrolls — measurements must account for it (§112). */
export function scrollParent(element, view = window) {
  let node = element.parentElement;
  while (node && node.nodeType === 1) {
    const style = view.getComputedStyle(node);
    const overflow = `${style.overflow}${style.overflowY}${style.overflowX}`;
    if (/(auto|scroll|overlay)/.test(overflow) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return view.document.scrollingElement ?? view.document.documentElement;
}

/** Box model as four numbers per band, for the spacing editor (§13). */
export function boxModel(element, view = window) {
  const s = view.getComputedStyle(element);
  const n = (v) => Number.parseFloat(v) || 0;
  const rect = viewportRect(element);
  return {
    content: {
      width: rect.width - n(s.paddingLeft) - n(s.paddingRight) - n(s.borderLeftWidth) - n(s.borderRightWidth),
      height: rect.height - n(s.paddingTop) - n(s.paddingBottom) - n(s.borderTopWidth) - n(s.borderBottomWidth),
    },
    padding: { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) },
    border: { top: n(s.borderTopWidth), right: n(s.borderRightWidth), bottom: n(s.borderBottomWidth), left: n(s.borderLeftWidth) },
    margin: { top: n(s.marginTop), right: n(s.marginRight), bottom: n(s.marginBottom), left: n(s.marginLeft) },
  };
}

/**
 * Distances from an element to its parent's content box and to its nearest siblings
 * (§54). These are the numbers a design tool shows when you hold a modifier key.
 */
export function measureNeighbours(element, view = window) {
  const rect = viewportRect(element);
  const out = { parent: null, top: null, right: null, bottom: null, left: null };

  const parent = element.parentElement;
  if (parent) {
    const p = viewportRect(parent);
    const s = view.getComputedStyle(parent);
    const n = (v) => Number.parseFloat(v) || 0;
    out.parent = {
      top: round1(rect.top - (p.top + n(s.borderTopWidth) + n(s.paddingTop))),
      right: round1((p.right - n(s.borderRightWidth) - n(s.paddingRight)) - rect.right),
      bottom: round1((p.bottom - n(s.borderBottomWidth) - n(s.paddingBottom)) - rect.bottom),
      left: round1(rect.left - (p.left + n(s.borderLeftWidth) + n(s.paddingLeft))),
    };

    for (const sibling of parent.children) {
      if (sibling === element) continue;
      const s2 = viewportRect(sibling);
      if (s2.width === 0 && s2.height === 0) continue;
      // Only count a sibling when the two overlap on the perpendicular axis, so a
      // element in another column is not reported as "8px above".
      const overlapX = s2.right > rect.left && s2.left < rect.right;
      const overlapY = s2.bottom > rect.top && s2.top < rect.bottom;
      if (overlapX && s2.bottom <= rect.top) out.top = minGap(out.top, rect.top - s2.bottom);
      if (overlapX && s2.top >= rect.bottom) out.bottom = minGap(out.bottom, s2.top - rect.bottom);
      if (overlapY && s2.right <= rect.left) out.left = minGap(out.left, rect.left - s2.right);
      if (overlapY && s2.left >= rect.right) out.right = minGap(out.right, s2.left - rect.right);
    }
  }
  return out;
}

const minGap = (current, next) => (current == null ? round1(next) : Math.min(current, round1(next)));
const round1 = (n) => Math.round(n * 10) / 10;

/** True when the element renders nothing — such nodes are poor selection targets (§8). */
export function isRenderable(element, view = window) {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = view.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/** Whether the element is currently within the viewport, for layers-panel affordances. */
export function isInViewport(element, view = window) {
  const r = element.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < view.innerHeight && r.left < view.innerWidth;
}

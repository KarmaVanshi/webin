/**
 * The Element Model (§27, §72, §73).
 *
 * The bridge every other system talks through: DOM on one side, Inspector, visual
 * editor, history and persistence on the other. Two constraints shape it:
 *
 *   - Large pages must stay cheap (§72). A record is a handful of strings until someone
 *     actually selects the element; only then are computed styles read.
 *   - Removed nodes must not be retained (§73). Records hold elements weakly, and the
 *     id->element direction is swept when nodes leave the document.
 */

import { uid, normaliseText, truncate } from '../shared/util.js';
import { buildIdentity } from './identity.js';
import { readAll } from './computed.js';
import { analyse } from './layout.js';
import { documentRect, viewportRect, boxModel, measureNeighbours, isRenderable, overlayFrame } from './geometry.js';
import { OWNED_ATTR, WID_ATTR } from '../shared/types.js';

export class ElementModel {
  #view;
  #doc;
  /** @type {Map<string, WeakRef<Element>>} */
  #byId = new Map();
  /** @type {WeakMap<Element, string>} */
  #ids = new WeakMap();
  /** @type {WeakMap<Element, object>} */
  #details = new WeakMap();

  constructor({ doc = document, view = window } = {}) {
    this.#doc = doc;
    this.#view = view;
  }

  /** Stable internal id for an element, minted on first sight. */
  idOf(element) {
    let id = this.#ids.get(element);
    if (!id) {
      id = uid('el');
      this.#ids.set(element, id);
      this.#byId.set(id, new WeakRef(element));
    }
    return id;
  }

  /** Resolves an internal id back to a live element, or null if it has gone. */
  elementOf(id) {
    const ref = this.#byId.get(id);
    if (!ref) return null;
    const element = ref.deref();
    if (!element || !element.isConnected) {
      this.#byId.delete(id);
      return null;
    }
    return element;
  }

  /**
   * The cheap record — enough for the Layers panel and hover labels (§72 initial phase).
   * @returns {object}
   */
  summary(element) {
    return {
      id: this.idOf(element),
      tag: element.tagName.toLowerCase(),
      classes: classListOf(element),
      elementId: element.id || null,
      label: labelFor(element),
      childCount: element.children.length,
      hasText: Boolean(singleLineText(element)),
      renderable: isRenderable(element, this.#view),
      overridden: element.hasAttribute(WID_ATTR),
    };
  }

  /**
   * The full record (§27) — computed styles, geometry, layout context, identity.
   * Resolved on selection, not on hover, and cached until invalidated.
   */
  detail(element, { fresh = false } = {}) {
    if (!fresh) {
      const cached = this.#details.get(element);
      if (cached) return { ...cached, geometry: this.geometry(element) };
    }

    const record = {
      ...this.summary(element),
      attributes: attributesOf(element),
      text: singleLineText(element),
      parentId: element.parentElement ? this.idOf(element.parentElement) : null,
      children: [...element.children].map((child) => this.idOf(child)),
      identity: buildIdentity(element),
      geometry: this.geometry(element),
      boxModel: boxModel(element, this.#view),
      layoutContext: analyse(element, this.#view),
      ...readAll(element, this.#view),
    };
    this.#details.set(element, record);
    return record;
  }

  /** Geometry alone — recomputed constantly during scroll and drag, so kept separate. */
  geometry(element) {
    return {
      ...documentRect(element, this.#view),
      viewport: viewportRect(element),
      frame: overlayFrame(element, this.#view),
    };
  }

  /** Neighbour distances, only computed when the measurement layer is on (§54). */
  measurements(element) {
    return measureNeighbours(element, this.#view);
  }

  /** Drops cached detail for an element whose styles or geometry may have changed (§29). */
  invalidate(element) {
    if (element) this.#details.delete(element);
    else this.#details = new WeakMap();
  }

  /** Sweeps ids whose elements have been collected or detached (§73). */
  sweep() {
    let removed = 0;
    for (const [id, ref] of this.#byId) {
      const element = ref.deref();
      if (!element || !element.isConnected) {
        this.#byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size() {
    return this.#byId.size;
  }
}

/** Elements that are structurally invisible make poor selection targets (§8). */
export function isSelectable(element, view = window) {
  if (!element || element.nodeType !== 1) return false;
  if (element.closest(`[${OWNED_ATTR}]`)) return false;
  const tag = element.tagName.toLowerCase();
  if (['html', 'head', 'script', 'style', 'meta', 'link', 'title', 'noscript'].includes(tag)) return false;
  return isRenderable(element, view);
}

/** Class list as an array, working for SVG elements too (their className is an object). */
export function classListOf(element) {
  return [...(element.classList ?? [])];
}

/** Attributes as a plain object, capped so a data-heavy node cannot bloat a record. */
export function attributesOf(element) {
  const out = {};
  for (const attr of element.attributes ?? []) {
    if (attr.name === WID_ATTR) continue;
    out[attr.name] = attr.value.length > 200 ? `${attr.value.slice(0, 200)}…` : attr.value;
  }
  return out;
}

/**
 * Text of an element when it is a single editable line.
 *
 * Strict on purpose: this gates *editing*, and an element with child elements has no
 * single text node to rewrite safely (§18).
 */
export function singleLineText(element) {
  if (element.children.length > 0) return null;
  const text = normaliseText(element.textContent);
  return text && text.length <= 120 ? text : null;
}

/**
 * Text of an element for *labelling* purposes.
 *
 * Looser than `singleLineText`, because a button holding an icon plus "Buy Now" should
 * still read as "Buy Now" in the Layers panel even though it is not safely editable.
 */
export function labelText(element, max = 60) {
  const text = normaliseText(element.textContent);
  return text && text.length <= max ? text : null;
}

/**
 * The name shown in the Layers panel and the hover label (§8, §26).
 * Prefers a human-meaningful signal over raw markup: a landmark role, an accessible
 * name, or the element's own text, and only falls back to `div.wrapper`.
 */
export function labelFor(element) {
  const tag = element.tagName.toLowerCase();

  const landmark = LANDMARKS[tag];
  if (landmark) return landmark;

  const ariaLabel = element.getAttribute?.('aria-label');
  if (ariaLabel) return truncate(normaliseText(ariaLabel), 28);

  const role = element.getAttribute?.('role');
  if (role) return `${tag} · ${role}`;

  if (tag === 'img') {
    const alt = element.getAttribute('alt');
    return alt ? `Image · ${truncate(normaliseText(alt), 20)}` : 'Image';
  }

  if (/^h[1-6]$/.test(tag)) {
    const text = labelText(element, 40);
    return text ? `${tag.toUpperCase()} · ${truncate(text, 24)}` : tag.toUpperCase();
  }

  if (['button', 'a', 'label', 'li', 'td', 'th', 'summary', 'option'].includes(tag)) {
    const text = labelText(element, 40);
    if (text) return `${tag} · ${truncate(text, 22)}`;
  }

  const id = element.id;
  if (id && id.length <= 24) return `${tag}#${id}`;

  const cls = classListOf(element).find((c) => c.length <= 20 && !/[[\]()#%/]/.test(c));
  return cls ? `${tag}.${cls}` : tag;
}

/** Tags that carry their own meaning — used verbatim in the tree (§26). */
const LANDMARKS = {
  header: 'Header',
  nav: 'Navigation',
  main: 'Main',
  footer: 'Footer',
  aside: 'Sidebar',
  form: 'Form',
  section: 'Section',
  article: 'Article',
  figure: 'Figure',
  dialog: 'Dialog',
  table: 'Table',
};

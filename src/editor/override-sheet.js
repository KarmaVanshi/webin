/**
 * The one stylesheet the extension writes into the page (§33 Level 1).
 *
 * Everything visual goes through here rather than through inline styles, for three
 * reasons: the page's own inline styles stay untouched and readable, removing an
 * override is a single rule deletion, and the Inspector can always distinguish "the
 * site set this" from "you set this" (§51, §61).
 *
 * Rules are keyed by a `data-webin-id` attribute stamped on the target. That attribute
 * is the only mark left on the page, and it is removed on reset.
 */

import { WID_ATTR, Breakpoint, BREAKPOINT_MAX } from '../shared/types.js';
import { validateDeclaration } from '../shared/css-values.js';
import { SheetRegistry } from '../content/sheets.js';
import { collectShadowRoots } from '../content/dom.js';

export const STYLE_ID = 'webin-overrides';

let widCounter = 0;

/** Stamps an element with a stable override id, reusing one if already present. */
export function ensureWid(element) {
  let wid = element.getAttribute(WID_ATTR);
  if (!wid) {
    widCounter += 1;
    wid = `w${widCounter}`;
    element.setAttribute(WID_ATTR, wid);
  }
  return wid;
}

/** Removes the mark, leaving the element exactly as the site rendered it. */
export function clearWid(element) {
  element.removeAttribute(WID_ATTR);
}

export class OverrideStylesheet {
  /** @type {Map<string, {wid:string, breakpoint:string, properties:Map<string,{value:string, important:boolean}>}>} */
  #rules = new Map();
  #sheets = null;
  #doc;
  #dirty = false;
  #frame = null;

  constructor(doc = document) {
    this.#doc = doc;
  }

  /**
   * Starts producing CSS.
   *
   * This goes through the same registry the theme engine uses, for one reason: a
   * document-level `<style>` cannot style anything inside a shadow root. On a site built
   * from web components — which is most of the ones worth re-styling — the element the
   * user just clicked is very often in one, and a rule written for it would be perfectly
   * correct and have no effect whatsoever. A constructed stylesheet can be adopted by
   * every open shadow root, so it reaches them.
   *
   * Where constructed stylesheets are unavailable the registry falls back to a `<style>`
   * carrying `STYLE_ID`, which is also what makes this inspectable in tests.
   */
  mount() {
    this.#sheets ??= new SheetRegistry(this.#doc, { styleId: STYLE_ID });
    this.#render();
    return this.#sheets;
  }

  /** Re-attaches the stylesheet if a page script removed it, and picks up new roots. */
  ensureMounted() {
    if (!this.#sheets) {
      this.mount();
      return true;
    }
    this.syncRoots();
    return false;
  }

  /**
   * Adopts the sheet into any shadow roots that have appeared since the last pass.
   *
   * A component that renders after the first paint brings a new root with it, and a root
   * that never adopted the sheet is a subtree where every override silently stops.
   */
  syncRoots(limit = 4000) {
    if (!this.#sheets) return 0;
    const roots = collectShadowRoots(this.#doc, limit);
    this.#sheets.sync(roots);
    return roots.length;
  }

  /**
   * Sets declarations for one element at one breakpoint.
   * Invalid declarations are dropped and reported rather than written (§62, §74).
   * @returns {{applied:string[], rejected:Array<{property:string, reason:string}>}}
   */
  set(wid, properties, { breakpoint = Breakpoint.ALL, important = false } = {}) {
    const key = ruleKey(wid, breakpoint);
    const rule = this.#rules.get(key) ?? { wid, breakpoint, properties: new Map() };
    const applied = [];
    const rejected = [];

    for (const [property, value] of Object.entries(properties)) {
      if (value == null) {
        rule.properties.delete(property);
        applied.push(property);
        continue;
      }
      const check = validateDeclaration(property, value);
      if (!check.ok) {
        rejected.push({ property, reason: check.reason });
        continue;
      }
      rule.properties.set(check.property, { value: check.value, important });
      applied.push(check.property);
    }

    if (rule.properties.size) this.#rules.set(key, rule);
    else this.#rules.delete(key);
    this.#schedule();
    return { applied, rejected };
  }

  /** Removes one property, or the whole rule when no property is given. */
  remove(wid, property = null, breakpoint = Breakpoint.ALL) {
    const key = ruleKey(wid, breakpoint);
    if (!property) {
      const existed = this.#rules.delete(key);
      if (existed) this.#schedule();
      return existed;
    }
    const rule = this.#rules.get(key);
    if (!rule) return false;
    const existed = rule.properties.delete(property);
    if (!rule.properties.size) this.#rules.delete(key);
    if (existed) this.#schedule();
    return existed;
  }

  /** Every override currently set on one element, across breakpoints. */
  get(wid) {
    const out = {};
    for (const rule of this.#rules.values()) {
      if (rule.wid !== wid) continue;
      out[rule.breakpoint] = Object.fromEntries([...rule.properties].map(([k, v]) => [k, v.value]));
    }
    return out;
  }

  /** The override value for a single property, or null. */
  valueOf(wid, property, breakpoint = Breakpoint.ALL) {
    return this.#rules.get(ruleKey(wid, breakpoint))?.properties.get(property)?.value ?? null;
  }

  /** Drops every rule and empties the stylesheet. */
  clear() {
    this.#rules.clear();
    this.#schedule();
  }

  /** Removes the stylesheet from the document and from every root that adopted it. */
  unmount() {
    this.#cancel();
    this.#sheets?.clear();
    this.#sheets = null;
    this.#rules.clear();
  }

  /** The CSS as it currently stands — the "view source" the inspector offers. */
  get css() {
    return this.#sheets?.css ?? '';
  }

  /** Serialised CSS — also what the "CSS source" view shows (§116). */
  toCss() {
    const byBreakpoint = new Map();
    for (const rule of this.#rules.values()) {
      if (!byBreakpoint.has(rule.breakpoint)) byBreakpoint.set(rule.breakpoint, []);
      byBreakpoint.get(rule.breakpoint).push(rule);
    }

    const blocks = [];
    // Unscoped rules first, so breakpoint-scoped rules can narrow them (§50).
    for (const [breakpoint, rules] of [...byBreakpoint].sort(breakpointOrder)) {
      const body = rules.map(serialiseRule).join('\n');
      if (breakpoint === Breakpoint.ALL) {
        blocks.push(body);
      } else {
        const max = BREAKPOINT_MAX[breakpoint];
        const query = max ? `@media (max-width: ${max}px)` : '@media (min-width: 1025px)';
        blocks.push(`${query} {\n${body.replace(/^/gm, '  ')}\n}`);
      }
    }
    return blocks.join('\n\n');
  }

  get ruleCount() {
    return this.#rules.size;
  }

  /** Writes pending changes immediately instead of waiting for the next frame. */
  flush() {
    this.#cancel();
    this.#render();
  }

  /** Batches writes onto one frame — dragging must not rewrite CSS per mousemove (§71, §83). */
  #schedule() {
    this.#dirty = true;
    if (this.#frame != null) return;
    const raf = globalThis.requestAnimationFrame;
    if (!raf) {
      this.#render();
      return;
    }
    this.#frame = raf(() => {
      this.#frame = null;
      this.#render();
    });
  }

  #cancel() {
    if (this.#frame != null && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  #render() {
    if (!this.#sheets) return;
    this.#dirty = false;
    this.#sheets.update(this.toCss());
    this.syncRoots();
  }
}

/**
 * The attribute is repeated on purpose.
 *
 * `[data-webin-id="w4"]` is specificity (0,1,0) — exactly what the theme engine's own
 * rules score, and the theme lives in an adopted stylesheet, which the cascade places
 * after anything in the document. At equal specificity the theme would therefore win, and
 * a colour the user picked by hand would be silently overruled by the theme they happened
 * to have on. Naming the attribute twice costs nothing and makes it (0,2,0), so a hand
 * edit outranks a theme wherever the two disagree, whatever order the sheets end up in.
 */
function selectorFor(wid) {
  return `[${WID_ATTR}="${wid}"][${WID_ATTR}]`;
}

function serialiseRule(rule) {
  const declarations = [...rule.properties]
    .map(([property, { value, important }]) => `  ${property}: ${value}${important ? ' !important' : ''};`)
    .join('\n');
  return `${selectorFor(rule.wid)} {\n${declarations}\n}`;
}

function ruleKey(wid, breakpoint) {
  return `${wid}|${breakpoint}`;
}

/** ALL first, then widest to narrowest, so narrower queries override. */
function breakpointOrder(a, b) {
  const rank = { [Breakpoint.ALL]: 0, [Breakpoint.DESKTOP]: 1, [Breakpoint.TABLET]: 2, [Breakpoint.MOBILE]: 3 };
  return (rank[a[0]] ?? 9) - (rank[b[0]] ?? 9);
}

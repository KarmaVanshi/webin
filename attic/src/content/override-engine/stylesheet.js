/**
 * The one stylesheet the extension writes into the page (§33 Level 1).
 *
 * Everything visual goes through here rather than through inline styles, for three
 * reasons: the page's own inline styles stay untouched and readable, removing an
 * override is a single rule deletion, and the Inspector can always distinguish "the
 * site set this" from "you set this" (§51, §61).
 *
 * Rules are keyed by a `data-widt-id` attribute stamped on the target. That attribute
 * is the only mark left on the page, and it is removed on reset.
 */

import { WID_ATTR, Breakpoint, BREAKPOINT_MAX } from '../../shared/types.js';
import { validateDeclaration } from '../../shared/css-values.js';

export const STYLE_ID = 'widt-overrides';

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
  #element = null;
  #doc;
  #dirty = false;
  #frame = null;

  constructor(doc = document) {
    this.#doc = doc;
  }

  /**
   * Creates the <style> node. Called at document_start, so `head` may not exist yet —
   * documentElement always does.
   */
  mount() {
    if (this.#element?.isConnected) return this.#element;
    const style = this.#doc.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-widt-owned', '');
    (this.#doc.head ?? this.#doc.documentElement).appendChild(style);
    this.#element = style;
    this.#render();
    return style;
  }

  /** Re-attaches the stylesheet if a page script removed or reordered it. */
  ensureMounted() {
    if (!this.#element?.isConnected) {
      this.#element = null;
      this.mount();
      return true;
    }
    // Overrides must lose to nothing but !important author rules, so keep the node last.
    const parent = this.#element.parentNode;
    if (parent && parent.lastElementChild !== this.#element) {
      parent.appendChild(this.#element);
    }
    return false;
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

  /** Removes the <style> node entirely. */
  unmount() {
    this.#cancel();
    this.#element?.remove();
    this.#element = null;
    this.#rules.clear();
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
    if (!this.#element) return;
    this.#dirty = false;
    this.#element.textContent = this.toCss();
  }
}

function serialiseRule(rule) {
  const declarations = [...rule.properties]
    .map(([property, { value, important }]) => `  ${property}: ${value}${important ? ' !important' : ''};`)
    .join('\n');
  return `[${WID_ATTR}="${rule.wid}"] {\n${declarations}\n}`;
}

function ruleKey(wid, breakpoint) {
  return `${wid}|${breakpoint}`;
}

/** ALL first, then widest to narrowest, so narrower queries override. */
function breakpointOrder(a, b) {
  const rank = { [Breakpoint.ALL]: 0, [Breakpoint.DESKTOP]: 1, [Breakpoint.TABLET]: 2, [Breakpoint.MOBILE]: 3 };
  return (rank[a[0]] ?? 9) - (rank[b[0]] ?? 9);
}

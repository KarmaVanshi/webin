/**
 * Where the generated CSS actually lives.
 *
 * A stylesheet in the document does not apply inside a shadow root, so a single `<style>`
 * tag can never re-skin a web-component site. Constructable stylesheets can: one sheet
 * object is built once and *adopted* by the document and by every open shadow root, so
 * updating the theme is one `replaceSync` rather than N DOM writes.
 *
 * The `<style>`-per-root fallback exists for engines without constructable sheets. It is
 * the same idea with more garbage.
 */

import { OWNED_ATTR, THEME_STYLE_ID } from '../shared/types.js';

export class SheetRegistry {
  #styleId;
  #doc;
  #css = '';
  #sheet = null;
  #adopted = new Set();
  #fallbackNodes = new Map();

  /** @param {string} styleId id for the fallback <style>, so a second sheet can name its own. */
  constructor(doc = document, { styleId = THEME_STYLE_ID } = {}) {
    this.#styleId = styleId;
    this.#doc = doc;
    try {
      const sheet = new doc.defaultView.CSSStyleSheet();
      // A constructor alone is not enough: an engine that cannot replace the contents or
      // adopt the sheet gives us a stylesheet nothing can read.
      const usable = typeof sheet.replaceSync === 'function' && 'adoptedStyleSheets' in doc;
      this.#sheet = usable ? sheet : null;
      // The editor reads the page's cascade to decide when it needs `!important`, and it
      // has to be able to tell the site's stylesheets from ours. A constructed sheet has
      // no owner node to check, so it says so directly — otherwise the editor sees its own
      // rule, concludes something is competing with it, and escalates against itself.
      if (this.#sheet) this.#sheet[Symbol.for('webin.ownSheet')] = true;
    } catch {
      this.#sheet = null; // fall back to <style> elements
    }
  }

  get constructable() { return this.#sheet !== null; }
  get css() { return this.#css; }

  /** Replaces the stylesheet's contents everywhere it is already adopted. */
  update(css) {
    this.#css = css;
    if (this.#sheet) {
      try {
        this.#sheet.replaceSync(css);
      } catch {
        // An invalid rule should cost the theme, not the page.
        this.#sheet.replaceSync('');
      }
    }
    this.#attach(this.#doc);
    for (const node of this.#fallbackNodes.values()) node.textContent = css;
  }

  /**
   * Adopts the sheet into any root that does not have it yet.
   * @param {Array<ShadowRoot>} roots
   */
  sync(roots) {
    for (const root of roots) this.#attach(root);
  }

  /** Removes the sheet from everywhere and forgets every root. */
  clear() {
    for (const root of this.#adopted) {
      try {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== this.#sheet);
      } catch {
        // A root that has gone away needs no cleaning.
      }
    }
    this.#adopted.clear();
    for (const node of this.#fallbackNodes.values()) node.remove();
    this.#fallbackNodes.clear();
    this.#css = '';
  }

  #attach(root) {
    if (this.#adopted.has(root) || this.#fallbackNodes.has(root)) return;
    if (this.#sheet) {
      try {
        const current = root.adoptedStyleSheets ?? [];
        if (!current.includes(this.#sheet)) root.adoptedStyleSheets = [...current, this.#sheet];
        this.#adopted.add(root);
        return;
      } catch {
        // Fall through to a style element for this root.
      }
    }
    const style = this.#doc.createElement('style');
    style.id = root === this.#doc ? this.#styleId : '';
    style.setAttribute(OWNED_ATTR, '');
    style.textContent = this.#css;
    const host = root === this.#doc ? (this.#doc.head ?? this.#doc.documentElement) : root;
    host.appendChild(style);
    this.#fallbackNodes.set(root, style);
  }
}

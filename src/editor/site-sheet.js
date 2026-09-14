/**
 * The stylesheet the user writes for a whole site.
 *
 * Every other edit in Webin is anchored to an element somebody clicked, which is the right
 * shape for almost everything and cannot express the rest: a `::before` that does not
 * exist yet, every third row of a table, a rule that should only apply on a narrow screen.
 * Those need a selector, and a selector needs somewhere to live. This is that place.
 *
 * It is a separate sheet from the override engine's on purpose. The overrides are records
 * keyed by element, rebuilt from a model; this is one piece of text the user owns, and
 * mixing the two would mean rewriting somebody's stylesheet every time they nudged a
 * padding. Kept apart, each is exactly as fragile as it should be.
 */

import { SheetRegistry } from '../content/sheets.js';
import { collectShadowRoots } from '../content/dom.js';
import { parseStylesheet, stylesheetCss, writeRule, SHEET_LIMIT } from '../shared/css-text.js';

/** Names the fallback `<style>`, so it can be told from the override sheet's. */
const STYLE_ID = 'webin-site-css';

export class SiteStylesheet {
  #doc;
  #sheets = null;
  #text = '';
  #rules = [];

  constructor(doc = document) {
    this.#doc = doc;
  }

  /** The text as written, which is what goes back into the editor. */
  get text() { return this.#text; }

  /** The rules that survived parsing. */
  get rules() { return this.#rules; }

  /** The CSS actually injected — useful in tests, and for showing what took effect. */
  get css() { return this.#sheets?.css ?? ''; }

  mount() {
    this.#sheets ??= new SheetRegistry(this.#doc, { styleId: STYLE_ID });
    this.#render();
    return this.#sheets;
  }

  /**
   * Adopts the sheet into shadow roots that have appeared since the last pass.
   *
   * The same reasoning as the override sheet: a component that renders late brings a root
   * with it, and a root that never adopted the sheet is a subtree the rules do not reach.
   */
  syncRoots(limit = 4000) {
    if (!this.#sheets) return 0;
    const roots = collectShadowRoots(this.#doc, limit);
    this.#sheets.sync(roots);
    return roots.length;
  }

  /**
   * Replaces the stylesheet with what somebody typed.
   *
   * Whatever parses is applied and whatever does not is reported, rather than the whole
   * sheet being refused over one bad line. The text is kept exactly as written either way
   * — someone half way through a rule has not asked for their draft to be reformatted.
   *
   * @returns {{rules:number, errors:string[]}}
   */
  set(text) {
    this.#text = String(text ?? '').slice(0, SHEET_LIMIT);
    const { rules, errors } = parseStylesheet(this.#text);
    this.#rules = rules;
    this.#render();
    return { rules: rules.length, errors };
  }

  /**
   * Writes one rule into the stylesheet, leaving the rest of the text as typed.
   *
   * This is how a rule edited from the inspector's Styles list gets here: the same selector
   * and media query the site used, and only the declarations that differ from the site's.
   * An existing rule with that selector is rewritten in place; no declarations at all
   * means the rule is removed. See `writeRule`.
   *
   * @returns {{rules:number, errors:string[]}}
   */
  setRule(rule) {
    const next = writeRule(this.#text, rule);
    if (next.length > SHEET_LIMIT) {
      return { rules: this.#rules.length, errors: [`The site stylesheet is full (${SHEET_LIMIT.toLocaleString()} characters).`] };
    }
    return this.set(next);
  }

  /** Empties the sheet without tearing it down. */
  clear() {
    this.#text = '';
    this.#rules = [];
    this.#render();
  }

  teardown() {
    this.#sheets?.clear();
    this.#sheets = null;
  }

  #render() {
    this.#sheets?.update(stylesheetCss(this.#rules));
    this.syncRoots();
  }
}

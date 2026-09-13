/**
 * What an element *is*, as far as the document is willing to say.
 *
 * The engine's other classifier looks at what an element paints and decides whether it is
 * a card. That test is the right one for cards and the wrong one for chrome: a navigation
 * bar and a modal are not distinguished by their colour, and neither of them is reliably
 * distinguished by its class name — matching `[class*='nav']` also matches `nav-away` and
 * `.navigation-disabled`, and `[class*='card']` catches `discard-button` and
 * `cardholder-name`. Themes that ship their own selector lists get this wrong on real
 * sites, quietly, and only on the pages nobody tested.
 *
 * So roles are read from tags and ARIA instead. Those are what the author of the page
 * declared and what the accessibility tree already believes; a `<dialog>` is a dialog on
 * every site in the world. The vocabulary is fixed in `ROLES` — a theme chooses from what
 * can be recognised rather than describing how to recognise it.
 */

/** Roles whose meaning depends on where the element sits, not only on its tag. */
const SECTIONING = 'article, section, aside, nav';

/** `<input>` types that are buttons wearing an input's tag. */
const BUTTON_TYPES = new Set(['button', 'submit', 'reset', 'image']);

/**
 * True for a `<header>`/`<footer>` that is the page's own rather than some article's.
 *
 * HTML scopes both to their nearest sectioning ancestor: the `<footer>` of a blog post is
 * that post's footer, and giving it the site footer's treatment turns every card on an
 * index page into a page-wide bar.
 */
function isPageLevel(element) {
  return !element.parentElement?.closest?.(SECTIONING);
}

/**
 * The structural role of one element, or null.
 *
 * @param {Element} element
 * @param {Set<string>} wanted roles the active theme actually styles. Anything outside it
 *   is not looked for at all, so a theme that declares no roles costs one set lookup.
 * @returns {string|null}
 */
export function roleOf(element, wanted) {
  if (!wanted?.size) return null;

  const tag = element.tagName;
  const aria = element.getAttribute?.('role') ?? '';

  // Most specific first: a `<button role="menuitem">` inside a popover is a button, and a
  // `<dialog>` that also carries `role="dialog"` should not be tested twice.
  if (wanted.has('modal')
    && (tag === 'DIALOG' || aria === 'dialog' || aria === 'alertdialog'
      || element.getAttribute?.('aria-modal') === 'true')) {
    return 'modal';
  }

  if (wanted.has('popover')
    && (element.hasAttribute?.('popover')
      || aria === 'tooltip' || aria === 'menu' || aria === 'listbox')) {
    return 'popover';
  }

  if (tag === 'INPUT') {
    const type = (element.getAttribute?.('type') ?? 'text').toLowerCase();
    if (BUTTON_TYPES.has(type)) return wanted.has('button') ? 'button' : null;
    // A checkbox or a radio is a control the browser draws itself; handing it a text
    // field's padding and corner radius is how a tick box comes out as a rounded slab.
    if (type === 'checkbox' || type === 'radio') return null;
    return wanted.has('field') ? 'field' : null;
  }

  if (wanted.has('field') && (tag === 'TEXTAREA' || tag === 'SELECT')) return 'field';
  if (wanted.has('button') && (tag === 'BUTTON' || aria === 'button')) return 'button';
  if (wanted.has('nav') && (tag === 'NAV' || aria === 'navigation')) return 'nav';
  if (wanted.has('table') && tag === 'TABLE') return 'table';
  if (wanted.has('sidebar') && (tag === 'ASIDE' || aria === 'complementary')) return 'sidebar';

  if (wanted.has('header') && (aria === 'banner' || (tag === 'HEADER' && isPageLevel(element)))) {
    return 'header';
  }
  if (wanted.has('footer') && (aria === 'contentinfo' || (tag === 'FOOTER' && isPageLevel(element)))) {
    return 'footer';
  }

  return null;
}

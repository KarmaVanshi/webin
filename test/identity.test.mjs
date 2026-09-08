import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers.mjs';

import {
  buildIdentity, scoreCandidate, resolveIdentity, resolveAll,
  isStableClass, isStableId, domPathOf,
} from '../src/editor/identity.js';
import { CONFIDENCE_THRESHOLD } from '../src/shared/types.js';

/** Builds a document and hands back a lookup by selector. */
function page(html) {
  const dom = makeDom(`<html><body>${html}</body></html>`);
  return { dom, $: (sel) => dom.window.document.querySelector(sel), doc: dom.window.document };
}

// ─── What counts as a signal ────────────────────────────────────────────────

test('generated class names are not evidence of anything', () => {
  // These change on every build, so saving one is saving a timestamp.
  assert.equal(isStableClass('card'), true);
  assert.equal(isStableClass('product-card'), true);
  assert.equal(isStableClass('css-1x2y3z'), false, 'CSS modules');
  assert.equal(isStableClass('sc-bdVaJa'), false, 'styled-components');
  assert.equal(isStableClass('jsx-2847362'), false);
  assert.equal(isStableClass('px-[13px]'), false, 'Tailwind arbitrary value');
  assert.equal(isStableClass('a'), false, 'a single letter is a coincidence');
  assert.equal(isStableClass('button-a1b2c3d4'), false, 'trailing hash');
});

test('framework-generated ids are not evidence either', () => {
  assert.equal(isStableId('checkout-form'), true);
  assert.equal(isStableId('radix-:r1:'), false);
  assert.equal(isStableId('headlessui-menu-button-3'), false);
  assert.equal(isStableId(':r7:'), false);
  assert.equal(isStableId('mui-1234567890'), false);
});

// ─── Scoring ────────────────────────────────────────────────────────────────

test('a different tag is never the same element, whatever else matches', () => {
  const { $ } = page('<button class="buy">Buy now</button><a class="buy">Buy now</a>');
  const identity = buildIdentity($('button'));
  assert.equal(scoreCandidate($('a'), identity), 0);
});

test('the element it was built from scores perfectly', () => {
  const { $ } = page('<main><button class="buy" data-testid="buy">Buy now</button></main>');
  const button = $('button');
  assert.equal(scoreCandidate(button, buildIdentity(button)), 1);
});

test('an identity is scored on what it could carry, not on a fixed scale', () => {
  // An element at the top of a shadow root has no parentElement, so it has no parent
  // signature and its DOM path is a single tag. Scoring it out of 100 makes a *perfect*
  // match land near 0.5 and be thrown away — and sites built from web components are
  // exactly the ones people want to redesign.
  const { dom, doc } = page('<div id="host"></div>');
  const host = doc.getElementById('host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="card"><p>Only card</p></div>';
  const card = shadow.querySelector('.card');

  assert.equal(card.parentElement, null, 'nothing above it inside the root');
  assert.equal(domPathOf(card), 'div', 'so its path is a single tag');

  const identity = buildIdentity(card);
  assert.equal(identity.parentSignature, null);
  assert.equal(scoreCandidate(card, identity), 1, 'a perfect match must read as a perfect match');
  assert.ok(scoreCandidate(card, identity) >= CONFIDENCE_THRESHOLD);
  dom.window.close();
});

test('a tag and an index alone are still not enough to match on', () => {
  // The counterweight to the rule above: if an identity carries nothing but the two
  // signals every element has, scoring it against its own achievable total would make it
  // look certain. It is scored against the full scale instead, and fails.
  const { $ } = page('<section><div></div><div></div></section>');
  const bare = {
    tag: 'div', id: null, stableAttr: null, semanticAttr: null,
    classFingerprint: [], textFingerprint: null, parentSignature: null,
    domPath: null, positionHint: 0,
  };
  const score = scoreCandidate($('div'), bare);
  assert.ok(score < CONFIDENCE_THRESHOLD, `bare identity scored ${score}, which is too confident`);
});

// ─── Resolving ──────────────────────────────────────────────────────────────

test('a saved change finds its element again on the next visit', () => {
  const html = `<main>
    <article class="card"><h2>First</h2><button class="buy">Buy now</button></article>
    <article class="card"><h2>Second</h2><button class="buy">Buy now</button></article>
  </main>`;
  const first = page(html);
  const identity = buildIdentity(first.$('article:nth-child(2) button'));

  // A fresh load of the same page.
  const second = page(html);
  const found = resolveIdentity(second.doc, identity);
  assert.ok(found.element, 'the button was found');
  assert.equal(found.element, second.$('article:nth-child(2) button'), 'and it is the right one');
  assert.ok(found.confidence >= CONFIDENCE_THRESHOLD);
});

test('two elements that cannot be told apart are refused, not guessed between', () => {
  // Applying somebody's saved button width to the wrong button is worse than applying
  // nothing and saying so.
  const html = '<ul><li><span>Item</span></li><li><span>Item</span></li></ul>';
  const first = page(html);
  const identity = buildIdentity(first.$('li:nth-child(2) span'));
  identity.domPath = null;
  identity.parentSignature = null;
  identity.positionHint = 0;

  const second = page(html);
  const found = resolveIdentity(second.doc, identity);
  assert.equal(found.ambiguous, true, 'the signature does not distinguish them');
  assert.equal(found.element, null, 'so nothing is applied');
});

test('an element that is simply gone reports low confidence rather than a near-miss', () => {
  const identity = buildIdentity(page('<aside class="promo"><p>Sale</p></aside>').$('aside'));
  const after = page('<main><p>The promo has been removed from this page.</p></main>');
  const found = resolveIdentity(after.doc, identity);
  assert.equal(found.element, null);
  assert.ok(found.confidence < CONFIDENCE_THRESHOLD);
});

test('the extension never matches its own chrome', () => {
  const { doc, $ } = page('<div data-webin-owned><div class="wb-panel">Panel</div></div>');
  const identity = { ...buildIdentity($('.wb-panel')) };
  const found = resolveIdentity(doc, identity);
  assert.equal(found.element, null, 'the panel is not part of the page');
});

test('a shared candidate pool gives the same answer as scanning per change', () => {
  // Restoring a page resolves every saved change; scanning once per tag rather than once
  // per change is what keeps that from being O(changes x elements).
  const html = '<main><p id="a">One</p><p id="b">Two</p><p id="c">Three</p></main>';
  const first = page(html);
  const identity = buildIdentity(first.$('#b'));

  const second = page(html);
  const pool = [...second.doc.querySelectorAll('p')];
  assert.equal(
    resolveIdentity(second.doc, identity, { candidates: pool }).element,
    resolveIdentity(second.doc, identity).element,
  );
});

test('every element that matches well enough can be listed', () => {
  const { doc, $ } = page(`<main>
    <div class="card"><p>Same</p></div>
    <div class="card"><p>Same</p></div>
    <div class="other"><p>Different</p></div>
  </main>`);
  const identity = buildIdentity($('.card'));
  const all = resolveAll(doc, identity);
  assert.ok(all.length >= 2, 'both cards are candidates');
  assert.ok(all[0].confidence >= all[all.length - 1].confidence, 'best first');
});

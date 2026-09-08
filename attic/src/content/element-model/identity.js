/**
 * Element identity: multi-signal signatures and a scoring matcher (§34, §35, §36).
 *
 * Saving `.card` as a selector is the mistake this module exists to avoid — classes get
 * reused, regenerated and renamed. Instead every saved change carries several
 * independent signals, and reapplying it scores candidates rather than trusting one
 * selector. A low-scoring best candidate is reported as low confidence, never applied
 * silently (§85).
 */

import { normaliseText } from '../../shared/util.js';
import { WID_ATTR, OWNED_ATTR, CONFIDENCE_THRESHOLD } from '../../shared/types.js';

/** Attributes that identify an element far more reliably than its classes (§36). */
const STABLE_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-id', 'name'];
const SEMANTIC_ATTRS = ['aria-label', 'role', 'type', 'href', 'alt', 'title', 'placeholder'];

/** Weights from §35. Their sum is the denominator for confidence. */
export const WEIGHTS = Object.freeze({
  tag: 10,
  stableAttr: 30,
  parent: 20,
  text: 15,
  className: 10,
  position: 5,
  domPath: 10,
});

const MAX_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Classes that look machine-generated, and so are worthless as a saved signal:
 * CSS-modules hashes, styled-components ids, Tailwind JIT arbitrary values, emotion.
 */
export function isStableClass(name) {
  if (!name || name.length > 40) return false;
  if (/^(css|sc|jsx|emotion|chakra)-/i.test(name)) return false;
  if (/^[\w-]*[a-f0-9]{6,}$/i.test(name)) return false;   // trailing hash
  if (/\d{4,}/.test(name)) return false;                   // long digit runs
  if (/[[\]()#%!/]/.test(name)) return false;              // Tailwind arbitrary values
  if (/^[a-z]$/i.test(name)) return false;                 // single letters
  return true;
}

/** An id is only useful when it is not itself generated. */
export function isStableId(id) {
  if (!id || id.length > 60) return false;
  if (/^(radix|headlessui|react-aria|mui|:r)/i.test(id)) return false;
  if (/^[\w-]*[a-f0-9]{8,}$/i.test(id)) return false;
  if (/\d{5,}/.test(id)) return false;
  return true;
}

/** Structural path from the root, used as one signal among several (§36). */
export function domPathOf(element) {
  const parts = [];
  let node = element;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 40) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html') {
      parts.unshift(tag);
      break;
    }
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
    parts.unshift(sameTag.length > 1 ? `${tag}:${sameTag.indexOf(node) + 1}` : tag);
    node = parent;
    depth += 1;
  }
  return parts.join('>');
}

/** A compact description of the parent, so siblings in different containers differ. */
export function parentSignatureOf(element) {
  const parent = element.parentElement;
  if (!parent) return null;
  const classes = stableClassesOf(parent).slice(0, 2);
  const id = isStableId(parent.id) ? `#${parent.id}` : '';
  return `${parent.tagName.toLowerCase()}${id}${classes.map((c) => `.${c}`).join('')}`;
}

/** The element's own stable classes, sorted so ordering changes do not break matching. */
export function stableClassesOf(element) {
  const list = typeof element.className === 'string'
    ? element.className.split(/\s+/)
    : [...(element.classList ?? [])];
  return list.filter(Boolean).filter(isStableClass).sort();
}

/** Leading text, normalised and capped — enough to tell "Buy now" from "Add to cart". */
export function textFingerprintOf(element) {
  const text = normaliseText(element.textContent);
  if (!text || text.length > 200) return null;
  return text.slice(0, 60).toLowerCase() || null;
}

function firstAttr(element, names) {
  for (const name of names) {
    const value = element.getAttribute?.(name);
    if (value != null && value !== '' && value.length <= 120) return `${name}=${value}`;
  }
  return null;
}

/**
 * Builds the saved signature for an element (§35).
 * @param {Element} element
 * @returns {import('../../shared/types.js').Identity}
 */
export function buildIdentity(element) {
  return {
    tag: element.tagName.toLowerCase(),
    id: isStableId(element.id) ? element.id : null,
    stableAttr: firstAttr(element, STABLE_ATTRS),
    semanticAttr: firstAttr(element, SEMANTIC_ATTRS),
    classFingerprint: stableClassesOf(element),
    textFingerprint: textFingerprintOf(element),
    parentSignature: parentSignatureOf(element),
    domPath: domPathOf(element),
    positionHint: positionHintOf(element),
  };
}

/** Index among same-tag siblings (§35 "relative position"). */
export function positionHintOf(element) {
  const parent = element.parentElement;
  if (!parent) return 0;
  return [...parent.children].filter((c) => c.tagName === element.tagName).indexOf(element);
}

/**
 * Scores how well `element` matches a saved identity.
 * @returns {number} 0..1
 */
export function scoreCandidate(element, identity) {
  let score = 0;

  if (element.tagName.toLowerCase() === identity.tag) score += WEIGHTS.tag;
  else return 0; // A different tag is never the same element.

  if (identity.id && element.id === identity.id) score += WEIGHTS.stableAttr;
  else if (identity.stableAttr && firstAttr(element, STABLE_ATTRS) === identity.stableAttr) score += WEIGHTS.stableAttr;
  else if (identity.semanticAttr && firstAttr(element, SEMANTIC_ATTRS) === identity.semanticAttr) {
    score += WEIGHTS.stableAttr * 0.5;
  }

  if (identity.parentSignature && parentSignatureOf(element) === identity.parentSignature) score += WEIGHTS.parent;

  if (identity.textFingerprint) {
    const text = textFingerprintOf(element);
    if (text === identity.textFingerprint) score += WEIGHTS.text;
    else if (text && identity.textFingerprint.startsWith(text.slice(0, 12))) score += WEIGHTS.text * 0.4;
  }

  const saved = identity.classFingerprint ?? [];
  if (saved.length) {
    const current = stableClassesOf(element);
    const shared = saved.filter((c) => current.includes(c)).length;
    score += WEIGHTS.className * (shared / saved.length);
  }

  if (positionHintOf(element) === identity.positionHint) score += WEIGHTS.position;
  if (identity.domPath && domPathOf(element) === identity.domPath) score += WEIGHTS.domPath;

  return score / MAX_SCORE;
}

/**
 * Finds the element a saved change refers to (§35, §85).
 *
 * Search is narrowed by tag first, so this stays cheap on large pages (§72). Extension-
 * owned nodes are never candidates.
 *
 * @returns {{element:Element|null, confidence:number, ambiguous:boolean}}
 */
export function resolveIdentity(root, identity, { threshold = CONFIDENCE_THRESHOLD } = {}) {
  if (!identity?.tag) return { element: null, confidence: 0, ambiguous: false };

  // Fast path: a stable id that still resolves to the right tag.
  if (identity.id) {
    const byId = root.getElementById?.(identity.id) ?? root.querySelector?.(`#${CSS.escape(identity.id)}`);
    if (byId && byId.tagName.toLowerCase() === identity.tag && !isOwned(byId)) {
      return { element: byId, confidence: Math.max(scoreCandidate(byId, identity), 0.9), ambiguous: false };
    }
  }

  let candidates;
  try {
    candidates = [...root.querySelectorAll(identity.tag)];
  } catch {
    return { element: null, confidence: 0, ambiguous: false };
  }

  let best = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const candidate of candidates) {
    if (isOwned(candidate)) continue;
    const score = scoreCandidate(candidate, identity);
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // Two candidates scoring the same means the signature does not actually distinguish
  // them; applying to either would be a guess (§85 step 5).
  const ambiguous = best != null && bestScore > 0 && Math.abs(bestScore - runnerUp) < 0.02;
  if (!best || bestScore < threshold || ambiguous) {
    return { element: bestScore >= threshold ? best : null, confidence: bestScore, ambiguous };
  }
  return { element: best, confidence: bestScore, ambiguous: false };
}

/** Every element scoring above the threshold — backs "apply to similar elements" (§48, §90). */
export function resolveAll(root, identity, { threshold = CONFIDENCE_THRESHOLD } = {}) {
  let candidates;
  try {
    candidates = [...root.querySelectorAll(identity.tag)];
  } catch {
    return [];
  }
  return candidates
    .filter((el) => !isOwned(el))
    .map((element) => ({ element, confidence: scoreCandidate(element, identity) }))
    .filter((c) => c.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);
}

/** True for nodes the extension created — they must never be inspected or matched. */
export function isOwned(element) {
  return Boolean(element?.closest?.(`[${OWNED_ATTR}], [${WID_ATTR}-host]`));
}

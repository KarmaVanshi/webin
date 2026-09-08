/**
 * Reads the live computed style into the groups the Inspector renders (§28, §60).
 *
 * Grouped rather than flat because the panel is organised by intent — Layout, Spacing,
 * Typography, Appearance — and because reading only what a section needs keeps property
 * access off the hot path when a section is collapsed (§72).
 */

import { parseBox, parseShadow } from '../shared/css-values.js';
import { normaliseColor } from '../shared/color.js';

/** One `getComputedStyle` call, reused by every group below. */
export function readComputed(element, view = window) {
  return view.getComputedStyle(element);
}

export function layoutGroup(style, element, view = window) {
  const rect = element.getBoundingClientRect();
  return {
    display: style.display,
    position: style.position,
    width: round(rect.width),
    height: round(rect.height),
    declaredWidth: style.width,
    declaredHeight: style.height,
    minWidth: style.minWidth,
    maxWidth: style.maxWidth,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
    boxSizing: style.boxSizing,
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    zIndex: style.zIndex,
    float: style.float,
    top: style.top, right: style.right, bottom: style.bottom, left: style.left,
    aspectRatio: style.aspectRatio,
  };
}

export function spacingGroup(style) {
  return {
    margin: parseBox(style.marginTop, style.marginRight, style.marginBottom, style.marginLeft),
    padding: parseBox(style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft),
    gap: style.gap,
    rowGap: style.rowGap,
    columnGap: style.columnGap,
  };
}

export function typographyGroup(style) {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing,
    textAlign: style.textAlign,
    textTransform: style.textTransform,
    textDecorationLine: style.textDecorationLine ?? style.textDecoration,
    whiteSpace: style.whiteSpace,
    color: normaliseColor(style.color) ?? style.color,
  };
}

export function appearanceGroup(style) {
  return {
    backgroundColor: normaliseColor(style.backgroundColor) ?? style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundSize: style.backgroundSize,
    backgroundPosition: style.backgroundPosition,
    backgroundRepeat: style.backgroundRepeat,
    opacity: style.opacity,
    borderStyle: style.borderTopStyle,
    borderWidth: parseBox(style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth),
    borderColor: normaliseColor(style.borderTopColor) ?? style.borderTopColor,
    radius: {
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
    },
    boxShadow: style.boxShadow === 'none' ? null : style.boxShadow,
    shadow: parseShadow(style.boxShadow),
    filter: style.filter === 'none' ? null : style.filter,
    transform: style.transform === 'none' ? null : style.transform,
  };
}

/** Read-only animation and transition facts (§108). */
export function motionGroup(style) {
  if (style.animationName === 'none' && style.transitionProperty === 'all' && style.transitionDuration === '0s') {
    return null;
  }
  return {
    animationName: style.animationName,
    animationDuration: style.animationDuration,
    animationTimingFunction: style.animationTimingFunction,
    animationIterationCount: style.animationIterationCount,
    transitionProperty: style.transitionProperty,
    transitionDuration: style.transitionDuration,
  };
}

/** SVG-specific properties, only meaningful inside an <svg> (§104). */
export function svgGroup(style, element) {
  if (!isSvg(element)) return null;
  return {
    fill: normaliseColor(style.fill) ?? style.fill,
    stroke: normaliseColor(style.stroke) ?? style.stroke,
    strokeWidth: style.strokeWidth,
    viewBox: element.getAttribute?.('viewBox') ?? null,
  };
}

/** Image-specific properties (§105). */
export function imageGroup(style, element) {
  const tag = element.tagName.toLowerCase();
  if (tag !== 'img' && tag !== 'video' && style.backgroundImage === 'none') return null;
  return {
    objectFit: style.objectFit,
    objectPosition: style.objectPosition,
    naturalWidth: element.naturalWidth ?? null,
    naturalHeight: element.naturalHeight ?? null,
    src: element.currentSrc ?? element.src ?? null,
    alt: element.getAttribute?.('alt') ?? null,
  };
}

/** Accessibility facts the editor must avoid destroying (§106). */
export function accessibilityGroup(element) {
  const attrs = {};
  for (const name of ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'alt', 'title', 'tabindex']) {
    const value = element.getAttribute?.(name);
    if (value != null) attrs[name] = value;
  }
  return {
    attributes: attrs,
    focusable: isFocusable(element),
    accessibleName: accessibleNameOf(element),
  };
}

export function isSvg(element) {
  return element.namespaceURI === 'http://www.w3.org/2000/svg';
}

function isFocusable(element) {
  const tag = element.tagName.toLowerCase();
  if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return !element.disabled;
  const tabindex = element.getAttribute?.('tabindex');
  return tabindex != null && tabindex !== '-1';
}

/** Best-effort accessible name — enough to warn when an edit would erase it. */
function accessibleNameOf(element) {
  return (
    element.getAttribute?.('aria-label') ||
    element.getAttribute?.('alt') ||
    element.getAttribute?.('title') ||
    (element.textContent ?? '').trim().slice(0, 60) ||
    null
  );
}

/** Everything the Inspector needs for a selected element, in one pass. */
export function readAll(element, view = window) {
  const style = readComputed(element, view);
  return {
    layout: layoutGroup(style, element, view),
    spacing: spacingGroup(style),
    typography: typographyGroup(style),
    appearance: appearanceGroup(style),
    motion: motionGroup(style),
    svg: svgGroup(style, element),
    image: imageGroup(style, element),
    accessibility: accessibilityGroup(element),
  };
}

const round = (n) => Math.round(n * 100) / 100;

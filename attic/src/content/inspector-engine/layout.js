/**
 * Layout context analysis (§12, §15, §16, §115).
 *
 * The editor must know what "move this 10px right" *means* before it writes anything.
 * In a flex row it may mean `order` or `margin-left`; in a grid it means a column
 * change; only in a positioned context does it mean `left`. Getting this wrong is how
 * a visual editor destroys a responsive layout (§12).
 */

export const LayoutKind = Object.freeze({
  FLEX: 'flex',
  GRID: 'grid',
  BLOCK: 'block',
  INLINE: 'inline',
  INLINE_BLOCK: 'inline-block',
  TABLE: 'table',
  ABSOLUTE: 'absolute',
  FIXED: 'fixed',
  STICKY: 'sticky',
});

/** How the element itself lays its own children out. */
export function selfLayout(style) {
  const display = style.display;
  if (display.includes('grid')) return LayoutKind.GRID;
  if (display.includes('flex')) return LayoutKind.FLEX;
  if (display.includes('table')) return LayoutKind.TABLE;
  if (display === 'inline') return LayoutKind.INLINE;
  if (display === 'inline-block') return LayoutKind.INLINE_BLOCK;
  return LayoutKind.BLOCK;
}

/** How the element is positioned by whatever contains it. */
export function positionKind(style) {
  switch (style.position) {
    case 'absolute': return LayoutKind.ABSOLUTE;
    case 'fixed': return LayoutKind.FIXED;
    case 'sticky': return LayoutKind.STICKY;
    default: return null;
  }
}

/**
 * Full layout context for a selected element.
 * @returns {{self:string, position:string, parentLayout:string|null, isFlexChild:boolean,
 *            isGridChild:boolean, isPositioned:boolean, flex:object|null, grid:object|null,
 *            child:object|null}}
 */
export function analyse(element, view = window) {
  const style = view.getComputedStyle(element);
  const parent = element.parentElement;
  const parentStyle = parent ? view.getComputedStyle(parent) : null;
  const parentLayout = parentStyle ? selfLayout(parentStyle) : null;

  const isFlexChild = parentLayout === LayoutKind.FLEX;
  const isGridChild = parentLayout === LayoutKind.GRID;
  const position = style.position;

  return {
    self: selfLayout(style),
    position,
    positionKind: positionKind(style),
    parentLayout,
    isFlexChild,
    isGridChild,
    isPositioned: position === 'absolute' || position === 'fixed' || position === 'relative' || position === 'sticky',
    flex: selfLayout(style) === LayoutKind.FLEX ? flexContainer(style) : null,
    grid: selfLayout(style) === LayoutKind.GRID ? gridContainer(style) : null,
    child: isFlexChild ? flexChild(style) : isGridChild ? gridChild(style) : null,
    parentFlex: isFlexChild && parentStyle ? flexContainer(parentStyle) : null,
    parentGrid: isGridChild && parentStyle ? gridContainer(parentStyle) : null,
  };
}

/** Container-side flex properties (§15). */
export function flexContainer(style) {
  return {
    direction: style.flexDirection,
    wrap: style.flexWrap,
    justifyContent: style.justifyContent,
    alignItems: style.alignItems,
    alignContent: style.alignContent,
    gap: style.gap === 'normal' ? '0px' : style.gap,
    rowGap: style.rowGap === 'normal' ? '0px' : style.rowGap,
    columnGap: style.columnGap === 'normal' ? '0px' : style.columnGap,
  };
}

/** Child-side flex properties (§15). */
export function flexChild(style) {
  return {
    flexGrow: style.flexGrow,
    flexShrink: style.flexShrink,
    flexBasis: style.flexBasis,
    alignSelf: style.alignSelf,
    order: style.order,
  };
}

/** Container-side grid properties (§16). */
export function gridContainer(style) {
  return {
    templateColumns: style.gridTemplateColumns,
    templateRows: style.gridTemplateRows,
    columnGap: style.columnGap === 'normal' ? '0px' : style.columnGap,
    rowGap: style.rowGap === 'normal' ? '0px' : style.rowGap,
    justifyItems: style.justifyItems,
    alignItems: style.alignItems,
    columnCount: countTracks(style.gridTemplateColumns),
    rowCount: countTracks(style.gridTemplateRows),
  };
}

/** Child-side grid placement (§16). */
export function gridChild(style) {
  return {
    columnStart: style.gridColumnStart,
    columnEnd: style.gridColumnEnd,
    rowStart: style.gridRowStart,
    rowEnd: style.gridRowEnd,
    justifySelf: style.justifySelf,
    alignSelf: style.alignSelf,
  };
}

/**
 * Track count for a grid template.
 *
 * Splits on whitespace at paren depth zero, so `minmax(0, 1fr)` and `repeat(3, 1fr)`
 * each count as the single token they are. In practice getComputedStyle resolves
 * templates to a pixel list, but a declared value read from the cascade will not be.
 */
export function countTracks(template) {
  if (!template || template === 'none') return 0;
  let depth = 0;
  let tokens = 0;
  let inToken = false;
  for (const ch of String(template).trim()) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);

    const isSpace = depth === 0 && /\s/.test(ch);
    if (isSpace) {
      inToken = false;
    } else if (!inToken) {
      inToken = true;
      tokens += 1;
    }
  }
  return tokens;
}

/**
 * What visual movement means here (§12).
 * The editor asks this before a drag, and writes the smallest set of properties that
 * expresses the gesture in the element's own layout language.
 */
export function movementStrategy(context) {
  if (context.positionKind === LayoutKind.ABSOLUTE || context.positionKind === LayoutKind.FIXED) {
    return { kind: 'offset', properties: ['left', 'top'], reason: 'Element is positioned; move by its own offsets.' };
  }
  if (context.position === 'relative') {
    return { kind: 'offset', properties: ['left', 'top'], reason: 'Relative element; nudge with offsets, flow is preserved.' };
  }
  if (context.isGridChild) {
    return { kind: 'grid', properties: ['grid-column-start', 'grid-row-start'], reason: 'Grid item; move between tracks.' };
  }
  if (context.isFlexChild) {
    return { kind: 'flex-order', properties: ['order', 'margin-left', 'margin-top'], reason: 'Flex item; reorder or adjust margins.' };
  }
  return { kind: 'margin', properties: ['margin-left', 'margin-top'], reason: 'In normal flow; shift with margins.' };
}

/**
 * What alignment means here (§14).
 * Prefers the parent's own alignment properties over absolute positioning.
 */
export function alignmentStrategy(context) {
  if (context.isFlexChild) {
    const row = (context.parentFlex?.direction ?? 'row').startsWith('row');
    return {
      kind: 'flex',
      horizontal: row ? { property: 'justify-content', onParent: true } : { property: 'align-self', onParent: false },
      vertical: row ? { property: 'align-self', onParent: false } : { property: 'justify-content', onParent: true },
    };
  }
  if (context.isGridChild) {
    return {
      kind: 'grid',
      horizontal: { property: 'justify-self', onParent: false },
      vertical: { property: 'align-self', onParent: false },
    };
  }
  return {
    kind: 'flow',
    horizontal: { property: 'margin', onParent: false },
    vertical: { property: 'margin', onParent: false },
  };
}

/** Whether resizing this element is meaningful, and on which axes (§11). */
export function resizeCapability(context, style) {
  const inline = context.self === LayoutKind.INLINE;
  return {
    horizontal: !inline,
    vertical: !inline && style.display !== 'inline',
    reason: inline ? 'Inline elements take their size from their content.' : null,
  };
}

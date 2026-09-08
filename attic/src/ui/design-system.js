/**
 * Themes and Design System panel (§49, §87).
 *
 * Two halves, in the order a user needs them:
 *   - **Themes** — a gallery of one-click reskins, plus capturing the current page as a
 *     reusable theme of your own.
 *   - **Tokens** — what the page's design system actually *is*: the palette it really
 *     uses, with usage weights, its type scale, spacing rhythm and radii.
 *
 * The token half is not decoration. It is the explanation of why a theme does what it
 * does, since a theme is a remapping of exactly these values.
 */

import { escapeHtml, truncate } from '../shared/util.js';
import { icon } from './icons.js';
import { button, emptyState, section } from './controls.js';
import { parseColor, luminance } from '../shared/color.js';
import { Role } from '../content/design-system/tokens.js';

const ROLE_LABELS = {
  [Role.BACKGROUND]: 'Background',
  [Role.SURFACE]: 'Surface',
  [Role.TEXT]: 'Text',
  [Role.TEXT_MUTED]: 'Muted text',
  [Role.ACCENT]: 'Accent',
  [Role.BORDER]: 'Border',
};

/**
 * @param {{themes:Array, activeThemeId:string|null, tokens:object|null, scanning:boolean}} state
 */
export function renderDesignSystem(state) {
  const { themes, activeThemeId, tokens, scanning } = state;

  if (scanning) {
    return `<div class="widt-empty"><span class="widt-empty-icon">${icon('inspect', 22)}</span>
      <p class="widt-empty-title">Reading this page…</p>
      <p class="widt-empty-body">Working out which colours, sizes and spacing it actually uses.</p></div>`;
  }

  if (!tokens) {
    return emptyState({
      iconName: 'target',
      title: 'Nothing scanned yet',
      body: 'Scan this page to find the colours, type sizes and spacing it uses. Themes remap exactly those values.',
    }) + `<div style="padding:0 var(--space-5) var(--space-5)">
      ${button({ label: 'Scan this page', action: 'detect-tokens', name: 'inspect', variant: 'primary' })}</div>`;
  }

  return [
    themeBar(activeThemeId),
    section({ id: 'themes', title: 'Themes', open: true, body: gallery(themes, activeThemeId) }),
    section({ id: 'palette', title: 'Palette', open: true, body: paletteBody(tokens) }),
    section({ id: 'type', title: 'Type scale', open: false, body: typeBody(tokens) }),
    section({ id: 'rhythm', title: 'Spacing & radius', open: false, body: rhythmBody(tokens) }),
    footer(tokens),
  ].join('');
}

function themeBar(activeThemeId) {
  return `
<div style="display:flex;gap:var(--space-2);padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--hairline)">
  ${button({ label: 'Save page as theme', action: 'save-theme', name: 'plus' })}
  <span style="flex:1"></span>
  ${button({ label: 'Clear', action: 'clear-theme', name: 'reset', variant: 'danger', disabled: !activeThemeId })}
</div>`;
}

/** Theme cards. Each preview is built from the theme's own palette — no images. */
function gallery(themes, activeThemeId) {
  if (!themes.length) return '<p class="widt-hint">No themes available.</p>';
  return `<div class="widt-theme-grid">${themes.map((theme) => themeCard(theme, theme.id === activeThemeId)).join('')}</div>`;
}

function themeCard(theme, active) {
  const p = theme.palette;
  return `
<button type="button" class="widt-theme-card${active ? ' is-on' : ''}" data-interactive
  data-action="apply-theme" data-value="${escapeHtml(theme.id)}"
  aria-pressed="${active}" title="${escapeHtml(theme.description ?? theme.name)}">
  <span class="widt-theme-preview" style="background:${escapeHtml(p.background)};border-color:${escapeHtml(p.border)}">
    <span class="widt-theme-bar" style="background:${escapeHtml(p.surface)};border-color:${escapeHtml(p.border)}">
      <span class="widt-theme-line" style="background:${escapeHtml(p.text)};width:38%"></span>
      <span class="widt-theme-pill" style="background:${escapeHtml(p.accent)}"></span>
    </span>
    <span class="widt-theme-line" style="background:${escapeHtml(p.text)};width:70%"></span>
    <span class="widt-theme-line" style="background:${escapeHtml(p.textMuted)};width:52%"></span>
    <span class="widt-theme-line" style="background:${escapeHtml(p.textMuted)};width:60%"></span>
  </span>
  <span class="widt-theme-name">${escapeHtml(theme.name)}
    ${theme.custom ? '<span class="widt-badge widt-badge--dim">Yours</span>' : ''}
    ${active ? `<span class="widt-theme-check">${icon('check', 12)}</span>` : ''}</span>
</button>`;
}

/** The page's real palette, with the role each colour was found to play. */
function paletteBody(tokens) {
  const roles = tokens.roles ?? {};
  const byValue = new Map();
  for (const [role, value] of Object.entries(roles)) {
    if (value) byValue.set(value, ROLE_LABELS[role] ?? role);
  }

  const swatches = [...tokens.backgrounds, ...tokens.colors, ...tokens.borders]
    .filter((token, index, list) => list.findIndex((t) => t.value === token.value) === index)
    .slice(0, 16)
    .map((token) => swatch(token, byValue.get(token.value)))
    .join('');

  return `<div class="widt-swatch-grid">${swatches}</div>
    <p class="widt-hint">Weight is how much of the page each colour actually paints — area for
    surfaces, characters for text. A theme remaps these values, which is why it re-skins the
    page instead of flattening it.</p>`;
}

function swatch(token, role) {
  const parsed = parseColor(token.value);
  const light = parsed ? luminance(parsed) > 0.5 : false;
  return `
<div class="widt-swatch-item" title="${escapeHtml(token.value)} · ${token.count} element${token.count === 1 ? '' : 's'}">
  <span class="widt-swatch-chip" style="background:${escapeHtml(token.value)};
    border-color:${light ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.25)'}"></span>
  <span class="widt-swatch-meta">
    <span class="widt-mono widt-swatch-value">${escapeHtml(truncate(token.value, 18))}</span>
    ${role ? `<span class="widt-badge widt-badge--accent">${escapeHtml(role)}</span>`
           : `<span class="widt-swatch-count widt-mono">${token.count}×</span>`}
  </span>
</div>`;
}

function typeBody(tokens) {
  if (!tokens.sizes.length) return '<p class="widt-hint">No text found on this page.</p>';
  const sizes = tokens.sizes.map((token) => `
    <div class="widt-scale-row">
      <span class="widt-scale-sample" style="font-size:${Math.min(token.value, 28)}px">Ag</span>
      <span class="widt-mono widt-scale-value">${token.value}px</span>
      <span class="widt-scale-bar"><span style="width:${barWidth(token, tokens.sizes)}%"></span></span>
    </div>`).join('');

  const families = tokens.fonts.map((f) =>
    `<code class="widt-badge widt-badge--dim">${escapeHtml(truncate(f.value, 24))}</code>`).join(' ');
  const weights = tokens.weights.map((w) =>
    `<code class="widt-badge widt-badge--dim">${w.value}</code>`).join(' ');

  return `${sizes}
    <div class="widt-row" style="margin-top:var(--space-4)"><span class="widt-label">Families</span>
      <div class="widt-field" style="flex-wrap:wrap;gap:3px">${families || '—'}</div></div>
    <div class="widt-row"><span class="widt-label">Weights</span>
      <div class="widt-field" style="flex-wrap:wrap;gap:3px">${weights || '—'}</div></div>`;
}

function rhythmBody(tokens) {
  const spacing = tokens.spacing.length
    ? tokens.spacing.map((token) => `
      <div class="widt-scale-row">
        <span class="widt-space-sample" style="width:${Math.min(token.value, 64)}px"></span>
        <span class="widt-mono widt-scale-value">${token.value}px</span>
        <span class="widt-scale-bar"><span style="width:${barWidth(token, tokens.spacing)}%"></span></span>
      </div>`).join('')
    : '<p class="widt-hint">No spacing values detected.</p>';

  const radii = tokens.radii.length
    ? tokens.radii.map((token) => `
      <div class="widt-scale-row">
        <span class="widt-radius-sample" style="border-radius:${Math.min(token.value, 20)}px"></span>
        <span class="widt-mono widt-scale-value">${token.value}px</span>
        <span class="widt-scale-bar"><span style="width:${barWidth(token, tokens.radii)}%"></span></span>
      </div>`).join('')
    : '<p class="widt-hint">This page uses square corners.</p>';

  return `<p class="widt-label" style="margin-bottom:var(--space-2)">Spacing</p>${spacing}
    <p class="widt-label" style="margin:var(--space-5) 0 var(--space-2)">Radius</p>${radii}`;
}

function footer(tokens) {
  return `<div style="padding:var(--space-4) var(--space-5);border-top:1px solid var(--hairline)">
    <p class="widt-hint" style="margin:0">Scanned ${tokens.scanned} elements.
      ${button({ label: 'Rescan', action: 'detect-tokens', name: 'reset' })}</p></div>`;
}

function barWidth(token, list) {
  const max = Math.max(...list.map((t) => t.weight), 1);
  return Math.max(4, Math.round((token.weight / max) * 100));
}

export const designSystemCss = /* css */ `
.widt-theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }

.widt-theme-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  text-align: left;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.widt-theme-card:hover { border-color: var(--border); background: var(--muted); }
.widt-theme-card.is-on { border-color: var(--accent); background: var(--accent-dim); }

.widt-theme-preview {
  display: flex;
  flex-direction: column;
  gap: 3px;
  height: 54px;
  padding: 5px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.widt-theme-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 3px 4px;
  margin-bottom: 2px;
  border: 1px solid;
  border-radius: 2px;
}
.widt-theme-line { height: 3px; border-radius: 2px; opacity: 0.85; }
.widt-theme-pill { width: 16px; height: 6px; border-radius: 3px; flex: none; }

.widt-theme-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--fg);
}
.widt-theme-check { margin-left: auto; color: var(--accent); display: inline-flex; }

.widt-swatch-grid { display: grid; gap: var(--space-2); }
.widt-swatch-item { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.widt-swatch-chip { flex: none; width: 22px; height: 22px; border: 1px solid; border-radius: var(--radius-sm); }
.widt-swatch-meta { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; }
.widt-swatch-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--fg-muted); }
.widt-swatch-count { flex: none; color: var(--fg-dim); font-size: 10px; }

.widt-scale-row { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); }
.widt-scale-sample { flex: none; width: 34px; color: var(--fg); line-height: 1; overflow: hidden; }
.widt-scale-value { flex: none; width: 42px; color: var(--fg-muted); font-size: var(--text-micro); }
.widt-scale-bar { flex: 1; min-width: 0; height: 4px; background: var(--muted); border-radius: 2px; overflow: hidden; }
.widt-scale-bar span { display: block; height: 100%; background: var(--selection); border-radius: 2px; }
.widt-space-sample { flex: none; height: 10px; background: var(--selection-soft); border-left: 2px solid var(--selection); border-right: 2px solid var(--selection); }
.widt-radius-sample { flex: none; width: 24px; height: 20px; background: var(--muted); border: 1px solid var(--border); }
`;

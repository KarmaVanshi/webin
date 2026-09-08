import test from 'node:test';
import assert from 'node:assert/strict';

import { sniffFormat, adaptForeignThemes, readColorValue } from '../src/shared/foreign-themes.js';
import { parseThemeInput } from '../src/shared/theme-format.js';
import { parseColor, toHex, contrastRatio } from '../src/shared/color.js';

/** What the importer actually produces: adapted, then validated, exactly as the app does. */
function importAll(text, name = 'Test') {
  return parseThemeInput(text, null, { name });
}

// ─── shadcn / Tailwind ──────────────────────────────────────────────────────

// The form shadcn shipped for years: bare HSL triplets that the stylesheet wraps.
const SHADCN_HSL = `
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --accent: 210 40% 96.1%;
    --border: 214.3 31.8% 91.4%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 6.9%;
    --muted-foreground: 215 20.2% 65.1%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --border: 217.2 32.6% 17.5%;
  }
}`;

test('shadcn bare HSL triplets are read as colours', () => {
  assert.equal(readColorValue('0 0% 100%'), '#ffffff');
  assert.equal(readColorValue('222.2 84% 4.9%'), '#020817');
  assert.equal(readColorValue('nonsense'), null);
});

test('a shadcn theme imports, light and dark both', () => {
  const { themes, error, source } = importAll(SHADCN_HSL, 'Acme');
  assert.equal(error, null);
  assert.equal(source, 'css-vars');
  assert.equal(themes.length, 2, 'the :root block and the .dark block are two themes');

  const [light, dark] = themes;
  assert.equal(light.palette.background, '#ffffff');
  assert.equal(light.palette.text, '#020817');
  assert.equal(light.radius, 8, '0.5rem');
  assert.equal(light.dark, false);

  assert.match(dark.name, /Dark$/);
  assert.equal(dark.dark, true);
  assert.equal(dark.palette.background, '#020817');
});

test('the brand colour is --primary, not shadcn’s --accent', () => {
  // This is the whole reason role inference is ordered. shadcn's `--accent` is a muted
  // hover fill; taking it as the brand turns every imported theme grey.
  const { themes } = importAll(SHADCN_HSL, 'Acme');
  const accent = parseColor(themes[0].palette.accent);
  const muted = parseColor(readColorValue('210 40% 96.1%'));
  assert.notDeepEqual(accent, muted, 'the pale hover fill must not become the brand');
  assert.equal(toHex(accent), '#2563eb', 'blue-600, which is what --primary says');
});

test('caption colour comes from --muted-foreground, not --muted', () => {
  const { themes } = importAll(SHADCN_HSL, 'Acme');
  assert.equal(themes[0].palette.textMuted, '#64748b');
});

test('a palette written in oklch imports the same way', () => {
  // Current shadcn and DaisyUI v5 both ship oklch.
  const css = `:root {
    --color-base-100: oklch(100% 0 0);
    --color-base-200: oklch(96% 0.001 286);
    --color-base-300: oklch(92% 0.004 286);
    --color-base-content: oklch(21% 0.006 286);
    --color-primary: oklch(70% 0.213 47.6);
    --color-primary-content: oklch(98% 0.016 73.7);
    --radius-box: 1rem;
  }`;
  const { themes, error } = importAll(css, 'Daisy');
  assert.equal(error, null);
  assert.equal(themes.length, 1);
  assert.equal(themes[0].palette.background, '#ffffff');
  assert.equal(themes[0].palette.text, '#18181b');
  assert.equal(themes[0].radius, 16);
});

// ─── VS Code ────────────────────────────────────────────────────────────────

const VSCODE = JSON.stringify({
  name: 'Night Owl',
  type: 'dark',
  colors: {
    'editor.background': '#011627',
    'editor.foreground': '#d6deeb',
    'sideBar.background': '#011021',
    'descriptionForeground': '#637777',
    'button.background': '#7e57c2',
    'button.foreground': '#ffffff',
    'panel.border': '#122d42',
  },
  tokenColors: [{ scope: 'comment', settings: { foreground: '#637777' } }],
});

test('a VS Code colour theme becomes a page theme', () => {
  const { themes, error, source } = importAll(VSCODE);
  assert.equal(error, null);
  assert.equal(source, 'vscode');
  const theme = themes[0];
  assert.equal(theme.name, 'Night Owl', 'the file names itself');
  assert.equal(theme.dark, true);
  assert.equal(theme.palette.background, '#011627');
  assert.equal(theme.palette.surface, '#011021');
  assert.equal(theme.palette.text, '#d6deeb');
  assert.equal(theme.palette.accent, '#7e57c2');
  assert.equal(theme.palette.border, '#122d42');
});

// ─── base16 ─────────────────────────────────────────────────────────────────

test('a base16 scheme maps by position, with nothing left to guess', () => {
  const json = JSON.stringify({
    scheme: 'Gruvbox dark', author: 'Dawid Kurek',
    base00: '282828', base01: '3c3836', base02: '504945', base03: '665c54',
    base04: 'bdae93', base05: 'd5c4a1', base0D: '83a598',
  });
  const { themes, source } = importAll(json);
  assert.equal(source, 'base16');
  const theme = themes[0];
  assert.equal(theme.name, 'Gruvbox dark');
  assert.equal(theme.author, 'Dawid Kurek');
  assert.equal(theme.palette.background, '#282828');
  assert.equal(theme.palette.surface, '#3c3836');
  assert.equal(theme.palette.text, '#d5c4a1');
  assert.equal(theme.palette.accent, '#83a598');
  assert.equal(theme.dark, true, 'inferred from the canvas, which is nearly black');
});

test('base16 in YAML works too, since that is how they are published', () => {
  const yaml = `scheme: "Solarized Light"\nauthor: "Ethan Schoonover"\nbase00: "fdf6e3"\nbase01: "eee8d5"\nbase02: "93a1a1"\nbase03: "839496"\nbase05: "586e75"\nbase0D: "268bd2"\n`;
  assert.equal(sniffFormat(yaml), 'base16');
  const { themes } = importAll(yaml);
  assert.equal(themes[0].name, 'Solarized Light');
  assert.equal(themes[0].palette.background, '#fdf6e3');
  assert.equal(themes[0].dark, false);
});

// ─── Terminal ───────────────────────────────────────────────────────────────

test('a Windows Terminal file can carry a whole shelf of schemes', () => {
  const json = JSON.stringify({
    schemes: [
      { name: 'Campbell', background: '#0C0C0C', foreground: '#CCCCCC', black: '#0C0C0C', blue: '#0037DA', brightBlack: '#767676' },
      { name: 'Tango Light', background: '#FFFFFF', foreground: '#000000', black: '#000000', blue: '#3465A4', brightBlack: '#555753' },
    ],
  });
  const { themes, source } = importAll(json);
  assert.equal(source, 'terminal');
  assert.equal(themes.length, 2);
  assert.equal(themes[0].name, 'Campbell');
  assert.equal(themes[0].palette.accent, '#0037da');
  assert.equal(themes[1].name, 'Tango Light');
  assert.equal(themes[1].dark, false);
  assert.equal(themes[0].shadow, 'none', 'a terminal palette is flat and square');
  assert.equal(themes[0].radius, 0);
});

// ─── Design tokens ──────────────────────────────────────────────────────────

test('a W3C design-token file is walked for its colours', () => {
  const json = JSON.stringify({
    color: {
      background: { $type: 'color', $value: '#f8fafc' },
      surface: { $type: 'color', $value: '#ffffff' },
      text: { $type: 'color', $value: '#0f172a' },
      primary: { $type: 'color', $value: '#6366f1' },
      border: { $type: 'color', $value: '#e2e8f0' },
    },
    radius: { $type: 'dimension', $value: '12px' },
  });
  assert.equal(sniffFormat(json), 'dtcg');
  const { themes, error } = importAll(json, 'Tokens');
  assert.equal(error, null);
  assert.equal(themes[0].palette.background, '#f8fafc');
  assert.equal(themes[0].palette.accent, '#6366f1');
  assert.equal(themes[0].radius, 12);
});

// ─── Filling the gaps ───────────────────────────────────────────────────────

test('what a file leaves out is derived, and reported as derived', () => {
  // Two colours is the least a theme can be built from. Everything else is worked out.
  const css = ':root { --background: #ffffff; --foreground: #111111; }';
  const { themes, inferred } = importAll(css, 'Bare');
  const theme = themes[0];
  for (const key of ['background', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border']) {
    assert.ok(theme.palette[key], `${key} should be filled`);
  }
  assert.ok(inferred.some((note) => note.includes('textMuted')), 'and the guess is disclosed');
  assert.ok(inferred.some((note) => note.includes('onAccent')));

  // The derived on-accent colour has to actually read on the accent.
  const ratio = contrastRatio(parseColor(theme.palette.onAccent), parseColor(theme.palette.accent));
  assert.ok(ratio >= 4.5, `on-accent scores ${ratio.toFixed(2)}`);
});

test('a file with no colours at all is refused, with a reason', () => {
  const { themes, error } = importAll(':root { --spacing: 8px; --z-index: 40; }');
  assert.equal(themes.length, 0);
  assert.match(error, /could not read that|missing colours/);
});

// ─── Security ───────────────────────────────────────────────────────────────

test('a hostile stylesheet gets no further than any other untrusted input', () => {
  // The adapter builds a candidate; normaliseTheme is still the only thing that makes a
  // theme. A font stack that closes the declaration is the attack that matters, because
  // theme values are written into a stylesheet injected on every page.
  const hostile = `:root {
    --background: #ffffff;
    --foreground: #000000;
    --font-family: Georgia; } * { background: url(https://evil.example/beacon) } .x {;
  }`;
  const { themes } = importAll(hostile, 'Hostile');
  assert.equal(themes.length, 1, 'the readable part still imports');
  assert.equal(themes[0].fontFamily, null, 'the injection does not');
  assert.equal(themes[0].custom, true, 'and it is never marked as one of ours');
});

test('an imported theme can never claim a raw CSS backdrop', () => {
  // `effects.backdrop` is raw CSS and is honoured only for presets we ship.
  const json = JSON.stringify({
    colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
    effects: { backdrop: 'url(https://evil.example/x)' },
  });
  const { themes } = importAll(json);
  assert.equal(themes[0].effects.backdrop, null);
});

test('sniffing does not confuse one format for another', () => {
  assert.equal(sniffFormat(VSCODE), 'vscode');
  assert.equal(sniffFormat(SHADCN_HSL), 'css-vars');
  assert.equal(sniffFormat('{"format":"webin-theme","theme":{}}'), 'webin');
  assert.equal(sniffFormat('just some words'), null);
  assert.equal(sniffFormat(''), null);
  assert.equal(sniffFormat('{ not json'), null);
});

test('our own format still wins over every adapter', () => {
  const ours = JSON.stringify({
    format: 'webin-theme',
    theme: {
      name: 'Mine', palette: {
        background: '#ffffff', surface: '#eeeeee', text: '#111111',
        textMuted: '#666666', accent: '#0055ff',
      },
    },
  });
  const { source, themes } = importAll(ours);
  assert.equal(source, 'webin');
  assert.equal(themes[0].name, 'Mine');
});

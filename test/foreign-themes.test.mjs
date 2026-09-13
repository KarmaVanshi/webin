import test from 'node:test';
import assert from 'node:assert/strict';

import { sniffFormat, adaptForeignThemes, readColorValue, stripJsonc } from '../src/shared/foreign-themes.js';
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

// ─── JSONC ──────────────────────────────────────────────────────────────────

// What VS Code's own "Generate Color Theme From Current Settings" writes: a `//` inside
// the very first string, every inherited default commented out, and — because the last
// live declaration keeps its comma — a trailing comma once those comments come away.
const VSCODE_JSONC = `{
	// Dark High Contrast, as VS Code exports it
	"$schema": "vscode://schemas/color-theme",
	"name": "Dark High Contrast",
	"type": "hcDark",
	"colors": {
		"editor.background": "#000000",
		"editor.foreground": "#ffffff", // the canvas
		"textLink.foreground": "#21a6ff",
		"panel.border": "#6fc3df",
		//"activityBar.background": "#000000",
		//"widget.shadow": null
	},
	/* syntax colours are not read, but they must not break the parse */
	"tokenColors": [{ "scope": "comment", "settings": { "foreground": "#7ca668" } }],
}`;

test('a VS Code theme with comments and trailing commas still reads', () => {
  assert.equal(sniffFormat(VSCODE_JSONC), 'vscode', 'sniffing survives the comments');
  const { themes, error, source } = importAll(VSCODE_JSONC);
  assert.equal(error, null);
  assert.equal(source, 'vscode');
  const theme = themes[0];
  assert.equal(theme.name, 'Dark High Contrast');
  assert.equal(theme.palette.background, '#000000');
  assert.equal(theme.palette.text, '#ffffff');
  assert.equal(theme.palette.accent, '#21a6ff', 'the link colour, since no button is declared');
  assert.equal(theme.palette.border, '#6fc3df');
});

test('a comment marker inside a string is left alone', () => {
  // The trap: `vscode://schemas/...` is not a comment, and a line-wise regex eats it.
  const cleaned = stripJsonc(VSCODE_JSONC);
  assert.match(cleaned, /"vscode:\/\/schemas\/color-theme"/, 'the schema URL is intact');
  assert.doesNotMatch(cleaned, /Dark High Contrast, as VS Code exports it/, 'the comment is gone');
  assert.equal(JSON.parse(cleaned).$schema, 'vscode://schemas/color-theme');
});

test('an escaped quote does not end the string it is in', () => {
  const source = '{"name": "a \\" // not a comment", "colors": {"editor.background": "#101010"}}';
  assert.equal(JSON.parse(stripJsonc(source)).name, 'a " // not a comment');
  assert.equal(sniffFormat(source), 'vscode');
});

test('valid JSON is never put through the stripper', () => {
  // A theme whose *name* contains a comment marker must survive untouched.
  const source = JSON.stringify({
    name: 'https://example.com/theme',
    colors: { 'editor.background': '#202020', 'editor.foreground': '#fafafa' },
  });
  const { themes, error } = importAll(source);
  assert.equal(error, null);
  assert.equal(themes[0].name, 'https://example.com/theme');
});

test('a stylesheet that opens with a block comment is still a stylesheet', () => {
  // Sniffing tries JSON on everything now, so CSS has to fall through rather than fail.
  const css = '/* Solarized, ported */\n:root { --background: #002b36; --foreground: #839496; }';
  assert.equal(sniffFormat(css), 'css-vars');
});

test('genuinely broken JSON is still refused', () => {
  assert.equal(sniffFormat('{"colors": {"editor.background": '), null);
  assert.equal(adaptForeignThemes('{"colors": {"editor.background": '), null);
});

// What VS Code's own theme exporter writes: the whole palette, with everything that came
// from a built-in default commented out. Live declarations first, inherited ones after.
const VSCODE_GENERATED = `{
	"$schema": "vscode://schemas/color-theme",
	"name": "Dark High Contrast",
	"type": "hcDark",
	"colors": {
		"editor.background": "#000000",
		"editor.foreground": "#ffffff",
		//"sideBar.background": "#000000",
		//"descriptionForeground": "#ffffffb3",
		//"button.background": "#000000",
		//"button.foreground": "#ffffff",
		//"textLink.foreground": "#21a6ff",
		//"panel.border": "#6fc3df",
		//"widget.shadow": null
	}
}`;

test('a theme exported with its defaults commented out still imports whole', () => {
  const { themes, error } = importAll(VSCODE_GENERATED);
  assert.equal(error, null);
  const { palette } = themes[0];
  assert.equal(palette.background, '#000000', 'read from a live declaration');
  assert.equal(palette.surface, '#000000', 'and this one from a commented default');
  assert.equal(palette.textMuted, 'rgba(255, 255, 255, 0.702)');
  assert.equal(palette.border, '#6fc3df');
});

test('a live declaration beats a commented one for the same key', () => {
  const source = `{
	"name": "T",
	"colors": {
		"editor.background": "#101010",
		//"editor.background": "#ffffff",
		//"editor.foreground": "#eeeeee"
	}
}`;
  const { themes } = importAll(source);
  assert.equal(themes[0].palette.background, '#101010', 'what the file states outright wins');
  assert.equal(themes[0].palette.text, '#eeeeee', 'what it inherited is still read');
});

test('prose that only looks like a declaration is left as prose', () => {
  // Reviving this would not parse, so the file has to be read exactly as it was.
  const source = `{
	"name": "T",
	// "editor.background": is where the canvas colour goes
	"colors": { "editor.background": "#123456", "editor.foreground": "#fafafa" }
}`;
  const { themes, error } = importAll(source);
  assert.equal(error, null);
  assert.equal(themes[0].palette.background, '#123456');
});

test('an accent the colour of the page falls through to one you can see', () => {
  // VS Code's high-contrast buttons are black on a black canvas, told apart by a border.
  const source = JSON.stringify({
    name: 'HC',
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#ffffff',
      'button.background': '#000000',
      'button.foreground': '#ffffff',
      'textLink.foreground': '#21a6ff',
    },
  });
  const { themes } = importAll(source);
  const { palette } = themes[0];
  assert.equal(palette.accent, '#21a6ff', 'not the invisible button fill');
  assert.equal(palette.onAccent, '#000000', 'and white does not read on that, so it is derived');
  assert.ok(contrastRatio(parseColor(palette.onAccent), parseColor(palette.accent)) >= 4.5);
});

test('a workable accent is still taken from the button, as before', () => {
  const source = JSON.stringify({
    name: 'Ordinary',
    colors: {
      'editor.background': '#011627',
      'editor.foreground': '#d6deeb',
      'button.background': '#7e57c2',
      'button.foreground': '#ffffff',
      'textLink.foreground': '#ff0000',
    },
  });
  const { palette } = importAll(source).themes[0];
  assert.equal(palette.accent, '#7e57c2');
  assert.equal(palette.onAccent, '#ffffff');
});

// ─── Namespaced design systems ──────────────────────────────────────────────

// What a real site ships. Netflix's tokens all sit under `--hcw--local-design--`, so an
// exact-name match finds nothing and the page used to import as no theme at all.
const NAMESPACED = `:root {
  --hcw--local-design--Page-Background: #141414;
  --hcw--local-design--Accordion-PanelForeground: #ffffff;
  --hcw--local-design--Button-Surface: #e50914;
  --hcw--local-design--Button-Foreground: #ffffff;
  --hcw--local-design--Input-Border: #808080;
  --hcw--focus-ring--color: transparent;
}`;

test('a namespaced design system is read from the tail of its names', () => {
  const { themes, error } = importAll(NAMESPACED, 'Netflix');
  assert.equal(error, null);
  const { palette } = themes[0];
  assert.equal(palette.background, '#141414');
  assert.equal(palette.text, '#ffffff');
  assert.equal(palette.accent, '#e50914', 'a button fill is a brand colour, not a panel');
  assert.equal(palette.border, '#808080');
});

test('an exact name still beats a tail match', () => {
  // The reason the tail pass runs second: `--primary-foreground` is the label on the
  // accent, and must not be claimed as the accent itself.
  const source = `:root {
    --background: #ffffff;
    --foreground: #111111;
    --primary: #3366ff;
    --primary-foreground: #ffffff;
    --some-vendor--Button-Surface: #ff0000;
  }`;
  const { palette } = importAll(source).themes[0];
  assert.equal(palette.accent, '#3366ff', 'the exact --primary wins');
  assert.equal(palette.onAccent, '#ffffff');
});

test('a transparent value does not fill a role', () => {
  const source = `:root {
    --background: #101010;
    --foreground: #f0f0f0;
    --border: transparent;
  }`;
  const { palette, } = importAll(source).themes[0];
  assert.notEqual(palette.border, 'transparent');
  assert.ok(palette.border, 'it is derived instead');
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
  // A backdrop is a base colour and a list of blobs. A string is not one, so a file that
  // smuggles CSS in under the name gets nothing — the adapters cannot mint one either.
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

// ─── Design systems a real website ships ────────────────────────────────────

/**
 * GitHub Primer, in the shape GitHub actually serves it: one enormous `:root` block of
 * namespaced tokens, the roles qualified by usage rather than named outright, and a full
 * set of status colours sitting alongside them.
 */
const PRIMER = `
  :root {
    --bgColor-default: #ffffff;
    --bgColor-muted: #f6f8fa;
    --bgColor-danger-emphasis: #cf222e;
    --bgColor-success-emphasis: #1f883d;
    --bgColor-attention-muted: #fff8c5;
    --fgColor-default: #1f2328;
    --fgColor-muted: #59636e;
    --fgColor-accent: #0969da;
    --fgColor-danger: #d1242f;
    --borderColor-default: #d1d9e0;
  }
`;

test('a namespaced design system reads as the theme it is', () => {
  // `--bgColor-default` is `bg` wearing a qualifier. Stripping `color` only when it leads
  // means that name never reduces at all, and the system behind millions of pages imports
  // as nothing.
  const { themes, error, source } = importAll(PRIMER, 'GitHub');
  assert.equal(error, null);
  assert.equal(source, 'css-vars');

  const { palette } = themes[0];
  assert.equal(palette.background, '#ffffff');
  assert.equal(palette.text, '#1f2328');
  assert.equal(palette.accent, '#0969da');
  assert.equal(palette.border, '#d1d9e0');
  assert.equal(palette.textMuted, '#59636e');
  assert.equal(palette.surface, '#f6f8fa');
});

test('a status colour is never mistaken for a role', () => {
  // This is what stops GitHub importing with a bright red page: `--bgColor-danger-emphasis`
  // ends in the same word as `--bgColor-default`, and a loose tail match takes whichever
  // it happens to see first.
  const { themes } = importAll(PRIMER, 'GitHub');
  const used = Object.values(themes[0].palette);
  for (const status of ['#cf222e', '#1f883d', '#fff8c5', '#d1242f']) {
    assert.ok(!used.includes(status), `${status} is a status, not a role`);
  }
});

test('a design system token beats one component’s decoration', () => {
  // GitHub declares both of these. They end in the same word and only one of them is the
  // accent of the site.
  const css = `:root {
    --testimonial-accent-color: #008000;
    --bgColor-default: #ffffff;
    --fgColor-default: #1f2328;
    --fgColor-accent: #0969da;
  }`;
  const { themes } = importAll(css, 'GitHub');
  assert.equal(themes[0].palette.accent, '#0969da');
});

test('an accent nobody could see is not kept', () => {
  // GOV.UK names a white button on a white page. That is a real colour for a real button
  // and an accent that vanishes into the background.
  const css = `:root {
    --background: #ffffff;
    --foreground: #0b0c0c;
    --button-background: #ffffff;
  }`;
  const { themes, inferred } = importAll(css, 'Gov');
  assert.notEqual(themes[0].palette.accent, '#ffffff');
  assert.ok(inferred.some((note) => /accent ←/.test(note)));
});

test('a name that is only noise keeps its own identity', () => {
  // Stripping every meaningless segment from `--color-theme` would leave the empty string,
  // and every such token would then collide with every other one.
  const css = ':root { --color-theme: #123456; --background: #ffffff; --foreground: #111111 }';
  const { themes, error } = importAll(css, 'Odd');
  assert.equal(error, null);
  assert.equal(themes[0].palette.background, '#ffffff');
});

// ── JSON that belongs to no format at all ───────────────────────────────────
// The files people actually have. A theme written by hand or by an assistant rarely
// matches a published format: it invents its own vocabulary and nests it however reads
// nicely, and every reader here would turn it away while the colours sat in plain sight.

test('a JSON file full of colours is a theme, whatever it calls them', () => {
  const { themes, source } = importAll(JSON.stringify({
    theme: {
      name: 'Whispering Forest',
      mode: 'light',
      colors: { canvas: '#F4EEDB', paper: '#FFFDF3', ink: '#39483B', mutedInk: '#71806D' },
    },
  }));

  assert.equal(themes.length, 1);
  assert.equal(source, 'json');
  assert.equal(themes[0].name, 'Whispering Forest', 'the file named itself');
  assert.equal(toHex(parseColor(themes[0].palette.background)), '#f4eedb', 'canvas is a ground');
  assert.equal(toHex(parseColor(themes[0].palette.surface)), '#fffdf3', 'paper is a surface');
  assert.equal(toHex(parseColor(themes[0].palette.text)), '#39483b', 'ink is ink');
});

test('a light theme does not take its colours from the file’s dark half', () => {
  // A theme file routinely carries both. `special.nightMode.surface` is correctly named
  // and completely real, and it belongs to the other theme — reading it is how a light
  // theme comes out with dark panels.
  const { themes } = importAll(JSON.stringify({
    theme: {
      mode: 'light',
      colors: { canvas: '#F4EEDB', paper: '#FFFDF3', ink: '#39483B' },
      special: { nightMode: { surface: 'rgba(31, 52, 49, 0.82)' } },
    },
  }));

  const surface = parseColor(themes[0].palette.surface);
  const ground = parseColor(themes[0].palette.background);
  assert.ok(contrastRatio(surface, ground) < 2, 'a panel sits close to the page it is on');
});

test('a stray colour in an unrelated document is not a theme', () => {
  assert.equal(importAll(JSON.stringify({ brandColor: '#ff0000', version: 3 })).themes.length, 0);
});

test('an unusable accent falls to the file’s other brand colour, not to its ink', () => {
  // `#F6D98B` on `#F4EEDB` is a pale yellow on cream: correctly named, and invisible.
  // Reaching past `primary` for the body text would make the whole theme monochrome.
  const { themes } = importAll(JSON.stringify({
    theme: {
      colors: {
        background: '#F4EEDB', text: '#39483B', surface: '#FFFDF3',
        accent: '#F6D98B', primary: '#527A5B',
      },
    },
  }));

  const accent = themes[0].palette.accent;
  assert.equal(toHex(parseColor(accent)), '#527a5b', 'the primary was right there');
  assert.notEqual(toHex(parseColor(accent)), '#39483b', 'and it is not the body text');
});

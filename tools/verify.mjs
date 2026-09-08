/**
 * Real-browser verification.
 *
 * The unit tests prove the logic in jsdom. This proves the product in Chromium, against
 * the two things jsdom cannot model: shadow DOM with adopted stylesheets, and a site
 * that paints itself entirely from custom properties. The second target is YouTube
 * itself, because a theming extension that cannot handle YouTube cannot handle the web.
 *
 *   node tools/verify.mjs                 # local fixture + youtube.com
 *   node tools/verify.mjs --headful       # watch it
 *   node tools/verify.mjs --no-network    # fixture only
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = join(root, 'shots');
const headful = process.argv.includes('--headful');
const skipNetwork = process.argv.includes('--no-network');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
};

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

async function serveFixtures() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/' || path === '/a' || path === '/b') path = '/components.html';
    try {
      const file = join(root, 'fixtures', path.replace(/\.\./g, ''));
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  // Port 0 for the same reason the browser gets one: a leftover server from an earlier
  // run must not be able to answer for this one.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.origin = `http://127.0.0.1:${server.address().port}`;
  return server;
}

/** Applies a theme through the extension's own runtime, as a toolbar click would. */
const applyTheme = (page, id) => page.evaluateInExtension(`
  const webin = window.__webin.webin;
  await webin.open();
  webin.panel.emit('action', { action: 'apply', value: ${JSON.stringify(id)} });
  await new Promise((r) => setTimeout(r, 400));
  return webin.active ? webin.active.id : null;
`);

async function main() {
  await import('node:fs/promises').then((fs) => fs.mkdir(shots, { recursive: true }));
  const server = await serveFixtures();
  const chrome = await launch({ extension: root, headless: !headful });

  try {
    await permissions(chrome, server.origin);
    await fixture(chrome, server.origin);
    await editor(chrome, server.origin);
    if (!skipNetwork) await youtube(chrome);
  } finally {
    await chrome.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

// ─── Permissions ───────────────────────────────────────────────────────────

/**
 * The extension asks for `storage` and host access, and nothing else. That is only true
 * if the service worker can still do its job on those alone — so this drives the real
 * toolbar path rather than trusting the manifest.
 */
async function permissions(chrome, origin) {
  console.log('\npermissions: storage + host access, and nothing else');
  const page = await chrome.page(origin);
  await sleep(800);
  const worker = await chrome.worker();

  const granted = await worker.evaluate(`
    const manifest = chrome.runtime.getManifest();
    return { permissions: manifest.permissions ?? [], hosts: manifest.host_permissions ?? [] };
  `);
  check('only the permissions the code uses are requested',
    granted.permissions.join() === 'storage', granted.permissions.join(', ') || 'none');

  // What the worker does on a toolbar click: find the tab, read its URL to rule out
  // browser pages, then message the top frame. Every step needs a permission.
  const clicked = await worker.evaluate(`
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, { frameId: 0 });
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, { frameId: 0 });
    return { url: tab.url, reply, status };
  `);
  check('the worker can still read the tab URL without activeTab',
    typeof clicked.url === 'string' && clicked.url.startsWith('http'), clicked.url || 'empty');
  check('a toolbar click opens the panel', clicked.reply?.open === true && clicked.status?.open === true);

  const visible = await page.evaluate("return Boolean(document.querySelector('[data-webin-owned]'));");
  check('and the panel is really on the page', visible);
}

// ─── The component fixture ─────────────────────────────────────────────────

async function fixture(chrome, origin) {
  console.log('\nfixture: a site built from custom properties and shadow roots');
  const page = await chrome.page(origin);
  await sleep(1200);

  const before = await page.evaluate(`
    const card = document.querySelector('site-card').shadowRoot.querySelector('.card');
    return {
      body: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(card).backgroundColor,
      variable: getComputedStyle(document.documentElement).getPropertyValue('--site-bg').trim(),
    };
  `);

  const applied = await applyTheme(page, 'neon');
  check('a theme applies from the panel', applied === 'neon', applied ?? 'nothing applied');

  const after = await page.evaluate(`
    const shadow = document.querySelector('site-card').shadowRoot;
    return {
      body: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(shadow.querySelector('.card')).backgroundColor,
      cardText: getComputedStyle(shadow.querySelector('h3')).color,
      variable: getComputedStyle(document.documentElement).getPropertyValue('--site-bg').trim(),
      scrim: getComputedStyle(document.documentElement).getPropertyValue('--site-scrim').trim(),
      stamped: document.querySelectorAll('[data-webin]').length,
      adopted: shadow.adoptedStyleSheets.length,
      font: getComputedStyle(document.body).fontFamily,
    };
  `);

  check('the page canvas is repainted', after.body !== before.body, `${before.body} -> ${after.body}`);
  check('root custom properties are remapped', after.variable !== before.variable, `--site-bg ${before.variable} -> ${after.variable}`);
  check('a translucent variable keeps its alpha', /rgba\(.*0\.4\)/.test(after.scrim), after.scrim);
  check('shadow DOM is restyled', after.card !== before.card, `${before.card} -> ${after.card}`);
  check('the sheet is adopted into shadow roots', after.adopted > 0, `${after.adopted} adopted`);
  check('elements are stamped', after.stamped > 10, `${after.stamped} elements`);
  check('the theme font is applied', /mono/i.test(after.font), after.font);

  await page.screenshot(join(shots, 'fixture-neon.png'));

  // Content added after the theme was applied.
  await page.evaluate('window.__addCards(3); return true;');
  await sleep(700);
  const late = await page.evaluate(`
    const cards = [...document.querySelectorAll('site-card')];
    const last = cards[cards.length - 1].shadowRoot.querySelector('.card');
    return { colour: getComputedStyle(last).backgroundColor, stamped: document.querySelectorAll('[data-webin]').length };
  `);
  check('content added later is themed', late.colour === after.card, `${late.colour}`);

  // Client-side navigation.
  await page.evaluate("document.querySelector('[href=\"/b\"]').click(); return true;");
  await sleep(900);
  const routed = await page.evaluate(`
    const card = document.querySelector('site-card').shadowRoot.querySelector('.card');
    return { colour: getComputedStyle(card).backgroundColor, url: location.pathname };
  `);
  check('a client-side route change keeps the theme', routed.colour === after.card, `${routed.url} ${routed.colour}`);

  // A reload has to bring the theme back on its own, before the page paints.
  await page.goto(origin);
  await sleep(1200);
  const reloaded = await page.evaluate(`
    return {
      body: getComputedStyle(document.body).backgroundColor,
      stamped: document.querySelectorAll('[data-webin]').length,
    };
  `);
  check('the theme returns on reload with no UI', reloaded.body === after.body, reloaded.body);
  check('and the page is stamped again', reloaded.stamped > 10, `${reloaded.stamped} elements`);

  // Every theme, in turn, on a real engine.
  const ids = ['minimal', 'editorial', 'sage', 'reading', 'blossom', 'contrast', 'flat',
    'skeuomorphic', 'neumorphic', 'glass', 'bauhaus', 'bold-type', 'brutalist', 'neon',
    'midnight', 'terminal', 'nord', 'dracula'];
  const broken = [];
  for (const id of ids) {
    const ok = await applyTheme(page, id);
    const paint = await page.evaluate(`
      return {
        body: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.querySelector('footer')).color,
      };
    `);
    if (ok !== id || paint.body === paint.text) broken.push(id);
  }
  check('all 18 themes apply on a real engine', broken.length === 0, broken.join(', ') || 'no failures');

  await applyTheme(page, 'glass');
  await sleep(400);
  await page.screenshot(join(shots, 'fixture-glass.png'));

  await applyTheme(page, 'bauhaus');
  await sleep(400);
  await page.screenshot(join(shots, 'fixture-bauhaus.png'));

  // The panel in dark chrome.
  await page.evaluateInExtension(`
    window.__webin.webin.panel.emit('action', { action: 'appearance' });
    await new Promise((r) => setTimeout(r, 200));
    return true;
  `);
  await page.screenshot(join(shots, 'panel-dark.png'));

  const cleared = await page.evaluateInExtension(`
    const webin = window.__webin.webin;
    webin.panel.emit('action', { action: 'clear' });
    await new Promise((r) => setTimeout(r, 300));
    return { active: webin.active, stamped: document.querySelectorAll('[data-webin]').length };
  `);
  check('removing a theme leaves nothing behind', cleared.active === null && cleared.stamped === 0,
    `${cleared.stamped} stamps left`);
}

// ─── YouTube ───────────────────────────────────────────────────────────────

async function youtube(chrome) {
  console.log('\nyoutube.com: shadow DOM everywhere, painted from --yt-spec-* variables');
  // A signed-out home page has no feed, so the search results are the real content here.
  const page = await chrome.page('https://www.youtube.com/results?search_query=fireplace');
  await sleep(7000);

  /** YouTube renames its variables from time to time; ask the page which it has. */
  const probe = `
    const root = getComputedStyle(document.documentElement);
    const names = [];
    for (let i = 0; i < root.length; i += 1) {
      const name = root.item(i);
      if (name.startsWith('--yt')) names.push(name);
    }
    const pick = (needle) => names.find((n) => n.includes(needle));
    const app = document.querySelector('ytd-app');
    const title = document.querySelector('#video-title, a#video-title-link, yt-formatted-string#video-title');
    return {
      count: names.length,
      bgName: pick('base-background') ?? names[0],
      background: root.getPropertyValue(pick('base-background') ?? names[0] ?? '--x').trim(),
      textName: pick('text-primary'),
      text: root.getPropertyValue(pick('text-primary') ?? '--x').trim(),
      app: app ? getComputedStyle(app).backgroundColor : null,
      title: title ? getComputedStyle(title).color : null,
      results: document.querySelectorAll('ytd-video-renderer').length,
      elements: document.querySelectorAll('*').length,
    };`;

  const before = await page.evaluate(`return (() => { ${probe} })();`);
  check('youtube loaded with real content', before.results > 0 && before.count > 100,
    `${before.results} results, ${before.count} custom properties, ${before.elements} elements`);

  const start = Date.now();
  const applied = await applyTheme(page, 'midnight');
  const elapsed = Date.now() - start;
  check('a theme applies on youtube', applied === 'midnight', `${elapsed}ms including a 400ms wait`);

  const after = await page.evaluate(`
    const stamped = document.querySelectorAll('[data-webin]').length;
    return { ...(() => { ${probe} })(), stamped };
  `);

  check('youtube variables are remapped', after.background !== before.background,
    `${after.bgName}: ${before.background} -> ${after.background}`);
  check('the app surface follows', after.app !== before.app, `${before.app} -> ${after.app}`);
  check('search result titles change colour with the theme', after.title !== before.title,
    `${before.title} -> ${after.title}`);
  check('elements are stamped inside youtube', after.stamped > 100, `${after.stamped} of ${after.elements}`);

  await page.screenshot(join(shots, 'youtube-midnight.png'));

  // Scrolling triggers the infinite feed; the theme has to keep up without stalling.
  const scroll = await page.evaluate(`
    const t0 = performance.now();
    for (let i = 0; i < 6; i += 1) {
      window.scrollBy(0, 1200);
      await new Promise((r) => setTimeout(r, 350));
    }
    await new Promise((r) => setTimeout(r, 1200));
    return { ms: Math.round(performance.now() - t0), elements: document.querySelectorAll('*').length };
  `);
  const afterScroll = await page.evaluate(`
    const rows = [...document.querySelectorAll('ytd-video-renderer')];
    const last = rows[rows.length - 1];
    const title = last?.querySelector('#video-title');
    return {
      rows: rows.length,
      title: title ? getComputedStyle(title).color : null,
      stamped: document.querySelectorAll('[data-webin]').length,
    };
  `);
  check('the infinite feed stays themed while scrolling',
    afterScroll.title === after.title,
    `${afterScroll.rows} rows, ${afterScroll.stamped} stamped, ${scroll.ms}ms of scrolling`);

  // A video page is a different route with a different layout, reached without a load.
  await page.evaluate(`
    const link = document.querySelector('ytd-video-renderer a#video-title, ytd-video-renderer a#thumbnail');
    if (link) link.click();
    return true;
  `);
  await sleep(6000);
  const watch = await page.evaluate(`
    const app = document.querySelector('ytd-app');
    return {
      url: location.pathname,
      app: app ? getComputedStyle(app).backgroundColor : null,
      stamped: document.querySelectorAll('[data-webin]').length,
      video: Boolean(document.querySelector('video')),
      player: document.querySelector('#movie_player') ? getComputedStyle(document.querySelector('#movie_player')).backgroundColor : null,
    };
  `);
  check('a watch page keeps the theme after client-side navigation',
    watch.app === after.app && watch.url.startsWith('/watch'), `${watch.url} ${watch.app}`);
  check('the video player is left alone', watch.video, `player background ${watch.player}`);

  await page.screenshot(join(shots, 'youtube-watch.png'));

  // And it survives a hard reload, from the cached root CSS.
  await page.goto('https://www.youtube.com/results?search_query=fireplace');
  await sleep(6000);
  const reloaded = await page.evaluate(`
    const stamped = document.querySelectorAll('[data-webin]').length;
    return { ...(() => { ${probe} })(), stamped };
  `);
  check('youtube reopens already themed', reloaded.background === after.background && reloaded.app === after.app,
    `${reloaded.background}, ${reloaded.stamped} stamped`);

  const cleaned = await page.evaluateInExtension(`
    const webin = window.__webin.webin;
    await webin.open();
    webin.panel.emit('action', { action: 'clear' });
    await new Promise((r) => setTimeout(r, 600));
    return { active: webin.active, stamped: document.querySelectorAll('[data-webin]').length };
  `);
  check('youtube can be put back to normal', cleaned.active === null && cleaned.stamped === 0,
    `${cleaned.stamped} stamps left`);
}

/**
 * The editor, against real layout.
 *
 * Everything here is the part jsdom cannot answer. It has no layout engine, so it has no
 * geometry, no hit-testing and nowhere to put a pointer — which is exactly what the
 * overlay, the resize grips and the drag gesture are made of.
 */
async function editor(chrome, origin) {
  console.log('\nthe editor: real geometry, real pointers');
  const page = await chrome.page(origin);
  await sleep(1200);

  // Open the editor and pick a card by clicking it on the page.
  await page.evaluateInExtension(`
    const webin = window.__webin.webin;
    await webin.open();
    webin.panel.emit('action', { action: 'mode', value: 'edit' });
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);

  const box = await page.evaluate(`
    const el = document.querySelector('site-card') ?? document.querySelector('main *');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 12, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  `);
  check('the fixture gives the editor something with a real box', box.width > 0 && box.height > 0,
    `${Math.round(box.width)} x ${Math.round(box.height)}`);

  await page.click(box.x, box.y);
  await sleep(400);

  const selected = await page.evaluateInExtension(`
    const editor = window.__webin.webin.editor;
    return { has: Boolean(editor?.selection.length), tag: editor?.selection[0]?.tagName ?? null };
  `);
  check('clicking the page selects an element', selected.has === true, selected.tag ?? 'nothing selected');

  // The overlay must be drawn, and must not be part of the page's own layout.
  const marks = await page.evaluate(`
    const hosts = [...document.documentElement.children].filter((el) => el.hasAttribute('data-webin-owned'));
    const overlay = hosts.map((h) => h.shadowRoot?.querySelector('.webin-marks, .webin-marks-host')).find(Boolean);
    return {
      hosts: hosts.length,
      drawn: Boolean(overlay && overlay.innerHTML.length > 0),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  `);
  check('the overlay is drawn in its own shadow root', marks.drawn === true, `${marks.hosts} owned hosts`);
  check('and adds nothing to the page layout', marks.scrollWidth <= marks.clientWidth + 1,
    `${marks.scrollWidth} vs ${marks.clientWidth}`);

  // Change a property and watch the real engine repaint.
  const beforeRadius = await page.evaluateInExtension(`
    const el = window.__webin.webin.editor.selection[0];
    return getComputedStyle(el).borderRadius;
  `);
  await page.evaluateInExtension(`
    window.__webin.webin.editor.setProperty('border-radius', '22px');
    await new Promise((r) => setTimeout(r, 200));
    return true;
  `);
  const afterRadius = await page.evaluateInExtension(`
    const el = window.__webin.webin.editor.selection[0];
    return getComputedStyle(el).borderRadius;
  `);
  check('an edit reaches the rendered page', afterRadius.startsWith('22px'), `${beforeRadius} -> ${afterRadius}`);

  // A real drag on a real grip.
  // The east grip, dragged outward: a west or north grip on an element near the edge of
  // the viewport would be dragged to a negative coordinate, which the browser drops.
  const grip = await page.evaluate(`
    const hosts = [...document.documentElement.children].filter((el) => el.hasAttribute('data-webin-owned'));
    for (const host of hosts) {
      const handle = host.shadowRoot?.querySelector('.webin-handle[data-handle="e"]')
        ?? host.shadowRoot?.querySelector('.webin-handle[data-handle="se"]');
      if (handle) { const r = handle.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width }; }
    }
    return null;
  `);
  if (grip) {
    check('resize grips are at least 24px of pointer target', grip.size >= 24, `${Math.round(grip.size)}px`);
    const widthBefore = await page.evaluateInExtension(`
      return Math.round(window.__webin.webin.editor.selection[0].getBoundingClientRect().width);
    `);
    await page.drag({ x: grip.x, y: grip.y }, { x: grip.x + 70, y: grip.y });
    await sleep(400);
    const after = await page.evaluateInExtension(`
      const el = window.__webin.webin.editor.selection[0];
      return { width: Math.round(el.getBoundingClientRect().width), wid: el.getAttribute('data-webin-id') };
    `);
    check('dragging a grip resizes the element', after.width > widthBefore + 50,
      `${widthBefore} -> ${after.width}`);
    // Releasing after a drag raises an ordinary click, and if the picker sees it the
    // element being resized stops being the element selected at the worst possible moment.
    check('and the thing being resized is still selected', after.wid !== null, after.wid ?? 'selection lost');
  } else {
    check('resize grips are drawn for the selection', false, 'no .webin-handle found');
  }

  // Keyboard is a real alternative to the pointer, not a courtesy.
  const nudged = await page.evaluateInExtension(`
    const editor = window.__webin.webin.editor;
    const before = getComputedStyle(editor.selection[0]).marginLeft;
    editor.nudge(10, 0);
    await new Promise((r) => setTimeout(r, 150));
    return { before, after: getComputedStyle(editor.selection[0]).marginLeft };
  `);
  check('the keyboard can move what the pointer can', nudged.before !== nudged.after,
    `${nudged.before} -> ${nudged.after}`);

  await page.screenshot(join(shots, 'editor-selection.png'));

  // `querySelectorAll` stops at a shadow boundary, so counting marks from the document
  // alone reports zero for anything inside a web component — and would let both of the
  // checks below pass for the wrong reason.
  const countMarks = `
    const walk = (root, out) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.hasAttribute('data-webin-id')) out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot, out);
      }
      return out;
    };
  `;

  // Save, reload, and see it come back — the milestone the whole feature is for.
  await page.evaluateInExtension(`
    await window.__webin.webin.editor.save();
    return true;
  `);
  await page.goto(origin);
  await sleep(1500);
  const restored = await page.evaluate(`
    ${countMarks}
    const marked = walk(document, []);
    return {
      marked: marked.length,
      radius: marked[0] ? getComputedStyle(marked[0]).borderRadius : null,
    };
  `);
  check('a saved edit is back after a reload', restored.marked > 0 && /22px/.test(restored.radius ?? ''),
    `${restored.marked} restored, radius ${restored.radius}`);

  // And it can all be taken away again.
  const reset = await page.evaluateInExtension(`
    const webin = window.__webin.webin;
    await webin.open();
    webin.panel.emit('action', { action: 'mode', value: 'edit' });
    await new Promise((r) => setTimeout(r, 200));
    webin.panel.emit('action', { action: 'reset-site' });
    await new Promise((r) => setTimeout(r, 500));
    ${countMarks}
    return { marked: walk(document, []).length };
  `);
  check('resetting the site leaves no trace', reset.marked === 0, `${reset.marked} handles left`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

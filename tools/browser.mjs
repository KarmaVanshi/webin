/**
 * A very small Chrome DevTools Protocol client, for driving a real browser in
 * development. No dependencies beyond `ws`, which jsdom already brings.
 *
 * jsdom proves the logic; only a real engine proves the product. Shadow roots, adopted
 * stylesheets, custom properties and backdrop filters all behave differently — or do not
 * exist at all — outside Chromium, and those are exactly the mechanisms this extension
 * runs on.
 *
 *   node tools/verify.mjs            # the checks
 *   node tools/verify.mjs --headful  # watch it happen
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const CHROME = process.env.CHROME
  ?? '/Applications/Chromium.app/Contents/MacOS/Chromium';

export async function launch({ extension, headless = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'webin-'));
  const args = [
    // Port 0 lets the browser pick. A fixed port means a browser left over from an earlier
    // run gets attached to instead of this one, and the suite then tests a stale build —
    // which looks exactly like flakiness and wastes an afternoon.
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1280,900',
    'about:blank',
  ];
  if (extension) {
    args.unshift(`--load-extension=${extension}`, `--disable-extensions-except=${extension}`);
  }
  if (headless) args.unshift('--headless=new');

  const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = await waitForEndpoint(profile);
  const browser = await Connection.open(endpoint);

  return {
    browser,
    /**
     * Opens a tab and navigates it.
     *
     * The target is created blank and navigated afterwards: creating it with a URL
     * starts loading before anything is attached, so the load event — and every
     * execution context the page creates, including the extension's — is missed.
     */
    async page(url) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const session = await Session.attach(browser, targetId);
      if (url && url !== 'about:blank') await session.goto(url);
      return session;
    },
    async targets() {
      const { targetInfos } = await browser.send('Target.getTargets');
      return targetInfos;
    },
    /**
     * Attaches to the extension's service worker.
     *
     * This is the only way to exercise what a toolbar click actually does — the
     * permissions the worker relies on are not the ones the content script has.
     */
    async worker({ timeout = 10000 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const { targetInfos } = await browser.send('Target.getTargets');
        const target = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('/src/background/'));
        if (target) return Session.attach(browser, target.targetId);
        if (Date.now() > deadline) throw new Error('the extension service worker never started');
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    },
    async close() {
      try { await browser.send('Browser.close'); } catch { /* already gone */ }
      browser.close();
      child.kill();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * The browser writes the port it chose, and the path to talk to it on, into its profile.
 * Reading it from there is what ties this connection to the process just spawned.
 */
async function waitForEndpoint(profile, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Chrome did not start a debugging endpoint');
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

class Connection {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Set();

  static open(endpoint) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint, { maxPayload: 256 * 1024 * 1024 });
      const connection = new Connection(ws);
      ws.on('open', () => resolve(connection));
      ws.on('error', reject);
    });
  }

  constructor(ws) {
    this.#ws = ws;
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.id != null) {
        const entry = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (!entry) return;
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
        return;
      }
      for (const listener of this.#listeners) listener(message);
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close() { this.#ws.close(); }
}

/** One attached page, with the execution contexts it has created. */
class Session {
  #connection;
  #sessionId;
  contexts = [];

  static async attach(browser, targetId) {
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const session = new Session(browser, sessionId);
    browser.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.executionContextCreated') session.contexts.push(message.params.context);
      if (message.method === 'Runtime.executionContextsCleared') session.contexts = [];
    });
    // A service worker target has no Page domain; everything else does.
    await session.send('Page.enable').catch(() => {});
    await session.send('Runtime.enable');
    return session;
  }

  constructor(connection, sessionId) {
    this.#connection = connection;
    this.#sessionId = sessionId;
  }

  send(method, params) {
    return this.#connection.send(method, params, this.#sessionId);
  }

  async goto(url, { waitFor = 'load', timeout = 30000 } = {}) {
    const done = this.#once((message) =>
      message.method === (waitFor === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired'), timeout);
    await this.send('Page.navigate', { url });
    await done;
  }

  /** Runs an expression in the page's own world. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result.value;
  }

  /**
   * Runs an expression inside the extension's content-script world, which is where the
   * runtime object lives. This is the only way to drive the extension from the outside
   * without a real toolbar click.
   */
  async evaluateInExtension(expression, { name = 'Webin' } = {}) {
    const context = this.contexts.find((c) => c.name?.includes(name) && c.auxData?.isDefault === false);
    if (!context) throw new Error(`no content-script context found (have: ${this.contexts.map((c) => c.name || 'default').join(', ')})`);
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      contextId: context.id,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result.value;
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path, Buffer.from(data, 'base64'));
    return path;
  }

  /**
   * A synthetic mouse.
   *
   * The editor's resize grips and drag gestures are pointer-driven, and pointer events
   * are exactly what jsdom cannot model — it has no layout, so there is nowhere to put a
   * pointer. Dispatching through the browser's own input pipeline is the only way to
   * exercise them: a JavaScript-constructed event would skip hit-testing, which is the
   * part most likely to be wrong.
   */
  async mouse(type, x, y, { button = 'left', clickCount = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: type === 'mouseMoved' ? 'none' : button,
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : clickCount,
      // Without this the browser raises `mousedown` and `click` but no `pointerdown` —
      // and the editor's gestures are built on pointer events, so a drag would look like
      // it did nothing at all.
      pointerType: 'mouse',
    });
  }

  /** Press, move in steps so a drag threshold is actually crossed, release. */
  async drag(from, to, { steps = 8 } = {}) {
    await this.mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= steps; i += 1) {
      await this.mouse('mouseMoved',
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps);
    }
    await this.mouse('mouseReleased', to.x, to.y);
  }

  async click(x, y) {
    await this.mouse('mouseMoved', x, y);
    await this.mouse('mousePressed', x, y);
    await this.mouse('mouseReleased', x, y);
  }

  #once(predicate, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('timed out waiting for the page')); }, timeout);
      const off = this.#connection.on((message) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        off();
        resolve(message);
      });
    });
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

import test from 'node:test';
import assert from 'node:assert/strict';

import { fitDimensions, readImageFile, ImageError, IMAGE_ACCEPT } from '../src/shared/image.js';

test('the picker offers exactly the formats that were asked for', () => {
  for (const kind of ['.png', '.jpg', '.jpeg', '.heic', '.svg']) {
    assert.ok(IMAGE_ACCEPT.includes(kind), `${kind} is offered`);
  }
});

test('an image inside the ceiling is left at its own size', () => {
  assert.deepEqual(fitDimensions(1200, 800, 2560), { width: 1200, height: 800 });
  // Never enlarged: scaling up spends bytes inventing detail that was never there.
  assert.deepEqual(fitDimensions(320, 200, 2560), { width: 320, height: 200 });
});

test('an oversized image is fitted to its longest edge, proportions kept', () => {
  assert.deepEqual(fitDimensions(6000, 4000, 2560), { width: 2560, height: 1707 });
  // Portrait: the ceiling applies to whichever edge is longer, not always the width.
  assert.deepEqual(fitDimensions(4000, 6000, 2560), { width: 1707, height: 2560 });
  // A sliver still has to come out at least one pixel tall, or the canvas throws.
  assert.deepEqual(fitDimensions(8000, 3, 2560), { width: 2560, height: 1 });
});

test('nonsense dimensions are refused rather than guessed at', () => {
  assert.equal(fitDimensions(0, 0, 2560), null);
  assert.equal(fitDimensions(Number.NaN, 100, 2560), null);
  assert.equal(fitDimensions(100, 100, 0), null);
});

test('an SVG is embedded as text, not rasterised', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff0000" width="9" height="9"/></svg>';
  const file = { name: 'mark.svg', type: 'image/svg+xml', text: async () => svg };
  const result = await readImageFile(file, {});

  assert.match(result.url, /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(result.url.split(',')[1], 'base64').toString('utf8'), svg,
    'the vector survives intact — rasterising it would be the wrong answer');
});

test('a HEIC photo is refused with something the user can act on', async () => {
  // Chrome ships no HEIC decoder, so `createImageBitmap` throws — and the picture would
  // have failed in `background-image` too. Saying so beats storing undisplayable bytes.
  const file = { name: 'IMG_4021.HEIC', type: 'image/heic' };
  const view = { createImageBitmap: async () => { throw new Error('unsupported'); } };

  await assert.rejects(() => readImageFile(file, view), (error) => {
    assert.ok(error instanceof ImageError);
    assert.match(error.message, /HEIC/);
    assert.match(error.message, /JPEG or PNG/, 'and says what to do instead');
    return true;
  });
});

test('an image that cannot be decoded says so without blaming the format', async () => {
  const file = { name: 'broken.png', type: 'image/png' };
  const view = { createImageBitmap: async () => { throw new Error('nope'); } };
  await assert.rejects(() => readImageFile(file, view), /could not be read/);
});

test('a raster image is shrunk until it fits the storage budget', async () => {
  // A stand-in for the browser's decoder and canvas: it reports how big it was asked to
  // draw, and returns a blob whose size falls with the requested edge — which is the only
  // property the stepping-down loop actually depends on.
  const asked = [];
  const view = {
    createImageBitmap: async () => ({ width: 6000, height: 4000, close() {} }),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() {
        asked.push(this.width);
        // Only the smallest rung comes in under the cap.
        const bytes = this.width > 1200 ? 4_000_000 : 40_000;
        return { arrayBuffer: async () => new Uint8Array(bytes).buffer };
      }
    },
  };

  const result = await readImageFile({ name: 'photo.jpg', type: 'image/jpeg' }, view);
  assert.deepEqual(asked, [2560, 1920, 1440, 1080], 'it steps down rather than giving up at once');
  assert.equal(result.width, 1080);
  assert.match(result.url, /^data:image\/webp;base64,/);
});

test('an image that will not fit at any size is refused, not stored anyway', async () => {
  const view = {
    createImageBitmap: async () => ({ width: 9000, height: 9000, close() {} }),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return { arrayBuffer: async () => new Uint8Array(4_000_000).buffer }; }
    },
  };
  await assert.rejects(() => readImageFile({ name: 'huge.png', type: 'image/png' }, view),
    /too large to store/);
});

// ── The whole chain ─────────────────────────────────────────────────────────
// Reading the file was never the hard part. A picture has to clear the declaration gate,
// reach the override sheet, and survive being written to storage and read back — and it
// was refused at the first of those and truncated at the last, so the picker worked
// perfectly and the page never changed. These cover the path rather than the piece.

import { validateDeclaration, isSafeValue, MAX_IMAGE_VALUE } from '../src/shared/css-values.js';
import { MemoryBackend } from '../src/storage/bridge.js';
import { EditStore } from '../src/storage/edits.js';
import { OpKind } from '../src/shared/types.js';

const dataUrl = (kind = 'webp', size = 40_000) => `url("data:image/${kind};base64,${'A'.repeat(size)}")`;

test('an inline image reaches the page as a background', () => {
  const result = validateDeclaration('background-image', dataUrl());
  assert.equal(result.ok, true, 'the gate lets a picture through');
  assert.equal(result.value.length, dataUrl().length, 'whole, not clipped');
});

test('a background is still the only place a url() may appear', () => {
  // The blanket rule exists because a URL in a value is a fetch the page never asked for.
  assert.equal(validateDeclaration('color', 'url(https://evil.example/x)').ok, false);
  assert.equal(validateDeclaration('box-shadow', 'url(https://evil.example/x)').ok, false);
  assert.equal(isSafeValue('url(https://evil.example/x)'), false, 'unchanged for everything else');
});

test('a background image must be inline, and must be an image', () => {
  for (const hostile of [
    'url(https://evil.example/beacon.png)',
    'url("data:text/html;base64,PHNjcmlwdD4=")',
    'url("data:image/svg+xml,<svg onload=alert(1)>")',
    'url("data:image/webp;base64,AAA"), url(https://evil.example/x)',
    'url("data:image/webp;base64,AAA"); background: red',
    'url("data:image/webp;base64,AAA") /*',
  ]) {
    assert.equal(validateDeclaration('background-image', hostile).ok, false, hostile.slice(0, 48));
  }
});

test('every function that can fetch is refused, not only the one spelled url', () => {
  // Chrome loads `image-set("https://…" 1x)` exactly as it loads `url(https://…)`, and a
  // gate that only knew the word `url` let a shared theme be a beacon on every site it was
  // worn on. Each of these is a fetch by another name.
  for (const [property, hostile] of [
    ['background-image', 'image-set("https://evil.example/b.png" 1x)'],
    ['background-image', '-webkit-image-set("https://evil.example/b.png" 1x)'],
    ['background-image', 'image-set(url("https://evil.example/b.png") 1x)'],
    ['background-image', 'cross-fade(image-set("https://evil.example/b.png" 1x), red)'],
    ['background-image', 'src("https://evil.example/b.png")'],
    ['background-image', 'image("https://evil.example/b.png")'],
    ['background-image', 'paint(worklet)'],
    ['background-image', 'element(#x)'],
    ['content', 'image-set("https://evil.example/b.png" 1x)'],
    ['list-style', 'image-set("https://evil.example/b.png" 1x)'],
    ['cursor', 'image-set("https://evil.example/c.png" 1x), auto'],
    ['cursor', 'IMAGE-SET("https://evil.example/c.png" 1x), auto'],
    ['background-image', 'linear-gradient(red, blue), image-set("https://evil.example/b.png" 1x)'],
    // `\75` is `u` to the CSS tokeniser, so this is `url(` spelled without the letters.
    ['background-image', '\\75 rl(https://evil.example/b.png)'],
    ['background-image', 'u\\rl(https://evil.example/b.png)'],
    ['background-image', '\\69mage-set("https://evil.example/b.png" 1x)'],
  ]) {
    assert.equal(validateDeclaration(property, hostile).ok, false, `${property}: ${hostile}`);
  }
});

test('a backslash is still a character inside a string', () => {
  assert.equal(validateDeclaration('content', '"\\201C"').ok, true, 'a curly quote');
  assert.equal(validateDeclaration('content', "'\\2014 '").ok, true, 'an em dash');
  assert.equal(validateDeclaration('font-family', '"Söhne", sans-serif').ok, true);
  // But the string has to be a string: a quote left open is not a hiding place.
  assert.equal(validateDeclaration('content', '"\\201C').ok, false, 'unterminated');
});

test('a gradient background is untouched by the image exception', () => {
  assert.equal(validateDeclaration('background-image', 'linear-gradient(#000, #fff)').ok, true);
  assert.equal(validateDeclaration('background-image', 'none').ok, true);
});

test('a picture survives being saved and read back', async () => {
  const store = new EditStore(new MemoryBackend());
  const url = dataUrl('webp', 60_000);
  await store.add('example.com', '/', {
    kind: OpKind.STYLE,
    target: { tag: 'DIV', domPath: 'body>div', id: 'hero' },
    label: 'Hero · background image',
    properties: {
      'background-image': url,
      'background-size': 'cover',
      'background-position': 'center',
      'background-repeat': 'no-repeat',
    },
  });

  const [change] = (await store.load('example.com')).scopes['/'].changes;
  assert.equal(change.properties['background-image'], url,
    'stored whole — half a data: URL is not a smaller picture, it is an invalid value');
  assert.equal(change.properties['background-size'], 'cover');
});

test('every other declaration is still held to a short value', async () => {
  const store = new EditStore(new MemoryBackend());
  await store.add('example.com', '/', {
    kind: OpKind.STYLE,
    target: { tag: 'DIV', domPath: 'body>div' },
    properties: { 'font-family': 'x'.repeat(900) },
  });

  const [change] = (await store.load('example.com')).scopes['/'].changes;
  assert.equal(change.properties['font-family'].length, 400, 'the ceiling only moved for the one property');
});

test('the reader cannot produce a picture the gate would refuse', async () => {
  // The two limits are the same number by construction now. They were not, which is how a
  // picture came to be read, shrunk, encoded, handed over and dropped without a trace.
  const view = {
    createImageBitmap: async () => ({ width: 4000, height: 3000, close() {} }),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return { arrayBuffer: async () => new Uint8Array(80_000).buffer }; }
    },
  };
  const { url } = await readImageFile({ name: 'p.jpg', type: 'image/jpeg' }, view);
  assert.ok(url.length < MAX_IMAGE_VALUE);
  assert.equal(validateDeclaration('background-image', `url("${url}")`).ok, true);
});

// ── Fitting ─────────────────────────────────────────────────────────────────

import { backgroundFit } from '../src/shared/image.js';

test('a picture close to the shape of its box fills it', () => {
  // Cropping a little to fill the box is what somebody choosing a background pictures.
  const fit = backgroundFit({ width: 1600, height: 900 }, { width: 400, height: 300 });
  assert.equal(fit['background-size'], 'cover');
  assert.equal(fit['background-repeat'], 'no-repeat');
  assert.equal(fit['background-position'], 'center');
});

test('a picture nothing like the shape of its box is shown whole', () => {
  // `cover` would keep about a twentieth of this: not a background so much as a smear of
  // whichever pixels happened to be in the middle.
  assert.equal(backgroundFit({ width: 600, height: 1400 }, { width: 900, height: 180 })['background-size'], 'contain');
});

test('the page is measured against the viewport, not against the body', () => {
  // A body's background paints the whole viewport however short the body is, but it is
  // sized against the body's own box — so a two-line page scales the picture to a strip
  // and stretches that across the screen.
  const body = { width: 900, height: 180 };
  const viewport = { width: 900, height: 600 };

  const wide = backgroundFit({ width: 1600, height: 900 }, body, { page: true, viewport });
  assert.equal(wide['background-size'], 'cover', 'a landscape photo fills the screen');
  assert.equal(wide['background-attachment'], 'fixed', 'and is anchored to what it is painted on');

  const tall = backgroundFit({ width: 600, height: 1400 }, body, { page: true, viewport });
  assert.equal(tall['background-size'], 'contain', 'a tall one is shown whole, not as a band');
});

test('an element background is never anchored to the viewport', () => {
  // `fixed` is right for the page and wrong everywhere else: it would park the picture
  // against the screen while the element it belongs to scrolls away from it.
  assert.equal(backgroundFit({ width: 800, height: 600 }, { width: 400, height: 300 })['background-attachment'], undefined);
});

test('a picture with no dimensions of its own still gets a sensible fit', () => {
  // An SVG reports none, and a box has to have been measured. Filling is the better guess.
  assert.equal(backgroundFit({ width: null, height: null }, { width: 400, height: 300 })['background-size'], 'cover');
  assert.equal(backgroundFit({ width: 800, height: 600 }, null)['background-size'], 'cover');
});

test('every declaration the fit produces is one the editor will write', () => {
  // The whole set goes to `setProperties`, so a property outside the allowlist would be
  // dropped at the gate and the picture would sit there sized by whatever was left.
  const fit = backgroundFit({ width: 600, height: 1400 }, { width: 900, height: 180 }, {
    page: true, viewport: { width: 900, height: 600 },
  });
  for (const [property, value] of Object.entries(fit)) {
    assert.equal(validateDeclaration(property, value).ok, true, `${property}: ${value}`);
  }
});

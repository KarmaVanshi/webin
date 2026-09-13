/**
 * Turning a picture off somebody's disk into a value a CSS declaration can hold.
 *
 * There is nowhere to put a file. An edit is a set of CSS declarations, saved per site in
 * `chrome.storage.local`, and a declaration is a string — so the picture has to *become*
 * the string, as a `data:` URL. That is fine for a background and ruinous if it is done
 * naively: a photo straight off a phone is several megabytes, base64 makes it a third
 * bigger again, and the whole extension has ten megabytes of local storage to live in.
 *
 * So a raster image is decoded, scaled to fit a sensible longest edge, and re-encoded —
 * stepping the quality and the size down until it fits the budget, and refusing rather
 * than silently storing something enormous. An SVG is left alone: it is already text, it
 * is usually tiny, and rasterising a vector to put it behind a page would be vandalism.
 */

import { MAX_IMAGE_VALUE } from './css-values.js';

/** What the picker offers. HEIC is included because phones produce it; see `decode`. */
export const IMAGE_ACCEPT = [
  '.png', '.jpg', '.jpeg', '.heic', '.heif', '.svg',
  'image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/svg+xml',
].join(',');

/**
 * Ceiling on the encoded string, comfortably inside `chrome.storage.local`'s ten
 * megabytes with room for the themes and the rest of the site's edits beside it.
 *
 * Taken from the declaration gate rather than chosen here, less the `url("…")` the value
 * gets wrapped in. Producing an image the gate would then refuse is not a smaller bug for
 * being a quiet one: the picture is read, shrunk, encoded, handed over, and dropped
 * without a mark on the page.
 */
const MAX_BYTES = MAX_IMAGE_VALUE - 16;

/**
 * Sizes and qualities to try, in order, keeping the first result that fits.
 *
 * The first rung is a retina-ish full-screen background; the last is still larger than
 * most laptop viewports. An image that cannot be made to fit even at the bottom rung is
 * refused, because the alternative is filling the user's storage quota on their behalf.
 */
const STEPS = [
  { edge: 2560, quality: 0.82 },
  { edge: 1920, quality: 0.78 },
  { edge: 1440, quality: 0.72 },
  { edge: 1080, quality: 0.66 },
];

/** Something the user needs told, rather than a fault to log. */
export class ImageError extends Error {}

/**
 * The largest box within `maxEdge` that keeps the original proportions.
 *
 * Never enlarges: an image smaller than the ceiling is already the right size, and
 * scaling it up would spend bytes inventing detail that was never there.
 *
 * @returns {{width:number, height:number}|null} null when the dimensions make no sense
 */
export function fitDimensions(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0 || !(maxEdge > 0)) return null;
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** True for the two names a vector arrives under. */
function isSvg(file) {
  return (file?.type ?? '').toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file?.name ?? '');
}

/** True for the format phones write and most browsers still cannot read. */
function isHeic(file) {
  const type = (file?.type ?? '').toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || /\.hei[cf]$/i.test(file?.name ?? '');
}

/** Base64 for arbitrary bytes, in chunks so a large image cannot blow the argument list. */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decodes the file, or says why it could not be.
 *
 * `createImageBitmap` is the browser's own decoder, so what it accepts is exactly what the
 * browser can later paint — which is the useful test. HEIC is the case worth naming: Chrome
 * has no HEIC decoder, so an iPhone photo fails here, and it would fail in
 * `background-image` too. Telling somebody to convert it is a real answer; storing four
 * megabytes of undisplayable data is not.
 */
async function decode(file, view) {
  try {
    return await view.createImageBitmap(file);
  } catch {
    throw new ImageError(isHeic(file)
      ? 'This browser cannot read HEIC photos. Convert it to JPEG or PNG and try again.'
      : 'That image could not be read.');
  }
}

/**
 * Reads a picked image file into a `data:` URL fit to put in a CSS declaration.
 *
 * @param {File} file
 * @param {typeof globalThis} view the window to decode in, injectable for tests
 * @returns {Promise<{url:string, width:number|null, height:number|null, bytes:number}>}
 * @throws {ImageError} with a sentence meant for the user
 */
export async function readImageFile(file, view = globalThis) {
  if (!file) throw new ImageError('No image was chosen.');

  if (isSvg(file)) {
    const text = await file.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > MAX_BYTES) throw new ImageError('That SVG is too large to store.');
    // Base64 rather than percent-encoding: an SVG is full of characters that would need
    // escaping anyway, and an unescaped `#` inside a `url()` truncates it at the first
    // colour it meets.
    return {
      url: `data:image/svg+xml;base64,${toBase64(bytes)}`,
      width: null,
      height: null,
      bytes: bytes.length,
    };
  }

  const bitmap = await decode(file, view);
  try {
    for (const step of STEPS) {
      const size = fitDimensions(bitmap.width, bitmap.height, step.edge);
      if (!size) throw new ImageError('That image has no usable size.');

      const canvas = new view.OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext('2d');
      if (!context) throw new ImageError('That image could not be prepared.');
      context.drawImage(bitmap, 0, 0, size.width, size.height);

      // WebP keeps the alpha channel, so a PNG cut-out stays cut out.
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: step.quality });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const url = `data:image/webp;base64,${toBase64(bytes)}`;
      if (url.length <= MAX_BYTES) {
        return { url, width: size.width, height: size.height, bytes: url.length };
      }
    }
    throw new ImageError('That image is too large to store, even shrunk. Try a smaller one.');
  } finally {
    bitmap.close?.();
  }
}

/**
 * How a picked image should sit in the thing it was picked for.
 *
 * `cover` fills the box and crops whatever does not fit, which is what somebody choosing a
 * background usually pictures — but only while the crop is small. A tall photo on a wide
 * strip keeps about a twentieth of itself under `cover`, and the result is not a background
 * so much as a smear of whichever pixels happened to be in the middle. Where that much
 * would be lost, the whole picture is shown instead.
 *
 * The page is the same judgement against a different box. A body's background paints the
 * entire viewport however short the body is, but it is *sized* against the body's own box
 * — so on a page with two lines of content, `cover` scales the picture to a 180px strip and
 * stretches that across the screen. Anchoring it to the viewport makes the box the thing
 * the picture is actually being painted on, and then the same comparison applies: a
 * landscape photo fills the screen, a tall one is shown whole rather than as a band of its
 * own middle.
 *
 * @param {{width:number|null, height:number|null}} image as `readImageFile` returned it
 * @param {{width:number, height:number}|null} box the target's rendered box
 * @param {{page?:boolean, viewport?:{width:number, height:number}|null}} options `page` for
 *   `<body>` and `<html>`, which are measured against the `viewport` instead of their box
 * @returns {Object<string,string>} declarations, to be set together
 */
export function backgroundFit(image, box, { page = false, viewport = null } = {}) {
  const base = { 'background-position': 'center', 'background-repeat': 'no-repeat' };
  // Anchored to the viewport, so what it is sized against is what it is painted on.
  if (page) base['background-attachment'] = 'fixed';

  const picture = ratioOf(image?.width, image?.height);
  const against = page ? (viewport ?? box) : box;
  const target = ratioOf(against?.width, against?.height);
  // An SVG reports no dimensions of its own, and a box has to have been measured. Without
  // both there is nothing to compare, and filling the box is the better guess.
  if (!picture || !target) return { ...base, 'background-size': 'cover' };

  // The fraction of the picture that survives `cover`.
  const kept = Math.min(picture, target) / Math.max(picture, target);
  return { ...base, 'background-size': kept >= COVER_FLOOR ? 'cover' : 'contain' };
}

/** How much of a picture may be cropped before showing all of it is the better answer. */
const COVER_FLOOR = 0.6;

function ratioOf(width, height) {
  return width > 0 && height > 0 ? width / height : null;
}

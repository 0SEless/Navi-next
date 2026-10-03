/**
 * Object-key convention for 360° panorama images in the private `navi-360`
 * bucket.
 *
 * Key shape (deterministic — one key per campus/panorama, so re-ingesting a
 * panorama replaces its own object and can never touch another):
 *
 *     panoramas/<campusId>/<panoramaId>.<jpg|png|webp>
 *
 * Security contract:
 *  - Keys are ALWAYS generated server-side from validated ids; clients never
 *    choose, influence, or pass raw keys into a signer except through
 *    `isPanoramaKey`.
 *  - `isPanoramaKey` is the single admission gate for any externally supplied
 *    key (resolve/complete). It is anchored, lowercase, segment-bounded, and
 *    rejects traversal (`..`), separators, whitespace, control characters,
 *    and anything outside the panorama namespace — so a signed URL can never
 *    be minted for an object this module did not bless.
 *  - Ids are restricted to `[a-z0-9][a-z0-9_-]{0,63}`: no dots, no slashes,
 *    no uppercase, no percent-encoding tricks.
 */

/** Content types accepted for panorama ingestion (exact match). */
export const PANORAMA_ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PanoramaContentType = (typeof PANORAMA_ALLOWED_CONTENT_TYPES)[number];

/** Maximum panorama byte size accepted by the signer (25 MiB). */
export const PANORAMA_MAX_BYTES = 25 * 1024 * 1024;

/** Fixed namespace prefix for every panorama object. */
export const PANORAMA_KEY_PREFIX = "panoramas/";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEY_PATTERN =
  /^panoramas\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}\.(jpg|png|webp)$/;

/** Narrow a value to a valid campus/panorama id. */
export function isPanoramaId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Narrow a value to a key produced by `buildPanoramaKey`. */
export function isPanoramaKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Defense in depth: the pattern already forbids dots inside segments, but
  // traversal must be impossible even if the pattern is ever loosened.
  if (value.includes("..")) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  return KEY_PATTERN.test(value);
}

/** Map an accepted content type to its canonical lowercase extension. */
export function extensionForContentType(contentType: string): "jpg" | "png" | "webp" {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new TypeError(`Unsupported panorama content type: ${contentType}`);
  }
}

/**
 * Build the deterministic object key for a panorama.
 * Throws `TypeError` on any id or content type that fails validation — a
 * caller must never be able to produce a key outside the namespace.
 */
export function buildPanoramaKey(
  campusId: unknown,
  panoramaId: unknown,
  contentType: unknown,
): string {
  if (!isPanoramaId(campusId)) {
    throw new TypeError("Invalid campusId for panorama key");
  }
  if (!isPanoramaId(panoramaId)) {
    throw new TypeError("Invalid panoramaId for panorama key");
  }
  if (typeof contentType !== "string") {
    throw new TypeError("Invalid contentType for panorama key");
  }
  const ext = extensionForContentType(contentType);
  const key = `${PANORAMA_KEY_PREFIX}${campusId}/${panoramaId}.${ext}`;
  // Invariant: whatever we build must pass the admission gate.
  if (!isPanoramaKey(key)) {
    throw new TypeError("Built panorama key failed validation");
  }
  return key;
}

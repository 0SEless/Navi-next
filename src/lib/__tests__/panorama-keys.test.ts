import { describe, expect, it } from "vitest";
import {
  PANORAMA_ALLOWED_CONTENT_TYPES,
  PANORAMA_MAX_BYTES,
  buildPanoramaKey,
  extensionForContentType,
  isPanoramaId,
  isPanoramaKey,
} from "../panorama-keys";

describe("panorama object-key convention", () => {
  it("builds a deterministic namespaced key", () => {
    expect(buildPanoramaKey("usm-main", "pano-lobby", "image/jpeg")).toBe(
      "panoramas/usm-main/pano-lobby.jpg",
    );
    expect(buildPanoramaKey("c1", "p1", "image/png")).toBe(
      "panoramas/c1/p1.png",
    );
    expect(buildPanoramaKey("c1", "p1", "image/webp")).toBe(
      "panoramas/c1/p1.webp",
    );
  });

  it("is idempotent — same inputs always yield the same key (replace-in-place)", () => {
    const a = buildPanoramaKey("usm-main", "pano-lobby", "image/jpeg");
    const b = buildPanoramaKey("usm-main", "pano-lobby", "image/jpeg");
    expect(a).toBe(b);
  });

  it("maps extensions only for allowed content types", () => {
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
    expect(extensionForContentType("image/png")).toBe("png");
    expect(extensionForContentType("image/webp")).toBe("webp");
    expect(() => extensionForContentType("image/gif")).toThrow();
    expect(() => extensionForContentType("text/html")).toThrow();
    expect(() => extensionForContentType("")).toThrow();
  });

  it("rejects unsafe ids at build time (key injection)", () => {
    // Path traversal / separator injection attempts must throw, not escape
    // the panorama namespace.
    expect(() => buildPanoramaKey("../other", "p1", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "../../etc/passwd", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "a/b", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "a\\b", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("", "p1", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("UPPER", "p1", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "PANO.1", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "pano 1", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "pano\u0000", "image/jpeg")).toThrow();
    expect(() => buildPanoramaKey("c1", "a".repeat(65), "image/jpeg")).toThrow();
  });

  it("validates ids and keys with strict predicates", () => {
    expect(isPanoramaId("usm-main")).toBe(true);
    expect(isPanoramaId("map_1")).toBe(true);
    expect(isPanoramaId("9")).toBe(true);
    expect(isPanoramaId("../x")).toBe(false);
    expect(isPanoramaId("A")).toBe(false);
    expect(isPanoramaId("")).toBe(false);
    expect(isPanoramaId(undefined)).toBe(false);
    expect(isPanoramaId(42)).toBe(false);

    expect(isPanoramaKey(buildPanoramaKey("usm-main", "pano-lobby", "image/jpeg"))).toBe(true);
    expect(isPanoramaKey(buildPanoramaKey("c1", "p1", "image/webp"))).toBe(true);

    // Every escape attempt must be rejected outright.
    const rejected: unknown[] = [
      "panoramas/../secret.jpg",
      "panoramas/../../etc/passwd",
      "panoramas/c1/../../c2/p1.jpg",
      "panoramas/c1/sub/p1.jpg",
      "panoramas/c1/",
      "panoramas/c1/p1",
      "panoramas/c1/p1.gif",
      "_navi-tests/r2-connectivity-test.txt",
      "navi-360/panoramas/c1/p1.jpg",
      "/panoramas/c1/p1.jpg",
      "panoramas/c1/p1.JPG",
      "PANORAMAS/c1/p1.jpg",
      "panoramas/C1/p1.jpg",
      "panoramas/c1/p1%2ejpg",
      "panoramas/c1/%2e%2e/p1.jpg",
      "panoramas/c1/p1.jpg ",
      "panoramas/c1/p1.jpg\n",
      "",
      "panoramas",
      null,
      undefined,
      42,
      {},
    ];
    for (const key of rejected) {
      expect(isPanoramaKey(key), `should reject: ${String(key)}`).toBe(false);
    }
  });

  it("exposes the documented limits", () => {
    expect(PANORAMA_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect([...PANORAMA_ALLOWED_CONTENT_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});

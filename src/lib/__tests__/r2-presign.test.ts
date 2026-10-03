import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PANORAMA_GET_TTL_SECONDS,
  PANORAMA_PUT_TTL_SECONDS,
  presignPanoramaGet,
  presignPanoramaPut,
  type R2Config,
} from "../r2";

const SECRET_SENTINEL = "SECRET_SENTINEL_42_MUST_NOT_APPEAR";

const config: R2Config = {
  endpoint: "https://acctid.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "navi-360",
  accessKeyId: "AKID_TEST_SENTINEL",
  secretAccessKey: SECRET_SENTINEL,
};

const KEY = "panoramas/usm-main/pano-lobby.jpg";

beforeEach(() => {
  // The default test environment defines `window`; signing must run in a
  // server runtime, so neutralize it unless a test explicitly re-stubs it.
  vi.stubGlobal("window", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("presigned panorama URLs", () => {
  it("signs a GET scoped to the exact bucket and key with the default TTL", async () => {
    const url = await presignPanoramaGet(config, KEY);
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://acctid.r2.cloudflarestorage.com");
    // forcePathStyle: bucket is the first path segment, then the exact key.
    expect(parsed.pathname).toBe(`/navi-360/${KEY}`);
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe(
      String(PANORAMA_GET_TTL_SECONDS),
    );
    expect(PANORAMA_GET_TTL_SECONDS).toBe(300);
    // The secret key must never appear in any signed URL.
    expect(url).not.toContain(SECRET_SENTINEL);
  });

  it("signs a PUT with the default TTL (content-type enforced at completion, not signature)", async () => {
    const url = await presignPanoramaPut(config, KEY, "image/jpeg");
    const parsed = new URL(url);

    expect(parsed.pathname).toBe(`/navi-360/${KEY}`);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe(
      String(PANORAMA_PUT_TTL_SECONDS),
    );
    expect(PANORAMA_PUT_TTL_SECONDS).toBe(600);
    // Documented SDK behavior (s3-request-presigner dist-cjs/index.js:47
    // hardcodes content-type as unsignable): SignedHeaders is `host` only.
    // This assertion locks in that fact so a future SDK change is noticed;
    // the content-type allowlist is enforced at sign time and re-verified
    // against the stored object at completion time instead.
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url).not.toContain(SECRET_SENTINEL);
  });

  it("refuses to sign keys outside the panorama namespace", async () => {
    const badKeys = [
      "../secret.txt",
      "_navi-tests/r2-connectivity-test.txt",
      "panoramas/../other/p1.jpg",
      "panoramas/c1/../../c2/p1.jpg",
      "navi-360/panoramas/c1/p1.jpg",
      "panoramas/c1/p1.gif",
      "",
    ];
    for (const key of badKeys) {
      await expect(
        presignPanoramaGet(config, key),
        `GET must reject: ${key}`,
      ).rejects.toThrow();
      await expect(
        presignPanoramaPut(config, key, "image/jpeg"),
        `PUT must reject: ${key}`,
      ).rejects.toThrow();
    }
  });

  it("refuses content types outside the allowed list", async () => {
    await expect(
      presignPanoramaPut(config, KEY, "text/html"),
    ).rejects.toThrow();
    await expect(presignPanoramaPut(config, KEY, "")).rejects.toThrow();
  });

  it("bounds the TTL", async () => {
    await expect(presignPanoramaGet(config, KEY, 0)).rejects.toThrow();
    await expect(presignPanoramaGet(config, KEY, 100_000)).rejects.toThrow();
    await expect(presignPanoramaGet(config, KEY, 1.5)).rejects.toThrow();
    await expect(presignPanoramaPut(config, KEY, "image/jpeg", -1)).rejects.toThrow();
  });

  it("refuses to run in a browser runtime", async () => {
    vi.stubGlobal("window", { location: {} });
    await expect(presignPanoramaGet(config, KEY)).rejects.toThrow(
      /server runtime|server/i,
    );
    await expect(presignPanoramaPut(config, KEY, "image/jpeg")).rejects.toThrow(
      /server runtime|server/i,
    );
  });
});

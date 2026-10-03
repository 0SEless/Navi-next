// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/panorama-resolve/route";

const { presignGetMock, storeMocks } = vi.hoisted(() => ({
  presignGetMock: vi.fn(),
  storeMocks: { getStore: vi.fn(), find: vi.fn() },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return { ...actual, presignPanoramaGet: presignGetMock };
});

vi.mock("@/lib/panorama-asset-store", () => ({
  getPanoramaAssetStore: storeMocks.getStore,
  // Unchanged collaborators kept so the module shape matches.
  recordSignedAsset: vi.fn(),
  markPanoramaAssetUploaded: vi.fn(),
  findPanoramaAsset: storeMocks.find,
}));

const R2_ENV = {
  R2_ENDPOINT: "https://sentinel-endpoint.example",
  R2_BUCKET: "navi-360",
  R2_ACCESS_KEY_ID: "sentinel-access-key-id",
  R2_SECRET_ACCESS_KEY: "sentinel-secret-access-key",
  R2_REGION: "auto",
};

const KEY = "panoramas/usm-main/pano-lobby.jpg";
const SIGNED_GET = "https://signed-get.example/panoramas/usm-main/pano-lobby.jpg?X-Amz-Expires=300";

const req = (query: string) =>
  new NextRequest(`http://x/api/panorama-resolve${query ? `?${query}` : ""}`);

const UPLOADED = {
  key: KEY,
  campusId: "usm-main",
  panoramaId: "pano-lobby",
  contentType: "image/jpeg",
  byteSize: 4_800_000,
  status: "uploaded" as const,
};

beforeEach(() => {
  for (const [key, value] of Object.entries(R2_ENV)) vi.stubEnv(key, value);
  storeMocks.getStore.mockReturnValue({ ok: true, client: { sentinel: "client" } });
  storeMocks.find.mockResolvedValue(UPLOADED);
  presignGetMock.mockResolvedValue(SIGNED_GET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /api/panorama-resolve (public, registry-gated)", () => {
  it("400 when the key parameter is missing", async () => {
    const res = await GET(req(""));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "key" });
    expect(storeMocks.find).not.toHaveBeenCalled();
    expect(presignGetMock).not.toHaveBeenCalled();
  });

  it("400 when the key escapes the panorama namespace (no lookup, no signing)", async () => {
    for (const key of [
      "../secret.txt",
      "_navi-tests/r2-connectivity-test.txt",
      "panoramas/../other/p1.jpg",
      "navi-360/panoramas/c1/p1.jpg",
      "panoramas/c1/p1.gif",
      "panoramas/c1/../../etc/passwd",
    ]) {
      const res = await GET(req(`key=${encodeURIComponent(key)}`));
      expect(res.status, key).toBe(400);
    }
    expect(storeMocks.find).not.toHaveBeenCalled();
    expect(presignGetMock).not.toHaveBeenCalled();
  });

  it("404 for a well-formed key that is not in the registry", async () => {
    storeMocks.find.mockResolvedValue(null);

    const res = await GET(req(`key=${encodeURIComponent(KEY)}`));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
    expect(presignGetMock).not.toHaveBeenCalled();
  });

  it("404 while the asset is still only signed (upload not completed) — no state leak", async () => {
    storeMocks.find.mockResolvedValue({ ...UPLOADED, status: "signed" });

    const res = await GET(req(`key=${encodeURIComponent(KEY)}`));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
    expect(presignGetMock).not.toHaveBeenCalled();
  });

  it("200 with a short-lived signed GET URL for a completed asset — without any session", async () => {
    // No cookies: resolution is public but strictly registry-gated.
    const res = await GET(req(`key=${encodeURIComponent(KEY)}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, url: SIGNED_GET });
    const expires = new Date(body.expiresAt).getTime();
    expect(Number.isFinite(expires)).toBe(true);
    // Default GET TTL = 300s (unit-tested in r2-presign.test.ts).
    expect(Math.abs(expires - (Date.now() + 300_000))).toBeLessThan(5_000);

    // Called with (config, key) only → default TTL, server-generated scope.
    expect(presignGetMock).toHaveBeenCalledTimes(1);
    const [config, signedKey, ttl] = presignGetMock.mock.calls[0];
    expect(signedKey).toBe(KEY);
    expect(ttl).toBeUndefined();
    expect(config.bucket).toBe("navi-360");

    const text = JSON.stringify(body);
    expect(text).not.toContain("sentinel-secret-access-key");
    expect(text).not.toContain("sentinel-access-key-id");
    expect(text).not.toContain("sentinel-endpoint.example");
  });

  it("500 missing_configuration with names only when R2 env is incomplete", async () => {
    vi.stubEnv("R2_ACCESS_KEY_ID", "");

    const res = await GET(req(`key=${encodeURIComponent(KEY)}`));

    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("missing_configuration");
    expect(text).toContain("R2_ACCESS_KEY_ID");
    expect(text).not.toContain("sentinel-endpoint.example");
    expect(presignGetMock).not.toHaveBeenCalled();
  });

  it("500 registry_unavailable with names only when the DB env is missing", async () => {
    storeMocks.getStore.mockReturnValue({ ok: false, missing: ["SUPABASE_SERVICE_ROLE_KEY"] });

    const res = await GET(req(`key=${encodeURIComponent(KEY)}`));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "registry_unavailable",
      missing: ["SUPABASE_SERVICE_ROLE_KEY"],
    });
    expect(presignGetMock).not.toHaveBeenCalled();
  });

  it("502 presign_failed when signing fails locally, with no secret in the body", async () => {
    presignGetMock.mockRejectedValue(new TypeError("get-signing-sentinel"));

    const res = await GET(req(`key=${encodeURIComponent(KEY)}`));

    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("presign_failed");
    expect(text).not.toContain("get-signing-sentinel");
    expect(text).not.toContain("sentinel-secret-access-key");
  });
});

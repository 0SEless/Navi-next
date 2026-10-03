// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/panorama-upload/route";

const { presignPutMock, headMock, storeMocks } = vi.hoisted(() => ({
  presignPutMock: vi.fn(),
  headMock: vi.fn(),
  storeMocks: {
    getStore: vi.fn(),
    record: vi.fn(),
    find: vi.fn(),
    mark: vi.fn(),
  },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return { ...actual, presignPanoramaPut: presignPutMock, headPanoramaObject: headMock };
});

vi.mock("@/lib/panorama-asset-store", () => ({
  getPanoramaAssetStore: storeMocks.getStore,
  recordSignedAsset: storeMocks.record,
  findPanoramaAsset: storeMocks.find,
  markPanoramaAssetUploaded: storeMocks.mark,
}));

const SESSION = { cookie: "sb-abcdefgh-auth-token=trusted-session" };

const R2_ENV = {
  R2_ENDPOINT: "https://sentinel-endpoint.example",
  R2_BUCKET: "navi-360",
  R2_ACCESS_KEY_ID: "sentinel-access-key-id",
  R2_SECRET_ACCESS_KEY: "sentinel-secret-access-key",
  R2_REGION: "auto",
};

const SIGN_BODY = {
  action: "sign",
  campusId: "usm-main",
  panoramaId: "pano-lobby",
  contentType: "image/jpeg",
  byteSize: 4_800_000,
};

const SIGNED_URL = "https://signed-upload.example/panoramas/usm-main/pano-lobby.jpg?X-Amz-Sentinel=1";

const req = (payload: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://x/api/panorama-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

beforeEach(() => {
  for (const [key, value] of Object.entries(R2_ENV)) vi.stubEnv(key, value);
  storeMocks.getStore.mockReturnValue({ ok: true, client: { sentinel: "client" } });
  storeMocks.record.mockResolvedValue(undefined);
  storeMocks.find.mockResolvedValue(null);
  storeMocks.mark.mockResolvedValue(true);
  presignPutMock.mockResolvedValue(SIGNED_URL);
  headMock.mockResolvedValue({ ok: true, contentType: "image/jpeg", byteSize: 4_800_000 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("POST /api/panorama-upload", () => {
  it("401 without a session, before any signing, registry, or network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(req(SIGN_BODY));

    expect(res.status).toBe(401);
    expect(presignPutMock).not.toHaveBeenCalled();
    expect(storeMocks.getStore).not.toHaveBeenCalled();
    expect(storeMocks.record).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400 on unparseable JSON", async () => {
    const bad = new NextRequest("http://x/api/panorama-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...SESSION },
      body: "{not json",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(presignPutMock).not.toHaveBeenCalled();
  });

  it("400 when byteSize exceeds the documented maximum", async () => {
    const res = await POST(req({ ...SIGN_BODY, byteSize: 26 * 1024 * 1024 }, SESSION));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request", field: "byteSize" });
    expect(presignPutMock).not.toHaveBeenCalled();
    expect(storeMocks.record).not.toHaveBeenCalled();
  });

  it("400 when byteSize is not a positive integer", async () => {
    for (const byteSize of [0, -5, 1.5, "100", null]) {
      const res = await POST(req({ ...SIGN_BODY, byteSize }, SESSION));
      expect(res.status, `byteSize=${String(byteSize)}`).toBe(400);
    }
    expect(presignPutMock).not.toHaveBeenCalled();
  });

  it("400 when campusId would escape the panorama namespace", async () => {
    for (const campusId of ["../other", "a/b", "UPPER", "", "a b"]) {
      const res = await POST(req({ ...SIGN_BODY, campusId }, SESSION));
      expect(res.status, `campusId=${campusId}`).toBe(400);
      expect(await res.json()).toMatchObject({ field: "campusId" });
    }
    expect(presignPutMock).not.toHaveBeenCalled();
  });

  it("400 when panoramaId would escape the panorama namespace", async () => {
    for (const panoramaId of ["../../etc/passwd", "p/1", "PANO", ""]) {
      const res = await POST(req({ ...SIGN_BODY, panoramaId }, SESSION));
      expect(res.status, `panoramaId=${panoramaId}`).toBe(400);
      expect(await res.json()).toMatchObject({ field: "panoramaId" });
    }
    expect(presignPutMock).not.toHaveBeenCalled();
  });

  it("400 for content types outside the allowlist", async () => {
    for (const contentType of ["text/html", "image/gif", "", "image/svg+xml"]) {
      const res = await POST(req({ ...SIGN_BODY, contentType }, SESSION));
      expect(res.status, `contentType=${contentType}`).toBe(400);
      expect(await res.json()).toMatchObject({ field: "contentType" });
    }
    expect(presignPutMock).not.toHaveBeenCalled();
  });

  it("423 for a protected campus, before signing or writing", async () => {
    const res = await POST(req({ ...SIGN_BODY, campusId: "map-map-1-k6bv" }, SESSION));

    expect(res.status).toBe(423);
    expect(presignPutMock).not.toHaveBeenCalled();
    expect(storeMocks.record).not.toHaveBeenCalled();
  });

  it("signs the server-generated key and records the asset without leaking secrets", async () => {
    const res = await POST(req(SIGN_BODY, SESSION));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      key: "panoramas/usm-main/pano-lobby.jpg",
      uploadUrl: SIGNED_URL,
      requiredContentType: "image/jpeg",
      maxBytes: 25 * 1024 * 1024,
    });
    // expiresAt ~ now + 10 minutes.
    const expires = new Date(body.expiresAt).getTime();
    const drift = Math.abs(expires - (Date.now() + 600_000));
    expect(Number.isFinite(expires)).toBe(true);
    expect(drift).toBeLessThan(5_000);

    expect(presignPutMock).toHaveBeenCalledTimes(1);
    const [config, key, contentType] = presignPutMock.mock.calls[0];
    expect(key).toBe("panoramas/usm-main/pano-lobby.jpg");
    expect(contentType).toBe("image/jpeg");
    expect(config.bucket).toBe("navi-360");
    expect(config.secretAccessKey).toBe("sentinel-secret-access-key");

    expect(storeMocks.record).toHaveBeenCalledTimes(1);
    expect(storeMocks.record.mock.calls[0][1]).toEqual({
      key: "panoramas/usm-main/pano-lobby.jpg",
      campusId: "usm-main",
      panoramaId: "pano-lobby",
      contentType: "image/jpeg",
      byteSize: 4_800_000,
    });

    const text = JSON.stringify(body);
    expect(text).not.toContain("sentinel-secret-access-key");
    expect(text).not.toContain("sentinel-access-key-id");
    expect(text).not.toContain("sentinel-endpoint.example");
  });

  it("500 missing_configuration with variable names only when R2 env is incomplete", async () => {
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");

    const res = await POST(req(SIGN_BODY, SESSION));

    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("missing_configuration");
    expect(text).toContain("R2_SECRET_ACCESS_KEY");
    expect(text).not.toContain("sentinel-endpoint.example");
    expect(text).not.toContain("sentinel-access-key-id");
    expect(presignPutMock).not.toHaveBeenCalled();
    expect(storeMocks.record).not.toHaveBeenCalled();
  });

  it("500 registry_unavailable with names only when the DB env is missing", async () => {
    storeMocks.getStore.mockReturnValue({
      ok: false,
      missing: ["SUPABASE_SERVICE_ROLE_KEY"],
    });

    const res = await POST(req(SIGN_BODY, SESSION));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "registry_unavailable",
      missing: ["SUPABASE_SERVICE_ROLE_KEY"],
    });
    // Fail fast: no URL may be minted when the asset cannot be tracked.
    expect(presignPutMock).not.toHaveBeenCalled();
    expect(storeMocks.record).not.toHaveBeenCalled();
  });

  it("500 registry_write_failed without echoing the upload URL when the registry write fails", async () => {
    storeMocks.record.mockRejectedValue(new Error("registry-write-sentinel"));

    const res = await POST(req(SIGN_BODY, SESSION));

    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("registry_write_failed");
    // The signed URL must never leave the server if tracking failed.
    expect(text).not.toContain("signed-upload.example");
    expect(text).not.toContain("registry-write-sentinel");
  });

  it("502 presign_failed when signing fails locally", async () => {
    presignPutMock.mockRejectedValue(new TypeError("signing-sentinel-failure"));

    const res = await POST(req(SIGN_BODY, SESSION));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ error: "presign_failed" });
    expect(JSON.stringify(body)).not.toContain("signing-sentinel-failure");
    expect(storeMocks.record).not.toHaveBeenCalled();
  });

  it("400 on malformed keys for complete", async () => {
    for (const key of ["../secret.txt", "_navi-tests/x.txt", "", "panoramas/c1/sub/p1.jpg", "panoramas/c1/p1.PNG"]) {
      const res = await POST(req({ action: "complete", key }, SESSION));
      expect(res.status, `key=${key}`).toBe(400);
    }
    expect(storeMocks.find).not.toHaveBeenCalled();
    expect(headMock).not.toHaveBeenCalled();
  });

  it("404 for a key that was never registered", async () => {
    storeMocks.find.mockResolvedValue(null);

    const res = await POST(
      req({ action: "complete", key: "panoramas/usm-main/pano-lobby.jpg" }, SESSION),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_registered" });
    expect(headMock).not.toHaveBeenCalled();
    expect(storeMocks.mark).not.toHaveBeenCalled();
  });

  it("complete verifies the object and records the upload", async () => {
    storeMocks.find.mockResolvedValue({
      key: "panoramas/usm-main/pano-lobby.jpg",
      campusId: "usm-main",
      panoramaId: "pano-lobby",
      contentType: "image/jpeg",
      byteSize: 4_800_000,
      status: "signed",
    });

    const res = await POST(
      req({ action: "complete", key: "panoramas/usm-main/pano-lobby.jpg" }, SESSION),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      key: "panoramas/usm-main/pano-lobby.jpg",
      byteSize: 4_800_000,
      contentType: "image/jpeg",
    });
    expect(headMock).toHaveBeenCalledTimes(1);
    expect(storeMocks.mark).toHaveBeenCalledWith(
      { sentinel: "client" },
      "panoramas/usm-main/pano-lobby.jpg",
      4_800_000,
    );
  });

  it("400 object_validation_failed when the stored Content-Type differs from the approved one", async () => {
    storeMocks.find.mockResolvedValue({
      key: "panoramas/usm-main/pano-lobby.jpg",
      campusId: "usm-main",
      panoramaId: "pano-lobby",
      contentType: "image/jpeg",
      byteSize: 4_800_000,
      status: "signed",
    });
    headMock.mockResolvedValue({ ok: true, contentType: "text/html", byteSize: 4_800_000 });

    const res = await POST(
      req({ action: "complete", key: "panoramas/usm-main/pano-lobby.jpg" }, SESSION),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "object_validation_failed",
      reason: "content_type_mismatch",
    });
    expect(storeMocks.mark).not.toHaveBeenCalled();
  });

  it("400 object_validation_failed when the object exceeds the size cap", async () => {
    storeMocks.find.mockResolvedValue({
      key: "panoramas/usm-main/pano-lobby.jpg",
      campusId: "usm-main",
      panoramaId: "pano-lobby",
      contentType: "image/jpeg",
      byteSize: 4_800_000,
      status: "signed",
    });
    headMock.mockResolvedValue({
      ok: true,
      contentType: "image/jpeg",
      byteSize: 26 * 1024 * 1024,
    });

    const res = await POST(
      req({ action: "complete", key: "panoramas/usm-main/pano-lobby.jpg" }, SESSION),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "object_validation_failed",
      reason: "size_out_of_bounds",
    });
    expect(storeMocks.mark).not.toHaveBeenCalled();
  });

  it("404 object_not_found when R2 has no such object", async () => {
    storeMocks.find.mockResolvedValue({
      key: "panoramas/usm-main/pano-lobby.jpg",
      campusId: "usm-main",
      panoramaId: "pano-lobby",
      contentType: "image/jpeg",
      byteSize: 4_800_000,
      status: "signed",
    });
    headMock.mockResolvedValue({ ok: false, notFound: true });

    const res = await POST(
      req({ action: "complete", key: "panoramas/usm-main/pano-lobby.jpg" }, SESSION),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "object_not_found" });
    expect(storeMocks.mark).not.toHaveBeenCalled();
  });

  it("502 sanitized r2_request_failed when HeadObject fails unexpectedly", async () => {
    storeMocks.find.mockResolvedValue({
      key: "panoramas/usm-main/pano-lobby.jpg",
      campusId: "usm-main",
      panoramaId: "pano-lobby",
      contentType: "image/jpeg",
      byteSize: 4_800_000,
      status: "signed",
    });
    headMock.mockRejectedValue(
      Object.assign(new Error("head-sentinel-message-must-not-leak"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403, requestId: "req-9" },
      }),
    );

    const res = await POST(
      req({ action: "complete", key: "panoramas/usm-main/pano-lobby.jpg" }, SESSION),
    );

    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("r2_request_failed");
    expect(text).toContain("AccessDenied");
    expect(text).toContain("req-9");
    expect(text).not.toContain("head-sentinel-message-must-not-leak");
    expect(text).not.toContain("sentinel-endpoint.example");
    expect(text).not.toContain("sentinel-secret-access-key");
    expect(storeMocks.mark).not.toHaveBeenCalled();
  });

  it("423 on complete when the registered campus is protected", async () => {
    storeMocks.find.mockResolvedValue({
      key: "panoramas/map-map-1-k6bv/p1.jpg",
      campusId: "map-map-1-k6bv",
      panoramaId: "p1",
      contentType: "image/jpeg",
      byteSize: 1000,
      status: "signed",
    });

    const res = await POST(
      req({ action: "complete", key: "panoramas/map-map-1-k6bv/p1.jpg" }, SESSION),
    );

    expect(res.status).toBe(423);
    expect(headMock).not.toHaveBeenCalled();
    expect(storeMocks.mark).not.toHaveBeenCalled();
  });

  it("400 for an unknown or missing action", async () => {
    for (const payload of [{}, { action: "delete" }, null]) {
      const res = await POST(req(payload, SESSION));
      expect(res.status, JSON.stringify(payload)).toBe(400);
    }
    expect(presignPutMock).not.toHaveBeenCalled();
    expect(headMock).not.toHaveBeenCalled();
  });
});

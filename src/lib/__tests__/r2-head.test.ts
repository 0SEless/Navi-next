// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headPanoramaObject, readR2Config, type R2Config } from "../r2";

const { sendMock, commandInputs } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  commandInputs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = sendMock;
  },
  HeadObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      commandInputs.push(input);
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      commandInputs.push(input);
    }
  },
  GetObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      commandInputs.push(input);
    }
  },
}));

const ENV = {
  R2_ENDPOINT: "https://sentinel-endpoint.example",
  R2_BUCKET: "navi-360",
  R2_ACCESS_KEY_ID: "sentinel-access-key-id",
  R2_SECRET_ACCESS_KEY: "sentinel-secret-access-key",
  R2_REGION: "auto",
};

const KEY = "panoramas/usm-main/pano-lobby.jpg";

const config = (): R2Config => {
  const settings = readR2Config(process.env);
  if (!settings.ok) throw new Error("test env not stubbed");
  return settings.config;
};

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  sendMock.mockReset();
  commandInputs.length = 0;
});

describe("headPanoramaObject", () => {
  it("returns the stored content type and size for an existing object", async () => {
    sendMock.mockResolvedValue({ ContentType: "image/jpeg", ContentLength: 4_800_000 });

    const result = await headPanoramaObject(config(), KEY);

    expect(result).toEqual({
      ok: true,
      contentType: "image/jpeg",
      byteSize: 4_800_000,
    });
    expect(commandInputs[0]).toEqual({ Bucket: "navi-360", Key: KEY });
  });

  it("refuses to inspect keys outside the panorama namespace (no R2 call)", async () => {
    await expect(
      headPanoramaObject(config(), "_navi-tests/r2-connectivity-test.txt"),
    ).rejects.toThrow(/panorama namespace/i);
    await expect(headPanoramaObject(config(), "../x.jpg")).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("maps NotFound (name or 404 status) to { ok:false, notFound:true }", async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { name: "NotFound" }),
    );
    expect(await headPanoramaObject(config(), KEY)).toEqual({
      ok: false,
      notFound: true,
    });

    sendMock.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { $metadata: { httpStatusCode: 404 } }),
    );
    expect(await headPanoramaObject(config(), KEY)).toEqual({
      ok: false,
      notFound: true,
    });
  });

  it("rethrows unexpected errors raw so the caller can sanitize them", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("raw-message-stays-server-side"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403, requestId: "req-1" },
      }),
    );

    await expect(headPanoramaObject(config(), KEY)).rejects.toThrow(
      "raw-message-stays-server-side",
    );
  });
});

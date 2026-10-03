/**
 * Server-only Cloudflare R2 (S3-compatible) helper.
 *
 * Two responsibilities:
 *  1. TEMPORARY connectivity test (original purpose): prove the NAVI server
 *     can authenticate against R2 and write one harmless object to the
 *     private `navi-360` bucket (`runR2ConnectivityTest`, served by
 *     `/api/r2-connectivity-test` — kept unchanged as an infrastructure
 *     diagnostic).
 *  2. Short-lived presigned URLs for 360° panorama ingestion (user-approved
 *     2026-09-25, see spec/NAVI-360-PANORAMA-INGESTION.md):
 *     `presignPanoramaPut` / `presignPanoramaGet`.
 *
 * Security contract:
 *  - Credentials are read from server-side `R2_*` environment variables only
 *    and are never echoed, logged, or serialized anywhere in this module.
 *  - Failure results carry variable *names*, an error *name*, an HTTP status
 *    and a request id — never an environment value, endpoint, or message body.
 *  - The bucket stays private: no ACL is ever set on any object. Access is
 *    granted only through presigned URLs minted here — TTL-bounded, scoped to
 *    a single object key, with PUT additionally pinned to an approved
 *    Content-Type.
 *  - Presigners only ever sign keys blessed by `isPanoramaKey`
 *    (`src/lib/panorama-keys.ts`): no other bucket object can be targeted.
 *  - `createR2Client` (and therefore the presigners) refuses to run in a
 *    browser runtime — credentials and signing never reach the client.
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PANORAMA_ALLOWED_CONTENT_TYPES,
  isPanoramaKey,
} from "./panorama-keys";

/** Environment variables required for R2 connectivity (names only, never values). */
export const R2_REQUIRED_ENV_VARS = [
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

/** Cloudflare R2's documented default region. */
export const R2_DEFAULT_REGION = "auto";

/** Fixed, harmless object used by the connectivity test. */
export const R2_TEST_OBJECT_KEY = "_navi-tests/r2-connectivity-test.txt";
export const R2_TEST_OBJECT_BODY = "NAVI R2 connectivity test";

export interface R2Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type R2ConfigResult =
  | { ok: true; config: R2Config }
  | { ok: false; missing: string[] };

/**
 * Read and validate the R2 configuration. Missing/blank variables are
 * reported by NAME only so a configuration error can never leak a value.
 */
export function readR2Config(
  env: Record<string, string | undefined> = process.env,
): R2ConfigResult {
  const value = (name: string): string => (env[name] ?? "").trim();
  const missing = R2_REQUIRED_ENV_VARS.filter((name) => value(name) === "");

  if (missing.length > 0) {
    return { ok: false, missing: [...missing] };
  }

  return {
    ok: true,
    config: {
      endpoint: value("R2_ENDPOINT"),
      region: value("R2_REGION") || R2_DEFAULT_REGION,
      bucket: value("R2_BUCKET"),
      accessKeyId: value("R2_ACCESS_KEY_ID"),
      secretAccessKey: value("R2_SECRET_ACCESS_KEY"),
    },
  };
}

/** Build the S3-compatible client. Server runtimes only. */
export function createR2Client(config: R2Config): S3Client {
  if (typeof window !== "undefined") {
    throw new Error("R2 client must only be created in a server runtime.");
  }

  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 is reached through a custom endpoint, so path-style addressing is used.
    forcePathStyle: true,
  });
}

/**
 * Reduce an SDK failure to fields that are safe to return over HTTP.
 * `message` is deliberately dropped: it can embed the endpoint, signing
 * material, or request details.
 */
export function sanitizeR2Error(error: unknown): {
  code: string;
  httpStatus?: number;
  requestId?: string;
} {
  const err = error as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
  };

  const name = [err?.name, err?.Code, err?.code].find(
    (candidate) => typeof candidate === "string" && candidate.length > 0,
  );

  const httpStatus = err?.$metadata?.httpStatusCode;
  const requestId = err?.$metadata?.requestId;

  return {
    code: typeof name === "string" ? name : "UnknownError",
    ...(typeof httpStatus === "number" ? { httpStatus } : {}),
    ...(typeof requestId === "string" ? { requestId } : {}),
  };
}

/** Default TTL for panorama upload (PUT) presigned URLs — 10 minutes. */
export const PANORAMA_PUT_TTL_SECONDS = 600;
/** Default TTL for panorama read (GET) presigned URLs — 5 minutes. */
export const PANORAMA_GET_TTL_SECONDS = 300;
/** Hard upper bound for any presigned URL lifetime minted by this module. */
export const MAX_PRESIGN_TTL_SECONDS = 86_400;

/** A signed URL must never outlive this module's intent: bounded, revocable. */
function assertSignableTtl(ttlSeconds: number): void {
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_PRESIGN_TTL_SECONDS
  ) {
    throw new TypeError(
      `Presign TTL must be an integer between 1 and ${MAX_PRESIGN_TTL_SECONDS} seconds.`,
    );
  }
}

/**
 * Sign a short-lived read URL for exactly one panorama object.
 * Refuses any key that `isPanoramaKey` does not bless — the signer can never
 * be aimed at another part of the bucket.
 */
export async function presignPanoramaGet(
  config: R2Config,
  key: string,
  ttlSeconds: number = PANORAMA_GET_TTL_SECONDS,
): Promise<string> {
  if (!isPanoramaKey(key)) {
    throw new TypeError("Refusing to sign a key outside the panorama namespace.");
  }
  assertSignableTtl(ttlSeconds);

  const client = createR2Client(config);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}

/**
 * Sign a short-lived upload URL for exactly one panorama object.
 *
 * The `ContentType` is validated against the allowlist here (so a signature
 * is never minted for an unapproved media type), and the completed object's
 * stored Content-Type is re-verified against it at `complete` time via
 * `HeadObject` before anything enters the asset registry.
 *
 * NOTE (verified 2026-09-25 in
 * `node_modules/@aws-sdk/s3-request-presigner/dist-cjs/index.js:47`): the SDK
 * presigner hardcodes `unsignableHeaders.add("content-type")`, so
 * Content-Type is NOT part of the URL signature — `X-Amz-SignedHeaders` is
 * `host` only. Enforcement therefore lives at completion + the resolve
 * registry gate, not in the signature.
 */
export async function presignPanoramaPut(
  config: R2Config,
  key: string,
  contentType: string,
  ttlSeconds: number = PANORAMA_PUT_TTL_SECONDS,
): Promise<string> {
  if (!isPanoramaKey(key)) {
    throw new TypeError("Refusing to sign a key outside the panorama namespace.");
  }
  if (!(PANORAMA_ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new TypeError("Unsupported panorama content type.");
  }
  assertSignableTtl(ttlSeconds);

  const client = createR2Client(config);
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      // No ACL: the bucket and object remain private.
    }),
    { expiresIn: ttlSeconds },
  );
}

export type R2HeadResult =
  | { ok: true; contentType: string; byteSize: number }
  | { ok: false; notFound: true };

/**
 * Inspect one panorama object without downloading it.
 *
 * Used by `complete` to verify what was actually stored (media type and
 * size) before the asset is allowed into the registry — this is where
 * Content-Type is enforced, since the SDK presigner does not sign it.
 *
 * Only `NotFound`-style failures collapse to `{ ok: false, notFound: true }`;
 * anything else is rethrown raw so the caller can pass it through
 * `sanitizeR2Error` before it reaches a response.
 */
export async function headPanoramaObject(
  config: R2Config,
  key: string,
): Promise<R2HeadResult> {
  if (!isPanoramaKey(key)) {
    throw new TypeError("Refusing to inspect a key outside the panorama namespace.");
  }

  const client = createR2Client(config);
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    return {
      ok: true,
      contentType: typeof result.ContentType === "string" ? result.ContentType : "",
      byteSize: typeof result.ContentLength === "number" ? result.ContentLength : -1,
    };
  } catch (error) {
    const err = error as {
      name?: unknown;
      Code?: unknown;
      code?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };
    const name = [err?.name, err?.Code, err?.code].find(
      (candidate) => typeof candidate === "string" && candidate.length > 0,
    );
    const status = err?.$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
      return { ok: false, notFound: true };
    }
    throw error;
  }
}

export type R2ConnectivityResult =
  | { ok: true; bucket: string; object: string }
  | { ok: false; stage: "configuration"; missing: string[] }
  | {
      ok: false;
      stage: "upload";
      error: { code: string; httpStatus?: number; requestId?: string };
    };

/**
 * Validate configuration, then upload exactly one fixed test object.
 * Returns a sanitized, serialization-safe result — never credentials.
 */
export async function runR2ConnectivityTest(
  env: Record<string, string | undefined> = process.env,
): Promise<R2ConnectivityResult> {
  const settings = readR2Config(env);
  if (!settings.ok) {
    return { ok: false, stage: "configuration", missing: settings.missing };
  }

  const { config } = settings;
  const client = createR2Client(config);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: R2_TEST_OBJECT_KEY,
        Body: R2_TEST_OBJECT_BODY,
        ContentType: "text/plain",
        // No ACL: the bucket and this object remain private.
      }),
    );

    return { ok: true, bucket: config.bucket, object: R2_TEST_OBJECT_KEY };
  } catch (error) {
    return { ok: false, stage: "upload", error: sanitizeR2Error(error) };
  }
}

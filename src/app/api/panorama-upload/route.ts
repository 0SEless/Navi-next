import { NextRequest, NextResponse } from "next/server";
import { assertCampusMutationAllowed, requireVerifiedMutationAuth } from "@/lib/api-guard";
import {
  PANORAMA_PUT_TTL_SECONDS,
  headPanoramaObject,
  presignPanoramaPut,
  readR2Config,
  sanitizeR2Error,
} from "@/lib/r2";
import {
  PANORAMA_ALLOWED_CONTENT_TYPES,
  PANORAMA_MAX_BYTES,
  buildPanoramaKey,
  isPanoramaId,
  isPanoramaKey,
} from "@/lib/panorama-keys";
import {
  findPanoramaAsset,
  getPanoramaAssetStore,
  markPanoramaAssetUploaded,
  recordSignedAsset,
} from "@/lib/panorama-asset-store";

/**
 * Panorama ingestion (admin, session-gated).
 *
 * `sign`   — validate the request, generate the object key server-side,
 *            mint a short-lived presigned PUT, and register the asset as
 *            `signed` so the upload is tracked from the very first byte.
 * `complete` — verify what R2 actually stored (existence, media type, size),
 *            then flip the registry row to `uploaded`. Only `uploaded` rows
 *            can ever be resolved to a read URL.
 *
 * The bucket stays private; the client never chooses the key; the signed URL
 * only leaves the server when the registry write has succeeded.
 */
export const runtime = "nodejs";

const invalid = (field: string) =>
  NextResponse.json({ error: "invalid_request", field }, { status: 400 });

const missingConfig = (missing: string[]) =>
  NextResponse.json({ error: "missing_configuration", missing }, { status: 500 });

const registryUnavailable = (missing: string[]) =>
  NextResponse.json({ error: "registry_unavailable", missing }, { status: 500 });

const registryFail = (error: "registry_read_failed" | "registry_write_failed", detail: string) => {
  console.error(`panorama ${error}:`, detail);
  return NextResponse.json({ error }, { status: 500 });
};

/** Media types are compared without parameters (`image/jpeg; charset=…`). */
const normalizeType = (value: string) => value.split(";")[0].trim().toLowerCase();

export async function POST(request: NextRequest) {
  const unauthorized = await requireVerifiedMutationAuth(request);
  if (unauthorized) return unauthorized;

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body) return invalid("body");

  if (body.action === "sign") return handleSign(body);
  if (body.action === "complete") return handleComplete(body);
  return invalid("action");
}

async function handleSign(body: Record<string, unknown>): Promise<NextResponse> {
  const { campusId, panoramaId, contentType, byteSize } = body;

  if (!isPanoramaId(campusId)) return invalid("campusId");
  if (!isPanoramaId(panoramaId)) return invalid("panoramaId");
  if (
    typeof contentType !== "string" ||
    !(PANORAMA_ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    return invalid("contentType");
  }
  if (
    typeof byteSize !== "number" ||
    !Number.isInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > PANORAMA_MAX_BYTES
  ) {
    return invalid("byteSize");
  }

  const blocked = assertCampusMutationAllowed(campusId);
  if (blocked) return blocked;

  const store = getPanoramaAssetStore();
  if (!store.ok) return registryUnavailable(store.missing);

  const settings = readR2Config();
  if (!settings.ok) return missingConfig(settings.missing);

  let key: string;
  try {
    key = buildPanoramaKey(campusId, panoramaId, contentType);
  } catch {
    return invalid("key");
  }

  let uploadUrl: string;
  try {
    uploadUrl = await presignPanoramaPut(settings.config, key, contentType);
  } catch (error) {
    const safe = sanitizeR2Error(error);
    console.error("panorama presign failed:", JSON.stringify(safe));
    return NextResponse.json(
      { error: "presign_failed", code: safe.code },
      { status: 502 },
    );
  }

  try {
    await recordSignedAsset(store.client, {
      key,
      campusId,
      panoramaId,
      contentType,
      byteSize,
    });
  } catch (error) {
    // Never emit the signed URL when the asset could not be tracked.
    return registryFail(
      "registry_write_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }

  return NextResponse.json({
    ok: true,
    key,
    uploadUrl,
    expiresAt: new Date(Date.now() + PANORAMA_PUT_TTL_SECONDS * 1000).toISOString(),
    requiredContentType: contentType,
    maxBytes: PANORAMA_MAX_BYTES,
  });
}

async function handleComplete(body: Record<string, unknown>): Promise<NextResponse> {
  const key = body.key;
  if (!isPanoramaKey(key)) return invalid("key");

  const store = getPanoramaAssetStore();
  if (!store.ok) return registryUnavailable(store.missing);

  let asset = null;
  try {
    asset = await findPanoramaAsset(store.client, key);
  } catch (error) {
    return registryFail(
      "registry_read_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  if (!asset) {
    return NextResponse.json({ error: "not_registered" }, { status: 404 });
  }

  const blocked = assertCampusMutationAllowed(asset.campusId);
  if (blocked) return blocked;

  const settings = readR2Config();
  if (!settings.ok) return missingConfig(settings.missing);

  let head;
  try {
    head = await headPanoramaObject(settings.config, key);
  } catch (error) {
    const safe = sanitizeR2Error(error);
    console.error("panorama HeadObject failed:", JSON.stringify(safe));
    return NextResponse.json(
      { error: "r2_request_failed", ...safe },
      { status: 502 },
    );
  }

  if (!head.ok) {
    return NextResponse.json({ error: "object_not_found" }, { status: 404 });
  }

  if (normalizeType(head.contentType) !== normalizeType(asset.contentType)) {
    return NextResponse.json(
      { error: "object_validation_failed", reason: "content_type_mismatch" },
      { status: 400 },
    );
  }
  if (head.byteSize <= 0 || head.byteSize > PANORAMA_MAX_BYTES) {
    return NextResponse.json(
      { error: "object_validation_failed", reason: "size_out_of_bounds" },
      { status: 400 },
    );
  }

  let updated = false;
  try {
    updated = await markPanoramaAssetUploaded(store.client, key, head.byteSize);
  } catch (error) {
    return registryFail(
      "registry_write_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  if (!updated) {
    return NextResponse.json({ error: "not_registered" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    key,
    byteSize: head.byteSize,
    contentType: asset.contentType,
  });
}

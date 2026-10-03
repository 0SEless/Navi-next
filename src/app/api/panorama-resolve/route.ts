import { NextRequest, NextResponse } from "next/server";
import {
  PANORAMA_GET_TTL_SECONDS,
  presignPanoramaGet,
  readR2Config,
  sanitizeR2Error,
} from "@/lib/r2";
import { isPanoramaKey } from "@/lib/panorama-keys";
import { findPanoramaAsset, getPanoramaAssetStore } from "@/lib/panorama-asset-store";

/**
 * Panorama image resolution (public, registry-gated — plan review decision).
 *
 * Given an object key, returns a short-lived presigned GET URL so a viewer
 * can load a panorama from the private bucket without the bucket ever being
 * exposed. A URL is minted only when:
 *   1. the key passes the strict panorama-namespace validator, and
 *   2. the registry holds the key with status `uploaded` (verified at
 *      completion), or else it is a 404 — no state details are revealed.
 *
 * No session is required; nothing outside the registry namespace can ever be
 * signed, so unrelated bucket objects are unreachable through this route.
 */
export const runtime = "nodejs";

const invalidKey = () =>
  NextResponse.json({ error: "invalid_request", field: "key" }, { status: 400 });

export async function GET(request: NextRequest) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key || !isPanoramaKey(key)) return invalidKey();

  const store = getPanoramaAssetStore();
  if (!store.ok) {
    return NextResponse.json(
      { error: "registry_unavailable", missing: store.missing },
      { status: 500 },
    );
  }

  let asset = null;
  try {
    asset = await findPanoramaAsset(store.client, key);
  } catch (error) {
    console.error(
      "panorama registry read failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json({ error: "registry_read_failed" }, { status: 500 });
  }

  // Unknown and not-yet-uploaded assets are indistinguishable: 404.
  if (!asset || asset.status !== "uploaded") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const settings = readR2Config();
  if (!settings.ok) {
    return NextResponse.json(
      { error: "missing_configuration", missing: settings.missing },
      { status: 500 },
    );
  }

  let url: string;
  try {
    url = await presignPanoramaGet(settings.config, key);
  } catch (error) {
    const safe = sanitizeR2Error(error);
    console.error("panorama resolve presign failed:", JSON.stringify(safe));
    return NextResponse.json(
      { error: "presign_failed", code: safe.code },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    url,
    expiresAt: new Date(Date.now() + PANORAMA_GET_TTL_SECONDS * 1000).toISOString(),
  });
}

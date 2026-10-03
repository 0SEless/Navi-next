/**
 * Server-side registry for ingested panorama images (`panorama_assets`).
 *
 * The table holds one row per panorama object in the private `navi-360`
 * bucket: the durable R2 key, its origin (campus/panorama), the approved
 * media type, the byte size, and whether the upload has been verified.
 *
 * Access model: service-role only (`SUPABASE_SERVICE_ROLE_KEY`), matching the
 * established pattern in `src/app/api/graph/route.ts` — the service role
 * bypasses RLS, and migration 015 grants the table to no client role at all.
 * Missing environment variables are reported by NAME only, never by value,
 * mirroring `readR2Config` in `src/lib/r2.ts`.
 *
 * Errors thrown from the write/read helpers carry the database error message
 * (table/column detail, no credentials) and are logged server-side only —
 * callers map them to generic `{ error: "registry_*_failed" }` responses.
 */
import { createServerClient } from "@supabase/ssr";

export const PANORAMA_ASSET_TABLE = "panorama_assets";

export type AssetStoreClient = ReturnType<typeof createServerClient>;

export type AssetStore =
  | { ok: true; client: AssetStoreClient }
  | { ok: false; missing: string[] };

export interface PanoramaAssetRecord {
  key: string;
  campusId: string;
  panoramaId: string;
  contentType: string;
  byteSize: number;
  status: "signed" | "uploaded";
}

export interface SignedAssetInput {
  key: string;
  campusId: string;
  panoramaId: string;
  contentType: string;
  byteSize: number;
}

/** Build the service-role store handle (names-only on missing config). */
export function getPanoramaAssetStore(
  env: Record<string, string | undefined> = process.env,
): AssetStore {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  const missing: string[] = [];
  if (url === "") missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (serviceKey === "") missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    client: createServerClient(url, serviceKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    }),
  };
}

/** Insert-or-reset a row to `signed` for a freshly issued upload URL. */
export async function recordSignedAsset(
  client: AssetStoreClient,
  asset: SignedAssetInput,
): Promise<void> {
  const { error } = await client
    .from(PANORAMA_ASSET_TABLE)
    .upsert(
      {
        key: asset.key,
        campus_id: asset.campusId,
        panorama_id: asset.panoramaId,
        content_type: asset.contentType,
        byte_size: asset.byteSize,
        status: "signed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

/** Look up one asset by its exact key; `null` when unregistered. */
export async function findPanoramaAsset(
  client: AssetStoreClient,
  key: string,
): Promise<PanoramaAssetRecord | null> {
  const { data, error } = await client
    .from(PANORAMA_ASSET_TABLE)
    .select("key, campus_id, panorama_id, content_type, byte_size, status")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    key: String(data.key),
    campusId: String(data.campus_id),
    panoramaId: String(data.panorama_id),
    contentType: String(data.content_type),
    byteSize: Number(data.byte_size),
    status: data.status === "uploaded" ? "uploaded" : "signed",
  };
}

/** Flip a row to `uploaded` with the HeadObject-verified size. */
export async function markPanoramaAssetUploaded(
  client: AssetStoreClient,
  key: string,
  byteSize: number,
): Promise<boolean> {
  const { data, error } = await client
    .from(PANORAMA_ASSET_TABLE)
    .update({
      status: "uploaded",
      byte_size: byteSize,
      updated_at: new Date().toISOString(),
    })
    .eq("key", key)
    .select("key");
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

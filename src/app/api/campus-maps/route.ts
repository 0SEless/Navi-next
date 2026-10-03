import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  assertCampusMutationAllowed,
  getCampusMapIdFromBody,
  getQueryParam,
  requireVerifiedMutationAuth,
} from "@/lib/api-guard";

async function getClient(auth: "publishable" | "secret") {
  const key = auth === "secret"
    ? process.env.SUPABASE_SERVICE_ROLE_KEY!
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const supabase = await getClient("publishable");
  const { searchParams } = new URL(request.url);
  const mapId = searchParams.get("map_id");

  if (mapId) {
    const result = await supabase
      .from("campus_maps")
      .select("data")
      .eq("map_id", mapId)
      .maybeSingle() as unknown as { data: { data: unknown } | null; error: { message: string } | null };

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    if (result.data?.data) {
      return NextResponse.json(result.data.data as Record<string, unknown>);
    }
  } else {
    const result = await supabase
      .from("campus_maps")
      .select("data")
      .order("updated_at", { ascending: false }) as unknown as { data: { data: unknown }[] | null; error: { message: string } | null };

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    if (result.data) {
      const maps = result.data.map((r) => r.data);
      return NextResponse.json({ maps });
    }
  }

  return NextResponse.json({ maps: [] });
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireVerifiedMutationAuth(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();

    const blocked = assertCampusMutationAllowed(getCampusMapIdFromBody(body));
    if (blocked) return blocked;

    const supabase = await getClient("secret");

    // RPC expects a single `payload` parameter — normalize caller-friendly formats
    const rpcArgs = body.payload ? body : { payload: body };
    const { data: result, error: rpcError } = await supabase.rpc("sync_campus_map", rpcArgs as never);

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    return NextResponse.json((result ?? { success: true }) as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const unauthorized = await requireVerifiedMutationAuth(request);
    if (unauthorized) return unauthorized;

    const mapId = getQueryParam(request, "map_id", "mapId");

    if (!mapId) {
      return NextResponse.json({ error: "map_id required" }, { status: 400 });
    }

    const blocked = assertCampusMutationAllowed(mapId);
    if (blocked) return blocked;

    const supabase = await getClient("secret");
    const { data: result, error: rpcError } = await supabase.rpc("delete_campus_map", { map_id_param: mapId } as never);

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    return NextResponse.json((result ?? { success: true }) as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

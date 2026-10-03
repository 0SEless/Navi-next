import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  assertCampusMutationAllowed,
  getCampusIdFromBody,
  getOptionalJsonBody,
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
  const campusId = searchParams.get("campus_id");

  if (campusId) {
    const { data, error } = await supabase
      .from("graph_snapshots")
      .select("campus_id, version, updated_at, data")
      .eq("campus_id", campusId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Campus not found" }, { status: 404 });
    }

    const { count: buildingCount } = await supabase
      .from("buildings")
      .select("*", { count: "exact", head: true })
      .eq("campus_id", campusId);

    const { count: nodeCount } = await supabase
      .from("route_nodes")
      .select("*", { count: "exact", head: true })
      .eq("campus_id", campusId);

    const snapData = (data.data ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      id: data.campus_id,
      campus_id: data.campus_id,
      name: typeof snapData.name === 'string' ? snapData.name : data.campus_id,
      description: typeof snapData.description === 'string' ? snapData.description : '',
      address: typeof snapData.address === 'string' ? snapData.address : '',
      version: data.version,
      updated_at: data.updated_at,
      building_count: buildingCount ?? 0,
      node_count: nodeCount ?? 0,
    });
  }

  const { data, error } = await supabase
    .from("graph_snapshots")
    .select("campus_id, version, updated_at, data")
    .order("campus_id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = await Promise.all(
    (data ?? []).map(async (c) => {
      const { count: bc } = await supabase
        .from("buildings")
        .select("*", { count: "exact", head: true })
        .eq("campus_id", c.campus_id);
      const snapData = (c.data ?? {}) as Record<string, unknown>;
      return {
        id: c.campus_id,
        campus_id: c.campus_id,
        name: typeof snapData.name === 'string' ? snapData.name : c.campus_id,
        description: typeof snapData.description === 'string' ? snapData.description : '',
        address: typeof snapData.address === 'string' ? snapData.address : '',
        version: c.version,
        updated_at: c.updated_at,
        building_count: bc ?? 0,
      };
    }),
  );

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireVerifiedMutationAuth(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const { campus_id, name, description, address } = body;

    if (!campus_id) {
      return NextResponse.json({ error: "campus_id is required" }, { status: 400 });
    }

    const blocked = assertCampusMutationAllowed(campus_id);
    if (blocked) return blocked;

    const supabase = await getClient("secret");
    const { error: snapError } = await supabase
      .from("graph_snapshots")
      .insert({
        campus_id,
        data: { campusId: campus_id, name: name || campus_id, description: description || "", address: address || "" },
        version: "1.0.0",
      });

    if (snapError) {
      if (snapError.code === '23505') {
        return NextResponse.json(
          { error: 'Campus already exists', code: 'CAMPUS_ALREADY_EXISTS' },
          { status: 409 },
        );
      }
      const snapMsg = snapError.message || 'Failed to create campus';
      return NextResponse.json({ error: snapMsg }, { status: 500 });
    }

    return NextResponse.json({ success: true, campus_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const unauthorized = await requireVerifiedMutationAuth(request);
    if (unauthorized) return unauthorized;

    const body = await getOptionalJsonBody(request);
    const campusId =
      getQueryParam(request, "campus_id", "campusId") ?? getCampusIdFromBody(body);

    if (!campusId) {
      return NextResponse.json({ error: "campus_id is required" }, { status: 400 });
    }

    const blocked = assertCampusMutationAllowed(campusId);
    if (blocked) return blocked;

    const supabase = await getClient("secret");
    await supabase.from("route_edges").delete().eq("campus_id", campusId);
    await supabase.from("route_nodes").delete().eq("campus_id", campusId);
    await supabase.from("buildings").delete().eq("campus_id", campusId);
    const { error } = await supabase.from("graph_snapshots").delete().eq("campus_id", campusId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, campus_id: campusId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

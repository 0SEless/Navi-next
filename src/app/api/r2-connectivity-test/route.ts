import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedMutationAuth } from "@/lib/api-guard";
import { runR2ConnectivityTest } from "@/lib/r2";

/**
 * TEMPORARY Cloudflare R2 connectivity test.
 *
 * Proves the NAVI server can authenticate with R2 and write one harmless
 * object to the private `navi-360` bucket. It performs a server-side write,
 * so it sits behind the same verified-auth gate as every other mutating NAVI
 * route. The response never contains credentials or environment values.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = await requireVerifiedMutationAuth(request);
  if (unauthorized) return unauthorized;

  const result = await runR2ConnectivityTest();

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      provider: "cloudflare-r2",
      bucket: result.bucket,
      object: result.object,
    });
  }

  if (result.stage === "configuration") {
    // Variable names only — never a value.
    return NextResponse.json(
      {
        ok: false,
        provider: "cloudflare-r2",
        error: "missing_configuration",
        missing: result.missing,
      },
      { status: 500 },
    );
  }

  // Sanitized upstream failure: name/code, HTTP status, request id — no message.
  console.error("R2 connectivity test failed:", JSON.stringify(result.error));
  return NextResponse.json(
    {
      ok: false,
      provider: "cloudflare-r2",
      error: "r2_request_failed",
      code: result.error.code,
      ...(result.error.httpStatus !== undefined
        ? { httpStatus: result.error.httpStatus }
        : {}),
      ...(result.error.requestId !== undefined
        ? { requestId: result.error.requestId }
        : {}),
    },
    { status: 502 },
  );
}

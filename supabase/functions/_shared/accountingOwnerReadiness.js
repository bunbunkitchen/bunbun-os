/**
 * Bunbun Accounting — owner-only authorization boundary.
 *
 * Staging diagnostics ONLY. No database posting/read of financial numbers.
 * Injectable dependencies keep auth, security, and failure modes testable.
 * Never trust role, userId, approval or monetary data from a request body.
 */
const MAX_JSON_BYTES = 4096;
const MAX_TOKEN_LENGTH = 8192;

function sendJson(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function tokenFromAuthorization(value) {
  if (typeof value !== "string" || value.length > MAX_TOKEN_LENGTH) return null;
  const match = /^Bearer ([A-Za-z0-9_.~-]+)$/.exec(value);
  return match?.[1] || null;
}

/**
 * Verify the JWT against Supabase Auth, not by decoding or trusting a
 * user-supplied id or claims. Fetch role and active status fresh each time.
 */
export async function authorizeActiveOwner({
  authorization, verifyUserToken, loadProfile,
}) {
  const token = tokenFromAuthorization(authorization);
  if (!token) return { ok: false, status: 401, code: "AUTH_REQUIRED" };
  if (typeof verifyUserToken !== "function" || typeof loadProfile !== "function") {
    return { ok: false, status: 503, code: "AUTH_UNAVAILABLE" };
  }
  let user;
  try {
    user = await verifyUserToken(token);
  } catch {
    return { ok: false, status: 401, code: "INVALID_SESSION" };
  }
  // Only trust the user from Auth's remote getUser(token), not body or JWT decode.
  if (!user || typeof user.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(user.id)) {
    return { ok: false, status: 401, code: "INVALID_SESSION" };
  }
  let profile;
  try {
    profile = await loadProfile(user.id);
  } catch {
    return { ok: false, status: 503, code: "PROFILE_UNAVAILABLE" };
  }
  if (!profile || profile.id !== user.id || profile.role !== "owner" ||
    profile.is_active !== true) {
    return { ok: false, status: 403, code: "OWNER_REQUIRED" };
  }
  return { ok: true, status: 200, userId: user.id };
}

/**
 * The whole endpoint is disabled unless an explicit staging flag is set.
 * It NEVER calls the private accounting posting SQL function.
 *
 * CORS is an additional browser restriction; the JWT+role check is what
 * authorizes access. CORS does not authenticate non-browser callers.
 */
export function createOwnerReadinessHandler({
  stageEnabled,
  allowedOrigin,
  verifyUserToken,
  loadProfile,
}) {
  return async function handle(request) {
    const origin = request.headers.get("Origin");
    if (stageEnabled !== true || !allowedOrigin ||
      typeof allowedOrigin !== "string") {
      return sendJson({ ok: false, code: "STAGING_NOT_CONFIGURED" }, 503);
    }
    if (origin !== allowedOrigin) {
      return sendJson({ ok: false, code: "ORIGIN_NOT_ALLOWED" }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Max-Age": "600",
          "Cache-Control": "no-store",
          "Vary": "Origin",
        },
      });
    }
    if (request.method !== "POST") {
      return sendJson({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return sendJson({ ok: false, code: "JSON_REQUIRED" }, 415, origin);
    }
    const auth = await authorizeActiveOwner({
      authorization: request.headers.get("Authorization"),
      verifyUserToken,
      loadProfile,
    });
    if (!auth.ok) return sendJson({ ok: false, code: auth.code }, auth.status, origin);

    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (contentLength > MAX_JSON_BYTES) {
      return sendJson({ ok: false, code: "BODY_TOO_LARGE" }, 413, origin);
    }
    let input;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > MAX_JSON_BYTES) {
        return sendJson({ ok: false, code: "BODY_TOO_LARGE" }, 413, origin);
      }
      input = JSON.parse(body);
    } catch {
      return sendJson({ ok: false, code: "INVALID_JSON" }, 400, origin);
    }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 1 || input.action !== "readiness") {
      // Explicitly reject post/approve/merge/commit/ownerId/amount payloads.
      return sendJson({ ok: false, code: "ACTION_NOT_AVAILABLE" }, 422, origin);
    }

    return sendJson({
      ok: true,
      status: "BLOCKED_PENDING_CUTOVER",
      dataMode: "STAGING_AUTHORIZATION_CHECK_ONLY",
      ownerAuthenticated: true,
      ledgerConnected: false,
      cutoverApproved: false,
      mayPost: false,
      financialValuesAvailable: false,
      blockers: [
        "Tanggal cutover dan stok opname Owner belum disahkan.",
        "Belum ada Supabase staging dan ledger yang terhubung.",
        "Backend posting sumber transaksi belum diaktifkan.",
      ],
    }, 200, origin);
  };
}

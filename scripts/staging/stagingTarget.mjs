/**
 * Fail-closed check preventing any remote Owner/Baker Auth smoke test from
 * contacting the Bunbun production Supabase project. No network operations.
 */
import { isIsolatedAccountingStaging } from
  "../../supabase/functions/_shared/accountingStagingGuard.js";

export function verifyStagingSmokeTarget({
  mode, projectRef, projectUrl, allowedOrigin, publishableKey,
}) {
  if (!isIsolatedAccountingStaging({
    stageFlag: mode,
    stagingProjectRef: projectRef,
    projectUrl,
    allowedOrigin,
  })) {
    throw new Error("Refusing remote Auth test: isolated staging ref/url/origin mismatch.");
  }
  if (typeof publishableKey !== "string" ||
    !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey)) {
    throw new Error("Staging must use its own publishable API key.");
  }
  return Object.freeze({
    projectRef,
    projectUrl,
    allowedOrigin,
    functionUrl: projectUrl.replace(/\/$/, "") + "/functions/v1/accounting-owner-readiness",
  });
}

export function checkLiveReadinessResponse({
  role, httpStatus, response,
}) {
  const expected = role === "owner" ? 200 : role === "baker" ||
    role === "inactive-owner" ? 403 : 401;
  if (httpStatus !== expected) {
    throw new Error("Auth smoke " + role + ": expected " + expected +
      ", observed " + httpStatus);
  }
  if (!response || typeof response !== "object") {
    throw new Error("Auth smoke " + role + ": response was not JSON");
  }
  if (role === "owner") {
    if (response.ok !== true || response.ownerAuthenticated !== true ||
        response.mayPost !== false || response.ledgerConnected !== false ||
        response.cutoverApproved !== false ||
        response.financialValuesAvailable !== false ||
        response.status !== "BLOCKED_PENDING_CUTOVER") {
      throw new Error("Owner readiness must remain read-only and cutover-blocked.");
    }
  } else if (role === "baker" || role === "inactive-owner") {
    if (response.code !== "OWNER_REQUIRED") {
      throw new Error("Auth smoke " + role + ": must be Owner-only");
    }
  } else if (role === "anonymous" || role === "forged-token") {
    // Supabase Edge Gateway verify_jwt may reject BEFORE the function runs,
    // using an integer 401 code instead of the handler's stable error code.
    if (!["AUTH_REQUIRED","INVALID_SESSION",401,"401"].includes(response.code)) {
      throw new Error("Auth smoke " + role + ": must reject missing/invalid Auth");
    }
  }
  return true;
}

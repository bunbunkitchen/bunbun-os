/**
 * Executable remote Auth smoke test, STAGING ONLY. NO financial or stock
 * writes. Run only when the isolated Supabase staging project, Edge function,
 * and three *synthetic* test users actually exist.
 *
 * Secret input variables:
 * BUNBUN_ACCOUNTING_STAGE=isolated-staging
 * BUNBUN_ACCOUNTING_STAGING_REF=<staging project ref>
 * STAGING_SUPABASE_URL=https://<ref>.supabase.co
 * STAGING_PUBLISHABLE_KEY=sb_publishable_...
 * STAGING_ALLOWED_ORIGIN=https://<separate staging UI hostname>
 * STAGING_OWNER_EMAIL / STAGING_OWNER_PASSWORD
 * STAGING_BAKER_EMAIL / STAGING_BAKER_PASSWORD
 * STAGING_INACTIVE_OWNER_EMAIL / STAGING_INACTIVE_OWNER_PASSWORD
 *
 * No service_role key is needed; never provide production credentials.
 */
import { createClient } from "@supabase/supabase-js";
import {
  verifyStagingSmokeTarget, checkLiveReadinessResponse,
} from "./stagingTarget.mjs";

const env = process.env;
const target = verifyStagingSmokeTarget({
  mode: env.BUNBUN_ACCOUNTING_STAGE,
  projectRef: env.BUNBUN_ACCOUNTING_STAGING_REF,
  projectUrl: env.STAGING_SUPABASE_URL,
  allowedOrigin: env.STAGING_ALLOWED_ORIGIN,
  publishableKey: env.STAGING_PUBLISHABLE_KEY,
});
if (env.STAGING_PUBLISHABLE_KEY === env.VITE_SUPABASE_PUBLISHABLE_KEY &&
  env.VITE_SUPABASE_URL &&
  env.VITE_SUPABASE_URL !== env.STAGING_SUPABASE_URL) {
  throw new Error("Staging key appears to be shared with production.");
}
const authClient = createClient(
  target.projectUrl, env.STAGING_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function tokenFor(role) {
  const envPrefix = role === "owner" ? "STAGING_OWNER" :
    role === "baker" ? "STAGING_BAKER" : "STAGING_INACTIVE_OWNER";
  const email = env[envPrefix + "_EMAIL"];
  const password = env[envPrefix + "_PASSWORD"];
  if (!email || !password || !email.includes("@")) {
    throw new Error("Missing synthetic staging " + role + " test credentials.");
  }
  const { data, error } = await authClient.auth.signInWithPassword({
    email, password,
  });
  if (error || !data?.session?.access_token) {
    throw new Error("Staging test-user login failed: " + role);
  }
  return data.session.access_token;
}

async function check(role, token) {
  const res = await fetch(target.functionUrl, {
    method: "POST",
    headers: {
      Origin: target.allowedOrigin,
      apikey: env.STAGING_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ action: "readiness" }),
    signal: AbortSignal.timeout(10000),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Auth smoke " + role + ": backend did not return JSON.");
  }
  checkLiveReadinessResponse({ role, httpStatus: res.status, response: data });
  console.log("PASS: " + role + " authentication and authorization.");
}

await check("anonymous", null);
await check("forged-token", "this.is.not-a-jwt");
for (const role of ["owner", "baker", "inactive-owner"]) {
  await check(role, await tokenFor(role));
}
console.log("PASS: separate staging Owner/Baker/inactive/anonymous auth. No writes.");

/**
 * Bunbun OS / accounting-owner-readiness
 *
 * NOT DEPLOYED. Supabase staging ONLY.
 * This endpoint checks the real Auth token and active Owner profile.
 * No financial data reads/writes, no accounting schema posting.
 *
 * Deployment requirements:
 * - Edge Gateway verify_jwt = true (do NOT disable it).
 * - BUNBUN_ACCOUNTING_STAGE=isolated-staging
 * - BUNBUN_ACCOUNTING_STAGING_REF=<verified independent staging project ref>
 * - BUNBUN_ACCOUNTING_ALLOWED_ORIGIN=https://<trusted-staging-frontend>
 * - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Secrets stay inside Edge runtime. Never ship to Vite/browser.
 */
import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { createOwnerReadinessHandler } from "../_shared/accountingOwnerReadiness.js";
import { isIsolatedAccountingStaging } from "../_shared/accountingStagingGuard.js";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Reviewed local smoke configuration, enabled only on the exact isolated project.
const isolatedProject = projectUrl === "https://pkgrqalpazhwdcxmthvb.supabase.co";
const allowedOrigin = Deno.env.get("BUNBUN_ACCOUNTING_ALLOWED_ORIGIN") ||
  (isolatedProject ? "http://localhost:5173" : "");
const stageEnabled = isIsolatedAccountingStaging({
  stageFlag: Deno.env.get("BUNBUN_ACCOUNTING_STAGE") || (isolatedProject ? "isolated-staging" : ""),
  stagingProjectRef: Deno.env.get("BUNBUN_ACCOUNTING_STAGING_REF") || (isolatedProject ? "pkgrqalpazhwdcxmthvb" : ""),
  projectUrl,
  allowedOrigin,
});

const authOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
};
const configured = stageEnabled && Boolean(projectUrl && anonKey && serviceRole && allowedOrigin);
const authClient = configured
  ? createClient(projectUrl, anonKey, authOptions)
  : null;
const adminClient = configured
  ? createClient(projectUrl, serviceRole, authOptions)
  : null;

// Admin access is used only to read current profile.role and is_active.
// No browser-provided user id is accepted. No accounting postings.
const handler = createOwnerReadinessHandler({
  stageEnabled: configured,
  allowedOrigin,
  async verifyUserToken(jwt: string) {
    if (!authClient) throw new Error("Staging auth disabled");
    const { data, error } = await authClient.auth.getUser(jwt);
    if (error || !data?.user?.id) throw new Error("Invalid session");
    return { id: data.user.id };
  },
  async loadProfile(userId: string) {
    if (!adminClient) throw new Error("Staging auth disabled");
    const { data, error } = await adminClient
      .from("profiles")
      .select("id,role,is_active")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error("Profile unavailable");
    return data;
  },
});

Deno.serve(handler);

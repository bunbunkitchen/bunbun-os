/**
 * Bunbun OS / accounting-owner-monthly-report
 *
 * NOT DEPLOYED. Read-only report endpoint for an independent staging project.
 * There is no database write or journal posting operation.
 *
 * Requires gateway verify_jwt=true and secrets held ONLY in Edge runtime.
 * Expected config:
 *   BUNBUN_ACCOUNTING_STAGE=isolated-staging
 *   BUNBUN_ACCOUNTING_STAGING_REF=<independent project ref>
 *   BUNBUN_ACCOUNTING_ALLOWED_ORIGIN=<trusted frontend staging origin>
 *   BUNBUN_ACCOUNTING_STAGING_DB_URL=<staging postgres or pooler URL>
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import postgres from "npm:postgres@3.4.7";
import { isIsolatedAccountingStaging } from "../_shared/accountingStagingGuard.js";
import {
  isIsolatedAccountingDbUrl,
  POSTED_FINANCIAL_REPORT_SQL,
  parsePrivateLedgerReportRows,
} from "../_shared/accountingPrivateLedgerRead.js";
import { createOwnerMonthlyReportHandler } from "../_shared/accountingOwnerMonthlyReport.js";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const origin = Deno.env.get("BUNBUN_ACCOUNTING_ALLOWED_ORIGIN") || "";
const stageRef = Deno.env.get("BUNBUN_ACCOUNTING_STAGING_REF") || "";
const dbUrl = Deno.env.get("BUNBUN_ACCOUNTING_STAGING_DB_URL") || "";

const configured = Boolean(
  anonKey && serviceRole && dbUrl &&
  isIsolatedAccountingStaging({
    stageFlag: Deno.env.get("BUNBUN_ACCOUNTING_STAGE"),
    stagingProjectRef: stageRef,
    projectUrl,
    allowedOrigin: origin,
  }) &&
  isIsolatedAccountingDbUrl(dbUrl, stageRef)
);

const options = { auth: { autoRefreshToken: false, persistSession: false } };
const authClient = configured ? createClient(projectUrl, anonKey, options) : null;
const adminClient = configured ? createClient(projectUrl, serviceRole, options) : null;

// Exactly one connection, HTTPS/TLS, parameterized SELECT only, no DB writes.
const sql = configured
  ? postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5, ssl: "require" })
  : null;

const handler = createOwnerMonthlyReportHandler({
  stageEnabled: configured,
  allowedOrigin: origin,
  async verifyUserToken(jwt: string) {
    if (!authClient) throw new Error("Unconfigured");
    const { data, error } = await authClient.auth.getUser(jwt);
    if (error || !data?.user?.id) throw new Error("Unauthorized");
    return { id: data.user.id };
  },
  async loadProfile(userId: string) {
    if (!adminClient) throw new Error("Unconfigured");
    const { data, error } = await adminClient
      .from("profiles").select("id,role,is_active")
      .eq("id", userId).maybeSingle();
    if (error) throw new Error("Unavailable");
    return data;
  },
  async loadMonthlyReport(month: string, _verifiedUserId: string) {
    if (!sql) throw new Error("Unconfigured");
    if (!adminClient) throw new Error("Unconfigured");
    // Unknown sold cost must not appear as zero COGS / a completed profit.
    const costs = await adminClient.rpc("accounting_revenue_service", {
      p_action: "cost_readiness", p_payload: { month }, p_actor_id: _verifiedUserId,
    });
    if (costs.error || costs.data?.soldCostsComplete !== true) return null;
    // SQL text constant, month supplied as a parameter: never string-concat
    // a user input into SQL. All underlying views are posted-journal-only.
    const rows = await sql.unsafe(POSTED_FINANCIAL_REPORT_SQL, [month]);
    return parsePrivateLedgerReportRows(rows);
  },
});

Deno.serve(handler);

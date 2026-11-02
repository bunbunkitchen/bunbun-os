/**
 * Bunbun OS / accounting-owner-source-preview
 * NOT DEPLOYED. Staging-only, Owner-only, READ ONLY.
 *
 * Re-fetches original source rows from a completely independent staging
 * Supabase project. Browser-submitted evidence is NEVER treated as true
 * approval and resulting DRAFT proposals NEVER call journal posting SQL.
 *
 * Gateway verify_jwt must remain enabled. Secrets are server-only.
 */
import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { isIsolatedAccountingStaging } from "../_shared/accountingStagingGuard.js";
import { createOwnerSourcePreviewHandler } from "../_shared/accountingOwnerSourcePreview.js";

const url = Deno.env.get("SUPABASE_URL") || "";
const publishable = Deno.env.get("SUPABASE_ANON_KEY") || "";
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedOrigin = Deno.env.get("BUNBUN_ACCOUNTING_ALLOWED_ORIGIN") || "";
const configured = Boolean(publishable && secret &&
  isIsolatedAccountingStaging({
    stageFlag: Deno.env.get("BUNBUN_ACCOUNTING_STAGE"),
    stagingProjectRef: Deno.env.get("BUNBUN_ACCOUNTING_STAGING_REF"),
    projectUrl: url,
    allowedOrigin,
  }));
const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const authClient = configured ? createClient(url, publishable, authOptions) : null;
const privateClient = configured ? createClient(url, secret, authOptions) : null;

const SOURCE_COLUMNS: Record<string, string> = Object.freeze({
  sales: "id,sale_date,sales_channel,total_amount,is_deleted",
  incomes: "id,tanggal,asal_setoran,pemasukan_bunbun,is_deleted",
  purchases: "id,tanggal,total,ingredient_id,maintenance_item_id,is_deleted",
  expenses: "id,tanggal,nominal,purchase_id,is_deleted",
});

const handler = createOwnerSourcePreviewHandler({
  stageEnabled: configured,
  allowedOrigin,
  async verifyUserToken(token: string) {
    if (!authClient) throw new Error("Staging not configured");
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user?.id) throw new Error("Invalid session");
    return { id: data.user.id };
  },
  async loadProfile(userId: string) {
    if (!privateClient) throw new Error("Staging not configured");
    const { data, error } = await privateClient
      .from("profiles").select("id,role,is_active")
      .eq("id", userId).maybeSingle();
    if (error) throw new Error("Profile not available");
    return data;
  },
  async fetchSourceRows(table: string, ids: string[], _verifiedUserId: string) {
    if (!privateClient || !(table in SOURCE_COLUMNS)) throw new Error("Not configured");
    // Table and columns are fixed server constants. Values are bound via
    // PostgREST .in(), never interpolated into SQL.
    const { data, error } = await privateClient.from(table)
      .select(SOURCE_COLUMNS[table]).in("id", ids).eq("is_deleted", false)
      .limit(20);
    if (error || !data) throw new Error("Source rows unavailable");
    return data;
  },
});
Deno.serve(handler);

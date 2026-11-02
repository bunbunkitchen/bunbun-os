/**
 * Owner financial dashboard read client.
 *
 * No production endpoints are invoked. A separate staging Supabase project
 * plus an explicit staging frontend flag must both be configured first.
 * The existing live Bunbun client will therefore always show NOT READY.
 */
import { supabase } from "../lib/supabase";
import { isIsolatedAccountingStaging } from
  "../../supabase/functions/_shared/accountingStagingGuard.js";
import {
  normalizeOwnerMonthlyResponse,
} from "../utils/accountingBusinessHealth.js";

export function isAccountingDashboardStagingEnabled({
  mode, projectRef, supabaseUrl, origin,
}) {
  return isIsolatedAccountingStaging({
    stageFlag: mode,
    stagingProjectRef: projectRef,
    projectUrl: supabaseUrl,
    allowedOrigin: origin,
  });
}

/**
 * Injectable invoke for tests. Missing periods (409) do not become zero.
 * All other failures are treated as errors and do not silently produce
 * a partial "complete" dashboard.
 */
export async function readFinancialDashboardMonths({
  months, config, invoke,
}) {
  if (!isAccountingDashboardStagingEnabled(config)) {
    return { status: "STAGING_NOT_CONFIGURED", records: [], unavailable: [] };
  }
  if (!Array.isArray(months) || months.length < 1 || months.length > 12 ||
    new Set(months).size !== months.length ||
    months.some(month => typeof month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    throw new Error("Pilihan bulan laporan tidak valid.");
  }
  if (typeof invoke !== "function") {
    throw new Error("Backend laporan tidak tersedia.");
  }

  const results = await Promise.all(months.map(async month => {
    const { data, error } = await invoke("accounting-owner-monthly-report", {
      body: { action: "monthly-report", month },
    });
    if (error) {
      if (error.context?.status === 409) {
        return { month, status: "PERIOD_NOT_READY", report: null };
      }
      throw new Error("Backend laporan belum siap atau akses Owner ditolak.");
    }
    return {
      month, status: "AVAILABLE",
      report: normalizeOwnerMonthlyResponse(data, month),
    };
  }));
  return {
    status: "STAGING_READ_ONLY",
    records: results.filter(result => result.report).map(result => result.report),
    unavailable: results.filter(result => !result.report).map(result => result.month),
  };
}

export async function loadOwnerFinancialDashboard(months) {
  return readFinancialDashboardMonths({
    months,
    config: {
      mode: import.meta.env.VITE_BUNBUN_ACCOUNTING_MODE,
      projectRef: import.meta.env.VITE_BUNBUN_ACCOUNTING_STAGING_REF,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      origin: typeof window === "undefined" ? "" : window.location.origin,
    },
    invoke: (...args) => supabase.functions.invoke(...args),
  });
}

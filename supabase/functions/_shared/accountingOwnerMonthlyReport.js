/**
 * Stage-only, read-only backend financial report gate.
 *
 * Reports MUST be loaded from posted journals and approved opening records
 * using a trusted server-side service. Never accept amounts, IDs, role, or
 * approval from clients. No accounting write action is implemented here.
 */
import { authorizeActiveOwner } from "./accountingOwnerReadiness.js";
import { isValidIsoDate } from "../../../src/utils/hppCutoverOpening.js";

const JSON_LIMIT_BYTES = 1024;

const json = (body, status, origin) => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
};

/** Use exact decimal cents, not floating point, when verifying reports. */
export function reportMoneyToCents(amount) {
  if (typeof amount !== "string" || !/^-?\d{1,13}(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error("Nilai laporan tidak valid.");
  }
  const negative = amount.startsWith("-");
  const raw = negative ? amount.slice(1) : amount;
  const [whole, decimals = ""] = raw.split(".");
  const result = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0") || "0");
  return negative ? -result : result;
}

const moneyKeys = {
  incomeStatement: ["netRevenue", "cogs", "grossProfit", "operatingExpenses", "netProfit"],
  cashFlow: ["openingCash", "operating", "investing", "financing", "netCashChange", "closingCash"],
  financialPosition: ["assets", "liabilities", "totalEquity", "trialBalanceDifference"],
};

export function validatePostedFinancialSnapshot(row, expectedMonth) {
  if (!row || row.month !== expectedMonth ||
    !["OPEN", "CLOSED"].includes(row.periodStatus) ||
    row.openingApproved !== true ||
    !isValidIsoDate(row.cutoverDate) || row.cutoverDate > expectedMonth + "-31" ||
    typeof row.incomeStatement !== "object" || !row.incomeStatement ||
    typeof row.cashFlow !== "object" || !row.cashFlow ||
    typeof row.financialPosition !== "object" || !row.financialPosition) {
    throw new Error("Periode/saldo awal belum siap untuk laporan keuangan.");
  }
  for (const [group, keys] of Object.entries(moneyKeys)) {
    for (const key of keys) reportMoneyToCents(row[group][key]);
  }

  const income = row.incomeStatement;
  const cash = row.cashFlow;
  const balance = row.financialPosition;
  const n = reportMoneyToCents;
  if (n(income.netRevenue) - n(income.cogs) !== n(income.grossProfit) ||
    n(income.grossProfit) - n(income.operatingExpenses) !== n(income.netProfit) ||
    n(cash.operating) + n(cash.investing) + n(cash.financing) !== n(cash.netCashChange) ||
    n(cash.openingCash) + n(cash.netCashChange) !== n(cash.closingCash) ||
    n(balance.assets) !== n(balance.liabilities) + n(balance.totalEquity) ||
    n(balance.trialBalanceDifference) !== 0n) {
    throw new Error("Jurnal/laporan belum berhasil direkonsiliasi.");
  }
  // Only a curated allowlist of fields is returned to the Owner.
  return {
    month: expectedMonth,
    periodStatus: row.periodStatus,
    cutoverDate: row.cutoverDate,
    incomeStatement: Object.fromEntries(moneyKeys.incomeStatement.map(key => [key, income[key]])),
    cashFlow: Object.fromEntries(moneyKeys.cashFlow.map(key => [key, cash[key]])),
    financialPosition: Object.fromEntries(moneyKeys.financialPosition.map(key => [key, balance[key]])),
  };
}

/**
 * Fail-closed. Access requires backend Auth token verification + freshly
 * checked Owner role. A report is untrusted for bonuses even if numbers balance:
 * source completeness/closing review is a separate workflow.
 */
export function createOwnerMonthlyReportHandler({
  stageEnabled, allowedOrigin, verifyUserToken, loadProfile, loadMonthlyReport,
}) {
  return async function handle(request) {
    const origin = request.headers.get("Origin");
    if (stageEnabled !== true || !allowedOrigin ||
      typeof loadMonthlyReport !== "function") {
      return json({ ok: false, code: "STAGING_NOT_CONFIGURED" }, 503);
    }
    if (origin !== allowedOrigin) {
      return json({ ok: false, code: "ORIGIN_NOT_ALLOWED" }, 403);
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
      return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ ok: false, code: "JSON_REQUIRED" }, 415, origin);
    }
    const auth = await authorizeActiveOwner({
      authorization: request.headers.get("Authorization"),
      verifyUserToken, loadProfile,
    });
    if (!auth.ok) return json({ ok: false, code: auth.code }, auth.status, origin);

    const announced = Number(request.headers.get("Content-Length") || "0");
    if (!Number.isFinite(announced) || announced < 0 || announced > JSON_LIMIT_BYTES) {
      return json({ ok: false, code: "BODY_TOO_LARGE" }, 413, origin);
    }
    let input;
    try {
      const payload = await request.text();
      if (new TextEncoder().encode(payload).length > JSON_LIMIT_BYTES) {
        return json({ ok: false, code: "BODY_TOO_LARGE" }, 413, origin);
      }
      input = JSON.parse(payload);
    } catch {
      return json({ ok: false, code: "INVALID_JSON" }, 400, origin);
    }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "action,month" ||
      input.action !== "monthly-report" ||
      typeof input.month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
      return json({ ok: false, code: "ACTION_NOT_AVAILABLE" }, 422, origin);
    }

    let snapshot;
    try {
      snapshot = await loadMonthlyReport(input.month, auth.userId);
    } catch {
      return json({ ok: false, code: "LEDGER_UNAVAILABLE" }, 503, origin);
    }
    if (!snapshot) {
      return json({
        ok: false, code: "PERIOD_NOT_READY",
        message: "Belum tersedia saldo awal approved dan jurnal posted untuk periode ini.",
      }, 409, origin);
    }

    try {
      const report = validatePostedFinancialSnapshot(snapshot, input.month);
      return json({
        ok: true,
        status: "STAGING_POSTED_JOURNALS_ONLY",
        report,
        sourceAudited: false,
        sourceCompletenessVerified: false,
        readyForBonusDecision: false,
        readyForExpansionDecision: false,
        dataMode: "PRIVATE_STAGING_LEDGER",
        mayPost: false,
      }, 200, origin);
    } catch {
      return json({ ok: false, code: "RECONCILIATION_REQUIRED" }, 409, origin);
    }
  };
}

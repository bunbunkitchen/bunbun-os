import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reportMoneyToCents, validatePostedFinancialSnapshot,
  createOwnerMonthlyReportHandler,
} from "../supabase/functions/_shared/accountingOwnerMonthlyReport.js";
import {
  isIsolatedAccountingDbUrl, parsePrivateLedgerReportRows,
  POSTED_FINANCIAL_REPORT_SQL,
} from "../supabase/functions/_shared/accountingPrivateLedgerRead.js";
import { BUNBUN_PRODUCTION_SUPABASE_REF } from "../supabase/functions/_shared/accountingStagingGuard.js";

const STAGE_REF = "abcdefghijklmnopqrst";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://staging.bunbun.example";
const period = () => ({
  month: "2026-11", periodStatus: "CLOSED", openingApproved: true,
  cutoverDate: "2026-11-01",
  incomeStatement: {
    netRevenue: "150000.00", cogs: "60000.00", grossProfit: "90000.00",
    operatingExpenses: "20000.00", netProfit: "70000.00",
  },
  cashFlow: {
    openingCash: "1000000.00", operating: "-30000.00",
    investing: "0.00", financing: "0.00",
    netCashChange: "-30000.00", closingCash: "970000.00",
  },
  financialPosition: {
    assets: "1320000.00", liabilities: "50000.00",
    totalEquity: "1270000.00", trialBalanceDifference: "0.00",
  },
});

function deps(overrides = {}) {
  return {
    stageEnabled: true, allowedOrigin: ORIGIN,
    verifyUserToken: async token => token === "valid.token" ? { id: OWNER } : null,
    loadProfile: async () => ({ id: OWNER, role: "owner", is_active: true }),
    loadMonthlyReport: async () => period(),
    ...overrides,
  };
}
function request(input = { action: "monthly-report", month: "2026-11" },
  options = {}) {
  const headers = {
    Origin: options.origin ?? ORIGIN,
    "Content-Type": options.type ?? "application/json",
    ...(options.token === null ? {} :
      { Authorization: "Bearer " + (options.token ?? "valid.token") }),
  };
  return new Request("https://staging-edge.example/monthly-report", {
    method: options.method || "POST", headers,
    body: (options.method || "POST") === "POST" ?
      (options.raw === undefined ? JSON.stringify(input) : options.raw) : undefined,
  });
}

test("authorized Owner reads only reconciled posted-ledger staging report", async () => {
  const response = await createOwnerMonthlyReportHandler(deps())(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.report.incomeStatement.netProfit, "70000.00");
  assert.equal(body.report.cashFlow.closingCash, "970000.00");
  assert.equal(body.report.financialPosition.assets, "1320000.00");
  assert.equal(body.readyForBonusDecision, false);
  assert.equal(body.readyForExpansionDecision, false);
  assert.equal(body.sourceCompletenessVerified, false);
  assert.equal(body.sourceAudited, false);
  assert.equal(body.mayPost, false);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("no stage or no backend adapter prevents even a valid Owner report", async () => {
  for (const inputs of [
    { stageEnabled: false },
    { allowedOrigin: "" },
    { loadMonthlyReport: null },
  ]) {
    const response = await createOwnerMonthlyReportHandler(deps(inputs))(request());
    assert.equal(response.status, 503);
  }
});

test("unknown origin does not reveal reports", async () => {
  let reads = 0;
  const handler = createOwnerMonthlyReportHandler(deps({
    loadMonthlyReport: async () => { reads++; return period(); },
  }));
  const response = await handler(request(undefined, { origin: "https://evil.example" }));
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("preflight allowed but not a data response", async () => {
  const handler = createOwnerMonthlyReportHandler(deps());
  const allowed = await handler(request(undefined, { method: "OPTIONS" }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
  const denied = await handler(request(undefined, { method: "OPTIONS", origin: "https://bad.example" }));
  assert.equal(denied.status, 403);
});

test("missing JWT, fake JWT, staff or inactive Owner are denied", async () => {
  const handler = createOwnerMonthlyReportHandler(deps());
  assert.equal((await handler(request(undefined, { token: null }))).status, 401);
  assert.equal((await handler(request(undefined, { token: "fake" }))).status, 401);
  for (const profile of [
    { id: OWNER, role: "baker", is_active: true },
    { id: OWNER, role: "helper", is_active: true },
    { id: OWNER, role: "owner", is_active: false },
    { id: "22222222-2222-4222-8222-222222222222", role: "owner", is_active: true },
  ]) {
    const r = await createOwnerMonthlyReportHandler(deps({
      loadProfile: async () => profile,
    }))(request());
    assert.equal(r.status, 403);
  }
});

test("cannot request posting, approve cutover or invent revenue in request body", async () => {
  const handler = createOwnerMonthlyReportHandler(deps());
  for (const input of [
    { action: "post-journal", journalId: "a" },
    { action: "approve-opening", month: "2026-11" },
    { action: "monthly-report", month: "2026-11", actorId: OWNER },
    { action: "monthly-report", month: "2026-11", amount: "1000000000" },
    { action: "monthly-report", month: "2026-00" },
    { action: "monthly-report", month: "2026-13" },
    { action: "monthly-report", month: "2026-11' OR 1=1 --" },
    { action: "monthly-report", month: ["2026-11"] },
    {},
    [],
  ]) {
    const response = await handler(request(input));
    assert.equal(response.status, 422, JSON.stringify(input));
  }
});

test("only POST JSON, strict body size and valid JSON accepted", async () => {
  const handler = createOwnerMonthlyReportHandler(deps());
  assert.equal((await handler(request(undefined, { method: "GET" }))).status, 405);
  assert.equal((await handler(request(undefined, { type: "text/plain" }))).status, 415);
  assert.equal((await handler(request(undefined, { raw: "{" }))).status, 400);
  assert.equal((await handler(request(undefined, { raw: JSON.stringify({
    action: "monthly-report", month: "2026-11", padding: "x".repeat(3000),
  }) }))).status, 413);
});

test("missing or unapproved opening/period has no financial output", async () => {
  for (const snapshot of [
    null,
    { ...period(), openingApproved: false },
    { ...period(), periodStatus: "DRAFT" },
  ]) {
    const response = await createOwnerMonthlyReportHandler(deps({
      loadMonthlyReport: async () => snapshot,
    }))(request());
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal("report" in body, false);
  }
});

test("failed query returns generic error, not SQL secrets or raw data", async () => {
  const response = await createOwnerMonthlyReportHandler(deps({
    loadMonthlyReport: async () => { throw new Error("password=veryprivate"); },
  }))(request());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("veryprivate"));
});

test("unreconciled P&L, cashflow or balance sheet never gets displayed", async () => {
  const badReports = [
    { ...period(), incomeStatement: { ...period().incomeStatement, netProfit: "90000.00" } },
    { ...period(), cashFlow: { ...period().cashFlow, closingCash: "990000.00" } },
    { ...period(), financialPosition: { ...period().financialPosition, assets: "1000000.00" } },
    { ...period(), financialPosition: { ...period().financialPosition, trialBalanceDifference: "1.00" } },
    { ...period(), incomeStatement: { ...period().incomeStatement, cogs: "9999999999999999" } },
  ];
  for (const snapshot of badReports) {
    const response = await createOwnerMonthlyReportHandler(deps({
      loadMonthlyReport: async () => snapshot,
    }))(request());
    assert.equal(response.status, 409);
    assert.equal("report" in await response.json(), false);
  }
});

test("financial money conversion is exact decimal cents, negative allowed", () => {
  assert.equal(reportMoneyToCents("1.01"), 101n);
  assert.equal(reportMoneyToCents("0"), 0n);
  assert.equal(reportMoneyToCents("-1.9"), -190n);
  assert.throws(() => reportMoneyToCents("1.111"));
  assert.throws(() => reportMoneyToCents("1,000"));
  assert.throws(() => reportMoneyToCents("Infinity"));
  assert.throws(() => reportMoneyToCents(10));
  assert.throws(() => reportMoneyToCents("123456789012345.00"));
});

test("pure reconciliation validates corrected closed month and tolerates open interim", () => {
  assert.equal(validatePostedFinancialSnapshot(period(), "2026-11").periodStatus, "CLOSED");
  assert.equal(validatePostedFinancialSnapshot({
    ...period(), periodStatus: "OPEN",
  }, "2026-11").periodStatus, "OPEN");
  assert.throws(() => validatePostedFinancialSnapshot(period(), "2026-10"));
});

test("direct and Supabase pooler DB URLs must be tied to STAGING ref", () => {
  assert.equal(isIsolatedAccountingDbUrl(
    "postgres://postgres:secret@db." + STAGE_REF + ".supabase.co:5432/postgres",
    STAGE_REF), true);
  assert.equal(isIsolatedAccountingDbUrl(
    "postgresql://postgres." + STAGE_REF +
    ":secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    STAGE_REF), true);
  assert.equal(isIsolatedAccountingDbUrl(
    "postgres://postgres:secret@db." + BUNBUN_PRODUCTION_SUPABASE_REF + ".supabase.co/postgres",
    STAGE_REF), false);
  assert.equal(isIsolatedAccountingDbUrl(
    "postgres://postgres:secret@db." + BUNBUN_PRODUCTION_SUPABASE_REF + ".supabase.co/postgres",
    BUNBUN_PRODUCTION_SUPABASE_REF), false);
  assert.equal(isIsolatedAccountingDbUrl("postgres://postgres:secret@evil.example/postgres", STAGE_REF), false);
  assert.equal(isIsolatedAccountingDbUrl("postgres://postgres@db." + STAGE_REF + ".supabase.co/postgres", STAGE_REF), false);
});

test("report SQL is constant and parameterized; does not expose draft journals", () => {
  assert.match(POSTED_FINANCIAL_REPORT_SQL, /\$1::text/);
  assert.match(POSTED_FINANCIAL_REPORT_SQL, /opening_snapshots/);
  assert.match(POSTED_FINANCIAL_REPORT_SQL, /op\.status = 'POSTED'/);
  assert.match(POSTED_FINANCIAL_REPORT_SQL, /v_monthly_profit_loss/);
  assert.match(POSTED_FINANCIAL_REPORT_SQL, /v_monthly_cash_flow/);
  assert.match(POSTED_FINANCIAL_REPORT_SQL, /v_monthly_financial_position/);
});

test("SQL row mapper rejects incomplete/unapproved snapshots", () => {
  assert.equal(parsePrivateLedgerReportRows([]), null);
  assert.equal(parsePrivateLedgerReportRows([{ opening_approved: false, period_status: "CLOSED" }]), null);
});

test("SQL row mapper sends only the intended report fields", () => {
  const p = period();
  const row = {
    month: "2026-11", period_status: "CLOSED", opening_approved: true,
    cutover_date: "2026-11-01",
    net_revenue: p.incomeStatement.netRevenue,
    cogs: p.incomeStatement.cogs,
    gross_profit: p.incomeStatement.grossProfit,
    operating_expenses: p.incomeStatement.operatingExpenses,
    net_profit: p.incomeStatement.netProfit,
    opening_cash: p.cashFlow.openingCash,
    cash_operating: p.cashFlow.operating,
    cash_investing: p.cashFlow.investing,
    cash_financing: p.cashFlow.financing,
    net_cash_change: p.cashFlow.netCashChange,
    closing_cash: p.cashFlow.closingCash,
    assets: p.financialPosition.assets,
    liabilities: p.financialPosition.liabilities,
    total_equity: p.financialPosition.totalEquity,
    trial_balance_difference: p.financialPosition.trialBalanceDifference,
    secret: "do not expose",
  };
  assert.deepEqual(parsePrivateLedgerReportRows([row]), p);
  assert.equal("secret" in parsePrivateLedgerReportRows([row]), false);
});


test("approved cutover date must be real and must not start after report period", () => {
  assert.throws(() => validatePostedFinancialSnapshot({
    ...period(), cutoverDate: null,
  }, "2026-11"), /belum siap/i);
  assert.throws(() => validatePostedFinancialSnapshot({
    ...period(), cutoverDate: "2026-02-30",
  }, "2026-11"), /belum siap/i);
  assert.throws(() => validatePostedFinancialSnapshot({
    ...period(), cutoverDate: "2026-12-01",
  }, "2026-11"), /belum siap/i);
});

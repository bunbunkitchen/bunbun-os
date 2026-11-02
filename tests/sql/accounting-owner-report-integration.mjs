/**
 * Cross-layer integration, isolated PostgreSQL ONLY:
 * - "emit" writes a SELECT against the actual private posted-ledger views
 *   using the SAME SQL definition as the Owner Edge Function.
 * - "assert <jsonfile>" validates the query output with the SAME exact-cent
 *   reconciliation used by the Owner API.
 *
 * This is not a production data export.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  POSTED_FINANCIAL_REPORT_SQL,
  parsePrivateLedgerReportRows,
} from "../../supabase/functions/_shared/accountingPrivateLedgerRead.js";
import { validatePostedFinancialSnapshot } from "../../supabase/functions/_shared/accountingOwnerMonthlyReport.js";

const mode = process.argv[2];

if (mode === "emit") {
  const anchor = "$1::text";
  assert.equal(POSTED_FINANCIAL_REPORT_SQL.split(anchor).length, 2);
  // The test month below is hard-coded CI sample data, never user input.
  const query = POSTED_FINANCIAL_REPORT_SQL.replace(anchor, "'2026-11'::text");
  process.stdout.write("select row_to_json(report)::text from (\n" + query + "\n) report;\n");
} else if (mode === "assert") {
  const filepath = process.argv[3];
  assert.ok(filepath, "Missing isolated PostgreSQL output path");
  const content = readFileSync(filepath, "utf8").trim();
  const row = JSON.parse(content);
  const mapped = parsePrivateLedgerReportRows([row]);
  assert.ok(mapped, "DB view missing posted opening or period");
  const report = validatePostedFinancialSnapshot(mapped, "2026-11");
  assert.equal(report.periodStatus, "OPEN");
  assert.equal(report.incomeStatement.netRevenue, "150000.00");
  assert.equal(report.incomeStatement.cogs, "60000.00");
  assert.equal(report.incomeStatement.netProfit, "70000.00");
  assert.equal(report.cashFlow.openingCash, "1000000.00");
  assert.equal(report.cashFlow.operating, "-30000.00");
  assert.equal(report.cashFlow.closingCash, "970000.00");
  assert.equal(report.financialPosition.assets, "1320000.00");
  assert.equal(report.financialPosition.liabilities, "50000.00");
  assert.equal(report.financialPosition.totalEquity, "1270000.00");
  assert.equal(report.financialPosition.trialBalanceDifference, "0.00");
  console.log("PASS: shared Owner SQL -> PostgreSQL posted ledger -> exact-cent API financial report");
} else {
  throw new Error("Usage: node tests/sql/accounting-owner-report-integration.mjs emit|assert <jsonfile>");
}

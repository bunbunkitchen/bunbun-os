import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCOUNT_CATALOG } from "../src/utils/accountingPostedReports.js";
import { OPENING_ACCOUNTS, OPENING_EQUITY } from "../src/utils/accountingOpeningJournal.js";

const path = new URL("../docs/sql/accounting-schema-review.sql", import.meta.url);
const sql = readFileSync(path, "utf8");

test("review SQL is explicitly NOT a runnable migration", () => {
  assert.match(sql, /DO NOT EXECUTE IN PRODUCTION/i);
  assert.match(sql, /NOT A SUPABASE MIGRATION/i);
  assert.match(sql, /STILL REQUIRED before any deployment/i);
});

test("every reporting account is present in proposed private schema", () => {
  for (const account of ACCOUNT_CATALOG) {
    const exp = new RegExp("\\('" + account.code + "','[^']+','" + account.type + "',(true|false)\\)");
    assert.match(sql, exp, "Account not seeded with expected type: " + account.code);
  }
});

test("opening preview account codes match the reporting catalog", () => {
  const reported = new Set(ACCOUNT_CATALOG.map(a => a.code));
  for (const account of OPENING_ACCOUNTS) {
    assert.ok(reported.has(account.code), "Unrecognized opening account " + account.code);
  }
  assert.ok(reported.has(OPENING_EQUITY.code));
});

test("private schema review has no direct browser writes and requires RLS", () => {
  assert.match(sql, /revoke all on schema bunbun_accounting from public, anon, authenticated/i);
  assert.match(sql, /revoke all on all tables in schema bunbun_accounting/i);
  assert.match(sql, /alter table bunbun_accounting\.journals enable row level security/i);
  assert.match(sql, /alter table bunbun_accounting\.opening_snapshots enable row level security/i);
  assert.doesNotMatch(sql, /security definer/i);
});

test("idempotent posting and line double-entry constraints are specified", () => {
  assert.match(sql, /operation_key uuid not null unique/i);
  assert.match(sql, /source_key text not null unique/i);
  assert.match(sql, /check \(\(debit > 0 and credit = 0\) or \(credit > 0 and debit = 0\)\)/i);
  assert.match(sql, /approved_by uuid references auth\.users/i);
  assert.match(sql, /source_type in \('OPENING','NORMAL','REVERSAL'\)/i);
});

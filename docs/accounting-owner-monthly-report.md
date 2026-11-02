# Bunbun OS — Staging Owner Monthly Financial Report API

Status: **STAGING-ONLY CODE, NOT DEPLOYED**. No production Supabase changes, no approved cutover, no live financial report.

## Why this stage exists
An Owner who wants bonus/expansion decisions must rely on source-complete posted journals, not historical cashbook arithmetic or a synthetic cash balance. This API is deliberately read-only and refuses unapproved or unreconciled periods.

## New backend components
- `supabase/functions/_shared/accountingStagingGuard.js`: explicit stage flag, exact independent Supabase project ref, exact trusted frontend origin, and hard-coded deny for the known Bunbun production Supabase project ref.
- `supabase/functions/_shared/accountingPrivateLedgerRead.js`: database URL must resolve to the SAME independent staging project (direct or Supabase pooler). Constant parameterized SQL reads only private posted-journal views plus approved opening snapshot.
- `supabase/functions/_shared/accountingOwnerMonthlyReport.js`: validates remote Auth token and fresh active Owner profile before querying ledger; accepts only a period `YYYY-MM`; validates P&L, cashflow and balance sheet using exact integer cents; rejects drafts, incomplete/unbalanced reports, mismatched periods and injection input.
- `supabase/functions/accounting-owner-monthly-report/index.ts`: Deno Supabase Edge Function, isolated staging only, uses server-side-only Admin Auth and pinned `postgres` driver through a TLS database connection. No `INSERT`, `UPDATE`, `DELETE`, posting, opening approval or journal reversal action.
- `supabase/functions/accounting-owner-readiness/index.ts` is also hardened to reject Bunbun production even if a stage flag is enabled.
- `deno.json`: local Deno dependency resolver for pinned Edge imports.

## Request / response contract (for staging after provisioning)
- Method: `POST`, Origin: exact allowed staging frontend, Auth: real Supabase user Bearer JWT, JSON body: `{ "action": "monthly-report", "month": "2026-11" }`.
- Valid authenticated Owner + posted opening + report period: returns read-only P&L, cashflow and balance sheet, with `status=STAGING_POSTED_JOURNALS_ONLY`.
- Missing period / opening: HTTP 409, no financial fields. Unbalanced reports: HTTP 409, no financial fields.
- Offline DB/invalid token/non-Owner/disabled stage: fail closed. No role or amount can be supplied by the request body.
- Response always includes `readyForBonusDecision=false`, `readyForExpansionDecision=false`, `sourceAudited=false`, `sourceCompletenessVerified=false`, and `mayPost=false`. This is NOT a business-profit certification.
- Even a CLOSED accounting period only proves that local ledger was closed. It does **not** prove cafe sales, purchasing, costing and inventory are completely reconciled.

## Configuration for an independent Supabase staging project
1. Obtain a separate staging project in the organization selected by the Owner. Creation might add billing; do not create automatically.
2. Set `BUNBUN_ACCOUNTING_STAGE=isolated-staging` in the staging Edge environment only.
3. Set `BUNBUN_ACCOUNTING_STAGING_REF` to the exact ref of the NEW staging project. The known production ref is explicitly denied.
4. Set `BUNBUN_ACCOUNTING_ALLOWED_ORIGIN` to the canonical HTTPS origin of the staging frontend (or localhost for local testing).
5. Set `BUNBUN_ACCOUNTING_STAGING_DB_URL` to the staging DB URL **only**, using TLS. The URL's hostname/username must identify the staging project ref.
6. Keep `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server-only. Never expose service role or DB password to Vite/browser, JSON draft or GitHub repository.
7. Keep gateway JWT verification ON. Do not make this function public or grant frontend direct access to private SQL.
8. Seed synthetic staging users/data only. Deploy the Edge function to the staging project after full RLS + Owner/non-Owner session tests.

## Verification
- `tests/hppAccountingStagingGuard.test.js`: production ref, lookalike URL and invalid origins blocked.
- `tests/hppAccountingMonthlyReportApi.test.js`: Owner role, token, month, malformed/malicious body, SQL mapping, exact-cent reconciliations and database URL guards.
- `tests/sql/accounting-owner-report-integration.mjs`: runs the **same SQL query used by the Edge endpoint** against the ephemeral PostgreSQL bakery simulation and validates it using the same report validation function.
- Latest tested branch results: 128/128 JS tests passed, ESLint, Vite build, Deno typecheck, PG16 integration and SQL-to-API exact-cent check passed.
- Github Actions: https://github.com/bunbunkitchen/bunbun-os/actions/runs/41374793986 and https://github.com/bunbunkitchen/bunbun-os/actions/runs/41374794062

## What remains blocked
1. No separate Supabase staging project is connected; the only currently listed project is live `bunbun-os`.
2. Endpoint is written but NOT deployed to Supabase, and has not yet been tested against Supabase Auth/RLS with real staging user sessions.
3. A production-safe posting adapter/operation audit with source-document validation, stock valuation, cash settlement reconciliation, full row locking/concurrency, and rollback remains to be implemented/tested.
4. Owner-approved stock opname and cutover date are still required.
5. No current Bunbun P&L or bonus/expansion eligibility can be calculated from synthetic tests.

**No production data was modified during this milestone. Draft PR must stay unmerged until the above controls are reviewed.**
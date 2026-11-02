/**
 * Private ledger read boundary. Never run against the Bunbun production DB.
 * Query is CONSTANT and parameterized: $1 is validated YYYY-MM in the API.
 */
import { BUNBUN_PRODUCTION_SUPABASE_REF } from "./accountingStagingGuard.js";

export function isIsolatedAccountingDbUrl(databaseUrl, stagingRef) {
  if (typeof databaseUrl !== "string" || typeof stagingRef !== "string" ||
      !/^[a-z]{20}$/.test(stagingRef) ||
      stagingRef === BUNBUN_PRODUCTION_SUPABASE_REF) return false;
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.password || !url.hostname || url.pathname !== "/postgres" ||
      url.hash || !url.username) return false;
    const direct = url.hostname === "db." + stagingRef + ".supabase.co" &&
      url.username === "postgres";
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      url.username === "postgres." + stagingRef;
    return direct || pooler;
  } catch {
    return false;
  }
}

// All source fields are posted-ledger views in a private accounting schema.
export const POSTED_FINANCIAL_REPORT_SQL = [
  "select",
  "  to_char(p.month_start,'YYYY-MM') as month,",
  "  p.status as period_status,",
  "  (select to_char(s.cutover_on, 'YYYY-MM-DD')",
  "   from bunbun_accounting.opening_snapshots s",
  "   join bunbun_accounting.journals j",
  "     on j.period_id = s.period_id",
  "    and j.source_type = 'OPENING' and j.status = 'POSTED'",
  "    and j.posting_date = s.cutover_on",
  "   where s.status = 'APPROVED'",
  "     and s.approved_by is not null and s.approved_at is not null",
  "     and s.cutover_on < (p.month_start + interval '1 month')::date",
  "   order by s.cutover_on limit 1) as cutover_date,",
  "  exists (",
  "    select 1 from bunbun_accounting.opening_snapshots s",
  "    join bunbun_accounting.journals op",
  "      on op.period_id = s.period_id",
  "     and op.source_type = 'OPENING'",
  "     and op.status = 'POSTED'",
  "     and op.posting_date = s.cutover_on",
  "    where s.status = 'APPROVED'",
  "      and s.approved_by is not null and s.approved_at is not null",
  "      and op.posting_date < (p.month_start + interval '1 month')::date",
  "  ) as opening_approved,",
  "  pl.net_revenue::text as net_revenue,",
  "  pl.cogs::text as cogs,",
  "  pl.gross_profit::text as gross_profit,",
  "  pl.operating_expenses::text as operating_expenses,",
  "  pl.net_profit::text as net_profit,",
  "  cf.opening_cash::text as opening_cash,",
  "  cf.operating::text as cash_operating,",
  "  cf.investing::text as cash_investing,",
  "  cf.financing::text as cash_financing,",
  "  cf.net_cash_change::text as net_cash_change,",
  "  cf.closing_cash::text as closing_cash,",
  "  fp.assets::text as assets,",
  "  fp.liabilities::text as liabilities,",
  "  fp.total_equity::text as total_equity,",
  "  fp.trial_balance_difference::text as trial_balance_difference",
  "from bunbun_accounting.periods p",
  "join bunbun_accounting.v_monthly_profit_loss pl",
  "  on pl.month = p.month_start",
  "join bunbun_accounting.v_monthly_cash_flow cf",
  "  on cf.month = p.month_start",
  "join bunbun_accounting.v_monthly_financial_position fp",
  "  on fp.month = p.month_start",
  "where p.month_start = ($1::text || '-01')::date",
  "  and p.status in ('OPEN','CLOSED')",
  "limit 1",
].join("\n");

export function parsePrivateLedgerReportRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (!row || row.opening_approved !== true ||
      !["OPEN", "CLOSED"].includes(row.period_status)) return null;
  return {
    month: row.month,
    periodStatus: row.period_status,
    cutoverDate: row.cutover_date,
    openingApproved: row.opening_approved,
    incomeStatement: {
      netRevenue: row.net_revenue,
      cogs: row.cogs,
      grossProfit: row.gross_profit,
      operatingExpenses: row.operating_expenses,
      netProfit: row.net_profit,
    },
    cashFlow: {
      openingCash: row.opening_cash,
      operating: row.cash_operating,
      investing: row.cash_investing,
      financing: row.cash_financing,
      netCashChange: row.net_cash_change,
      closingCash: row.closing_cash,
    },
    financialPosition: {
      assets: row.assets,
      liabilities: row.liabilities,
      totalEquity: row.total_equity,
      trialBalanceDifference: row.trial_balance_difference,
    },
  };
}

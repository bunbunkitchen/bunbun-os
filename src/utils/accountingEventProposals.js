/**
 * Bunbun OS — accounting journal PROPOSALS from verified business events.
 * NOT an automatic mapper of historical sales/incomes/expenses.
 *
 * Caller must supply a reviewed document and an actual accounting amount.
 * All outputs are DRAFT; a future trusted backend must independently verify
 * source ownership, amounts, stock, receivables, RLS, anti-replay and period.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";
import { toJournalCents } from "./accountingPostedReports.js";

const INVENTORY_ACCOUNTS = new Set(["1210", "1215", "1220", "1230", "1240"]);
const SELLABLE_STOCK = new Set(["1220", "1230", "1240"]);
const OPERATING_EXPENSE = new Set(["6010", "6020", "6030", "6040", "6050", "6060", "6070"]);
const CASH_ACCOUNTS = new Set(["1010", "1020"]);

function checkedAccount(value, allowed, label) {
  const account = String(value || "");
  if (!allowed.has(account)) throw new Error(label + " belum dipilih dengan benar.");
  return account;
}

function entry(code, cents, side) {
  const amount = (cents / 100).toFixed(2);
  return {
    accountCode: code,
    debit: side === "DEBIT" ? amount : "0.00",
    credit: side === "CREDIT" ? amount : "0.00",
  };
}

/**
 * sourceKey must refer to an independently verified, unique source event.
 * A purchase-linked expense is not another cost event.
 */
export function proposeAccountingEvent(event) {
  if (!event || event.reviewed !== true ||
    !isValidIsoDate(event.date) ||
    typeof event.sourceKey !== "string" ||
    !/^[a-zA-Z0-9:_-]{3,120}$/.test(event.sourceKey) ||
    typeof event.evidence !== "string" || !event.evidence.trim()) {
    throw new Error("Event harus direview dengan tanggal, sumber unik dan bukti yang jelas.");
  }
  if (event.linkedPurchaseId && event.type === "PERIOD_EXPENSE_PAYMENT") {
    throw new Error("Pengeluaran terkait Purchasing harus diklasifikasikan melalui pembelian, bukan beban kedua.");
  }

  const cents = toJournalCents(event.amount, "Nilai perolehan/transaksi");
  if (cents <= 0) throw new Error("Nilai event akuntansi harus positif.");
  let debit;
  let credit;
  let category = null;
  let requiresBalanceCheck = false;
  let requiresStockCheck = false;

  switch (event.type) {
    case "PURCHASE_RAW_MATERIAL":
      // Initial recognition of material/invoice; paid invoice follows
      // as a separate payable settlement, never an immediate COGS.
      debit = "1210"; credit = "2010"; break;
    case "PAY_PURCHASE_PAYABLE":
      debit = "2010";
      credit = checkedAccount(event.cashAccount, CASH_ACCOUNTS, "Sumber kas/bank");
      category = "OPERATING"; requiresBalanceCheck = true; break;
    case "MATERIALS_TO_WIP":
      debit = "1215"; credit = "1210"; requiresStockCheck = true; break;
    case "WIP_TO_FINISHED":
      debit = checkedAccount(event.targetInventoryAccount, new Set(["1220", "1230"]), "Tujuan barang selesai");
      credit = "1215"; requiresStockCheck = true; break;
    case "TRANSFER_SELLABLE_STOCK":
      debit = checkedAccount(event.targetInventoryAccount, SELLABLE_STOCK, "Tujuan stock");
      credit = checkedAccount(event.sourceInventoryAccount, SELLABLE_STOCK, "Asal stock");
      if (debit === credit) throw new Error("Asal dan tujuan persediaan harus berbeda.");
      requiresStockCheck = true; break;
    case "RECOGNIZE_BUNBUN_SALE":
      if (event.revenueBasis !== "CONFIRMED_BUNBUN_ENTITLEMENT") {
        throw new Error("Pendapatan harus sebesar hak Bunbun yang telah diverifikasi, bukan omzet kafe bruto.");
      }
      debit = "1120"; credit = "4010"; break;
    case "RECOGNIZE_WHOLESALE_SALE":
      debit = "1120"; credit = "4020"; break;
    case "RECOGNIZE_SOLD_COGS":
      debit = "5010";
      credit = checkedAccount(event.inventoryAccount, SELLABLE_STOCK, "Persediaan produk terjual");
      requiresStockCheck = true; break;
    case "RECEIVE_CAFE_SETTLEMENT":
      if (!event.receivableReference) {
        throw new Error("Setoran kafe wajib dirujuk ke piutang penjualan agar tidak menjadi pendapatan ganda.");
      }
      debit = checkedAccount(event.cashAccount, CASH_ACCOUNTS, "Tujuan setoran");
      credit = "1120"; category = "OPERATING"; requiresBalanceCheck = true; break;
    case "PERIOD_EXPENSE_PAYMENT":
      debit = checkedAccount(event.expenseAccount, OPERATING_EXPENSE, "Akun beban");
      credit = checkedAccount(event.cashAccount, CASH_ACCOUNTS, "Sumber kas/bank");
      category = "OPERATING"; break;
    case "OWNER_CAPITAL_IN":
      debit = checkedAccount(event.cashAccount, CASH_ACCOUNTS, "Tujuan kas/bank");
      credit = "3100"; category = "FINANCING"; break;
    case "OWNER_DRAWING":
      debit = "3200";
      credit = checkedAccount(event.cashAccount, CASH_ACCOUNTS, "Sumber kas/bank");
      category = "FINANCING"; break;
    case "CAPITAL_EXPENDITURE":
      debit = "1590";
      credit = checkedAccount(event.cashAccount, CASH_ACCOUNTS, "Sumber kas/bank");
      category = "INVESTING"; break;
    case "ABNORMAL_STOCK_LOSS":
      debit = "6070";
      credit = checkedAccount(event.inventoryAccount, INVENTORY_ACCOUNTS, "Persediaan terdampak");
      requiresStockCheck = true; break;
    default:
      throw new Error("Jenis transaksi belum punya aturan akuntansi yang disetujui.");
  }

  return {
    sourceKey: event.sourceKey,
    date: event.date,
    sourceType: "NORMAL",
    status: "DRAFT",
    cashFlowCategory: category,
    lines: [entry(debit, cents, "DEBIT"), entry(credit, cents, "CREDIT")],
    evidence: event.evidence.trim(),
    requiresBalanceCheck,
    requiresStockCheck,
    requiresCutoverApproval: true,
    approved: false,
    readyToPost: false,
    writesDatabase: false,
    // A future posting service must check original source records,
    // quantity/value reconciliation, settlement allocation and period status.
  };
}

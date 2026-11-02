/**
 * Bunbun Kitchen — read-only sale item ↔ stock movement crosscheck.
 *
 * A sale_item references a product and quantity; product_stock_movements
 * references sale_id and product_id. A CAFE_OUT row does NOT identify a
 * production lot and it is NOT proof of external café settlement.
 *
 * Output is an audit of source traceability, NEVER revenue or actual COGS.
 * Unknown/partial sources fail closed rather than silently treating them
 * as zero. No database access or writes in this module.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";
import { toJournalCents } from "./accountingPostedReports.js";

const safeId = (value, label) => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(label + " melebihi batas ID aman.");
  }
  if (!/^[1-9]\d{0,15}$/.test(String(value ?? ""))) {
    throw new Error(label + " tidak valid.");
  }
  return String(value);
};
const qty = (value, label) => {
  if (value == null || value === "" || typeof value === "boolean" ||
    !/^\d+(?:\.0+)?$/.test(String(value))) {
    throw new Error(label + " wajib unit bulat positif.");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(label + " wajib unit bulat positif.");
  }
  return number;
};
const add = (a, b, label) => {
  if (!Number.isSafeInteger(a + b)) throw new Error(label + " melebihi batas aman.");
  return a + b;
};
const money = (value, label) => {
  // Amounts may be legitimately zero for complimentary/discounted sale lines,
  // but null/invalid amounts must not be normalized to zero.
  return toJournalCents(value, label);
};
const issue = (code, key, message) => ({ code, source: key, message });
const duplicateGuard = (rows, label) => {
  if (!Array.isArray(rows)) throw new Error("Sumber " + label + " belum dimuat seluruhnya.");
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("Baris " + label + " rusak.");
    }
    const key = safeId(row.id, "ID " + label);
    if (ids.has(key)) throw new Error("ID " + label + " duplikat.");
    ids.add(key);
    if (row.is_deleted === true) throw new Error("Sumber " + label + " terhapus tidak boleh dihitung.");
  }
};

/**
 * Crosschecks every line and linked CAFE_OUT per product and sale ID.
 * Orphan movements in the selected calendar month are reported separately,
 * not retroactively assigned to any sale based on date/quantity.
 */
export function reconcileSaleStockSourceRows({
  month, sales, saleItems, movements, orphanMovements = [],
}) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Bulan rekonsiliasi tidak valid.");
  }
  duplicateGuard(sales, "sales");
  duplicateGuard(saleItems, "sale_items");
  duplicateGuard(movements, "product_stock_movements");
  duplicateGuard(orphanMovements, "CAFE_OUT tanpa penjualan");

  const salesMap = new Map();
  const problems = [];
  const categories = {
    saleCount: sales.length,
    itemCount: saleItems.length,
    linkedMovementCount: movements.length,
    orphanMovementCount: orphanMovements.length,
    matchedSaleCount: 0,
    needsReviewSaleCount: 0,
    sourceLinkedUnitCount: 0,
    itemUnitCount: 0,
    orphanUnitCount: 0,
    confirmedSoldUnitCount: 0,
    confirmedLotUnitCount: 0,
  };
  const linesBySale = new Map();
  const movementsBySale = new Map();

  for (const row of sales) {
    const id = safeId(row.id, "Sales");
    if (!isValidIsoDate(row.sale_date) || row.sale_date.slice(0, 7) !== month) {
      throw new Error("Tanggal sales di luar bulan rekonsiliasi.");
    }
    if (typeof row.sales_channel !== "string" || !row.sales_channel.trim()) {
      throw new Error("Sumber sales tanpa channel.");
    }
    money(row.total_amount, "Nilai sales");
    salesMap.set(id, row);
  }

  for (const row of saleItems) {
    const saleId = safeId(row.sale_id, "Referensi sale_item");
    const productId = safeId(row.product_id, "Produk sale_item");
    if (!salesMap.has(saleId)) {
      throw new Error("Sale item mengacu pada transaksi yang tidak dimuat.");
    }
    const amount = qty(row.quantity, "Jumlah sale_item");
    money(row.subtotal, "Nilai sale_item");
    categories.itemUnitCount = add(categories.itemUnitCount, amount, "Jumlah sale item");
    const perSale = linesBySale.get(saleId) ?? [];
    perSale.push({ row, productId, amount });
    linesBySale.set(saleId, perSale);
  }

  const movementIds = new Set();
  for (const row of movements) {
    const id = safeId(row.id, "ID mutasi");
    movementIds.add(id);
    const saleId = safeId(row.sale_id, "Referensi sale_id pada mutasi");
    safeId(row.product_id, "Produk pada mutasi");
    qty(row.qty, "Jumlah mutasi");
    if (!isValidIsoDate(row.movement_date)) {
      throw new Error("Tanggal mutasi stok tidak valid.");
    }
    if (!salesMap.has(saleId)) {
      throw new Error("Mutasi mengacu pada sales di luar dataset yang dimuat.");
    }
    const perSale = movementsBySale.get(saleId) ?? [];
    perSale.push(row);
    movementsBySale.set(saleId, perSale);
  }
  for (const row of orphanMovements) {
    const id = safeId(row.id, "Mutasi tanpa sales");
    if (movementIds.has(id)) throw new Error("Mutasi stok muncul di dua kelompok.");
    if (row.sale_id !== null && row.sale_id !== undefined) {
      throw new Error("Mutasi tidak boleh dianggap orphan bila punya sale_id.");
    }
    if (row.movement_type !== "CAFE_OUT" ||
      !isValidIsoDate(row.movement_date) ||
      row.movement_date.slice(0, 7) !== month) {
      throw new Error("Mutasi orphan bukan CAFE_OUT bulan yang dipilih.");
    }
    safeId(row.product_id, "Produk mutasi orphan");
    categories.orphanUnitCount = add(categories.orphanUnitCount,
      qty(row.qty, "Jumlah mutasi orphan"), "Jumlah stok tanpa sales");
  }
  if (orphanMovements.length) {
    problems.push(issue("CAFE_OUT_WITHOUT_SALE_ID", "product_stock_movements",
      orphanMovements.length + " mutasi CAFE_OUT belum punya sale_id dan memerlukan penelusuran manual."));
  }

  const perSale = [];
  for (const row of sales) {
    const saleId = String(row.id);
    const saleLines = linesBySale.get(saleId) ?? [];
    const stockMoves = movementsBySale.get(saleId) ?? [];
    const warnings = [];
    const productTotals = new Map();
    let subtotal = 0;
    for (const { row: line, productId, amount } of saleLines) {
      subtotal = add(subtotal, money(line.subtotal, "Subtotal sale item"),
        "Total line sale");
      const entry = productTotals.get(productId) ?? { productId, soldUnits: 0, movedUnits: 0,
        lineIds: [], movementIds: [] };
      entry.soldUnits = add(entry.soldUnits, amount, "Qty item sale");
      entry.lineIds.push(String(line.id));
      productTotals.set(productId, entry);
    }
    if (!saleLines.length) {
      warnings.push(issue("SALE_WITHOUT_ITEMS", "sales:" + saleId,
        "Transaksi penjualan tidak memiliki rincian produk."));
    }
    if (subtotal !== money(row.total_amount, "Total sales")) {
      warnings.push(issue("SALE_LINE_TOTAL_MISMATCH", "sales:" + saleId,
        "Jumlah subtotal item berbeda dari total sales; cek diskon, pembulatan, atau koreksi."));
    }
    for (const movement of stockMoves) {
      const productId = String(movement.product_id);
      if (movement.movement_type !== "CAFE_OUT") {
        warnings.push(issue("UNSUPPORTED_SALE_STOCK_TYPE", "stock:" + movement.id,
          "Mutasi berkaitan sales tetapi bukan CAFE_OUT."));
      }
      if (movement.movement_date !== row.sale_date) {
        warnings.push(issue("SALE_MOVEMENT_DATE_MISMATCH", "stock:" + movement.id,
          "Tanggal mutasi berbeda dari tanggal sale; perlu penelusuran."));
      }
      const entry = productTotals.get(productId);
      if (!entry) {
        warnings.push(issue("STOCK_PRODUCT_NOT_IN_SALE", "stock:" + movement.id,
          "Stok keluar untuk produk yang tidak tercantum pada sale."));
        continue;
      }
      if (movement.movement_type !== "CAFE_OUT") continue;
      entry.movedUnits = add(entry.movedUnits, qty(movement.qty, "Qty stok"), "Qty mutasi");
      entry.movementIds.push(String(movement.id));
    }
    for (const entry of productTotals.values()) {
      if (entry.soldUnits !== entry.movedUnits) {
        warnings.push(issue("SALE_STOCK_QTY_MISMATCH", "sales:" + saleId + ":product:" + entry.productId,
          "Jumlah item tidak cocok dengan jumlah CAFE_OUT terkait untuk produk ini."));
      }
      categories.sourceLinkedUnitCount = add(categories.sourceLinkedUnitCount,
        entry.movedUnits, "Qty stok tertaut");
    }
    const matched = warnings.length === 0;
    if (matched) categories.matchedSaleCount++;
    else categories.needsReviewSaleCount++;
    problems.push(...warnings);
    perSale.push({
      saleId, saleDate: row.sale_date, salesChannel: row.sales_channel,
      saleLineCount: saleLines.length, movementCount: stockMoves.length,
      qtyMatched: matched,
      lotSourceVerified: false,
      saleEvidenceVerified: false,
      costVerified: false,
      issues: warnings,
      products: [...productTotals.values()].sort((a, b) =>
        Number(a.productId) - Number(b.productId)),
    });
  }
  return {
    month,
    status: "SALES_TO_STOCK_LINK_AUDIT_ONLY",
    summary: categories,
    sales: perSale, issues: problems,
    allStockLinksMatch: problems.length === 0,
    automaticLotAssignmentPermitted: false,
    confirmedActualHpp: false, readyToPost: false,
    writesDatabase: false,
    note: "Kecocokan jumlah dan ID tidak membuktikan produk terjual, HPP, atau lot asal.",
  };
}

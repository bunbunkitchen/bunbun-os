/**
 * Audit-only historical moving weighted average (MWA).
 *
 * Never writes inventory, derives purchase cost from recipe master price,
 * treats cash expenses as raw-material cost, or guesses an opening balance.
 * Values here are preview numbers (JS Number); authoritative posting later
 * must use atomic PostgreSQL NUMERIC and reviewed ledger order.
 */
const UNIT = {
  gram: { family: "mass", factor: 1 },
  gr: { family: "mass", factor: 1 },
  kg: { family: "mass", factor: 1000 },
  ml: { family: "volume", factor: 1 },
  l: { family: "volume", factor: 1000 },
  liter: { family: "volume", factor: 1000 },
  pc: { family: "count", factor: 1 },
  pcs: { family: "count", factor: 1 },
};
const INPUT = new Set(["PURCHASE", "ADJUSTMENT", "ADJUSTMENT_IN", "PRODUCTION_IN"]);
const OUTPUT = new Set(["PRODUCTION_OUT", "ADJUSTMENT_OUT", "SALE"]);

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function convertToBaseQuantity(value, unit) {
  const qty = safeNumber(value);
  const definition = UNIT[String(unit || "").toLowerCase()];
  if (qty === null || qty <= 0 || !definition) return null;
  return { qty: qty * definition.factor, family: definition.family };
}

function parseEvent(row, baseFamily) {
  const converted = convertToBaseQuantity(row.qty, row.unit);
  if (!converted || converted.family !== baseFamily) return null;
  return converted.qty;
}

function compareDateThenId(a, b) {
  const dates = String(a.transaction_date).localeCompare(String(b.transaction_date));
  if (dates) return dates;
  // This is a provisional order, NOT verified intraday sequencing.
  return Number(a.id) - Number(b.id);
}

export function reconstructIngredientMWA({
  ingredient,
  purchases = [],
  movements = [],
  opening = null,
}) {
  if (!ingredient?.id || !UNIT[String(ingredient.satuan || "").toLowerCase()]) {
    throw new Error("Master bahan / satuan dasar tidak valid.");
  }
  if (!Array.isArray(purchases) || !Array.isArray(movements)) {
    throw new Error("Daftar transaksi atau pembelian tidak valid.");
  }
  const id = String(ingredient.id);
  const baseUnit = UNIT[String(ingredient.satuan).toLowerCase()];
  const baseLabel = baseUnit.family === "mass" ? "gram" :
    baseUnit.family === "volume" ? "ml" : "pc";
  const allEvents = movements
    .filter(row => !row.is_deleted && String(row.ingredient_id) === id)
    .sort(compareDateThenId);
  const purchaseMap = new Map(purchases.map(row => [String(row.id), row]));
  const blockers = [];
  const add = (code, row, message) =>
    blockers.push({ code, transactionId: row?.id ?? null, date: row?.transaction_date ?? null, message });
  let qty = null;
  let value = null;
  let known = false;
  const asOfDate = opening?.asOfDate;
  if (opening?.approved === true && typeof asOfDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) &&
      (!allEvents.length || asOfDate < allEvents[0].transaction_date)) {
    const openingQty = safeNumber(opening.quantity);
    const openingValue = safeNumber(opening.value);
    const openingAmount = convertToBaseQuantity(openingQty, opening.unit || baseLabel);
    if (openingQty === 0 && openingValue === 0) {
      qty = 0; value = 0; known = true;
    } else if (openingAmount?.family === baseUnit.family &&
        openingValue !== null && openingValue >= 0 && openingAmount.qty > 0) {
      qty = openingAmount.qty;
      value = openingValue;
      known = true;
    }
  }
  if (!known) {
    add("OPENING_BALANCE_UNVERIFIED", null,
      "Saldo awal sebelum transaksi pertama belum memiliki jumlah, nilai, dan persetujuan.");
  }
  const firstPurchase = allEvents.find(row => row.transaction_type === "PURCHASE");
  const firstUse = allEvents.find(row => OUTPUT.has(row.transaction_type));
  if (firstUse && (!firstPurchase || firstUse.transaction_date < firstPurchase.transaction_date)) {
    add("USE_BEFORE_FIRST_PURCHASE", firstUse,
      "Pemakaian stok mendahului pembelian pertama yang tercatat.");
  }
  // Flag same-date inbound/outbound: historical IDs and created_at may reflect backfills.
  const dates = new Map();
  for (const row of allEvents) {
    const flags = dates.get(row.transaction_date) || { input: false, output: false, first: row };
    if (INPUT.has(row.transaction_type)) flags.input = true;
    if (OUTPUT.has(row.transaction_type)) flags.output = true;
    dates.set(row.transaction_date, flags);
  }
  for (const [date, flags] of dates) {
    if (flags.input && flags.output) {
      add("SAME_DAY_ORDER_UNVERIFIED", { id: flags.first.id, transaction_date: date },
        "Ada masuk dan keluar pada tanggal yang sama. Urutan kejadian asli perlu dikonfirmasi.");
    }
  }
  const ledger = [];
  for (const row of allEvents) {
    const amount = parseEvent(row, baseUnit.family);
    if (amount === null) {
      add("UNIT_OR_QUANTITY_INVALID", row,
        "Satuan transaksi tidak kompatibel dengan satuan master atau jumlah tidak positif.");
      known = false;
      ledger.push({ id: row.id, type: row.transaction_type, cost: null, balanceQty: null, balanceValue: null });
      continue;
    }
    const incoming = INPUT.has(row.transaction_type);
    const outgoing = OUTPUT.has(row.transaction_type);
    if (!incoming && !outgoing) {
      add("UNSUPPORTED_MOVEMENT", row, "Tipe transaksi belum memiliki aturan valuasi.");
      known = false;
      continue;
    }
    let cost = null;
    if (row.transaction_type === "PURCHASE") {
      const p = purchaseMap.get(String(row.purchase_id));
      if (!p || p.is_deleted || String(p.ingredient_id) !== id) {
        add("PURCHASE_LINK_INVALID", row, "Hubungan inventory dengan pembelian tidak valid.");
      } else {
        const pQuantity = parseEvent({ qty: p.jumlah, unit: p.satuan }, baseUnit.family);
        if (pQuantity === null || Math.abs(pQuantity - amount) > 1e-5) {
          add("PURCHASE_QUANTITY_MISMATCH", row, "Jumlah dan satuan pembelian tidak sesuai inventory.");
        } else if (safeNumber(p.total) === null || Number(p.total) <= 0) {
          add("PURCHASE_COST_UNCONFIRMED", row,
            "Total pembelian nol atau tidak tersedia; perlu konfirmasi bonus/transfer/harga.");
        } else {
          // Use actual TOTAL acquisition amount, not master ingredient price.
          cost = Number(p.total);
        }
      }
    } else if (row.transaction_type === "ADJUSTMENT") {
      const unitValue = safeNumber(row.unit_value);
      const sourceQty = safeNumber(row.qty);
      if (unitValue !== null && unitValue >= 0 && sourceQty !== null && sourceQty > 0) {
        // unit_value is quoted per transaction unit, not per base unit.
        cost = sourceQty * unitValue;
      } else {
        add("NON_PURCHASE_VALUE_MISSING", row,
          "Stok non-pembelian tidak mempunyai unit_value yang tervalidasi.");
      }
    } else if (incoming) {
      add("INBOUND_VALUE_UNCONFIRMED", row,
        "Stock adjustment / sub-recipe masuk memerlukan biaya perolehan yang divalidasi.");
    }
    if (incoming && cost === null) known = false;
    if (outgoing && known) {
      if (amount > qty + 1e-6) {
        add("NEGATIVE_BALANCE", row, "Saldo tidak cukup sebelum pemakaian; jangan paksa ke nol.");
        known = false;
      } else {
        cost = amount * (qty > 0 ? value / qty : 0);
      }
    }
    if (known) {
      if (incoming) {
        qty += amount;
        value += cost;
      } else {
        qty -= amount;
        value -= cost;
        if (Math.abs(qty) < 1e-8) { qty = 0; value = 0; }
      }
    }
    ledger.push({
      id: row.id, date: row.transaction_date, type: row.transaction_type,
      batchId: row.production_batch_id ?? null,
      quantityBase: amount, cost: known ? cost : null,
      balanceQty: known ? qty : null, balanceValue: known ? value : null,
      averageValue: known && qty > 0 ? value / qty : null,
    });
  }
  return {
    ingredientId: ingredient.id, ingredientName: ingredient.nama || "",
    baseUnit: baseLabel, transactionCount: allEvents.length,
    firstPurchaseDate: firstPurchase?.transaction_date ?? null,
    firstUseDate: firstUse?.transaction_date ?? null,
    openingVerified: opening?.approved === true && !blockers.some(b => b.code === "OPENING_BALANCE_UNVERIFIED"),
    blockers, blockerCount: blockers.length, ledger,
    endingQty: known ? qty : null, endingValue: known ? value : null,
    readyForFinalPosting: false,
    previewOnly: true,
    valuationCompletelyReconciled: known && blockers.length === 0,
  };
}

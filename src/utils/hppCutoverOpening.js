/**
 * Persiapan saldo awal: audit saja, tanpa penulisan database.
 * Saldo buku bukan hasil opname maupun nilai aset yang sudah disahkan.
 */
import {
  areUnitsCompatible, getBaseUnit, fromBaseUnit, toBaseUnit, roundQuantity,
} from "./unitConverter.js";

const INCOMING = new Set(["PURCHASE", "PRODUCTION_IN", "ADJUSTMENT_IN", "ADJUSTMENT"]);
const OUTGOING = new Set(["PRODUCTION_OUT", "SALE", "ADJUSTMENT_OUT"]);

export const OPENING_FINANCIAL_FIELDS = [
  { key: "cash", label: "Kas tunai hasil hitung fisik", type: "asset" },
  { key: "bank", label: "Saldo bank menurut rekening", type: "asset" },
  { key: "receivables", label: "Piutang yang benar-benar belum diterima", type: "asset" },
  { key: "workInProgress", label: "Produksi dalam proses / WIP (nilai biaya)", type: "asset" },
  { key: "finishedGoods", label: "Persediaan produk jadi (nilai HPP)", type: "asset" },
  { key: "frozenGoods", label: "Persediaan produk frozen (nilai HPP)", type: "asset" },
  { key: "consignmentGoods", label: "Produk titip di kafe belum terjual (nilai HPP)", type: "asset" },
  { key: "otherAssets", label: "Aset usaha lain yang terverifikasi", type: "asset" },
  { key: "payables", label: "Utang usaha yang belum dibayar", type: "liability" },
  { key: "otherLiabilities", label: "Kewajiban usaha lainnya", type: "liability" },
];

export function isValidIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseOptionalNonnegative(value, label = "Nilai") {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  if (typeof value === "boolean" ||
    (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))) {
    throw new Error(label + ": masukkan angka tanpa pemisah ribuan.");
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(label + ": angka tidak valid.");
  return numeric;
}

export function buildCutoverIngredientReview({ cutoverDate, ingredients = [], movements = [] }) {
  if (!isValidIsoDate(cutoverDate)) throw new Error("Tanggal mulai harus valid.");
  if (!Array.isArray(ingredients) || !Array.isArray(movements)) {
    throw new Error("Data ingredient/inventory tidak valid.");
  }
  const rowsById = new Map();
  for (const ingredient of ingredients) {
    if (ingredient.id === null || ingredient.id === undefined ||
      rowsById.has(String(ingredient.id))) throw new Error("Master bahan duplikat/tidak valid.");
    rowsById.set(String(ingredient.id), {
      ingredientId: ingredient.id, ingredientName: ingredient.nama ?? "",
      unit: ingredient.satuan ?? "", baseUnit: getBaseUnit(ingredient.satuan),
      bookQtyBase: 0, bookQty: null, movementCount: 0,
      issues: [], isReliable: true,
    });
  }
  const unmatchedMovementIds = [];
  for (const movement of movements) {
    if (movement.is_deleted === true) continue;
    if (!isValidIsoDate(movement.transaction_date)) {
      unmatchedMovementIds.push(movement.id);
      continue;
    }
    if (movement.transaction_date >= cutoverDate) continue;
    // Finished-products movements without ingredient_id are not raw-material stock.
    if (movement.ingredient_id === null || movement.ingredient_id === undefined) continue;
    const row = rowsById.get(String(movement.ingredient_id));
    if (!row) {
      unmatchedMovementIds.push(movement.id);
      continue;
    }
    row.movementCount++;
    const quantity = Number(movement.qty);
    if (!Number.isFinite(quantity) || quantity <= 0 ||
      !areUnitsCompatible(movement.unit, row.unit)) {
      row.issues.push({ code: "INVALID_UNIT_OR_QUANTITY", movementId: movement.id });
      row.isReliable = false;
      continue;
    }
    let sign;
    if (INCOMING.has(movement.transaction_type)) sign = 1;
    else if (OUTGOING.has(movement.transaction_type)) sign = -1;
    else {
      row.issues.push({ code: "UNKNOWN_MOVEMENT", movementId: movement.id });
      row.isReliable = false;
      continue;
    }
    row.bookQtyBase += sign * toBaseUnit(quantity, movement.unit);
  }
  const rows = [...rowsById.values()].map(row => {
    const signedBalance = fromBaseUnit(row.bookQtyBase, row.unit);
    if (signedBalance < -1e-6) {
      row.isReliable = false;
      row.issues.push({ code: "NEGATIVE_BOOK_STOCK", movementId: null });
    }
    return {
      ...row,
      bookQtyBase: row.isReliable ? roundQuantity(row.bookQtyBase) : null,
      bookQty: row.isReliable ? roundQuantity(signedBalance) : null,
    };
  }).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, "id"));
  return {
    cutoverDate, quantityBasis: "MUTASI_SEBELUM_TANGGAL_CUTOVER",
    physicalCountVerified: false, rows, unmatchedMovementIds,
    reliableRowCount: rows.filter(row => row.isReliable).length,
    issuesCount: rows.reduce((n, row) => n + row.issues.length, 0) + unmatchedMovementIds.length,
    readyToActivate: false,
  };
}

const sum = values => values.reduce((total, value) => total + value, 0);

/**
 * Unfilled fields remain unknown, not zero. This result cannot be posted.
 * Monetary unitCost is per master unit (e.g. Rp/kg, not Rp/gram).
 */
export function evaluateCutoverDraft({
  review, financial = {}, physical = {}, approvedByOwner = false,
}) {
  if (!review?.rows || !isValidIsoDate(review.cutoverDate)) {
    throw new Error("Ringkasan saldo buku belum tersedia.");
  }
  const issues = [];
  const warnings = [];
  const accounts = {};
  for (const item of OPENING_FINANCIAL_FIELDS) {
    const value = parseOptionalNonnegative(financial[item.key], item.label);
    accounts[item.key] = value;
    if (value === null) {
      issues.push("Saldo " + item.label + " belum dicatat (isi 0 jika benar-benar nol).");
    }
  }
  const inventory = review.rows.map(item => {
    const input = physical[String(item.ingredientId)] ?? {};
    const physicalQty = parseOptionalNonnegative(input.qty, "Stok fisik " + item.ingredientName);
    const costPerUnit = parseOptionalNonnegative(input.unitCost, "Biaya per " + item.unit + " " + item.ingredientName);
    const source = String(input.costSource || "").trim();
    const varianceNote = String(input.varianceNote || "").trim();
    if (physicalQty === null) issues.push(item.ingredientName + ": hasil stok opname belum diisi.");
    if (physicalQty !== null && physicalQty > 0 && costPerUnit === null) {
      issues.push(item.ingredientName + ": nilai biaya per " + item.unit + " belum diisi.");
    }
    if (physicalQty !== null && physicalQty > 0 && !source) {
      issues.push(item.ingredientName + ": bukti/dasar penilaian stok belum dicatat.");
    }
    const difference = physicalQty !== null && item.bookQty !== null
      ? roundQuantity(physicalQty - item.bookQty) : null;
    if (difference !== null && Math.abs(difference) > 1e-6 && !varianceNote) {
      warnings.push(item.ingredientName + ": selisih fisik dan buku historis belum diberi catatan.");
    }
    if (!item.isReliable) {
      warnings.push(item.ingredientName + ": saldo buku historis bermasalah; gunakan stok opname terverifikasi sebagai dasar baru.");
    }
    return {
      ingredientId: item.ingredientId, nama: item.ingredientName,
      unit: item.unit, physicalQty, bookQty: item.bookQty,
      difference, unitCost: costPerUnit, costSource: source || null,
      varianceNote: varianceNote || null,
      stockValue: physicalQty !== null && (physicalQty === 0 || costPerUnit !== null)
        ? physicalQty * (costPerUnit ?? 0) : null,
    };
  });
  if (review.unmatchedMovementIds?.length) {
    warnings.push("Ada mutasi historis tanpa bahan master/tanggal valid; periksa sebagai catatan audit.");
  }
  const inventoryComplete = inventory.every(x => x.stockValue !== null);
  const accountsComplete = Object.values(accounts).every(x => x !== null);
  const inventoryValue = inventoryComplete ? sum(inventory.map(x => x.stockValue)) : null;
  let balance = null;
  if (accountsComplete && inventoryValue !== null) {
    const assets = inventoryValue + sum(OPENING_FINANCIAL_FIELDS
      .filter(item => item.type === "asset").map(item => accounts[item.key]));
    const liabilities = sum(OPENING_FINANCIAL_FIELDS
      .filter(item => item.type === "liability").map(item => accounts[item.key]));
    balance = {
      openingAssets: assets, openingLiabilities: liabilities,
      openingEquityByDifference: assets - liabilities,
      rawInventoryValue: inventoryValue, provisionalOnly: true,
    };
  }
  return {
    version: 1, cutoverDate: review.cutoverDate,
    status: approvedByOwner && issues.length === 0 ? "DRAFT_REVIEW_COMPLETE" : "DRAFT_INCOMPLETE",
    financial: accounts, inventory, balance, issues, warnings,
    canActivate: false, writesDatabase: false,
  };
}

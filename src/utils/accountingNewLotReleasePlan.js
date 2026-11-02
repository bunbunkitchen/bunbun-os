/**
 * Bunbun OS — NEW-TRANSACTION LOT RELEASE PLAN (NOT A STOCK TRANSACTION).
 *
 * Current production release RPC removes product-level stock, but does not
 * persist the root production split/lot used. This conservative planner
 * describes how many finished units of each explicitly named lot should be
 * consumed in a future release. It never calls the existing RPC.
 *
 * Source lot "availableQty" and evidenceRef are CALLER CLAIMS, not stocktake
 * approval. A trusted atomic backend must re-read materialized lot positions,
 * original movements, the opening balance and Owner authorization.
 *
 * Manual release to a café is NOT a sale; event and order releases are also
 * NOT evidence of customer payment. The planner generates no COGS.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";

const TYPES = Object.freeze([
  "CAFE_CONSIGNMENT", "EVENT_RELEASE", "DIRECT_ORDER_RELEASE",
  "SAMPLE_RELEASE", "OTHER_RELEASE",
]);
const LOT_SOURCE = ["PRODUCTION_DIRECT", "PRODUCTION_FROZEN_CONVERTED", "OPENING_COUNT"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9 /:._-]{5,159}$/;
const LOT_ID = /^(?:split:[1-9]\d{0,15}|opening:[A-Za-z0-9_-]{4,64})$/;
function uint(value, label, allowZero = false) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(label + " tidak valid.");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(label + " melebihi presisi aman.");
  }
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
    (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw new Error(label + " harus bilangan bulat" + (allowZero ? " tidak negatif." : " positif."));
  }
  return Number(value);
}
const safeAdd = (a, b) => {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error("Jumlah lot melebihi batas aman.");
  return sum;
};
function evidence(input, label) {
  if (typeof input !== "string" || !SOURCE_REF.test(input)) {
    throw new Error(label + " memerlukan nomor bukti yang dapat ditelusuri.");
  }
  return input;
}
function lotIdentity(value) {
  if (typeof value !== "string" || !LOT_ID.test(value)) {
    throw new Error("Identitas lot harus split:<ID> atau opening:<KODE>.");
  }
  return value;
}
function productIdentity(value) {
  return String(uint(value, "ID produk"));
}

/**
 * An array entry is {productId, qty, allocations:[{lotId,qty}]}.
 * A distinct product should appear once, but that product may draw from
 * multiple different root split or approved-opening lot candidates.
 */
export function previewNewLotRelease({
  cutoverDate, releaseDate, destination, destinationType,
  operationKey, lots, entries, releaseEvidenceRef,
}) {
  if (!isValidIsoDate(cutoverDate) || !isValidIsoDate(releaseDate) ||
    releaseDate < cutoverDate) {
    throw new Error("Tanggal pengeluaran sebelum cutover atau tidak valid.");
  }
  if (typeof operationKey !== "string" || !UUID.test(operationKey)) {
    throw new Error("Operation key pengeluaran wajib UUID yang valid.");
  }
  if (!TYPES.includes(destinationType) ||
    typeof destination !== "string" ||
    destination.trim().length < 2 || destination.trim().length > 160) {
    throw new Error("Tujuan dan klasifikasi pengeluaran belum valid.");
  }
  evidence(releaseEvidenceRef, "Bukti pengeluaran");
  if (!Array.isArray(lots) || !Array.isArray(entries) ||
    !entries.length || entries.length > 100 || lots.length > 500) {
    throw new Error("Lot dan daftar produk pengeluaran belum lengkap.");
  }

  const stockByLot = new Map();
  for (const candidate of lots) {
    const lotId = lotIdentity(candidate?.lotId);
    if (stockByLot.has(lotId)) throw new Error("Lot asal duplikat.");
    const productId = productIdentity(candidate.productId);
    if (candidate.location !== "FINISHED" ||
      !LOT_SOURCE.includes(candidate.sourceType) ||
      !isValidIsoDate(candidate.releasedOn) ||
      candidate.releasedOn > releaseDate) {
      throw new Error("Lot belum berada pada stok produk jadi yang layak dikeluarkan.");
    }
    if (candidate.sourceType === "OPENING_COUNT" && !lotId.startsWith("opening:")) {
      throw new Error("Lot opening harus berasal dari identitas stok opname.");
    }
    if (candidate.sourceType !== "OPENING_COUNT" && !lotId.startsWith("split:")) {
      throw new Error("Lot produksi harus memakai ID split asal/turunan nyata.");
    }
    const availableQty = uint(candidate.availableQty, "Sisa lot yang diklaim", true);
    stockByLot.set(lotId, {
      lotId, productId, availableQty, sourceType: candidate.sourceType,
      releasedOn: candidate.releasedOn,
      evidenceRef: evidence(candidate.evidenceRef, "Bukti lot"),
    });
  }

  const perProduct = new Set();
  const assignedByLot = new Map();
  const allocationRows = [];
  const productRows = [];
  for (const row of entries) {
    const productId = productIdentity(row?.productId);
    if (perProduct.has(productId)) throw new Error("Produk yang sama dipilih dua kali.");
    perProduct.add(productId);
    const quantity = uint(row.qty, "Qty produk dikeluarkan");
    if (!Array.isArray(row.allocations) || !row.allocations.length ||
      row.allocations.length > 100) {
      throw new Error("Setiap produk harus memilih paling sedikit satu lot.");
    }
    const localLots = new Set();
    let assigned = 0;
    for (const allocation of row.allocations) {
      const lotId = lotIdentity(allocation?.lotId);
      const requested = uint(allocation.qty, "Qty pengeluaran per lot");
      const source = stockByLot.get(lotId);
      if (!source || source.productId !== productId) {
        throw new Error("Lot yang dipilih tidak sesuai produk pada pengeluaran.");
      }
      if (localLots.has(lotId)) throw new Error("Lot yang sama dipilih dua kali untuk satu produk.");
      localLots.add(lotId);
      const totalUse = safeAdd(assignedByLot.get(lotId) ?? 0, requested);
      if (totalUse > source.availableQty) {
        throw new Error("Pengeluaran melebihi jumlah tersedia pada lot " + lotId + ".");
      }
      assignedByLot.set(lotId, totalUse);
      assigned = safeAdd(assigned, requested);
      allocationRows.push({
        operationKey,
        stockMovementId: null,
        productId,
        lotId,
        qty: requested,
        sourceLocation: "FINISHED",
        destinationType,
        movementDate: releaseDate,
        allocationEvidenceRef: releaseEvidenceRef,
      });
    }
    if (assigned !== quantity) {
      throw new Error("Total qty lot tidak sama dengan qty produk " + productId + ".");
    }
    productRows.push({ productId, quantity, assignedQty: assigned });
  }
  if (allocationRows.length > 500) {
    throw new Error("Terlalu banyak alokasi lot dalam satu transaksi.");
  }

  return {
    status: "NEW_LOT_RELEASE_PLAN_ONLY",
    operationKey,
    cutoverDate, releaseDate, destination: destination.trim(), destinationType,
    productRows, allocationRows,
    projectedLotBalances: lots.map(candidate => {
      const source = stockByLot.get(candidate.lotId);
      return {
        lotId: source.lotId, productId: source.productId,
        startingClaimedQty: source.availableQty,
        proposedOutQty: assignedByLot.get(source.lotId) || 0,
        projectedQty: source.availableQty - (assignedByLot.get(source.lotId) || 0),
        independentlyVerified: false,
      };
    }),
    createsSale: false,
    createsCashTransaction: false,
    createsCogs: false,
    sourceBalanceVerified: false,
    ownerApprovalVerified: false,
    requiresAtomicReleaseWithStockMovement: true,
    readyToPost: false,
    writesDatabase: false,
  };
}

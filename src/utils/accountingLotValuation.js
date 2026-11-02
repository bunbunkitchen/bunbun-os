/**
 * Bunbun Kitchen — conservative draft lot costing from a completed batch.
 *
 * The historical inventory_transactions.unit_value is NOT assumed reliable.
 * Instead, every PRODUCTION_OUT requires independently reviewed acquisition
 * cost evidence. Labor and overhead are independently documented (zero is an
 * explicit, reviewed value, never a missing-value fallback).
 *
 * Root splits are releases from production. Derived source_split_id splits are
 * conversions of existing frozen units, NEVER a second batch output.
 *
 * THIS MODULE NEVER POSTS, MODIFIES STOCK OR CERTIFIES ACTUAL HPP.
 */
import { isValidIsoDate } from "./hppCutoverOpening.js";
import { toJournalCents } from "./accountingPostedReports.js";

const nonnegativeMoney = (amount, label) => toJournalCents(amount, label);
const cents = amount => {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Nilai HPP melewati batas presisi.");
  return (Math.floor(amount / 100)) + "." + String(amount % 100).padStart(2, "0");
};
const safePlus = (a,b) => {
  if (!Number.isSafeInteger(a + b)) throw new Error("Jumlah HPP tidak aman dihitung.");
  return a + b;
};
const int = (value,label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || value === null || value === "") {
    throw new Error(label + " harus bilangan bulat tidak negatif.");
  }
  return number;
};
const positiveId = (value,label) => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(label + " tidak aman.");
  if (!/^[1-9]\d{0,15}$/.test(String(value ?? ""))) throw new Error(label + " tidak valid.");
  return String(value);
};
const proof = (entry,label) => {
  if (!entry || entry.reviewed !== true ||
    typeof entry.evidenceRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_:/ .-]{5,159}$/.test(entry.evidenceRef)) {
    throw new Error(label + " belum memiliki bukti yang direview.");
  }
  return nonnegativeMoney(entry.amount,label);
};

export function buildBatchLotCostDraft({
  batch, materials, splits, stockMovements, verifiedCosts, cutoverDate,
}) {
  if (!isValidIsoDate(cutoverDate) || !batch ||
    !Array.isArray(materials) || !Array.isArray(splits) ||
    !Array.isArray(stockMovements) || !verifiedCosts) {
    throw new Error("Data batch, mutasi stok atau cutover belum lengkap.");
  }
  const batchId = positiveId(batch.id,"Batch");
  if (batch.status !== "Finished" || batch.inventory_consumed !== true ||
    batch.is_deleted === true) {
    throw new Error("Batch harus Finished dan pemakaian bahan sudah tercatat.");
  }
  if (batch.created_at &&
    (!isValidIsoDate(String(batch.created_at).slice(0,10)) ||
      String(batch.created_at).slice(0,10) < cutoverDate)) {
    throw new Error("Batch sebelum cutover perlu saldo awal, bukan dihitung ulang sebagai produksi baru.");
  }
  if (!materials.length || !splits.length) {
    throw new Error("Batch belum memiliki catatan bahan dan split produksi.");
  }
  if (!Array.isArray(verifiedCosts.materials) || !Array.isArray(verifiedCosts.lots)) {
    throw new Error("Verifikasi biaya bahan dan alokasi lot belum lengkap.");
  }
  const matMap = new Map();
  for (const item of verifiedCosts.materials) {
    const id = positiveId(item.transactionId,"ID pemakaian bahan");
    if (matMap.has(id)) throw new Error("Biaya transaksi bahan dicatat dua kali.");
    matMap.set(id, proof(item,"Biaya bahan " + id));
  }
  const movements = new Map();
  for (const movement of stockMovements) {
    const id = positiveId(movement.id,"ID mutasi produk");
    if (movements.has(id)) throw new Error("Mutasi produk duplikat.");
    if (movement.is_deleted === true) throw new Error("Mutasi produk terhapus.");
    movements.set(id, movement);
  }
  const splitMap = new Map();
  for (const split of splits) {
    const id = positiveId(split.id,"ID split");
    if (splitMap.has(id)) throw new Error("Split produksi duplikat.");
    if (String(split.production_batch_id ?? batch.id) !== batchId || split.is_deleted === true) {
      throw new Error("Split tidak berasal dari batch ini atau sudah dihapus.");
    }
    splitMap.set(id,split);
  }
  const roots = [...splitMap.values()].filter(split => split.source_split_id == null);
  const usableRoots = roots.filter(split => split.route === "DIRECT" || split.route === "FROZEN");
  if (roots.some(split => !["DIRECT","FROZEN","REJECT"].includes(split.route))) {
    throw new Error("Ada route split produksi yang belum memiliki klasifikasi HPP.");
  }
  if (roots.length !== splitMap.size && [...splitMap.values()].some(split =>
      split.source_split_id != null && !splitMap.has(String(split.source_split_id)))) {
    throw new Error("Split turunan frozen harus memiliki split asal dalam batch sama.");
  }
  if (!usableRoots.length) throw new Error("Tidak ada split produk layak jual.");
  const allocMap = new Map();
  for (const item of verifiedCosts.lots) {
    const id = positiveId(item.splitId,"ID alokasi lot");
    if (allocMap.has(id)) throw new Error("Alokasi biaya lot duplikat.");
    allocMap.set(id,proof(item,"Alokasi biaya lot " + id));
  }
  const originalLines = new Set();
  let rawCents = 0;
  for (const line of materials) {
    const id = positiveId(line.id,"ID bahan");
    if (originalLines.has(id) || line.is_deleted === true ||
      String(line.production_batch_id ?? batch.id) !== batchId ||
      line.transaction_type !== "PRODUCTION_OUT" || line.ingredient_id == null ||
      !(Number(line.qty) > 0) || !Number.isFinite(Number(line.qty))) {
      throw new Error("Pemakaian bahan duplikat, bukan PRODUCTION_OUT, atau tidak dapat ditelusuri.");
    }
    originalLines.add(id);
    if (!isValidIsoDate(line.transaction_date) || line.transaction_date < cutoverDate) {
      throw new Error("Transaksi bahan sebelum cutover harus berasal dari saldo awal yang disahkan.");
    }
    if (!matMap.has(id)) {
      throw new Error("Biaya pemakaian bahan #" + id + " belum diverifikasi; tidak boleh nol otomatis.");
    }
    rawCents = safePlus(rawCents,matMap.get(id));
  }
  if (originalLines.size !== matMap.size) throw new Error("Ada bukti biaya bahan tanpa transaksi produksi yang cocok.");
  const labor = proof(verifiedCosts.labor,"Alokasi tenaga kerja batch");
  const overhead = proof(verifiedCosts.overhead,"Alokasi overhead batch");
  const loss = proof(verifiedCosts.rejectLoss,"Biaya reject/kerusakan batch");
  const total = safePlus(safePlus(rawCents,labor),overhead);
  if (total === 0) throw new Error("Total biaya batch nol; perlu validasi perolehan.");
  if (loss > total) throw new Error("Biaya reject melebihi total batch.");
  if (roots.some(s=>s.route === "REJECT") && loss === 0) {
    throw new Error("Split REJECT memerlukan alokasi biaya reject terverifikasi.");
  }

  const lots = [];
  let allocated = 0;
  for (const split of usableRoots) {
    const id = positiveId(split.id,"ID split");
    const productId = positiveId(split.product_id,"Produk pada split");
    if (!allocMap.has(id)) throw new Error("Alokasi lot untuk split #" + id + " belum diverifikasi.");
    const route = split.route;
    const plannedQty = int(split.qty,"Rencana split");
    if (plannedQty <= 0) throw new Error("Split dengan hasil kosong belum layak dinilai.");
    const releasedQty = route === "DIRECT" ?
      int(split.baked_good_qty,"Jumlah produk jadi layak") : plannedQty;
    if (!releasedQty || releasedQty > plannedQty) {
      throw new Error("Hasil layak tidak cocok dengan jumlah split.");
    }
    const expectedType = route === "DIRECT" ? "FINISHED_IN" : "FROZEN_IN";
    const releases = stockMovements.filter(row =>
      String(row.batch_split_id) === id && row.movement_type === expectedType);
    if (releases.length !== 1 || int(releases[0].qty,"Mutasi produk masuk") !== releasedQty ||
      String(releases[0].product_id) !== productId) {
      throw new Error("Mutasi " + expectedType + " split #" + id +
        " tidak cocok dengan pelepasan produk nyata.");
    }
    if (!isValidIsoDate(releases[0].movement_date) ||
      releases[0].movement_date < cutoverDate) {
      throw new Error("Pelepasan produk sebelum cutover memerlukan saldo awal.");
    }
    if (stockMovements.some(movement =>
      String(movement.batch_split_id) === id &&
      ["FINISHED_IN","FROZEN_IN"].includes(movement.movement_type) &&
      movement.movement_type !== expectedType)) {
      throw new Error("Split menghasilkan jenis stok masuk tidak sesuai route.");
    }
    const lotCents = allocMap.get(id);
    if (lotCents === 0) throw new Error("Biaya lot layak jual tidak boleh nol.");
    allocated = safePlus(allocated,lotCents);
    lots.push({
      lotId: "batch:" + batchId + ":split:" + id,
      batchId, splitId: id, productId,
      initialLocation: route === "DIRECT" ? "FINISHED" : "FROZEN",
      qty: releasedQty, totalCost: cents(lotCents),
      sourceMovementId: String(releases[0].id),
      costEvidenceRef: verifiedCosts.lots.find(item => String(item.splitId) === id).evidenceRef,
    });
  }
  if (allocMap.size !== lots.length) throw new Error("Ada alokasi biaya tanpa split produksi asal yang layak.");
  if (safePlus(allocated,loss) !== total) {
    throw new Error("Total biaya lot dan reject tidak sama dengan biaya bahan + tenaga kerja + overhead.");
  }
  // Derived releases and FROZEN_OUT are NOT part of batch output and cannot be
  // valued as new production. Their cost is retained by the lot transfer model.
  return {
    batchId, batchCode: String(batch.kode || ""),
    cutoverDate, source: "MANUALLY_REVIEWED_DRAFT_ONLY",
    rawMaterialCost: cents(rawCents),
    laborCost: cents(labor), overheadCost: cents(overhead),
    totalProductionCost: cents(total), rejectLossCost: cents(loss),
    releasedLotCost: cents(allocated),
    lots,
    excludedDerivedSplitCount: splitMap.size - roots.length,
    completeInventoryLedger: false,
    valuationApprovedByBackend: false,
    actualCostOfGoodsSoldAvailable: false,
    mayPost: false, writesDatabase: false,
  };
}

/**
 * Production lots are initialized at verified actual release quantities.
 * Cost stays in inventory when frozen becomes finished or goods are consigned.
 * Only SOLD (with separate verified sale evidence) becomes COGS.
 *
 * Moves are approved-looking test evidence, not real authorization. This
 * deterministic pure model uses FIFO-like proportional *cent remainder*
 * distribution WITHIN AN EXPLICIT LOT. It never invents cross-lot matching.
 */
export function traceLotCostDraft({ lots, events }) {
  if (!Array.isArray(lots) || !Array.isArray(events)) {
    throw new Error("Daftar lot atau pergerakan belum lengkap.");
  }
  const stocks = new Map();
  const locations = ["FROZEN","FINISHED","CAFE"];
  const eventIds = new Set();
  const soldSales = new Map();
  const costEvents = [];
  for (const lot of lots) {
    if (!lot || typeof lot.lotId !== "string" || !/^[A-Za-z0-9:._-]{3,100}$/.test(lot.lotId) ||
      stocks.has(lot.lotId) || !locations.includes(lot.initialLocation) ||
      !/^[1-9]\d{0,15}$/.test(String(lot.productId)) ||
      !Number.isSafeInteger(lot.qty) || lot.qty <= 0) {
      throw new Error("Lot asal tidak lengkap atau duplikat.");
    }
    const value = toJournalCents(lot.totalCost,"Nilai lot asal");
    if (!value) throw new Error("Lot tidak boleh bernilai nol.");
    const initialLocation = lot.initialLocation;
    const slots = Object.fromEntries(locations.map(location => [location,{
      qty: location === initialLocation ? lot.qty : 0,
      value: location === initialLocation ? value : 0,
    }]));
    stocks.set(lot.lotId,{
      lotId:lot.lotId, productId:String(lot.productId), slots,
      originalQty:lot.qty, originalCost:value,
      lastDate:null,
    });
  }
  for (const event of events) {
    const eventId = String(event?.id ?? "");
    if (!/^[A-Za-z0-9:_-]{3,120}$/.test(eventId) || eventIds.has(eventId)) {
      throw new Error("Mutasi lot tanpa ID unik.");
    }
    eventIds.add(eventId);
    const lot = stocks.get(event.lotId);
    if (!lot || !isValidIsoDate(event.date) ||
      (lot.lastDate && event.date < lot.lastDate)) {
      throw new Error("Lot, tanggal, atau urutan mutasi tidak valid.");
    }
    lot.lastDate = event.date;
    const qty = int(event.qty,"Jumlah mutasi");
    if (qty <= 0) throw new Error("Mutasi lot harus positif.");
    const allowed = {
      FROZEN_TO_FINISHED: ["FROZEN","FINISHED"],
      SHIP_TO_CAFE: ["FINISHED","CAFE"],
      RETURN_FROM_CAFE: ["CAFE","FINISHED"],
      SOLD_AT_CAFE: ["CAFE",null],
      DIRECT_SOLD: ["FINISHED",null],
    };
    const pair = allowed[event.type];
    if (!pair || event.reviewed !== true ||
      typeof event.evidenceRef !== "string" ||
      event.evidenceRef.trim().length < 6) {
      throw new Error("Jenis/bukti mutasi belum direview.");
    }
    if ((event.type === "SOLD_AT_CAFE" || event.type === "DIRECT_SOLD")) {
      positiveId(event.saleId,"Sale");
      const key = String(event.saleId) + ":" + lot.lotId;
      if (soldSales.has(key)) throw new Error("Penjualan lot sama dicatat lebih dari sekali.");
      soldSales.set(key,true);
    } else if (event.saleId != null) {
      throw new Error("Perpindahan stok tidak boleh diperlakukan sebagai penjualan.");
    }
    const [from,to] = pair;
    const src = lot.slots[from];
    if (src.qty < qty || !src.qty) throw new Error("Stok lot tidak cukup untuk mutasi " + eventId + ".");
    // BigInt multiplication prevents overflow; final withdrawal takes residual
    // pennies so value is always conserved even at non-integer unit costs.
    const valueMoved = qty === src.qty ?
      src.value :
      Number(BigInt(src.value) * BigInt(qty) / BigInt(src.qty));
    src.qty -= qty; src.value -= valueMoved;
    if (to) {
      lot.slots[to].qty += qty;
      lot.slots[to].value = safePlus(lot.slots[to].value,valueMoved);
    }
    costEvents.push({
      id:eventId, lotId:lot.lotId, date:event.date, type:event.type,
      qty, value:cents(valueMoved),
      isCogs:to === null,
      saleId:to === null ? String(event.saleId) : null,
    });
  }
  let inventory = 0, cogs = 0;
  const stockByLocation = Object.fromEntries(locations.map(location => [location,{
    qty:0, value:0,
  }]));
  for (const lot of stocks.values()) {
    for (const location of locations) {
      const slot = lot.slots[location];
      stockByLocation[location].qty += slot.qty;
      stockByLocation[location].value = safePlus(stockByLocation[location].value,slot.value);
      inventory = safePlus(inventory,slot.value);
    }
  }
  for (const event of costEvents) {
    if (event.isCogs) cogs = safePlus(cogs,toJournalCents(event.value,"HPP penjualan"));
  }
  const original = [...stocks.values()].reduce((sum,lot) => safePlus(sum,lot.originalCost),0);
  if (safePlus(inventory,cogs) !== original) throw new Error("Nilai persediaan dan HPP tidak seimbang.");
  return {
    initialLotCost:cents(original), remainingInventoryValue:cents(inventory),
    soldCogs:cents(cogs),
    locations:Object.fromEntries(locations.map(location => [location,{
      qty:stockByLocation[location].qty, value:cents(stockByLocation[location].value),
    }])),
    events:costEvents,
    sourceCompletelyVerified:false,
    accountingApproved:false,
    readyToPost:false, writesDatabase:false,
  };
}

/**
 * Explicit source-to-lot reconciliation for sold COGS draft.
 *
 * Sale lines + CAFE_OUT are not linked to a production batch in the existing
 * Bunbun database. This bridge requires a distinct, reviewed assignment
 * between a CAFE_OUT movement and a sold-lot cost event; no FIFO guesses,
 * product/date matching or automatic allocation.
 *
 * reviewed:true and evidenceRef are CLIENT-SUPPLIED TEST/DEMO claims. They
 * are NOT owner authorization; an independent staging backend must re-fetch
 * original sales/movements, audit production lot state and stored proof.
 */
import { toJournalCents } from "./accountingPostedReports.js";
import { proposeSoldLotCogsDrafts } from "./accountingLotValuation.js";

const validId = (v, label) => {
  if (typeof v === "number" && !Number.isSafeInteger(v)) {
    throw new Error(label + " tidak aman.");
  }
  if (!/^[1-9]\d{0,15}$/.test(String(v ?? ""))) {
    throw new Error(label + " tidak valid.");
  }
  return String(v);
};
const count = (v, label) => {
  if (v == null || typeof v === "boolean" ||
    !/^\d+(?:\.0+)?$/.test(String(v)) || !Number.isSafeInteger(Number(v)) ||
    Number(v) <= 0) {
    throw new Error(label + " harus unit bulat positif.");
  }
  return Number(v);
};
const eventId = (v, label) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9:_-]{3,120}$/.test(v)) {
    throw new Error(label + " tidak valid.");
  }
  return v;
};
const reference = v => typeof v === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9_:/ .-]{5,159}$/.test(v);

function safeSum(a, b) {
  if (!Number.isSafeInteger(a + b)) throw new Error("Total jumlah tidak aman.");
  return a + b;
}

function ensureOriginalSaleAudit(audit) {
  if (!audit || audit.status !== "SALES_TO_STOCK_LINK_AUDIT_ONLY" ||
    audit.readyToPost !== false || audit.writesDatabase !== false ||
    audit.confirmedActualHpp !== false || !Array.isArray(audit.sales)) {
    throw new Error("Pencocokan lot memerlukan audit sumber penjualan yang valid.");
  }
}

/**
 * All available matched sale movements MUST be assigned to exactly one or
 * multiple independently costed sold-lot events. One lot event cannot pay
 * for two movements. It is an exact all-or-nothing preview per sale group.
 */
export function previewSaleToLotCogs({
  saleAudit, movements, lots, lotTrace, assignments,
}) {
  ensureOriginalSaleAudit(saleAudit);
  if (!Array.isArray(movements) || !Array.isArray(lots) ||
    !Array.isArray(assignments) || !lotTrace ||
    !Array.isArray(lotTrace.events) ||
    lotTrace.readyToPost !== false || lotTrace.writesDatabase !== false ||
    lotTrace.sourceCompletelyVerified !== false) {
    throw new Error("Sumber lot, perpindahan, dan penjualan belum lengkap.");
  }
  const lotById = new Map();
  for (const lot of lots) {
    if (!lot || typeof lot.lotId !== "string" || lotById.has(lot.lotId)) {
      throw new Error("Lot duplikat atau tidak valid.");
    }
    lotById.set(lot.lotId, validId(lot.productId, "Produk lot"));
  }
  const saleById = new Map();
  for (const s of saleAudit.sales) {
    const id = validId(s.saleId, "Sales");
    if (saleById.has(id)) throw new Error("Sale audit duplikat.");
    saleById.set(id, s);
  }
  const movementById = new Map();
  for (const movement of movements) {
    const id = validId(movement.id, "Mutasi");
    if (movementById.has(id)) throw new Error("ID mutasi duplikat.");
    movementById.set(id, movement);
    if (!saleById.has(validId(movement.sale_id, "Sale mutasi"))) {
      throw new Error("Mutasi tidak ada dalam audit penjualan.");
    }
  }
  const soldById = new Map();
  for (const event of lotTrace.events) {
    const id = eventId(event.id, "ID event lot");
    if (soldById.has(id)) throw new Error("ID event lot duplikat.");
    soldById.set(id, event);
  }
  const included = new Map();
  const assignedEvents = new Set();
  const issues = [];
  const allocatedMovementIds = new Set();

  for (const proof of assignments) {
    const moveId = validId(proof?.movementId, "ID mutasi stok");
    const lotEventId = eventId(proof?.lotEventId, "ID event lot");
    if (!proof || proof.reviewed !== true || !reference(proof.evidenceRef)) {
      throw new Error("Alokasi lot memerlukan bukti yang ditinjau Owner (pratinjau).");
    }
    if (assignedEvents.has(lotEventId)) {
      throw new Error("Satu event biaya lot tidak boleh dialokasikan dua kali.");
    }
    const movement = movementById.get(moveId);
    const event = soldById.get(lotEventId);
    if (!movement || !event ||
      movement.movement_type !== "CAFE_OUT" ||
      event.isCogs !== true || event.type !== "SOLD_AT_CAFE") {
      throw new Error("Perpindahan atau event bukan barang terjual dari titipan kafe.");
    }
    if (!lotById.has(event.lotId) ||
      lotById.get(event.lotId) !== validId(movement.product_id, "Produk mutasi")) {
      throw new Error("Produk lot tidak cocok dengan produk dalam mutasi stok.");
    }
    const saleId = validId(movement.sale_id, "Sale pada mutasi");
    const sale = saleById.get(saleId);
    if (!sale || !sale.qtyMatched ||
      validId(event.saleId, "Sale event lot") !== saleId ||
      movement.movement_date !== event.date ||
      movement.movement_date !== sale.saleDate) {
      throw new Error("Sales, tanggal, atau jumlah belum cocok dengan penjualan stok.");
    }
    const q = count(event.qty, "Qty lot terjual");
    const total = safeSum(included.get(moveId) || 0, q);
    if (total > count(movement.qty, "Qty mutasi stok")) {
      throw new Error("Alokasi lot melebihi jumlah stok keluar.");
    }
    included.set(moveId, total);
    assignedEvents.add(lotEventId);
    allocatedMovementIds.add(moveId);
  }

  let allMatchedMoves = 0;
  const required = new Set();
  for (const s of saleAudit.sales) {
    if (!s.qtyMatched) {
      issues.push({
        code:"SALE_STOCK_NOT_RECONCILED", saleId:s.saleId,
        message:"Stok belum cocok dengan rincian penjualan; lot tidak boleh dialokasikan.",
      });
      continue;
    }
    for (const product of s.products) {
      for (const id of product.movementIds) {
        if (required.has(id)) throw new Error("Mutasi penjualan dipakai oleh dua grup produk.");
        required.add(id);
        const movement = movementById.get(id);
        if (!movement || String(movement.product_id) !== product.productId) {
          throw new Error("Mutasi tertaut tidak sama dengan sumber audit penjualan.");
        }
        allMatchedMoves++;
        if ((included.get(id) || 0) !== count(movement.qty, "Qty mutasi sale")) {
          issues.push({
            code:"SALE_LOT_ALLOCATION_MISSING", saleId:s.saleId,
            movementId:id,
            message:"Qty CAFE_OUT belum dialokasikan lengkap ke lot produksi tertentu.",
          });
        }
      }
    }
  }
  for (const id of allocatedMovementIds) {
    if (!required.has(id)) throw new Error("Alokasi berada di luar stok penjualan yang telah direkonsiliasi.");
  }
  const draft = proposeSoldLotCogsDrafts(lotTrace);
  const selected = assignments.map(a => {
    const sold = soldById.get(a.lotEventId);
    const key = "verified-cogs:" + sold.saleId + ":" + sold.id;
    const proposal = draft.proposals.find(p => p.sourceKey === key);
    if (!proposal) throw new Error("Usulan jurnal COGS tidak sesuai event lot.");
    return proposal;
  });
  if (selected.length !== assignments.length) {
    throw new Error("Jumlah usulan jurnal COGS tidak sama dengan alokasi lot.");
  }
  const coveredCents = selected.reduce((sum, p) => {
    const amount = toJournalCents(p.lines[0].debit,"COGS");
    if (!Number.isSafeInteger(sum + amount)) throw new Error("COGS melebihi batas presisi.");
    return sum + amount;
  },0);
  if (lotTrace.events.some(e=>e.isCogs && !assignedEvents.has(e.id))) {
    issues.push({
      code:"SOLD_LOT_EVENT_NOT_LINKED_TO_SALE_STOCK",
      message:"Ada event penjualan lot yang belum punya kecocokan mutasi penjualan.",
    });
  }

  return {
    status:"UNVERIFIED_SALE_TO_LOT_COGS_DRAFT",
    matchedStockMovements: allMatchedMoves,
    allocationCount:assignments.length,
    allocatedStockMovementCount:allocatedMovementIds.size,
    draftCogsCents: coveredCents,
    draftCogs: String(Math.floor(coveredCents / 100)) + "." +
      String(coveredCents % 100).padStart(2,"0"),
    cogsProposals:selected,
    issues,
    evidenceFromCallerUnverified:true,
    soldGoodsIndependentlyVerified:false,
    inventorySourceVerified:false,
    readyToPost:false,
    actualHppAvailable:false,
    writesDatabase:false,
  };
}

/**
 * Staging-only Original-ID financial source preview for active Bunbun Owners.
 * Never creates or posts journals. Supplied evidence is USER-CLAIMED and is
 * NOT a verified signature/approval. Backend re-fetches every source record.
 */
import { authorizeActiveOwner } from "./accountingOwnerReadiness.js";
import { isValidIsoDate } from "../../../src/utils/hppCutoverOpening.js";
import { buildVerifiedAccountingSourceBridge } from "../../../src/utils/accountingVerifiedSourceBridge.js";

const LIMIT_PER_TABLE = 20;
const MAX_JSON_BYTES = 32768;
const TABLES = ["sales", "incomes", "purchases", "expenses"];
const EVIDENCE_NAMES = ["sales", "deposits", "purchases", "purchasePayments"];
const CORS_METHODS = "POST, OPTIONS";

function json(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function validateExactKeys(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === keys.slice().sort().join("|"));
}

function safeId(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d{0,15}$/.test(value)) return value;
  return null;
}

export function checkRequestedSourceIds(sourceIds) {
  if (!validateExactKeys(sourceIds, TABLES)) {
    throw new Error("Jenis sumber transaksi tidak lengkap.");
  }
  const lists = {};
  for (const table of TABLES) {
    const items = sourceIds[table];
    if (!Array.isArray(items) || items.length > LIMIT_PER_TABLE) {
      throw new Error("Jumlah ID sumber melebihi batas pratinjau.");
    }
    const cleaned = items.map(safeId);
    if (cleaned.some(value => !value) || new Set(cleaned).size !== cleaned.length) {
      throw new Error("ID sumber tidak valid atau duplikat.");
    }
    lists[table] = cleaned;
  }
  return lists;
}

export function createOwnerSourcePreviewHandler({
  stageEnabled, allowedOrigin, verifyUserToken, loadProfile, fetchSourceRows,
}) {
  return async function handle(request) {
    const origin = request.headers.get("Origin");
    if (stageEnabled !== true || typeof fetchSourceRows !== "function" ||
      !allowedOrigin) {
      return json({ ok: false, code: "STAGING_NOT_CONFIGURED" }, 503);
    }
    if (origin !== allowedOrigin) {
      return json({ ok: false, code: "ORIGIN_NOT_ALLOWED" }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": CORS_METHODS,
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Max-Age": "600",
          "Cache-Control": "no-store",
          "Vary": "Origin",
        },
      });
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ ok: false, code: "JSON_REQUIRED" }, 415, origin);
    }
    const auth = await authorizeActiveOwner({
      authorization: request.headers.get("Authorization"),
      verifyUserToken, loadProfile,
    });
    if (!auth.ok) return json({ ok: false, code: auth.code }, auth.status, origin);

    const announced = Number(request.headers.get("Content-Length") || "0");
    if (!Number.isFinite(announced) || announced < 0 || announced > MAX_JSON_BYTES) {
      return json({ ok: false, code: "BODY_TOO_LARGE" }, 413, origin);
    }
    let input;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) {
        return json({ ok: false, code: "BODY_TOO_LARGE" }, 413, origin);
      }
      input = JSON.parse(raw);
    } catch {
      return json({ ok: false, code: "INVALID_JSON" }, 400, origin);
    }
    let requested;
    try {
      if (!validateExactKeys(input, ["action", "cutoverDate", "sourceIds", "evidence"]) ||
        input.action !== "source-preview" ||
        !isValidIsoDate(input.cutoverDate) ||
        !validateExactKeys(input.evidence, EVIDENCE_NAMES) ||
        EVIDENCE_NAMES.some(name => !Array.isArray(input.evidence[name]) ||
          input.evidence[name].length > LIMIT_PER_TABLE)) {
        throw new Error("Request does not match preview schema.");
      }
      requested = checkRequestedSourceIds(input.sourceIds);
      if (TABLES.every(name => requested[name].length === 0)) {
        throw new Error("At least one original transaction ID is required.");
      }
    } catch {
      return json({ ok: false, code: "INVALID_SOURCE_REQUEST" }, 422, origin);
    }

    const sources = {};
    try {
      for (const table of TABLES) {
        const ids = requested[table];
        if (!ids.length) {
          sources[table] = [];
          continue;
        }
        const rows = await fetchSourceRows(table, ids, auth.userId);
        if (!Array.isArray(rows) || rows.length !== ids.length) {
          return json({ ok: false, code: "SOURCE_INCOMPLETE" }, 409, origin);
        }
        const found = new Set(rows.map(row => safeId(row?.id)));
        if (found.size !== ids.length ||
          ids.some(id => !found.has(id)) ||
          rows.some(row => row?.is_deleted === true)) {
          return json({ ok: false, code: "SOURCE_INCOMPLETE" }, 409, origin);
        }
        sources[table] = rows;
      }
    } catch {
      return json({ ok: false, code: "SOURCE_UNAVAILABLE" }, 503, origin);
    }

    try {
      const preview = buildVerifiedAccountingSourceBridge({
        cutoverDate: input.cutoverDate,
        sources, evidence: input.evidence,
      });
      return json({
        ok: true,
        status: "SOURCE_PREVIEW_UNVERIFIED",
        preview,
        evidenceFromClientUnverified: true,
        sourceRowsRefetchedByBackend: true,
        cutoverApprovalConfirmed: false,
        allSourceEventsComplete: false,
        actualProfitAvailable: false,
        mayPost: false,
        writesDatabase: false,
        note: "Bukti dan cutover baru klaim untuk pratinjau. Backend posting belum diaktifkan.",
      }, 200, origin);
    } catch {
      return json({
        ok: false, code: "RECONCILIATION_REQUIRED",
        message: "ID transaksi, sumber, nominal, atau bukti belum dapat direkonsiliasi.",
      }, 409, origin);
    }
  };
}

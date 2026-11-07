import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRequestedSourceIds, createOwnerSourcePreviewHandler,
} from "../supabase/functions/_shared/accountingOwnerSourcePreview.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://staging.example.test";
const sources = {
  sales: [{ id: 1, sale_date: "2026-11-05", total_amount: "50000.00", is_deleted: false }],
  incomes: [{ id: 2, tanggal: "2026-11-10", pemasukan_bunbun: "30000.00", is_deleted: false }],
  purchases: [{ id: 3, tanggal: "2026-11-02", total: "20000.00", ingredient_id: 5, maintenance_item_id: null, is_deleted: false }],
  expenses: [{ id: 4, tanggal: "2026-11-03", nominal: "10000.00", purchase_id: 3, is_deleted: false }],
};
const payload = () => ({
  action: "source-preview", cutoverDate: "2026-11-01",
  sourceIds: { sales: [1], incomes: [2], purchases: [3], expenses: [4] },
  evidence: {
    sales: [{ saleId: 1, reviewed: true, soldVerified: true,
      recordedBasis: "NET_BUNBUN", netEntitlement: "50000.00",
      evidenceRef: "CAFE-SALES-DOCUMENT-20261105" }],
    deposits: [{ incomeId: 2, reviewed: true, cashAccount: "1020",
      evidenceRef: "BANK-TRANSACTION-20261110",
      allocations: [{ saleId: 1, amount: "30000.00" }] }],
    purchases: [{ purchaseId: 3, reviewed: true, kind: "INGREDIENT",
      evidenceRef: "PURCHASE-INVOICE-20261102" }],
    purchasePayments: [{ expenseId: 4, purchaseId: 3, reviewed: true,
      cashAccount: "1020", evidenceRef: "PAYMENT-RECEIPT-20261103" }],
  },
});
const settings = overrides => ({
  stageEnabled: true, allowedOrigin: ORIGIN,
  verifyUserToken: async token => token === "valid.token" ? { id: OWNER } : null,
  loadProfile: async () => ({ id: OWNER, role: "owner", is_active: true }),
  fetchSourceRows: async table => sources[table],
  ...overrides,
});
const req = (body = payload(), { token = "valid.token", origin = ORIGIN, method = "POST" } = {}) =>
  new Request("https://api.example.test/preview", {
    method,
    headers: { Origin: origin, "Content-Type": "application/json",
      Authorization: "Bearer " + token },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });

test("real source rows are re-fetched and only DRAFT proposals returned", async () => {
  const called = [];
  const h = createOwnerSourcePreviewHandler(settings({
    fetchSourceRows: async (table, ids, ownerId) => {
      called.push({ table, ids, ownerId }); return sources[table];
    },
  }));
  const result = await h(req());
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.status, "SOURCE_PREVIEW_UNVERIFIED");
  assert.equal(body.evidenceFromClientUnverified, true);
  assert.equal(body.mayPost, false);
  assert.equal(body.writesDatabase, false);
  assert.equal(body.preview.proposals.length, 4);
  assert.ok(body.preview.proposals.every(p =>
    p.status === "DRAFT" && p.readyToPost === false));
  assert.equal(called.length, 4);
  assert.ok(called.every(row => row.ownerId === OWNER));
});

test("Owner role and staging config deny access before any source read", async () => {
  for (const override of [
    { stageEnabled: false }, { loadProfile: async () => ({ id: OWNER, role: "baker", is_active: true }) },
    { loadProfile: async () => ({ id: OWNER, role: "owner", is_active: false }) },
  ]) {
    let calls = 0;
    const h = createOwnerSourcePreviewHandler(settings({
      ...override, fetchSourceRows: async () => { calls++; return []; },
    }));
    assert.notEqual((await h(req())).status, 200);
    assert.equal(calls, 0);
  }
});

test("original source mismatch is rejected instead of trusting posted body claims", async () => {
  const h = createOwnerSourcePreviewHandler(settings({
    fetchSourceRows: async table => table === "sales" ?
      [{ ...sources.sales[0], total_amount: "48000.00" }] : sources[table],
  }));
  const result = await h(req());
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "RECONCILIATION_REQUIRED");
});

test("source snapshots must be complete, unique and not deleted", async () => {
  for (const rows of [[], [{ ...sources.sales[0], is_deleted: true }],
    [{ ...sources.sales[0], id: 99 }], [sources.sales[0], sources.sales[0]]]) {
    const h = createOwnerSourcePreviewHandler(settings({
      fetchSourceRows: async table => table === "sales" ? rows : sources[table],
    }));
    const result = await h(req());
    assert.equal(result.status, 409);
    assert.equal((await result.json()).code, "SOURCE_INCOMPLETE");
  }
});

test("malformed ID lists and attempts to request posting are rejected", async () => {
  const h = createOwnerSourcePreviewHandler(settings());
  const wrong = payload();
  wrong.action = "post-journal";
  assert.equal((await h(req(wrong))).status, 422);
  const duplicate = payload();
  duplicate.sourceIds.sales = [1, "1"];
  assert.equal((await h(req(duplicate))).status, 422);
  assert.throws(() => checkRequestedSourceIds({
    sales: [1], incomes: [], purchases: [], expenses: [], profiles: [2],
  }));
});

test("malformed origin, token, and month cannot access preview", async () => {
  const h = createOwnerSourcePreviewHandler(settings());
  assert.equal((await h(req(payload(), { origin: "https://elsewhere.test" }))).status, 403);
  assert.equal((await h(req(payload(), { token: "wrong" }))).status, 401);
  const wrongMonth = payload();
  wrongMonth.cutoverDate = "2026-11-31";
  assert.equal((await h(req(wrongMonth))).status, 422);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctionReviewTotal, createPurchaseReviewHandler, openPurchaseReview, sealPurchaseReview } from '../supabase/functions/_shared/accountingPurchaseReview.js';

const owner = '2375b60c-c418-47c2-b157-af80b262fadf';
const origin = 'https://staging.example';
const secret = 'synthetic-signing-secret-not-a-real-key-12345';
const time = 1793740000000;
const input = { action: 'review-post', purchaseId: '42', cashAccount: '1020', evidenceRef: 'INVOICE-42', newUnitPrice: null };
const source = { purchaseSnapshot: '{"id":42,"total":20000}', expenseSnapshot: '{"id":12,"nominal":20000}',
  total: '20000', unitPrice: '10000', quantity: '2', unit: 'kg', packageQuantity: '2', posted: false, sourceComplete: true, periodReady: true };
const deps = overrides => ({ stageEnabled: true, allowedOrigin: origin, signingSecret: secret,
  verifyUserToken: async token => token === 'valid.token' ? { id: owner } : null,
  loadProfile: async () => ({ id: owner, role: 'owner', is_active: true }),
  loadReview: async () => source, submitReview: async () => ({ invoiceJournalId: 'invoice-id' }), now: () => time, ...overrides });
function request(body, options = {}) {
  return new Request('https://edge.example/accounting-purchase', { method: 'POST', headers: {
    Origin: options.origin ?? origin, 'Content-Type': 'application/json',
    ...(options.token === null ? {} : { Authorization: 'Bearer ' + (options.token || 'valid.token') }),
  }, body: JSON.stringify(body) });
}
async function prepare(handler) { const r = await handler(request(input)); assert.equal(r.status, 200); return r.json(); }

test('signed review pins server source, actor and action through confirmation', async () => {
  let captured;
  const handler = createPurchaseReviewHandler(deps({ submitReview: async (review, actor) => { captured = { review, actor }; return { invoiceJournalId: 'invoice-id' }; } }));
  const review = await prepare(handler);
  assert.equal(review.mayConfirm, true);
  const r = await handler(request({ action: 'confirm', reviewToken: review.reviewToken, confirmed: true }));
  assert.equal(r.status, 200);
  assert.equal(captured.actor, owner);
  assert.equal(captured.review.purchaseSnapshot, source.purchaseSnapshot);
  assert.equal(captured.review.expenseSnapshot, source.expenseSnapshot);
  assert.equal(captured.review.action, 'review-post');
  assert.equal(captured.review.cashAccount, '1020');
  assert.ok(captured.review.operationKey);
});
test('unsigned/client-extended amounts cannot enter posting', async () => {
  let writes = 0;
  const handler = createPurchaseReviewHandler(deps({ submitReview: async () => { writes++; } }));
  assert.equal((await handler(request({ ...input, total: 1, actorId: owner }))).status, 422);
  const review = await prepare(handler);
  assert.equal((await handler(request({ action: 'confirm', confirmed: true, reviewToken: review.reviewToken, total: 1 }))).status, 422);
  const [body, sig] = review.reviewToken.split('.');
  const tampered = body.slice(0, -1) + (body.endsWith('A') ? 'B' : 'A') + '.' + sig;
  assert.equal((await handler(request({ action: 'confirm', confirmed: true, reviewToken: tampered }))).status, 409);
  assert.equal(writes, 0);
});
test('expired and cross-owner review tokens fail closed', async () => {
  const handler = createPurchaseReviewHandler(deps());
  const review = await prepare(handler);
  await assert.rejects(openPurchaseReview(review.reviewToken, secret, '11111111-1111-4111-8111-111111111111', time));
  await assert.rejects(openPurchaseReview(review.reviewToken, secret, owner, time + 300000));
  await assert.rejects(openPurchaseReview(review.reviewToken, secret + 'rotated', owner, time));
});
test('anonymous, invalid sessions, inactive Owner and other roles never load financial sources', async () => {
  let reads = 0;
  const loadReview = async () => { reads++; return source; };
  const handler = createPurchaseReviewHandler(deps({ loadReview }));
  assert.equal((await handler(request(input, { token: null }))).status, 401);
  assert.equal((await handler(request(input, { token: 'bad.token' }))).status, 401);
  for (const role of ['helper', 'baker', 'admin', 'cashier']) {
    const h = createPurchaseReviewHandler(deps({ loadReview, loadProfile: async () => ({ id: owner, role, is_active: true }) }));
    assert.equal((await h(request(input))).status, 403);
  }
  const inactive = createPurchaseReviewHandler(deps({ loadReview, loadProfile: async () => ({ id: owner, role: 'owner', is_active: false }) }));
  assert.equal((await inactive(request(input))).status, 403);
  assert.equal(reads, 0);
});
test('fresh authorization is required again on confirmation', async () => {
  let active = true; let writes = 0;
  const handler = createPurchaseReviewHandler(deps({ loadProfile: async () => ({ id: owner, role: 'owner', is_active: active }), submitReview: async () => { writes++; } }));
  const review = await prepare(handler); active = false;
  assert.equal((await handler(request({ action: 'confirm', confirmed: true, reviewToken: review.reviewToken }))).status, 403);
  assert.equal(writes, 0);
});
test('missing opening/closed period yields inspection without a confirmation token', async () => {
  const handler = createPurchaseReviewHandler(deps({ loadReview: async () => ({ ...source, periodReady: false }) }));
  const review = await prepare(handler);
  assert.equal(review.mayConfirm, false); assert.equal(review.reviewToken, null);
  assert.equal(review.code, 'OPENING_OR_PERIOD_NOT_READY');
});
test('posting state and incomplete linked documents must match requested action', async () => {
  for (const row of [{ ...source, posted: true }, { ...source, sourceComplete: false }]) {
    const handler = createPurchaseReviewHandler(deps({ loadReview: async () => row }));
    assert.equal((await handler(request(input))).status, 409);
  }
  const correction = createPurchaseReviewHandler(deps({ loadReview: async () => ({ ...source, posted: true }) }));
  const r = await correction(request({ ...input, action: 'review-correction', newUnitPrice: '12000.00' }));
  assert.equal(r.status, 200);
  const token = (await r.json()).reviewToken;
  assert.equal((await openPurchaseReview(token, secret, owner, time)).newUnitPrice, '12000.00');
});
test('confirmation requires explicit acknowledgement and rechecks the database', async () => {
  const handler = createPurchaseReviewHandler(deps({ submitReview: async () => { throw new Error('Changed/closed source details must stay private'); } }));
  const review = await prepare(handler);
  assert.equal((await handler(request({ action: 'confirm', reviewToken: review.reviewToken, confirmed: false }))).status, 422);
  const r = await handler(request({ action: 'confirm', reviewToken: review.reviewToken, confirmed: true }));
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'SOURCE_OR_PERIOD_CHANGED');
});
test('staging gate, exact origin, missing source and oversized bodies block safely', async () => {
  assert.equal((await createPurchaseReviewHandler(deps({ stageEnabled: false }))(request(input))).status, 503);
  assert.equal((await createPurchaseReviewHandler(deps())(request(input, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await createPurchaseReviewHandler(deps({ loadReview: async () => null }))(request(input))).status, 404);
  assert.equal((await createPurchaseReviewHandler(deps())(request({ ...input, evidenceRef: 'x'.repeat(70000) }))).status, 413);
});
test('IDs and money use bounded text, never coercion or unsafe floating amounts', async () => {
  const handler = createPurchaseReviewHandler(deps());
  for (const purchaseId of [42, '-1', '42 OR 1=1', '9223372036854775808']) assert.equal((await handler(request({ ...input, purchaseId }))).status, 422);
  for (const newUnitPrice of [12000, '-1', 'NaN', '1e4', '0', '1.001']) assert.equal((await handler(request({ ...input, action: 'review-correction', newUnitPrice }))).status, 422);
});
test('review payload lifetime cannot be extended', async () => {
  const token = await sealPurchaseReview({ version: 1, actorId: owner, issuedAt: time, expiresAt: time + 600000 }, secret);
  await assert.rejects(openPurchaseReview(token, secret, owner, time));
});
test('correction review shows an exact total and rejects unknown or fractional-cent packages', () => {
  assert.equal(correctionReviewTotal('12000.00', '2'), '24000.00');
  assert.equal(correctionReviewTotal('0.20', '0.5'), '0.10');
  for (const qty of [null, '0', 'NaN', '0.000001']) assert.throws(() => correctionReviewTotal('0.01', qty));
});

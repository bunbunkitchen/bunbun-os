import { authorizeActiveOwner } from './accountingOwnerReadiness.js';
import { openPurchaseReview, sealPurchaseReview } from './accountingPurchaseReview.js';

export const PERIOD_EXPENSE_ACCOUNTS = Object.freeze({
  '6010': 'Gaji nonproduksi', '6020': 'Utilitas nonproduksi', '6030': 'Maintenance periode',
  '6050': 'Sewa periode', '6060': 'Operasional lain nonproduksi',
});
const exactKeys = (x, fields) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === [...fields].sort().join(',');
const validAmount = x => typeof x === 'string' && /^\d{1,12}(?:\.\d{1,2})?$/.test(x) && Number(x) > 0;
const validId = x => typeof x === 'string' && /^[1-9]\d{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n;
export function createExpenseReviewHandler({ stageEnabled, allowedOrigin, signingSecret,
  verifyUserToken, loadProfile, loadReview, submitReview, now = Date.now }) {
  const reply = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  } });
  return async request => {
    const origin = request.headers.get('Origin');
    if (!stageEnabled || !allowedOrigin || typeof signingSecret !== 'string' || signingSecret.length < 32)
      return reply({ code: 'STAGING_NOT_CONFIGURED' }, 503);
    if (origin !== allowedOrigin) return reply({ code: 'ORIGIN_NOT_ALLOWED' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Vary': 'Origin',
    } });
    if (request.method !== 'POST') return reply({ code: 'METHOD_NOT_ALLOWED' }, 405, origin);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply({ code: 'JSON_REQUIRED' }, 415, origin);
    const auth = await authorizeActiveOwner({ authorization: request.headers.get('Authorization'), verifyUserToken, loadProfile });
    if (!auth.ok) return reply({ code: auth.code }, auth.status, origin);
    let input;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 65536) return reply({ code: 'BODY_TOO_LARGE' }, 413, origin);
      input = JSON.parse(raw);
    } catch { return reply({ code: 'INVALID_JSON' }, 400, origin); }
    const secret = signingSecret + ':period-expense-v1';
    if (input?.action === 'confirm') {
      if (!exactKeys(input, ['action','reviewToken','confirmed']) || input.confirmed !== true)
        return reply({ code: 'CONFIRMATION_REQUIRED' }, 422, origin);
      let review;
      try {
        review = await openPurchaseReview(input.reviewToken, secret, auth.userId, now());
        if (review.kind !== 'PERIOD_EXPENSE' || !['post','correct'].includes(review.action)) throw new Error('Wrong review kind');
      } catch { return reply({ code: 'REVIEW_EXPIRED_OR_CHANGED', message: 'Pemeriksaan kedaluwarsa atau berubah. Periksa pengeluaran kembali.' }, 409, origin); }
      try {
        const result = await submitReview(review, auth.userId);
        return reply({ ok: true, code: 'POSTED', result }, 200, origin);
      } catch { return reply({ code: 'SOURCE_OR_PERIOD_CHANGED', message: 'Pengeluaran belum dicatat. Periksa kembali sumber transaksi dan periode akuntansi.' }, 409, origin); }
    }
    if (!exactKeys(input, ['action','expenseId','expenseAccount','cashAccount','evidenceRef','newAmount','nonProductionConfirmed'])
      || !['review-post','review-correction'].includes(input.action) || !validId(input.expenseId)
      || typeof input.expenseAccount !== 'string' || !Object.hasOwn(PERIOD_EXPENSE_ACCOUNTS, input.expenseAccount) || !['1010','1020'].includes(input.cashAccount)
      || input.nonProductionConfirmed !== true || typeof input.evidenceRef !== 'string'
      || input.evidenceRef.trim().length < 6 || input.evidenceRef.trim().length > 500
      || (input.action === 'review-post' ? input.newAmount !== null : !validAmount(input.newAmount)))
      return reply({ code: 'INVALID_REVIEW_REQUEST', message: 'Pilih biaya periode nonproduksi, akun pembayaran dan referensi bukti yang sesuai.' }, 422, origin);
    let source;
    try { source = await loadReview(input.expenseId, auth.userId); }
    catch { return reply({ code: 'SOURCE_UNAVAILABLE' }, 503, origin); }
    if (!source) return reply({ code: 'EXPENSE_NOT_FOUND' }, 404, origin);
    if (source.sourceComplete !== true || (input.action === 'review-post' ? source.posted : !source.posted))
      return reply({ code: 'SOURCE_REQUIRES_RECONCILIATION', message: 'Pengeluaran terkait Purchasing atau status jurnalnya tidak cocok. Gunakan alur yang sesuai.' }, 409, origin);
    const issuedAt = now();
    const review = { version: 1, kind: 'PERIOD_EXPENSE', actorId: auth.userId, expenseId: input.expenseId,
      action: input.action === 'review-post' ? 'post' : 'correct', sourceSnapshot: source.sourceSnapshot,
      expenseAccount: input.expenseAccount, cashAccount: input.cashAccount, newAmount: input.newAmount,
      evidenceRef: input.evidenceRef.trim(), costScope: 'PERIOD_NONPRODUCTION',
      operationKey: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + 300000 };
    return reply({ ok: true, code: source.periodReady === true ? 'READY_FOR_CONFIRMATION' : 'OPENING_OR_PERIOD_NOT_READY',
      mayConfirm: source.periodReady === true,
      reviewToken: source.periodReady === true ? await sealPurchaseReview(review, secret) : null,
      summary: { expenseId: input.expenseId, date: source.date, category: source.category, amount: source.amount,
        newAmount: input.newAmount, expenseAccount: input.expenseAccount, expenseLabel: PERIOD_EXPENSE_ACCOUNTS[input.expenseAccount],
        cashAccount: input.cashAccount, evidenceRef: input.evidenceRef.trim() } }, 200, origin);
  };
}

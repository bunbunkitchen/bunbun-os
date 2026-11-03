import { authorizeActiveOwner } from './accountingOwnerReadiness.js';

const encoder = new TextEncoder();
const MAX_BODY = 65536;
const REVIEW_LIFETIME = 5 * 60 * 1000;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), x => x.charCodeAt(0));
async function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Signing key unavailable');
  return crypto.subtle.importKey('raw', encoder.encode('bunbun-purchase-review-v1:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function sealPurchaseReview(payload, secret) {
  const body = encode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(body));
  return body + '.' + encode(new Uint8Array(signature));
}
export async function openPurchaseReview(token, secret, actorId, now) {
  if (typeof token !== 'string' || token.length > 60000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid review');
  const [body, signature] = token.split('.');
  if (!await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(body))) throw new Error('Invalid review');
  const payload = JSON.parse(new TextDecoder().decode(decode(body)));
  if (payload.version !== 1 || payload.actorId !== actorId || !Number.isSafeInteger(payload.expiresAt)
    || !Number.isSafeInteger(payload.issuedAt) || payload.issuedAt > now || payload.expiresAt <= now
    || payload.expiresAt - payload.issuedAt !== REVIEW_LIFETIME) throw new Error('Expired or invalid review');
  return payload;
}
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const validPrice = value => typeof value === 'string' && /^\d{1,12}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
export function correctionReviewTotal(unitPrice, packageQuantity) {
  if (!validPrice(unitPrice) || typeof packageQuantity !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(packageQuantity)) throw new Error('Invalid package quantity');
  const [price, fraction = ''] = unitPrice.split('.');
  const [quantity, part = ''] = packageQuantity.split('.');
  const units = BigInt(quantity) * 1000000n + BigInt(part.padEnd(6, '0'));
  const product = (BigInt(price) * 100n + BigInt(fraction.padEnd(2, '0'))) * units;
  if (units <= 0n || product % 1000000n !== 0n || product / 1000000n > 99999999999999n) throw new Error('Invalid correction precision');
  const cents = product / 1000000n;
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
}
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');

export function createPurchaseReviewHandler({ stageEnabled, allowedOrigin, signingSecret,
  verifyUserToken, loadProfile, loadReview, submitReview, now = Date.now }) {
  const reply = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
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
      const body = await request.text();
      if (encoder.encode(body).length > MAX_BODY) return reply({ code: 'BODY_TOO_LARGE' }, 413, origin);
      input = JSON.parse(body);
    } catch { return reply({ code: 'INVALID_JSON' }, 400, origin); }
    if (input?.action === 'confirm') {
      if (!keys(input, ['action', 'reviewToken', 'confirmed']) || input.confirmed !== true) return reply({ code: 'CONFIRMATION_REQUIRED' }, 422, origin);
      let review;
      try { review = await openPurchaseReview(input.reviewToken, signingSecret, auth.userId, now()); }
      catch { return reply({ code: 'REVIEW_EXPIRED_OR_CHANGED', message: 'Pemeriksaan kedaluwarsa atau berubah. Periksa transaksi kembali.' }, 409, origin); }
      try {
        const result = await submitReview(review, auth.userId);
        return reply({ ok: true, code: 'POSTED', purchaseId: review.purchaseId, result }, 200, origin);
      } catch {
        return reply({ code: 'SOURCE_OR_PERIOD_CHANGED', message: 'Transaksi belum dicatat. Periksa kembali sumber, periode, dan pemakaian bahan.' }, 409, origin);
      }
    }
    if (!keys(input, ['action', 'purchaseId', 'cashAccount', 'evidenceRef', 'newUnitPrice'])
      || !['review-post', 'review-correction'].includes(input.action) || !validId(input.purchaseId)
      || !['1010', '1020'].includes(input.cashAccount) || typeof input.evidenceRef !== 'string'
      || input.evidenceRef.trim().length < 6 || input.evidenceRef.trim().length > 500
      || (input.action === 'review-post' ? input.newUnitPrice !== null : !validPrice(input.newUnitPrice)))
      return reply({ code: 'INVALID_REVIEW_REQUEST' }, 422, origin);
    let source;
    try { source = await loadReview(input.purchaseId, auth.userId); }
    catch { return reply({ code: 'SOURCE_UNAVAILABLE' }, 503, origin); }
    if (!source) return reply({ code: 'PURCHASE_NOT_FOUND' }, 404, origin);
    if (!source.sourceComplete || (input.action === 'review-post' ? source.posted : !source.posted))
      return reply({ code: 'SOURCE_REQUIRES_RECONCILIATION', message: 'Pembelian, pembayaran, atau penerimaan bahan belum cocok dengan tindakan ini.' }, 409, origin);
    let newTotal = null;
    if (input.action === 'review-correction') {
      try { newTotal = correctionReviewTotal(input.newUnitPrice, source.packageQuantity); }
      catch { return reply({ code: 'PACKAGE_REQUIRES_RECONCILIATION', message: 'Jumlah sediaan atau ketelitian total koreksi belum valid. Periksa nota pembelian.' }, 409, origin); }
    }
    const issuedAt = now();
    const review = { version: 1, actorId: auth.userId, action: input.action, purchaseId: input.purchaseId,
      purchaseSnapshot: source.purchaseSnapshot, expenseSnapshot: source.expenseSnapshot,
      newUnitPrice: input.newUnitPrice, cashAccount: input.cashAccount, evidenceRef: input.evidenceRef.trim(),
      operationKey: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + REVIEW_LIFETIME };
    // Never return client-supplied journal lines/amounts as a trusted posting plan.
    return reply({ ok: true, code: source.periodReady ? 'READY_FOR_CONFIRMATION' : 'OPENING_OR_PERIOD_NOT_READY',
      summary: { purchaseId: input.purchaseId, total: source.total, unitPrice: source.unitPrice,
        quantity: source.quantity, unit: source.unit, packageQuantity: source.packageQuantity,
        newUnitPrice: input.newUnitPrice, newTotal, cashAccount: input.cashAccount, evidenceRef: input.evidenceRef.trim(), posted: source.posted },
      mayConfirm: source.periodReady === true,
      reviewToken: source.periodReady ? await sealPurchaseReview(review, signingSecret) : null }, 200, origin);
  };
}

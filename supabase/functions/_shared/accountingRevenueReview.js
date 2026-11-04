import { authorizeActiveOwner } from './accountingOwnerReadiness.js';
import { openPurchaseReview, sealPurchaseReview } from './accountingPurchaseReview.js';

const exact = (x, fields) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === [...fields].sort().join(',');
const validId = x => typeof x === 'string' && /^[1-9]\d{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n;
export function revenueMoneyToCents(x) {
  if (typeof x !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(x)) throw new Error('Invalid amount');
  const [whole, decimal = ''] = x.split('.');
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2,'0'));
}
const positive = x => { try { return revenueMoneyToCents(x) > 0n; } catch { return false; } };
export function createRevenueReviewHandler({ stageEnabled, allowedOrigin, signingSecret,
  verifyUserToken, loadProfile, loadSource, loadReceivables, submitReview, now = Date.now }) {
  const reply = (body,status,origin) => new Response(JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}),
  }});
  return async request => {
    const origin=request.headers.get('Origin');
    if (!stageEnabled || !allowedOrigin || typeof signingSecret!=='string' || signingSecret.length<32) return reply({code:'STAGING_NOT_CONFIGURED'},503);
    if (origin!==allowedOrigin) return reply({code:'ORIGIN_NOT_ALLOWED'},403);
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Vary':'Origin'}});
    if (request.method!=='POST') return reply({code:'METHOD_NOT_ALLOWED'},405,origin);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply({code:'JSON_REQUIRED'},415,origin);
    const auth=await authorizeActiveOwner({authorization:request.headers.get('Authorization'),verifyUserToken,loadProfile});
    if (!auth.ok) return reply({code:auth.code},auth.status,origin);
    let input;
    try { const text=await request.text(); if(new TextEncoder().encode(text).length>65536) return reply({code:'BODY_TOO_LARGE'},413,origin); input=JSON.parse(text); }
    catch {return reply({code:'INVALID_JSON'},400,origin);}
    const secret=signingSecret+':sale-settlement-v1';
    if(input?.action==='confirm') {
      if(!exact(input,['action','reviewToken','confirmed']) || input.confirmed!==true) return reply({code:'CONFIRMATION_REQUIRED'},422,origin);
      let review;
      try {review=await openPurchaseReview(input.reviewToken,secret,auth.userId,now());
        if(review.kind!=='REVENUE_AND_SETTLEMENT'||!['post_sale','post_income'].includes(review.action)) throw Error('Wrong review');}
      catch {return reply({code:'REVIEW_EXPIRED_OR_CHANGED',message:'Pemeriksaan kedaluwarsa atau berubah. Periksa transaksi kembali.'},409,origin);}
      try {return reply({ok:true,code:'POSTED',result:await submitReview(review,auth.userId)},200,origin);}
      catch {return reply({code:'SOURCE_OR_BALANCE_CHANGED',message:'Transaksi belum dicatat. Periksa kembali sumber, sisa piutang, dan periode akuntansi.'},409,origin);}
    }
    if(exact(input,['action'])&&input.action==='receivables') {
      try {return reply({ok:true,...await loadReceivables(auth.userId),actualProfitAvailable:false},200,origin);}
      catch {return reply({code:'RECEIVABLES_UNAVAILABLE'},503,origin);}
    }
    const isSale=input?.action==='review-sale';
    const isIncome=input?.action==='review-income';
    const fields=isSale?['action','saleId','recordedBasis','netEntitlement','soldConfirmed','evidenceRef']:
      ['action','incomeId','cashAccount','allocations','allocationConfirmed','evidenceRef'];
    if((!isSale&&!isIncome)||!exact(input,fields)||!validId(isSale?input.saleId:input.incomeId)
      ||typeof input.evidenceRef!=='string'||input.evidenceRef.trim().length<6||input.evidenceRef.trim().length>500)
      return reply({code:'INVALID_REVIEW_REQUEST'},422,origin);
    if(isSale&&(!['NET_BUNBUN','GROSS_CAFE'].includes(input.recordedBasis)||!positive(input.netEntitlement)||input.soldConfirmed!==true))
      return reply({code:'SALE_VERIFICATION_REQUIRED',message:'Konfirmasi produk sudah terjual dan hak pendapatan Bunbun berdasarkan bukti.'},422,origin);
    if(isIncome&&(!['1010','1020'].includes(input.cashAccount)||input.allocationConfirmed!==true||!Array.isArray(input.allocations)
      ||input.allocations.length<1||input.allocations.length>50||input.allocations.some(x=>!exact(x,['saleId','amount'])||!validId(x.saleId)||!positive(x.amount))
      ||new Set(input.allocations.map(x=>x.saleId)).size!==input.allocations.length))
      return reply({code:'ALLOCATION_REQUIRED',message:'Pilih piutang dan nominal alokasi yang benar, tanpa penjualan duplikat.'},422,origin);
    let source;
    try {source=await loadSource(isSale?'review_sale':'review_income',isSale?input.saleId:input.incomeId,auth.userId);}
    catch {return reply({code:'SOURCE_UNAVAILABLE'},503,origin);}
    if(!source) return reply({code:'SOURCE_NOT_FOUND'},404,origin);
    if(source.sourceComplete!==true||source.posted===true||typeof source.sourceSnapshot!=='string'
      ||new TextEncoder().encode(source.sourceSnapshot).length>24000)
      return reply({code:'SOURCE_REQUIRES_RECONCILIATION',message:'Sumber tidak lengkap, terlalu besar, atau sudah dijurnal. Muat ulang status transaksi.'},409,origin);
    let allocationSummary=[];
    try {
      if(isSale) {
        const net=revenueMoneyToCents(input.netEntitlement), total=revenueMoneyToCents(source.total);
        if((input.recordedBasis==='NET_BUNBUN'&&net!==total)||(input.recordedBasis==='GROSS_CAFE'&&net>total)) throw Error('Entitlement mismatch');
      } else {
        const {receivables}=await loadReceivables(auth.userId);
        let sum=0n;
        for(const allocation of input.allocations) {
          const row=receivables.find(x=>x.saleId===allocation.saleId);
          if(!row||row.date>source.date||revenueMoneyToCents(allocation.amount)>revenueMoneyToCents(row.outstanding)) throw Error('Outstanding mismatch');
          sum+=revenueMoneyToCents(allocation.amount);
          allocationSummary.push({saleId:row.saleId,date:row.date,channel:row.channel,outstanding:row.outstanding,amount:allocation.amount});
        }
        if(sum!==revenueMoneyToCents(source.amount)) throw Error('Net receipt mismatch');
      }
    } catch {return reply({code:'ENTITLEMENT_OR_ALLOCATION_MISMATCH',message:'Hak Bunbun atau alokasi tidak cocok dengan sumber dan sisa piutang. Setoran harus dialokasikan sebesar uang bersih yang diterima.'},409,origin);}
    const issuedAt=now();
    const review={version:1,kind:'REVENUE_AND_SETTLEMENT',actorId:auth.userId,action:isSale?'post_sale':'post_income',
      sourceSnapshot:source.sourceSnapshot,evidenceRef:input.evidenceRef.trim(),operationKey:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+300000,
      ...(isSale?{saleId:input.saleId,recordedBasis:input.recordedBasis,netEntitlement:input.netEntitlement,soldConfirmed:true}:
        {incomeId:input.incomeId,cashAccount:input.cashAccount,allocations:input.allocations,allocationConfirmed:true})};
    return reply({ok:true,code:source.periodReady===true?'READY_FOR_CONFIRMATION':'OPENING_OR_PERIOD_NOT_READY',
      mayConfirm:source.periodReady===true,reviewToken:source.periodReady===true?await sealPurchaseReview(review,secret):null,
      actualProfitAvailable:false,summary:{date:source.date,evidenceRef:input.evidenceRef.trim(),
        ...(isSale?{saleId:input.saleId,channel:source.channel,recordedTotal:source.total,recordedBasis:input.recordedBasis,
          netEntitlement:input.netEntitlement,cogsStatus:'PENDING_VALUATION'}:
          {incomeId:input.incomeId,netReceipt:source.amount,cashAccount:input.cashAccount,allocations:allocationSummary})}},200,origin);
  };
}

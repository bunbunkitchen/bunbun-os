// Exact factual reconciliation. Never derives waste or applies a sharing percentage.
export const cafeQuantityFields = ['openingQty','receivedQty','regularQty','bundleQty','discountQty','wasteQty','returnedQty','closingQty'];
export const cafeMoneyFields = ['regularNet','bundleNet','discountNet'];
const exact=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...fields].sort().join(',');
const id=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const money=x=>typeof x==='string'&&/^\d{1,12}(\.\d{1,2})?$/.test(x);
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const evidence=x=>typeof x==='string'&&x.trim().length>=6&&x.length<=500;
const cents=x=>{const [a,b='']=String(x).split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
const cash=x=>`${x<0n?'-':''}${(x<0n?-x:x)/100n}.${((x<0n?-x:x)%100n).toString().padStart(2,'0')}`;
export function validateCafeReport(x){
 const fields=['month','cafeKey','asOfDate','expectedReportId','openingEvidenceRef','evidenceRef','factsConfirmed','confirmedUnpaid','confirmedCredit','shipmentIds','returnIds','receipts','rows'];
 if(!exact(x,fields)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(x.month)||!['PUBLIC_HUB','PUBLIC_COFFEE'].includes(x.cafeKey)
  ||!date(x.asOfDate)||x.asOfDate<new Date(Date.UTC(Number(x.month.slice(0,4)),Number(x.month.slice(5)),0)).toISOString().slice(0,10)
  ||(x.expectedReportId!==null&&!(typeof x.expectedReportId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.expectedReportId)))
  ||!evidence(x.evidenceRef)||!evidence(x.openingEvidenceRef)||x.factsConfirmed!==true||!money(x.confirmedUnpaid)||!money(x.confirmedCredit))throw Error('Lengkapi bulan, tanggal batas setoran, bukti, serta saldo belum dibayar dan kelebihan bayar. Isi 0 hanya bila sudah dipastikan.');
 for(const key of ['shipmentIds','returnIds'])if(!Array.isArray(x[key])||x[key].length>300||x[key].some(v=>!id(v))||new Set(x[key]).size!==x[key].length)throw Error('Sumber kiriman/retur tidak valid.');
 if(!Array.isArray(x.receipts)||x.receipts.length>100||x.receipts.some(r=>!exact(r,['incomeId','amount'])||!id(r.incomeId)||!money(r.amount)||cents(r.amount)<=0n)||new Set(x.receipts.map(r=>r.incomeId)).size!==x.receipts.length)throw Error('Pilih setoran dan nominal bagi laporan ini.');
 if(!Array.isArray(x.rows)||!x.rows.length||x.rows.length>50||new Set(x.rows.map(r=>r.productId)).size!==x.rows.length)throw Error('Isi 1–50 produk tanpa duplikasi.');
 for(const r of x.rows){
  if(!exact(r,['productId',...cafeQuantityFields,...cafeMoneyFields])||!id(r.productId)||cafeQuantityFields.some(k=>typeof r[k]!=='string'||!/^\d{1,9}$/.test(r[k]))||cafeMoneyFields.some(k=>!money(r[k])))throw Error('Semua jumlah dan nominal produk wajib diisi, termasuk angka 0 yang sudah dipastikan.');
  for(const k of ['regular','bundle','discount'])if(BigInt(r[k+'Qty'])===0n&&cents(r[k+'Net'])!==0n)throw Error('Nominal penjualan harus 0 bila jumlah kategori tersebut 0.');
 }
 return x;
}
export function reconcileCafeReport(input,source){
 validateCafeReport(input);
 const issues=[];let entitlement=0n;let waste=0n;
 const selected=new Set([...input.shipmentIds,...input.returnIds]);
 const movementMap=new Map(source.movements.map(m=>[m.id,m]));
 for(const key of ['shipmentIds','returnIds'])for(const mid of input[key]){
  const m=movementMap.get(mid);
  if(!m||m.type!==(key==='shipmentIds'?'CAFE_OUT':'CAFE_IN')||(m.cafeKey&&m.cafeKey!==input.cafeKey)||m.excluded)throw Error('Tujuan, jenis, atau identitas sumber barang tidak sesuai.');
 }
 for(const m of source.movements){
  if(m.excluded)continue;
  if(m.cafeKey===input.cafeKey&&!selected.has(m.id))issues.push(`Sumber ${m.id} untuk kafe ini belum dimasukkan.`);
  if(!m.cafeKey&&!selected.has(m.id))issues.push(`Tujuan sumber ${m.id} belum ditentukan; kelengkapan kiriman belum terjamin.`);
 }
 const products=new Set(source.products.map(p=>p.id));
 const previous=new Map((source.previousRows||[]).map(r=>[r.productId,r]));
 const rows=input.rows.map(r=>{
  if(!products.has(r.productId))throw Error('Produk tidak ditemukan.');
  const q=k=>BigInt(r[k]);const n=k=>cents(r[k]);
  const shipped=input.shipmentIds.reduce((s,k)=>s+(movementMap.get(k).productId===r.productId?BigInt(movementMap.get(k).quantity):0n),0n);
  const returned=input.returnIds.reduce((s,k)=>s+(movementMap.get(k).productId===r.productId?BigInt(movementMap.get(k).quantity):0n),0n);
  const sold=q('regularQty')+q('bundleQty')+q('discountQty');
  const stockVariance=q('openingQty')+q('receivedQty')-sold-q('wasteQty')-q('returnedQty')-q('closingQty');
  const receivedVariance=q('receivedQty')-shipped,returnVariance=q('returnedQty')-returned;
  const prior=previous.get(r.productId);const openingVariance=source.previousReportId?q('openingQty')-BigInt(prior?.closingQty||'0'):null;
  const net=n('regularNet')+n('bundleNet')+n('discountNet');entitlement+=net;waste+=q('wasteQty');
  if(stockVariance||receivedVariance||returnVariance||openingVariance)issues.push(`Jumlah produk ${r.productId} belum cocok.`);
  return {productId:r.productId,soldQty:String(sold),wasteQty:r.wasteQty,entitlement:cash(net),stockVariance:String(stockVariance),receivedVariance:String(receivedVariance),returnVariance:String(returnVariance),openingVariance:openingVariance===null?null:String(openingVariance)};
 });
 const ids=new Set(input.rows.map(r=>r.productId));
 for(const mid of selected)if(!ids.has(movementMap.get(mid).productId))issues.push(`Produk pada sumber ${mid} belum masuk laporan.`);
 for(const r of source.previousRows||[])if(BigInt(r.closingQty)>0n&&!ids.has(r.productId))issues.push(`Sisa produk ${r.productId} dari bulan sebelumnya belum masuk laporan.`);
 const incomeMap=new Map(source.incomes.map(i=>[i.id,i]));let receipts=0n;
 for(const r of input.receipts){const i=incomeMap.get(r.incomeId);
  if(!i||!money(i.net)||i.date>input.asOfDate||cents(r.amount)+cents(i.usedElsewhere)>cents(i.net))throw Error('Alokasi setoran melebihi pemasukan bersih yang tersedia atau melewati tanggal batas.');
  receipts+=cents(r.amount);
 }
 const paymentVariance=entitlement-receipts-cents(input.confirmedUnpaid)+cents(input.confirmedCredit);
 if(paymentVariance)issues.push('Hak bersih, setoran, saldo belum dibayar, dan kelebihan bayar belum cocok.');
 // A factual report is never a substitute for posting revenue/COGS or cafe-waste journals.
 return {rows,entitlement:cash(entitlement),receipts:cash(receipts),confirmedUnpaid:input.confirmedUnpaid,confirmedCredit:input.confirmedCredit,paymentVariance:cash(paymentVariance),wasteQty:String(waste),
  factsMatch:issues.length===0,issues:[...new Set(issues)],status:issues.length?'RECORDED_REQUIRES_RECONCILIATION':'FACTS_RECONCILED',
  accountingStatus:'REQUIRES_LEDGER_RECONCILIATION',readyToClose:false,actualProfitAvailable:false};
}

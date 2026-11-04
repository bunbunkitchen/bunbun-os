import {useState} from 'react';
import CafeLedgerPanel from '../../components/accounting/CafeLedgerPanel';
import {requestCafeLedger} from '../../services/accountingCafeLedgerService';
import {requestCafeReport} from '../../services/accountingCafeReportService';
import {purchaseAccountingAvailable} from '../../services/accountingPurchaseService';
import {cafeQuantityFields,cafeMoneyFields} from '../../../supabase/functions/_shared/accountingCafeReport';
const labels={openingQty:'Stok awal',receivedQty:'Diterima kafe',regularQty:'Terjual normal',bundleQty:'Terjual bundling',discountQty:'Terjual diskon',wasteQty:'Waste terkonfirmasi',returnedQty:'Retur belum terjual',closingQty:'Sisa di kafe',regularNet:'Hak bersih normal (Rp)',bundleNet:'Hak bersih bundling (Rp)',discountNet:'Hak bersih diskon (Rp)'};
const blank=()=>Object.fromEntries(['productId',...cafeQuantityFields,...cafeMoneyFields].map(k=>[k,'']));
const box='border rounded-lg px-3 py-2 w-full bg-white';
const button='rounded-lg bg-[#595e47] text-white px-4 py-2 disabled:opacity-50';
export default function CafeReconciliation(){
 const [month,setMonth]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).format(new Date()).replace(/^(\d{2})\/(\d{4})$/,'$2-$1'));
 const [cafe,setCafe]=useState('PUBLIC_HUB'),[loaded,setLoaded]=useState(null),[input,setInput]=useState(null),[review,setReview]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ledger,setLedger]=useState(null);
 const change=patch=>{setInput(x=>({...x,...patch}));setReview(null);setMessage('');};
 const run=async fn=>{setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message);}finally{setBusy(false);}};
 const load=async()=>{
  const data=await requestCafeReport({action:'inspect',month,cafeKey:cafe});setLoaded(data);setReview(null);
  const saved=data.currentReport;
  setLedger(null);
  if(saved){try{setLedger(await requestCafeLedger({action:'inspect',reportId:saved.id}));}catch{setMessage('Laporan dimuat, tetapi pemeriksaan jurnal belum tersedia. Muat ulang sebelum mengubah laporan.');}}
  setInput(saved?{...saved.input,expectedReportId:saved.id,factsConfirmed:false}:{month,cafeKey:cafe,asOfDate:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),expectedReportId:null,openingEvidenceRef:'',evidenceRef:'',factsConfirmed:false,confirmedUnpaid:'',confirmedCredit:'',shipmentIds:[],returnIds:[],receipts:[],rows:[blank()]});
 };
 const choose=(key,id,checked)=>change({[key]:checked?[...input[key],id]:input[key].filter(x=>x!==id)});
 if(!purchaseAccountingAvailable)return <p className="p-6">Rekonsiliasi kafe tersedia di staging yang ditentukan.</p>;
 return <main className="p-6 space-y-6">
  <header><h1 className="text-3xl font-bold">Rekonsiliasi Bulanan Kafe</h1><p className="mt-2">Cocokkan laporan produk dan hak bersih Bunbun dengan kiriman, retur, dan setoran.</p></header>
  <p className="p-4 rounded-lg bg-amber-50">Setoran sudah merupakan bagian Bunbun. Isi waste dari jumlah barang yang dipastikan tidak terjual. Selisih uang tidak menentukan waste. Penyimpanan laporan ini belum menjurnal pendapatan, HPP, atau waste kafe.</p>
  <div className="flex flex-wrap gap-3 items-end"><label>Bulan laporan<input aria-label="Bulan laporan" type="month" className={box} value={month} onChange={e=>{setMonth(e.target.value);setLoaded(null);setInput(null);setReview(null);}} /></label>
   <label>Kafe<select className={box} value={cafe} onChange={e=>{setCafe(e.target.value);setLoaded(null);setInput(null);setReview(null);}}><option value="PUBLIC_HUB">Public Hub</option><option value="PUBLIC_COFFEE">The Public Coffee</option></select></label>
   <button disabled={busy||!month} className={button} onClick={()=>run(load)}>Muat laporan dan sumber</button></div>
  {message&&<p role="status" className="p-4 bg-amber-50 rounded-lg">{message}</p>}
  {loaded&&input&&<>
   {loaded.sourceChanged&&<p className="p-4 bg-amber-50 rounded-lg">Sumber atau laporan bulan sebelumnya sudah berubah sejak laporan ini disimpan. Periksa ulang sebelum memakai hasil pencocokan.</p>}
   {loaded.currentReport&&<CafeLedgerPanel key={loaded.currentReport.id} report={loaded.currentReport} initialStatus={ledger} onComplete={load} />}
   {ledger?.imported&&<p className="p-4 bg-amber-50 rounded-lg">Laporan sudah menjadi sumber jurnal. Perubahan memerlukan koreksi akuntansi.</p>}
   <fieldset disabled={busy||!!ledger?.imported||!!(loaded.currentReport&&!ledger)} className="space-y-6">
   <section className="bg-white rounded-xl p-5 space-y-4"><h2 className="font-bold text-xl">Laporan dari kafe {loaded.currentReport?`· revisi ${loaded.currentReport.revision}`:''}</h2>
    <div className="grid md:grid-cols-2 gap-4"><label>Bukti laporan kafe<input className={box} value={input.evidenceRef} onChange={e=>change({evidenceRef:e.target.value})} placeholder="Nomor laporan atau referensi dokumen" /></label><label>Bukti stok awal<input className={box} value={input.openingEvidenceRef} onChange={e=>change({openingEvidenceRef:e.target.value})} placeholder="Laporan bulan lalu / hasil hitung stok" /></label></div>
    <p>Semua kolom wajib diisi. Angka 0 berarti sudah dipastikan nol; kolom kosong berarti belum diketahui.</p>
    {input.rows.map((r,i)=><fieldset key={i} className="border rounded-xl p-4 space-y-3"><div className="flex gap-3"><label className="grow">Produk<select className={box} value={r.productId} onChange={e=>change({rows:input.rows.map((v,j)=>i===j?{...v,productId:e.target.value}:v)})}><option value="">Pilih produk</option>{loaded.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={busy||input.rows.length===1} onClick={()=>change({rows:input.rows.filter((_,j)=>j!==i)})}>Hapus produk</button></div>
     <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...cafeQuantityFields,...cafeMoneyFields].map(k=><label key={k}>{labels[k]}<input className={box} inputMode={cafeMoneyFields.includes(k)?'decimal':'numeric'} value={r[k]} onChange={e=>change({rows:input.rows.map((v,j)=>i===j?{...v,[k]:e.target.value}:v)})} /></label>)}</div></fieldset>)}
    <button className={button} disabled={busy||input.rows.length>=50} onClick={()=>change({rows:[...input.rows,blank()]})}>Tambah produk</button>
   </section>
   <section className="bg-white rounded-xl p-5 space-y-3"><h2 className="font-bold text-xl">Sumber kiriman dan retur</h2><p>Pilih hanya sumber yang tujuannya kafe ini, sesuai bukti pengiriman. Tujuan yang belum diketahui tetap ditandai untuk diperiksa.</p>
    {!loaded.movements.length&&<p>Belum ada kiriman atau retur bulan ini.</p>}
    {loaded.movements.filter(m=>!m.excluded&&(!m.cafeKey||m.cafeKey===cafe)).map(m=>{const key=m.type==='CAFE_OUT'?'shipmentIds':'returnIds';return <label className="block border rounded-lg p-3" key={m.id}><input type="checkbox" checked={input[key].includes(m.id)} onChange={e=>choose(key,m.id,e.target.checked)} /> {m.date} · {m.type==='CAFE_OUT'?'Kiriman':'Retur'} #{m.id} · {loaded.products.find(p=>p.id===m.productId)?.name||m.productId} · {m.quantity} pcs · {m.cafeKey||'Tujuan perlu dipastikan'}</label>;})}
   </section>
   <section className="bg-white rounded-xl p-5 space-y-3"><h2 className="font-bold text-xl">Setoran bersih untuk laporan ini</h2><label>Tanggal batas pencocokan setoran<input type="date" className={box} value={input.asOfDate} onChange={e=>change({asOfDate:e.target.value})} /></label>
    <p>Setoran boleh masuk setelah bulan laporan. Pilih transaksi yang benar dan isi nominal yang dialokasikan ke laporan ini.</p>
    {loaded.receiptCandidates.map(r=>{const selected=input.receipts.find(x=>x.incomeId===r.id);return <div key={r.id} className="border rounded-lg p-3 flex gap-3 items-center flex-wrap"><label className="grow"><input type="checkbox" checked={!!selected} onChange={e=>change({receipts:e.target.checked?[...input.receipts,{incomeId:r.id,amount:''}]:input.receipts.filter(x=>x.incomeId!==r.id)})} /> {r.date} · #{r.id} · Rp{r.net} · {r.description}</label>{selected&&<label>Nominal untuk bulan ini<input className={box} value={selected.amount} inputMode="decimal" onChange={e=>change({receipts:input.receipts.map(x=>x.incomeId===r.id?{...x,amount:e.target.value}:x)})} /></label>}</div>;})}
    <div className="grid md:grid-cols-2 gap-3"><label>Hak bersih yang belum dibayar (Rp)<input className={box} inputMode="decimal" value={input.confirmedUnpaid} onChange={e=>change({confirmedUnpaid:e.target.value})} /></label><label>Kelebihan bayar terkonfirmasi (Rp)<input className={box} inputMode="decimal" value={input.confirmedCredit} onChange={e=>change({confirmedCredit:e.target.value})} /></label></div>
   </section>
   <label className="block"><input type="checkbox" checked={input.factsConfirmed} onChange={e=>change({factsConfirmed:e.target.checked})} /> Saya sudah mencocokkan jumlah, kategori penjualan, hak bersih dan setoran dengan bukti kafe.</label>
   <button disabled={busy||!input.factsConfirmed} className={button} onClick={()=>run(async()=>setReview(await requestCafeReport({action:'review',input})))}>Periksa pencocokan</button>
   {review&&<section className="bg-white rounded-xl p-5 space-y-3"><h2 className="font-bold text-xl">Hasil pemeriksaan</h2><dl className="grid md:grid-cols-3 gap-3">{[['Hak bersih',review.summary.entitlement],['Setoran terkait',review.summary.receipts],['Selisih belum terjelaskan',review.summary.paymentVariance]].map(([k,v])=><div key={k}><dt>{k}</dt><dd className="font-bold text-xl">Rp{v}</dd></div>)}</dl><p>Waste terkonfirmasi: {review.summary.wasteQty} pcs.</p>
    {review.summary.issues.length?<ul className="list-disc pl-6">{review.summary.issues.map(x=><li key={x}>{x}</li>)}</ul>:<p>Jumlah barang dan pencocokan setoran sesuai dengan sumber yang dipilih.</p>}
    <p>Laporan dapat disimpan beserta selisihnya. Status akuntansi tetap memerlukan pencocokan jurnal.</p>
    <button disabled={busy} className={button} onClick={()=>run(async()=>{const r=await requestCafeReport({action:'confirm',reviewToken:review.reviewToken,confirmed:true});await load();setMessage(`Laporan tersimpan sebagai revisi ${r.result.revision}. Riwayat sebelumnya tetap tersedia.`);})}>Simpan laporan{review.summary.issues.length?' dengan selisih':''}</button>
   </section>}
   </fieldset>
   {!!loaded.history.length&&<section><h2 className="font-bold text-xl">Riwayat laporan</h2>{loaded.history.map(r=><p key={r.id}>Revisi {r.revision} · {new Date(r.createdAt).toLocaleString('id-ID')} · {r.status==='FACTS_RECONCILED'?'Fakta cocok':'Ada selisih untuk ditelusuri'}</p>)}</section>}
  </>}
 </main>;
}

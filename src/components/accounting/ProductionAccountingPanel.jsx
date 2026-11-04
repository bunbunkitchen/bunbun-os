import { useState } from 'react';
import Currency from '../ui/Currency';
import { requestProductionAccounting } from '../../services/accountingProductionService';

const todayWib=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function ProductionAccountingPanel({batchId,batchCode,expenses}){
 const [info,setInfo]=useState(null),[mode,setMode]=useState('cost');
 const [expenseId,setExpenseId]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(todayWib);
 const [costKind,setCostKind]=useState(''),[cashAccount,setCashAccount]=useState(''),[evidenceRef,setEvidenceRef]=useState('');
 const [lossPolicy,setLossPolicy]=useState(''),[rejectCost,setRejectCost]=useState(''),[lotValues,setLotValues]=useState({});
 const [confirmed,setConfirmed]=useState(false),[zeroLabor,setZeroLabor]=useState(false),[zeroOverhead,setZeroOverhead]=useState(false);
 const [review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 function changed(){setReview(null);setError('');setMessage('');}
 const field=setter=>event=>{setter(event.target.value);changed();};
 async function refresh(){
   setBusy(true);changed();
   try{setInfo(await requestProductionAccounting({action:'inspect-batch',batchId:String(batchId)}));}
   catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function inspect(event){
   event.preventDefault();setBusy(true);changed();
   const input=mode==='cost'?{action:'review-cost',expenseId,amount,costKind,cashAccount,productionConfirmed:confirmed}:
     {action:'review-completion',lossPolicy,rejectCost,allCostsConfirmed:confirmed,zeroLaborConfirmed:zeroLabor,zeroOverheadConfirmed:zeroOverhead,
       lotCosts:(info?.roots||[]).map(x=>({splitId:x.splitId,amount:lotValues[x.splitId]||''}))};
   try{setReview(await requestProductionAccounting({...input,batchId:String(batchId),date,evidenceRef}));}
   catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function post(){
   if(!review?.mayConfirm||!review.reviewToken||busy)return;
   setBusy(true);setError('');
   try{const r=await requestProductionAccounting({action:'confirm',confirmed:true,reviewToken:review.reviewToken});setReview(null);setInfo(null);
     setMessage(r.result?.alreadyProcessed?'Sudah dijurnal; tidak dihitung dua kali.':mode==='cost'?'Biaya produksi dialokasikan. Muat ulang ringkasan untuk melihat sisanya.':'Biaya batch telah dibagi ke lot asal dan reject sesuai bukti. HPP terjual masih menunggu penelusuran penjualan.');}
   catch(e){setError(e.message);setReview(null);}finally{setBusy(false);}
 }
 const s=review?.summary;
 return <section className="mt-5 rounded-xl border bg-white p-5">
   <h3 className="font-semibold">Tenaga kerja, overhead dan biaya hasil produksi — {batchCode}</h3>
   <p className="mt-1 text-sm text-slate-600">Gunakan bukti biaya produksi yang sudah dibayar. Gaji atau overhead yang belum dibayar membutuhkan pencatatan akrual tersendiri. Sisa pembayaran yang belum dialokasikan akan menahan penutupan periode.</p>
   <button type="button" disabled={busy} onClick={refresh} className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50">Muat ringkasan biaya batch</button>
   {info&&<div className="mt-3 rounded bg-slate-50 p-3 text-sm">
     <p>Bahan: <Currency value={info.materialCost} /> · Tenaga kerja: <Currency value={info.laborCost} /> · Overhead: <Currency value={info.overheadCost} /></p>
     <p>Total tercatat: <Currency value={info.totalCost} />. {info.completed?'Biaya batch sudah diselesaikan.':'Periksa kelengkapan seluruh biaya sebelum menyelesaikan batch.'}</p>
     {info.valuedLots?.map(x=><p key={x.splitId}>Lot #{x.splitId} ({x.location==='FROZEN'?'Frozen':'Produk jadi'}): {x.quantity} pcs, nilai <Currency value={x.actualValue} />, sekitar <Currency value={x.unitValue} />/pcs saat pelepasan asal.</p>)}
   </div>}
   {!info?.completed&&<form onSubmit={inspect} className="mt-4 grid gap-3 md:grid-cols-2">
     <fieldset disabled={busy} className="contents">
       <label className="text-sm">Tindakan<select value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false);changed();}} className="mt-1 w-full rounded border p-2">
         <option value="cost">Alokasikan pembayaran biaya produksi</option><option value="completion">Selesaikan biaya batch ke lot asal</option></select></label>
       <label className="text-sm">Tanggal pengakuan<input required type="date" value={date} onChange={field(setDate)} className="mt-1 w-full rounded border p-2" /></label>
       {mode==='cost'?<>
         <label className="text-sm">Bukti pembayaran pengeluaran<select required value={expenseId} onChange={field(setExpenseId)} className="mt-1 w-full rounded border p-2">
           <option value="">Pilih pembayaran di bulan audit</option>{expenses.filter(x=>!x.purchaseId&&x.kategori!=='Bahan Baku').map(x=><option key={x.id} value={String(x.id)}>{x.tanggal} — {x.kategori} — #{x.id} — Rp{Number(x.nominal).toLocaleString('id-ID')}</option>)}
         </select></label>
         <label className="text-sm">Bagian biaya untuk batch ini (Rp)<input required type="number" min="0.01" step="0.01" value={amount} onChange={field(setAmount)} className="mt-1 w-full rounded border p-2" /></label>
         <label className="text-sm">Jenis biaya<select required value={costKind} onChange={field(setCostKind)} className="mt-1 w-full rounded border p-2"><option value="">Pilih jenis</option><option value="LABOR">Tenaga kerja produksi</option><option value="OVERHEAD">Overhead produksi</option></select></label>
         <label className="text-sm">Sumber pembayaran<select required value={cashAccount} onChange={field(setCashAccount)} className="mt-1 w-full rounded border p-2"><option value="">Pilih akun</option><option value="1010">Kas tunai</option><option value="1020">Bank</option></select></label>
       </>:<>
         <p className="text-sm md:col-span-2">Muat ringkasan terlebih dahulu. Isi biaya setiap lot berdasarkan dasar alokasi yang tercantum dalam bukti; jumlah biaya lot dan kerugian reject harus tepat sama dengan biaya batch.</p>
         {info?.roots?.map(x=><label key={x.splitId} className="text-sm">Lot #{x.splitId}, produk #{x.productId} — {x.route==='FROZEN'?'Frozen':'Produk jadi'} ({x.quantity} pcs)<input required type="number" min="0.01" step="0.01" value={lotValues[x.splitId]||''}
           onChange={e=>{setLotValues({...lotValues,[x.splitId]:e.target.value});changed();}} className="mt-1 w-full rounded border p-2" /></label>)}
         <label className="text-sm">Perlakuan reject<select required value={lossPolicy} onChange={field(setLossPolicy)} className="mt-1 w-full rounded border p-2"><option value="">Pilih berdasarkan bukti</option><option value="ABSORB_NORMAL_LOSS">Susut normal diserap produk layak</option><option value="SEPARATE_ABNORMAL_LOSS">Kerusakan abnormal menjadi kerugian</option></select></label>
         <label className="text-sm">Biaya reject terpisah (Rp)<input required type="number" min="0" step="0.01" value={rejectCost} onChange={field(setRejectCost)} className="mt-1 w-full rounded border p-2" /></label>
         <label className="flex gap-2 text-sm"><input type="checkbox" checked={zeroLabor} onChange={e=>{setZeroLabor(e.target.checked);changed();}} />Jika tenaga kerja nol, bukti menjelaskan alasan nilainya nol.</label>
         <label className="flex gap-2 text-sm"><input type="checkbox" checked={zeroOverhead} onChange={e=>{setZeroOverhead(e.target.checked);changed();}} />Jika overhead nol, bukti menjelaskan alasan nilainya nol.</label>
       </>}
       <label className="text-sm md:col-span-2">Referensi bukti dan dasar alokasi<input required minLength={6} maxLength={500} value={evidenceRef} onChange={field(setEvidenceRef)} className="mt-1 w-full rounded border p-2" /></label>
       <label className="flex items-start gap-2 text-sm md:col-span-2"><input required type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);changed();}} />{mode==='cost'?'Seluruh pembayaran sumber adalah biaya produksi, bukan bahan, aset, prive atau biaya periode nonproduksi. Bagian yang dialokasikan sesuai bukti batch.':'Seluruh bahan, tenaga kerja, overhead, hasil produksi dan reject untuk batch ini sudah diperiksa lengkap.'}</label>
       <button disabled={busy||(mode==='completion'&&!info?.roots?.length)} className="justify-self-start rounded bg-slate-700 px-4 py-2 text-white disabled:opacity-50">Periksa sebelum mencatat</button>
     </fieldset>
   </form>}
   {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
   {s&&<div className="mt-4 rounded border bg-slate-50 p-4 text-sm">
     {s.allocationAmount?<><p>Pembayaran sumber <Currency value={s.expenseAmount} />; alokasi batch <Currency value={s.allocationAmount} />.</p><p>Sisa sesudah alokasi <Currency value={s.remainingAfter} />.</p></>:<><p>Total biaya batch <Currency value={s.totalCost} />, kerugian reject <Currency value={s.rejectCost} />.</p>{s.lots?.map(x=><p key={x.splitId}>Lot #{x.splitId}: {x.quantity} pcs — <Currency value={x.actualValue} /> (sekitar <Currency value={x.unitValue} />/pcs pada tahap ini).</p>)}</>}
     {s.blockers?.length>0&&<ul className="mt-2 list-disc pl-5 text-amber-900">{s.blockers.map((x,i)=><li key={i}>{x}</li>)}</ul>}
     {review.mayConfirm&&<button type="button" disabled={busy} onClick={post} className="mt-3 rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50">Konfirmasi jurnal produksi</button>}
   </div>}
 </section>;
}

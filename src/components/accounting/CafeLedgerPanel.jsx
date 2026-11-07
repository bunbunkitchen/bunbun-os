import {useState} from 'react';
import {Link} from 'react-router-dom';
import {requestCafeLedger} from '../../services/accountingCafeLedgerService';
const box='border rounded-lg px-3 py-2 w-full bg-white';
const button='rounded-lg bg-[#595e47] text-white px-4 py-2 disabled:opacity-50';
export default function CafeLedgerPanel({report,initialStatus,onComplete}){
 const [mode,setMode]=useState(''),[saleDate,setSaleDate]=useState(''),[ids,setIds]=useState([]),[evidence,setEvidence]=useState(report.input.evidenceRef),[cash,setCash]=useState(''),[sold,setSold]=useState(false),[review,setReview]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const status=initialStatus;
 const change=fn=>{fn();setReview(null);setMessage('');};
 const run=async fn=>{setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message);}finally{setBusy(false);}};
 return <section className="bg-white rounded-xl p-5 space-y-4">
  <h2 className="font-bold text-xl">Jurnal dari Laporan Kafe</h2>
  <p>Pendapatan dicatat dari produk yang benar-benar terjual. Kiriman tetap menjadi stok titipan sampai terjual. Setoran hanya melunasi piutang, tanpa mencatat pendapatan kedua kali.</p>
  {!status?<p>Pemeriksaan jurnal belum tersedia. Muat ulang laporan sebelum mengubah atau menjurnalnya.</p>:<>
   {message&&<p role="status" className="p-3 rounded-lg bg-amber-50">{message}</p>}
   <label>Bukti pengakuan penjualan / setoran<input className={box} value={evidence} onChange={e=>change(()=>setEvidence(e.target.value))} /></label>
   {status.imported?<div className="p-4 bg-green-50 rounded-lg"><p>Pendapatan laporan sudah tertaut ke penjualan #{status.import.saleIds.join(', #')}.</p><p>Koreksi laporan ini memerlukan koreksi akuntansi. Status HPP masing-masing penjualan: {status.candidates.map(s=>`#${s.id}: ${s.cogsStatus==='POSTED'?'sudah dijurnal':'menunggu biaya lot aktual'}`).join('; ')}.</p><Link className="underline" to="/finance/hpp-audit">Periksa dan alokasikan biaya lot aktual</Link></div>:<fieldset disabled={busy} className="space-y-3">
    <label>Cara menghubungkan penjualan<select className={box} value={mode} onChange={e=>change(()=>{setMode(e.target.value);setIds([]);})}><option value="">Pilih cara</option><option value="CREATE">Bentuk penjualan aktual dari laporan ini</option><option value="LINK">Cocokkan dengan penjualan yang sudah dijurnal</option></select></label>
    <label>Tanggal pengakuan penjualan bulanan (akhir bulan untuk penjualan baru)<input type="date" min={`${report.input.month}-01`} max={new Date(Date.UTC(Number(report.input.month.slice(0,4)),Number(report.input.month.slice(5)),0)).toISOString().slice(0,10)} className={box} value={saleDate} onChange={e=>change(()=>setSaleDate(e.target.value))} /></label>
    {!!status.candidates.length&&<div><p>Sudah ada penjualan bulan ini. Semua jumlah produk dan hak bersihnya harus cocok dengan laporan; jumlah kiriman tidak boleh dianggap jumlah terjual.</p>{status.candidates.map(s=><label key={s.id} className="block p-2 border rounded-lg"><input type="checkbox" disabled={mode!=='LINK'} checked={ids.includes(s.id)} onChange={e=>change(()=>setIds(e.target.checked?[...ids,s.id]:ids.filter(x=>x!==s.id)))} /> #{s.id} · {s.date} · hak bersih {s.net===null?'belum dijurnal':`Rp${s.net}`}</label>)}</div>}
    <label className="block"><input type="checkbox" checked={sold} onChange={e=>change(()=>setSold(e.target.checked))} /> Jumlah ini adalah barang yang benar-benar terjual dan hak bersih Bunbun, sesuai laporan kafe.</label>
    <button className={button} disabled={!mode||!sold||!saleDate} onClick={()=>run(async()=>setReview({...await requestCafeLedger({action:'review_import',reportId:report.id,mode,saleDate,existingSaleIds:ids,actualSoldConfirmed:sold,evidenceRef:evidence}),kind:'import'}))}>Periksa jurnal penjualan</button>
   </fieldset>}
   <div className="space-y-3 border-t pt-4"><h3 className="font-bold">Pelunasan dari setoran aktual</h3><p>Semua bagian satu setoran harus sudah tertaut ke penjualan yang benar sebelum dijurnal. Jika satu laporan memakai beberapa faktur lama, alokasikan setoran melalui pemeriksaan sumber keuangan.</p>
    <label>Akun penerimaan<select className={box} value={cash} onChange={e=>change(()=>setCash(e.target.value))}><option value="">Pilih sesuai penerimaan sebenarnya</option><option value="1020">Bank</option><option value="1010">Kas</option></select></label>
    {status.receiptStatus.map(r=><div key={r.incomeId} className="flex gap-3 items-center flex-wrap"><p className="grow">Setoran #{r.incomeId} · bagian laporan ini Rp{r.amount} · {r.verified?'alokasi sudah diverifikasi':r.posted?'sudah ada jurnal; alokasi perlu dicocokkan':'belum dijurnal'}</p><button className={button} disabled={busy||!cash||r.verified} onClick={()=>run(async()=>setReview({...await requestCafeLedger({action:'review_receipt',reportId:report.id,incomeId:r.incomeId,cashAccount:cash,evidenceRef:evidence}),kind:'receipt'}))}>Periksa pelunasan</button></div>)}
   </div>
   {review&&<div className="p-4 rounded-lg bg-amber-50 space-y-3"><h3 className="font-bold">Pemeriksaan sebelum posting</h3><p>{review.kind==='import'?(mode==='LINK'?'Cocokkan jurnal penjualan yang sudah ada':'Debit Piutang Kafe · Kredit Pendapatan Bersih'):`Debit ${cash==='1020'?'Bank':'Kas'} · Kredit Piutang Kafe`}: Rp{review.summary.netEntitlement}.</p>
    {!!review.summary.allocations?.length&&<ul className="list-disc pl-5">{review.summary.allocations.map(a=><li key={a.saleId}>Pelunasan penjualan #{a.saleId}: Rp{a.amount}</li>)}</ul>}
    <p>Posting mengunci sumber laporan. HPP lot aktual dan waste kafe tetap perlu diselesaikan sebelum laba final.</p>
    <button disabled={busy} className={button} onClick={()=>run(async()=>{await requestCafeLedger({action:'confirm',reviewToken:review.reviewToken,confirmed:true});setReview(null);await onComplete();setMessage('Jurnal berhasil dicatat atau dicocokkan dengan jurnal yang sudah ada.');})}>Konfirmasi posting / pencocokan</button>
   </div>}
  </>}
 </section>;
}

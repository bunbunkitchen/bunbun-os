import { useEffect, useState } from 'react';
import Currency from '../ui/Currency';
import { requestRevenueAccounting } from '../../services/accountingRevenueService';

const channels = { PUBLIC_HUB: 'Public Hub', PUBLIC_COFFEE: 'The Public Coffee', DIRECT: 'Direct / Online', CAFE_OTHER: 'Kafe lain' };
export default function RevenueAccountingPanel({ kind, sources, onPosted }) {
  const isSale = kind === 'sale';
  const [sourceId, setSourceId] = useState('');
  const [basis, setBasis] = useState('');
  const [net, setNet] = useState('');
  const [cash, setCash] = useState('');
  const [evidence, setEvidence] = useState('');
  const [verified, setVerified] = useState(false);
  const [allocations, setAllocations] = useState({});
  const [receivables, setReceivables] = useState([]);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (isSale) return;
    let active = true;
    requestRevenueAccounting({ action: 'receivables' }).then(x => { if (active) setReceivables(x.receivables || []); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [isSale]);
  function changed() { setReview(null); setError(''); setMessage(''); }
  async function refreshReceivables() {
    setBusy(true); changed();
    try { setReceivables((await requestRevenueAccounting({ action: 'receivables' })).receivables || []); setAllocations({}); setVerified(false); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  const field = setter => event => { setter(event.target.value); changed(); };
  async function inspect(event) {
    event.preventDefault(); setBusy(true); setReview(null); setError(''); setMessage('');
    try {
      const input = isSale ? { action: 'review-sale', saleId: sourceId, recordedBasis: basis,
        netEntitlement: net, soldConfirmed: verified, evidenceRef: evidence } :
        { action: 'review-income', incomeId: sourceId, cashAccount: cash, allocationConfirmed: verified, evidenceRef: evidence,
          allocations: Object.entries(allocations).filter(([,amount]) => amount.trim() && Number(amount) > 0).map(([saleId,amount]) => ({ saleId,amount })) };
      setReview(await requestRevenueAccounting(input));
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!review?.mayConfirm || !review.reviewToken || busy) return;
    setBusy(true); setError('');
    try {
      const result = await requestRevenueAccounting({ action: 'confirm', reviewToken: review.reviewToken, confirmed: true });
      setReview(null); setAllocations({}); setVerified(false);
      setMessage(result.result?.alreadyProcessed ? 'Transaksi sudah dijurnal; tidak dicatat dua kali.' :
        isSale ? 'Pendapatan dan piutang hak Bunbun berhasil dicatat. HPP terjual masih menunggu valuasi.' : 'Setoran berhasil dicatat sebagai pelunasan piutang.');
      try {
        if (!isSale) setReceivables((await requestRevenueAccounting({ action: 'receivables' })).receivables || []);
        await onPosted?.();
      } catch { setMessage('Jurnal berhasil dicatat. Muat ulang halaman untuk melihat status terbaru.'); }
    } catch(e) { setError(e.message); setReview(null); } finally { setBusy(false); }
  }
  const selected = sources.find(x => String(x.id) === sourceId);
  const summary = review?.summary;
  return <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold text-slate-800">{isSale ? 'Akuntansi penjualan' : 'Pencocokan setoran dan piutang'}</h2>
    <p className="mt-1 text-sm text-slate-600">{isSale ? 'Konfirmasi produk sudah terjual dan nilai hak Bunbun. Pengiriman barang ke kafe belum merupakan penjualan.' :
      'Alokasikan uang bersih yang diterima ke penjualan yang sudah dijurnal. Setoran melunasi piutang, tanpa mencatat pendapatan kedua.'}</p>
    <form onSubmit={inspect} className="mt-4 grid gap-3 md:grid-cols-2">
      <fieldset disabled={busy} className="contents">
        <label className="text-sm">{isSale ? 'Penjualan' : 'Setoran aktual'}
          <select required value={sourceId} onChange={e => { setSourceId(e.target.value); setVerified(false); setAllocations({}); setNet(''); changed(); }} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih transaksi</option>
            {sources.map(x => <option key={x.id} value={String(x.id)}>{isSale ? `${x.saleDate} — ${channels[x.salesChannel] || x.salesChannel}` : `${x.tanggal} — ${x.asalSetoran}`} — #{x.id}</option>)}
          </select>
        </label>
        {isSale ? <><label className="text-sm">Dasar nominal penjualan yang tercatat
          <select required value={basis} onChange={field(setBasis)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih berdasarkan bukti</option><option value="NET_BUNBUN">Sudah sebesar hak bersih Bunbun</option><option value="GROSS_CAFE">Masih omzet bruto kafe</option>
          </select>
        </label><label className="text-sm">Hak pendapatan Bunbun yang dikonfirmasi (Rp)
          <input required type="number" min="0.01" step="0.01" value={net} onChange={field(setNet)} className="mt-1 w-full rounded border p-2" />
        </label></> : <label className="text-sm">Uang diterima di
          <select required value={cash} onChange={field(setCash)} className="mt-1 w-full rounded border p-2">
            <option value="">Pilih kas atau bank</option><option value="1010">Kas tunai</option><option value="1020">Bank</option>
          </select>
        </label>}
        <label className="text-sm">Referensi bukti yang diperiksa
          <input required minLength={6} maxLength={500} value={evidence} onChange={field(setEvidence)} className="mt-1 w-full rounded border p-2" />
        </label>
        {selected && <p className="text-sm md:col-span-2">{isSale ? 'Nominal penjualan tercatat' : 'Setoran bersih tercatat'}: <Currency value={isSale ? selected.totalAmount : selected.pemasukanBunbun} />.</p>}
        {!isSale && <div className="overflow-x-auto md:col-span-2">
          <button type="button" disabled={busy} onClick={refreshReceivables} className="mb-2 rounded border px-3 py-1 disabled:opacity-50">Muat ulang piutang</button>
          <table className="w-full text-left text-sm"><thead><tr><th className="p-2">Penjualan</th><th className="p-2">Sisa piutang</th><th className="p-2">Dialokasikan dari setoran ini (Rp)</th></tr></thead>
            <tbody>{receivables.filter(x => Number(x.outstanding) > 0).map(x => <tr key={x.saleId} className="border-t">
              <td className="p-2">#{x.saleId} — {x.date}<br />{channels[x.channel] || x.channel}</td>
              <td className="p-2"><Currency value={x.outstanding} /></td>
              <td className="p-2"><input aria-label={`Alokasi penjualan ${x.saleId}`} type="number" min="0" step="0.01" value={allocations[x.saleId] || ''}
                onChange={e => { setAllocations(v => ({ ...v,[x.saleId]:e.target.value })); changed(); }} className="w-full rounded border p-2" /></td>
            </tr>)}</tbody></table>
          {!receivables.some(x => Number(x.outstanding) > 0) && <p className="mt-2 text-slate-600">Belum ada piutang tersisa dari penjualan yang sudah dijurnal.</p>}
          <p className="mt-2">Total alokasi: <Currency value={Object.values(allocations).reduce((sum,x) => sum + (Number(x) || 0),0)} />.</p>
        </div>}
        <label className="flex items-start gap-2 text-sm md:col-span-2"><input required type="checkbox" checked={verified} onChange={e => { setVerified(e.target.checked); changed(); }} />
          {isSale ? 'Saya sudah memeriksa bahwa produk benar-benar terjual dan nominal di atas adalah hak Bunbun.' :
            'Saya sudah memeriksa penerimaan uang dan penjualan yang dilunasi oleh setoran ini.'}
        </label>
        <button disabled={busy} className="justify-self-start rounded bg-slate-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Memproses…' : 'Periksa sebelum mencatat'}</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    {summary && <div className="mt-4 rounded border bg-slate-50 p-4 text-sm">
      {isSale ? <><p>Penjualan #{summary.saleId}: tercatat <Currency value={summary.recordedTotal} />, hak Bunbun <Currency value={summary.netEntitlement} />.</p>
        <p className="mt-2 text-amber-800">HPP produk terjual belum divaluasi. Nilai ini belum menjadi laba final.</p></> :
        <><p>Setoran #{summary.incomeId}: <Currency value={summary.netReceipt} /> diterima di {summary.cashAccount === '1010' ? 'kas tunai' : 'bank'}.</p>
          <ul className="mt-2">{summary.allocations.map(x => <li key={x.saleId}>Penjualan #{x.saleId} — {channels[x.channel] || x.channel}: <Currency value={x.amount} /></li>)}</ul></>}
      <p className="mt-2">Bukti: {summary.evidenceRef}. Pemeriksaan berlaku lima menit.</p>
      {review.mayConfirm ? <button type="button" disabled={busy} onClick={confirm} className="mt-3 rounded bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-50">Konfirmasi dan catat jurnal</button>
        : <p role="status" className="mt-3 text-amber-800">Jurnal belum dapat dicatat: saldo awal belum disahkan atau periode belum dibuka.</p>}
    </div>}
  </section>;
}

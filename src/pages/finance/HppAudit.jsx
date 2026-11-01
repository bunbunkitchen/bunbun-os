import { useEffect, useState } from "react";
import { getMonthlyHppAudit } from "../../services/hppAuditService";
import { getBatchCostingSnapshot } from "../../services/batchCostingReadService";

const rupiah = n => Number(n || 0).toLocaleString("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
});
function currentMonthWib() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit"
  }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}`;
}
export default function HppAudit() {
  const [month, setMonth] = useState(currentMonthWib);
  const [audit, setAudit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batchInfo, setBatchInfo] = useState(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setAudit(null);
    setError("");
    getMonthlyHppAudit(month)
      .then(value => { if (!cancelled) setAudit(value); })
      .catch(err => { if (!cancelled) setError(err.message || "Audit gagal dimuat."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [month]);

  async function inspectBatch(event) {
    event.preventDefault();
    setBatchBusy(true);
    setBatchError("");
    setBatchInfo(null);
    try { setBatchInfo(await getBatchCostingSnapshot(batchId)); }
    catch (err) { setBatchError(err.message || "Gagal memuat batch."); }
    finally { setBatchBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#595E48]">Audit Biaya HPP</h1>
        <p className="mt-1 text-sm text-[#777A6D]">Pemeriksaan read-only biaya bulanan dan batch produksi.</p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Belum menjadi HPP aktual.</strong> Pengeluaran kas berbeda dari biaya produksi.
        Gaji, gas, kemasan, perlengkapan, dan aset perlu diklasifikasikan serta direkonsiliasi dahulu.
        Halaman ini tidak menyimpan atau mengubah transaksi.
      </div>
      <div className="rounded-xl border border-[#D9D8D0] bg-white p-5">
        <label htmlFor="audit-month" className="mr-3 text-sm font-semibold">Bulan</label>
        <input id="audit-month" type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="rounded-lg border border-[#D9D8D0] px-3 py-2" />
      </div>
      {busy && <p>Memuat data...</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {audit && !busy && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm text-[#777A6D]">Total pengeluaran kas</p>
              <p className="text-xl font-bold">{rupiah(audit.expensesReview.totalPaid)}</p>
              <p className="text-xs">Bukan biaya HPP yang disetujui</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm text-[#777A6D]">Batch dibuat bulan ini</p>
              <p className="text-xl font-bold">{audit.batches.count}</p>
              <p className="text-xs">Berdasarkan waktu dibuat (WIB)</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-sm text-[#777A6D]">Kolom selesai (pcs)</p>
              <p className="text-xl font-bold">{audit.batches.completedUnitsField.toLocaleString("id-ID")}</p>
              <p className="text-xs">Belum direkonsiliasi terhadap split/frozen</p>
            </div>
          </div>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">Ringkasan kategori pengeluaran</h2>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="py-2">Kategori kas</th><th className="text-right">Transaksi</th>
                <th className="text-right">Nominal</th>
              </tr></thead>
              <tbody>{audit.expensesReview.categories.map(row => (
                <tr key={row.kategori} className="border-b">
                  <td className="py-2">{row.kategori}</td>
                  <td className="text-right">{row.jumlahTransaksi}</td>
                  <td className="text-right">{rupiah(row.nominal)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">Rincian untuk rekonsiliasi</h2>
            <div className="max-h-[400px] overflow-auto"><table className="w-full min-w-[600px] text-sm">
              <thead><tr className="border-b text-left">
                <th className="py-2">Tanggal</th><th>Kategori</th><th>Keterangan</th>
                <th className="text-right">Nominal</th><th className="pl-3">Sumber</th>
              </tr></thead>
              <tbody>{audit.expensesReview.rows.map(row => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-2">{row.tanggal}</td>
                  <td className="pr-2">{row.kategori}</td>
                  <td className="pr-2">{row.keterangan || "-"}
                    {row.warning && <p className="text-amber-700">{row.warning}</p>}
                  </td>
                  <td className="text-right">{rupiah(row.nominal)}</td>
                  <td className="pl-3">{row.purchaseId ? `Pembelian #${row.purchaseId}` : "Kas langsung"}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <p className="mt-2 text-xs text-[#777A6D]">
              Semua pengeluaran belum diklasifikasikan menjadi biaya akrual. Pembelian tidak dijumlahkan ulang.
            </p>
          </section>
        </>
      )}
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Pemeriksaan batch</h2>
        <p className="mt-1 text-sm">Periksa baris bahan yang belum mempunyai nilai persediaan dan jumlah split.</p>
        <form onSubmit={inspectBatch} className="mt-3 flex gap-2">
          <input aria-label="ID batch" type="number" min="1" step="1" required
            value={batchId} onChange={e => setBatchId(e.target.value)}
            className="w-36 rounded-lg border px-3 py-2" placeholder="ID batch" />
          <button type="submit" disabled={batchBusy}
            className="rounded-lg bg-[#595E48] px-4 py-2 text-white disabled:opacity-50">
            {batchBusy ? "Memeriksa..." : "Periksa"}
          </button>
        </form>
        {batchError && <p role="alert" className="mt-2 text-red-700">{batchError}</p>}
        {batchInfo && <div className="mt-3 rounded-lg bg-[#F1F3ED] p-4 text-sm">
          <p className="font-bold">{batchInfo.batch.kode}</p>
          <p>Pemakaian bahan: {batchInfo.materials.length} baris</p>
          <p>Bahan belum bernilai: {batchInfo.missingMaterialValues.length} baris</p>
          <p>Split: {batchInfo.splits.length} baris</p>
          <p>Status audit: {batchInfo.costingStatus} (bukan HPP final)</p>
        </div>}
      </section>
    </div>
  );
}

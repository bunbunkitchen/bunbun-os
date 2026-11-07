import { useState } from "react";
import { loadAccountingSourceReadiness } from "../../services/accountingSourceReadinessService";
import { validReportMonth } from "../../utils/accountingSourceReadiness";

const rupiah = value => value == null
  ? "Tidak tersedia (ada nominal tidak valid)"
  : Number(value).toLocaleString("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  });

const viewCount = value => Number(value || 0).toLocaleString("id-ID");

function AuditMetric({ title, count, amount, note }) {
  return (
    <div className="rounded-xl border border-[#D9D8D0] bg-white p-4">
      <p className="text-sm font-semibold text-[#595E48]">{title}</p>
      <p className="mt-2 text-2xl font-bold">{viewCount(count)} <span className="text-xs font-normal">catatan</span></p>
      <p className="mt-1 text-lg font-semibold text-[#3F4335]">{rupiah(amount)}</p>
      <p className="mt-2 text-xs text-[#777A6D]">{note}</p>
    </div>
  );
}

function Breakdown({ heading, rows }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{heading}</h3>
      {rows?.length ? (
        <div className="mt-2 divide-y rounded-lg border text-sm">
          {rows.map(item => (
            <div key={item.name} className="flex items-start justify-between gap-3 px-3 py-2">
              <span>{item.name}</span><span className="font-semibold">{viewCount(item.count)}</span>
            </div>
          ))}
        </div>
      ) : <p className="mt-2 text-sm text-[#777A6D]">Tidak ada catatan.</p>}
    </div>
  );
}

function downloadAudit(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = "bunbun-audit-sumber-keuangan-" + payload.month + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default function AccountingSourceReadiness() {
  const [month, setMonth] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleAudit(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!validReportMonth(month)) {
      setError("Bulan audit tidak valid.");
      return;
    }
    setBusy(true);
    try {
      const audit = await loadAccountingSourceReadiness(month);
      setResult(audit);
    } catch (reason) {
      setError(reason?.message || "Audit tidak dapat diselesaikan.");
    } finally {
      setBusy(false);
    }
  }

  const data = result?.categories;
  return (
    <div className="space-y-5 pb-12">
      <header>
        <h1 className="text-2xl font-bold text-[#595E48]">Audit Sumber Keuangan</h1>
        <p className="mt-1 text-sm text-[#777A6D]">
          Peta transaksi yang sudah tercatat sebelum kita membuat laba rugi aktual.
          Khusus Owner dan hanya membaca database.
        </p>
      </header>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Audit historis, bukan laporan laba rugi.</strong> Total Sales, setoran kafe, pengeluaran dan
        Purchasing adalah sumber yang berbeda. Jangan dijumlahkan atau dibandingkan langsung untuk
        menetapkan keuntungan. Laporan bonus dan ekspansi tetap menunggu saldo awal serta HPP tervalidasi.
      </div>
      <form onSubmit={handleAudit} className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Bulan transaksi</span>
          <input type="month" required value={month} onChange={event => {
            setMonth(event.target.value); setResult(null); setError("");
          }} className="rounded-lg border px-3 py-2" />
        </label>
        <button disabled={busy || !month} type="submit"
          className="rounded-lg bg-[#595E48] px-4 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? "Memeriksa..." : "Periksa sumber transaksi"}
        </button>
        {result && <button type="button" onClick={() => downloadAudit(result)}
          className="rounded-lg border px-4 py-2 font-semibold">
          Unduh hasil audit JSON
        </button>}
        {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
      </form>
      {result && data && (
        <>
          <p className="text-sm font-medium">
            Periode {result.month} — <strong>Belum siap untuk laporan laba aktual</strong>.
            Tidak ada transaksi yang diubah selama audit.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AuditMetric title="Penjualan di OS" count={data.sales.count}
              amount={data.sales.recordedAmount} note={data.sales.interpretation}/>
            <AuditMetric title="Setoran diterima di OS" count={data.cafeDeposits.count}
              amount={data.cafeDeposits.recordedAmount} note={data.cafeDeposits.interpretation}/>
            <AuditMetric title="Pengeluaran di OS" count={data.expenses.count}
              amount={data.expenses.recordedAmount} note={data.expenses.interpretation}/>
            <AuditMetric title="Pembelian di OS" count={data.purchases.count}
              amount={data.purchases.recordedAmount} note={data.purchases.interpretation}/>
          </div>
          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="text-lg font-semibold">Rincian pencatatan keuangan</h2>
              <Breakdown heading="Channel Sales" rows={data.sales.byChannel}/>
              <Breakdown heading="Asal setoran" rows={data.cafeDeposits.bySource}/>
              <Breakdown heading="Kategori pengeluaran" rows={data.expenses.byCategory}/>
              <p className="text-sm text-[#777A6D]">
                Pengeluaran tertaut Purchasing: <strong>{viewCount(data.expenses.linkedPurchases)}</strong>.
                Pengeluaran yang tidak tertaut Purchasing: <strong>{viewCount(data.expenses.unlinkedPurchases)}</strong>.
                Tautan ke Purchasing yang tidak ditemukan dalam bulan ini:
                {" "}<strong>{viewCount(data.expenses.purchaseReferenceOutsideSelectedMonth)}</strong>
                {" "}(bisa berasal dari bulan lain).
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="text-lg font-semibold">Kaitan dengan stok produksi</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[#777A6D]">Mutasi CAFE_OUT</p>
                  <p className="text-2xl font-bold">{viewCount(data.productStock.cafeOutRows)}</p>
                  <p className="text-xs">Total unit terinput: {data.productStock.cafeOutQty == null
                    ? "perlu verifikasi" : viewCount(data.productStock.cafeOutQty)}</p>
                </div>
                <div>
                  <p className="text-[#777A6D]">CAFE_OUT tanpa ID Sale</p>
                  <p className="text-2xl font-bold">{viewCount(data.productStock.cafeOutWithoutSaleId)}</p>
                </div>
                <div>
                  <p className="text-[#777A6D]">Pemakaian bahan produksi</p>
                  <p className="text-2xl font-bold">{viewCount(data.ingredientStock.productionUseRows)}</p>
                </div>
                <div>
                  <p className="text-[#777A6D]">Tanpa nilai unit HPP valid</p>
                  <p className="text-2xl font-bold">{viewCount(data.ingredientStock.productionUseWithoutVerifiedUnitValue)}</p>
                </div>
              </div>
              <p className="text-sm text-[#777A6D]">
                {data.productStock.interpretation} {data.ingredientStock.interpretation}
                Mutasi stok produk yang berupa adjustment/opening:
                {" "}<strong>{viewCount(data.productStock.adjustmentRows)}</strong>.
              </p>
            </div>
          </section>
          <section className="rounded-xl border border-amber-200 bg-white p-4">
            <h2 className="text-lg font-semibold">Hal yang perlu ditelusuri</h2>
            {result.issues.length ? (
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                {result.issues.map((message, i) => <li key={i}>{message}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm">Tidak ditemukan anomali dasar dalam sumber yang terbaca.</p>
            )}
            <h3 className="mt-4 font-semibold">Sebelum laporan laba bisa diaktifkan</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {result.requiredVerifications.map((message, i) => <li key={i}>{message}</li>)}
            </ol>
          </section>
          <p className="text-xs text-[#777A6D]">
            Audit ini tidak menciptakan jurnal, setoran, stok baru, atau nilai HPP.
            Tanggal transaksi membatasi data setiap tabel; transaksi tertaut boleh berada di bulan lain.
            Verifikasi bukti tetap diperlukan.
          </p>
        </>
      )}
    </div>
  );
}

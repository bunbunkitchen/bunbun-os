import { useEffect, useMemo, useState } from "react";
import { loadMonthlySaleStockLinkAudit } from "../../services/accountingSaleStockAuditService";

function wibMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return parts.find(p => p.type === "year").value + "-" +
    parts.find(p => p.type === "month").value;
}
const number = value => Number(value ?? 0).toLocaleString("id-ID");

function CountCard({ label, value, note }) {
  return (
    <div className="rounded-xl border border-[#E0E2D8] bg-white p-4">
      <p className="text-sm text-[#606C5C]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#414D3D]">{number(value)}</p>
      <p className="mt-2 text-xs text-[#777C73]">{note}</p>
    </div>
  );
}

export default function SaleLotTraceAudit() {
  const [month, setMonth] = useState(wibMonth);
  const [fetchState, setFetchState] = useState({
    month: "", data: null, error: "",
  });
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadMonthlySaleStockLinkAudit(month)
      .then(data => {
        if (!cancelled) setFetchState({ month, data, error: "" });
      })
      .catch(error => {
        if (!cancelled) setFetchState({
          month, data: null,
          error: error?.message || "Audit tidak dapat dimuat.",
        });
      });
    return () => { cancelled = true; };
  }, [month]);

  const loading = fetchState.month !== month;
  const audit = loading ? null : fetchState.data;
  const error = loading ? "" : fetchState.error;
  const visible = useMemo(() => {
    const rows = audit?.sales || [];
    const filtered = rows.filter(row =>
      (showAll || !row.qtyMatched) &&
      (!search.trim() || row.saleId.includes(search.trim())));
    return filtered.slice(0, 100);
  }, [audit, showAll, search]);

  return (
    <div className="space-y-5 pb-12">
      <header>
        <h1 className="text-2xl font-bold text-[#59674F]">Audit Penjualan & Lot</h1>
        <p className="mt-1 text-sm text-[#777B71]">
          Pencocokan ID penjualan, daftar produk terjual, dan mutasi stok terkait.
          Pemeriksaan Owner ini hanya membaca data lama.
        </p>
      </header>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Belum menunjukkan HPP atau keuntungan aktual.</strong> Kecocokan
        penjualan dan CAFE_OUT hanya membuktikan hubungan pencatatan jumlah produk,
        bukan bukti barang benar-benar terjual, kafe sudah membayar, atau asal lot produksi.
        Mutasi penjualan lama belum memiliki batch_split_id.
      </section>
      <label className="inline-flex flex-col gap-1 text-sm font-semibold">
        Bulan penjualan
        <input type="month" value={month} max={wibMonth()}
          onChange={event => {
            if (event.target.value) {
              setMonth(event.target.value);
              setSearch("");
              setShowAll(false);
            }
          }}
          className="rounded-lg border bg-white px-3 py-2 font-normal"/>
      </label>
      {loading && <p className="rounded-lg border bg-white p-4 text-sm">
        Membaca semua baris transaksi dan mutasi stok...
      </p>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Audit gagal: {error}. Tidak ada laporan parsial yang dianggap lengkap.
      </div>}
      {audit && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CountCard label="Transaksi penjualan" value={audit.summary.saleCount}
            note="Semua channel pada bulan terpilih."/>
          <CountCard label="Penjualan cocok dengan stok" value={audit.summary.matchedSaleCount}
            note="Hanya kecocokan ID, produk, jumlah, tanggal dan subtotal."/>
          <CountCard label="Penjualan perlu ditelusuri" value={audit.summary.needsReviewSaleCount}
            note="Tidak diperbaiki otomatis."/>
          <CountCard label="Stok keluar tanpa ID penjualan" value={audit.summary.orphanMovementCount}
            note="CAFE_OUT tanpa sale_id pada bulan yang dipilih."/>
        </div>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold text-[#4F5D4A]">Jejak transaksi yang berhasil ditemukan</h2>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-[#777B71]">Baris produk penjualan</p>
              <p className="text-xl font-bold">{number(audit.summary.itemCount)}</p>
            </div>
            <div>
              <p className="text-[#777B71]">Mutasi stok tertaut penjualan</p>
              <p className="text-xl font-bold">{number(audit.summary.linkedMovementCount)}</p>
            </div>
            <div>
              <p className="text-[#777B71]">Stok titipan keluar tanpa sale_id (pcs)</p>
              <p className="text-xl font-bold">{number(audit.summary.orphanUnitCount)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-amber-900">
            Lot asal terverifikasi: <strong>belum tersedia</strong>. HPP aktual:
            {" "}<strong>belum tersedia</strong>. Tidak ada potongan persentase kafe,
            perubahan stok, atau jurnal yang dilakukan audit ini.
          </p>
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold text-[#4F5D4A]">Penelusuran per nomor penjualan</h2>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input type="search" value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cari ID penjualan..."
              className="w-48 rounded-lg border px-3 py-2 text-sm"/>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAll}
                onChange={event => setShowAll(event.target.checked)}/>
              Tampilkan yang cocok juga
            </label>
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="min-w-[620px] w-full text-left text-sm">
              <thead><tr className="border-b text-[#747A70]">
                <th className="py-2">Sales</th>
                <th>Tanggal</th>
                <th>Channel</th>
                <th>Qty item</th>
                <th>Qty stok</th>
                <th>Status</th>
              </tr></thead>
              <tbody>{visible.map(row =>
                <tr key={row.saleId} className="border-b align-top">
                  <td className="py-3 font-semibold">#{row.saleId}</td>
                  <td>{row.saleDate}</td>
                  <td>{row.salesChannel}</td>
                  <td>{number(row.products.reduce((sum,p) => sum+p.soldUnits,0))}</td>
                  <td>{number(row.products.reduce((sum,p) => sum+p.movedUnits,0))}</td>
                  <td className="max-w-[380px]">
                    <span className={row.qtyMatched ? "text-[#526E4B]" : "font-medium text-amber-900"}>
                      {row.qtyMatched ? "Catatan stok cocok" : "Perlu verifikasi"}
                    </span>
                    {row.issues.map((p,i) =>
                      <p key={i} className="mt-1 text-xs text-amber-800">{p.message}</p>)}
                  </td>
                </tr>
              )}</tbody>
            </table>
            {!visible.length && <p className="py-5 text-center text-sm text-[#777C73]">
              Tidak ada transaksi yang memenuhi filter.
            </p>}
          </div>
          <p className="mt-2 text-xs text-[#777C73]">
            Maksimum 100 transaksi ditampilkan sekaligus di tabel agar cepat dibaca;
            seluruh baris bulan terpilih tetap diperiksa di ringkasan.
          </p>
        </section>
        <section className="rounded-xl border border-[#E0E2D8] bg-white p-4 text-sm">
          <h2 className="font-semibold text-[#4F5D4A]">Agar benar-benar menjadi HPP aktual</h2>
          <p className="mt-2">
            Lot produksi harus ditautkan secara sah ke stok keluar dan rincian penjualan,
            nilai biaya batch harus disahkan, dan setoran kafe direkonsiliasi ke piutang.
            Halaman ini mengidentifikasi celah pencatatan, bukan mengisi lot atau harga
            yang belum terbukti dengan asumsi.
          </p>
        </section>
      </>}
    </div>
  );
}

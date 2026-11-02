import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MdAssessment, MdShowChart, MdLockOutline, MdSavings, MdRefresh } from "react-icons/md";
import FinancialTrendChart from "../../components/accounting/FinancialTrendChart";
import { loadOwnerFinancialDashboard } from "../../services/accountingBusinessHealthService";
import {
  buildBusinessHealthView, chartMonths, makeIllustrativeBusinessRecords,
} from "../../utils/accountingBusinessHealth";

const rupiah = value => typeof value !== "number" || !Number.isFinite(value)
  ? "Belum tersedia"
  : value.toLocaleString("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  });
const percent = value => value == null || !Number.isFinite(value)
  ? "—"
  : value.toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";

function currentWibMonth() {
  const pieces = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return pieces.find(part => part.type === "year").value + "-" +
    pieces.find(part => part.type === "month").value;
}

function Metric({ title, value, hint, subtle = false }) {
  return (
    <div className={
      "rounded-xl border p-4 " +
      (subtle ? "border-[#D9E0D7] bg-[#F1F3ED]" : "border-[#E4E2DC] bg-white")
    }>
      <p className="text-xs font-semibold text-[#656B60]">{title}</p>
      <p className="mt-2 break-words text-xl font-bold tracking-tight text-[#3F4335] sm:text-2xl">
        {value}
      </p>
      <p className="mt-2 text-xs text-[#777A6D]">{hint}</p>
    </div>
  );
}

function MoneyLine({ title, value, emphasize = false, negative = false }) {
  return (
    <div className={
      "flex flex-wrap items-center justify-between gap-2 border-b border-[#EEECE7] py-2.5 text-sm " +
      (emphasize ? "font-bold text-[#414B3F]" : "text-[#5D6257]")
    }>
      <span>{title}</span>
      <span className={negative ? "font-semibold text-[#9D6455]" : "font-semibold"}>
        {negative ? "− " : ""}{rupiah(value)}
      </span>
    </div>
  );
}

function CsvExport({ report, demo }) {
  function handleDownload() {
    const v = report.values;
    const source = demo ? "CONTOH SIMULASI - BUKAN DATA AKTUAL" :
      "STAGING POSTED LEDGER - SUMBER BELUM DIAUDIT";
    const lines = [
      ["Sumber", source],
      ["Bulan", report.month],
      ["Status periode", report.periodStatus],
      ["Tanggal cutover", report.cutoverDate],
      ["Pendapatan hak Bunbun", v.revenue],
      ["HPP produk terjual", v.cogs],
      ["Laba kotor", v.grossProfit],
      ["Beban operasional", v.expenses],
      ["Laba bersih", v.netProfit],
      ["Margin kotor (%)", report.grossMarginPct ?? ""],
      ["Margin bersih (%)", report.netMarginPct ?? ""],
      ["Kas awal", v.cashOpening],
      ["Arus kas operasi", v.cashOperating],
      ["Arus kas investasi", v.cashInvesting],
      ["Arus kas pendanaan", v.cashFinancing],
      ["Kas akhir", v.cashClosing],
      ["Total aset", v.assets],
      ["Total kewajiban", v.liabilities],
      ["Total ekuitas", v.equity],
      ["Kelayakan bonus/ekspansi", "BELUM DAPAT DINILAI"],
    ];
    const csv = "\uFEFF" + lines.map(items =>
      items.map(item => '"' + String(item).replace(/"/g, '""') + '"').join(";"))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = href;
      a.download = "bunbun-laporan-laba-rugi-" + report.month +
        (demo ? "-SIMULASI" : "-STAGING") + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
  }
  return (
    <button type="button" onClick={handleDownload}
      className="rounded-lg border border-[#C7D1BF] bg-white px-4 py-2 text-sm font-semibold text-[#595E48] hover:bg-[#F1F3ED]">
      Ekspor rincian CSV
    </button>
  );
}

export default function OwnerBusinessHealth() {
  const [month, setMonth] = useState(currentWibMonth);
  const [mode, setMode] = useState("STAGING");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState("");
  const todayMonth = currentWibMonth();

  useEffect(() => {
    if (mode !== "STAGING") {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setResponse(null);
    setError("");
    loadOwnerFinancialDashboard(chartMonths(month))
      .then(result => { if (!cancelled) setResponse(result); })
      .catch(reason => {
        if (!cancelled) setError(reason.message || "Gagal memuat laporan akuntansi.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, reload, mode]);

  const demo = mode === "SIMULASI";
  const records = useMemo(() => demo
    ? makeIllustrativeBusinessRecords(month, todayMonth)
    : response?.records || [], [demo, month, todayMonth, response]);
  const dashboard = useMemo(() => buildBusinessHealthView({
    selectedMonth: month, nowMonth: todayMonth, records,
  }), [month, todayMonth, records]);

  const selected = dashboard.selected;
  const v = selected?.values;
  const unavailable = !demo && response?.status === "STAGING_NOT_CONFIGURED";

  return (
    <div className="space-y-5 pb-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MdShowChart className="text-2xl text-[#6C7E64]" />
            <h1 className="text-2xl font-bold text-[#495244]">Keuntungan & Pertumbuhan</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-[#73786D]">
            Dashboard kesehatan keuangan Bunbun Kitchen dari jurnal akuntansi setelah cutover.
            Hanya Owner yang dapat melihatnya.
          </p>
        </div>
        <span className={
          "rounded-full border px-3 py-1.5 text-xs font-bold tracking-wide " +
          (demo ? "border-[#E8BFAA] bg-[#FFF1E8] text-[#9B573F]" :
            "border-[#D4DFCC] bg-[#F1F3ED] text-[#5B7051]")
        }>
          {demo ? "SIMULASI — BUKAN LABA AKTUAL" : "STAGING — BELUM LAPORAN AKTUAL"}
        </span>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>{demo ? "Perhatian: semua angka di halaman ini adalah contoh fiktif." :
          "Belum dapat dijadikan dasar pembagian laba atau bonus."}</strong>
        {" "}Rekonsiliasi jurnal tidak otomatis membuktikan penjualan kafe, HPP, dan stok
        sudah lengkap. Sebelum data aktual sah, keputusan bonus maupun ekspansi tetap ditahan.
      </div>

      <section className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[#4F574D]">Bulan laporan</span>
            <input type="month" max={todayMonth} value={month}
              onChange={event => {
                if (event.target.value) setMonth(event.target.value);
              }}
              className="rounded-lg border border-[#D7D9D1] px-3 py-2" />
          </label>
          {mode === "STAGING" && (
            <button type="button" onClick={() => setReload(x => x + 1)}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-[#596A53] disabled:opacity-50">
              <MdRefresh /> Perbarui
            </button>
          )}
          {selected && <CsvExport report={selected} demo={demo} />}
        </div>
        <button type="button"
          onClick={() => {
            setMode(current => current === "SIMULASI" ? "STAGING" : "SIMULASI");
            setError("");
          }}
          className="rounded-lg bg-[#61755B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4F6349]">
          {demo ? "Kembali ke data staging" : "Lihat contoh dashboard"}
        </button>
      </section>

      {mode === "STAGING" && loading &&
        <p className="rounded-xl border bg-white p-5 text-sm">Memeriksa ketersediaan laporan staging...</p>}
      {mode === "STAGING" && error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <strong>Laporan tidak dapat ditampilkan.</strong> {error}
          {" "}Tidak ada angka laba yang diasumsikan.
        </div>
      )}
      {unavailable && (
        <div className="rounded-xl border border-[#E2DFD5] bg-white p-5">
          <div className="flex items-center gap-2 text-[#5D6658]">
            <MdLockOutline className="text-xl" />
            <h2 className="text-lg font-semibold">Laporan akuntansi belum tersedia</h2>
          </div>
          <p className="mt-2 text-sm text-[#747A70]">
            Bunbun OS aktif belum memiliki proyek staging akuntansi terpisah, saldo awal
            yang telah disahkan, dan jurnal POSTED yang lengkap. G tidak menampilkan
            omzet historis dikurangi pengeluaran sebagai laba karena hasilnya bisa keliru.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/finance/cutover" className="rounded-lg border px-4 py-2 text-sm font-semibold text-[#5E7557]">
              Persiapan Saldo Awal
            </Link>
            <Link to="/finance/source-audit" className="rounded-lg border px-4 py-2 text-sm font-semibold text-[#5E7557]">
              Audit Sumber Keuangan
            </Link>
          </div>
        </div>
      )}
      {!loading && !error && !unavailable && !selected && (
        <div className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold text-[#4F5B4A]">Belum tersedia laporan untuk {month}</h2>
          <p className="mt-2 text-sm text-[#777A6D]">
            Periode ini belum memiliki saldo awal disetujui dan jurnal yang lengkap.
            Bulan tanpa data tidak dianggap laba nol. Gunakan tombol contoh untuk
            melihat desain dashboard dengan angka simulasi.
          </p>
        </div>
      )}

      {selected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#4E5B49]">
              Ringkasan periode {month}
            </h2>
            <span className="rounded-md bg-[#F1F3ED] px-2 py-1 text-xs text-[#586854]">
              {selected.periodStatus === "CLOSED" ? "Bulan telah ditutup" : "Bulan berjalan — sementara"}
              {demo ? " · SIMULASI" : " · STAGING"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric title="Pendapatan Hak Bunbun" value={rupiah(v.revenue)}
              hint="Bukan omzet bruto kafe." />
            <Metric title="HPP Produk Terjual" value={rupiah(v.cogs)}
              hint="Tidak termasuk bahan yang masih menjadi persediaan." />
            <Metric title="Laba Bersih" value={rupiah(v.netProfit)}
              hint="Pendapatan − HPP − beban periode." subtle />
            <Metric title="Margin Laba Bersih" value={percent(selected.netMarginPct)}
              hint="Persentase laba bersih terhadap pendapatan." subtle />
            <Metric title="Pertumbuhan Pendapatan (MoM)"
              value={percent(dashboard.growth.revenuePct)}
              hint={dashboard.growth.comparable
                ? "Dibanding bulan penuh sebelumnya."
                : dashboard.growth.reason} />
            <Metric title="Pertumbuhan Laba (MoM)"
              value={percent(dashboard.growth.profitPct)}
              hint={dashboard.growth.comparable && dashboard.growth.profitPct === null
                ? "Basis laba sebelumnya tidak positif; persentase tidak dihitung."
                : dashboard.growth.comparable ? "Dibanding bulan penuh sebelumnya."
                  : dashboard.growth.reason} />
            <Metric title="Saldo Kas Akhir" value={rupiah(v.cashClosing)}
              hint="Kas tidak sama dengan laba yang boleh dibagikan." />
            <Metric title="Margin Laba Kotor" value={percent(selected.grossMarginPct)}
              hint="Setelah HPP terjual, sebelum beban periode." />
          </div>

          <section className="rounded-xl border bg-white p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-[#5A7056]">
                  <MdShowChart className="text-xl" />
                  <h2 className="text-lg font-bold">Tren 6 Bulan</h2>
                </div>
                <p className="mt-1 text-xs text-[#777A6D]">
                  Pendapatan hak Bunbun dan laba bersih berdasarkan jurnal, bukan setoran mentah.
                </p>
              </div>
              {demo && <span className="rounded bg-[#FFF1E8] px-2 py-1 text-xs font-bold text-[#9B573F]">CONTOH FIKTIF</span>}
            </div>
            <FinancialTrendChart data={dashboard.trend} />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-[#5D7156]">
                <MdAssessment className="text-xl" /><h2 className="text-lg font-bold">Laporan Laba Rugi</h2>
              </div>
              <MoneyLine title="Pendapatan hak Bunbun" value={v.revenue} />
              <MoneyLine title="HPP barang terjual" value={v.cogs} negative />
              <MoneyLine title="Laba kotor" value={v.grossProfit} emphasize />
              <MoneyLine title="Beban operasional periode" value={v.expenses} negative />
              <MoneyLine title="Laba / rugi bersih" value={v.netProfit} emphasize />
              <p className="mt-3 text-xs text-[#777A6D]">
                Belanja bahan yang masih tersimpan tidak dibebankan ulang ke HPP
                hanya karena sudah dibayar.
              </p>
            </section>
            <section className="rounded-xl border bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-[#5D7156]">
                <MdSavings className="text-xl" /><h2 className="text-lg font-bold">Arus Kas</h2>
              </div>
              <MoneyLine title="Kas awal periode" value={v.cashOpening} />
              <MoneyLine title="Arus kas operasional (neto)" value={v.cashOperating} />
              <MoneyLine title="Arus kas investasi (neto)" value={v.cashInvesting} />
              <MoneyLine title="Arus kas pendanaan (neto)" value={v.cashFinancing} />
              <MoneyLine title="Perubahan bersih kas" value={v.cashNetChange} />
              <MoneyLine title="Kas akhir periode" value={v.cashClosing} emphasize />
              <p className="mt-3 text-xs text-[#777A6D]">
                Setoran kafe yang melunasi piutang tidak membuat pendapatan kedua.
              </p>
            </section>
          </div>

          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-bold text-[#5D7156]">Posisi Keuangan</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <Metric title="Total Aset" value={rupiah(v.assets)}
                hint="Kas, piutang, persediaan dan aset lain." />
              <Metric title="Total Kewajiban" value={rupiah(v.liabilities)}
                hint="Utang dan kewajiban yang masih terbuka." />
              <Metric title="Total Ekuitas" value={rupiah(v.equity)}
                hint="Aset dikurangi kewajiban termasuk hasil periode." />
            </div>
            <p className="mt-3 text-xs text-[#777A6D]">
              Aset = kewajiban + ekuitas sudah cocok secara matematis.
              Hal tersebut tidak otomatis memastikan seluruh bukti transaksi lengkap.
            </p>
          </section>

          <div className="rounded-xl border border-[#DDDAD0] bg-[#FAFAF7] p-4 text-sm text-[#6C7266]">
            <strong>Keputusan manajemen belum aktif.</strong> Analisis bonus, rekrutmen,
            dan ekspansi baru dapat dilakukan setelah saldo awal, sumber transaksi,
            valuasi stok, dan laporan ditutup dengan bukti yang disetujui Owner.
            {demo && " SEMUA NOMINAL YANG TERLIHAT ADALAH DATA SIMULASI."}
          </div>
        </>
      )}
    </div>
  );
}

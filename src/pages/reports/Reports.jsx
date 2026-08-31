import { useEffect, useState } from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import Currency from "../../components/ui/Currency";
import DataTable from "../../components/ui/DataTable";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";

import { useAuth } from "../../context/AuthContext";
import { getFinancialReport, REPORT_TYPES } from "../../services/reportService";
import { exportReportToExcel, exportReportToPdf } from "../../services/reportExportService";

function getCurrentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("id-ID");
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function getStockTypeLabel(type) {
  const labels = {
    FINISHED_IN: "Produk Jadi Masuk",
    CAFE_OUT: "Produk Keluar",
    CAFE_IN: "Produk Kembali",
    OPENING_BALANCE: "Saldo Awal",
    FROZEN_IN: "Frozen Masuk",
    FROZEN_OUT: "Frozen Keluar",
  };
  return labels[type] || type || "-";
}

const BAKER_REPORT_TYPES = [
  "purchase",
  "stock",
  "product_out",
  "production",
];

export default function Reports() {
  const { role } = useAuth();
  const isBaker = role === "baker";

  const defaultRange = getCurrentMonthRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [reportType, setReportType] = useState(isBaker ? "purchase" : "expense");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const availableReportTypes = isBaker
    ? REPORT_TYPES.filter((item) => BAKER_REPORT_TYPES.includes(item.value))
    : REPORT_TYPES;

  useEffect(() => {
    if (!availableReportTypes.some((item) => item.value === reportType)) {
      setReportType(isBaker ? "purchase" : "expense");
    }
  }, [isBaker, reportType]);

  async function loadReport() {
    if (!startDate || !endDate) {
      setPageError("Tanggal mulai dan tanggal akhir wajib diisi.");
      return;
    }

    if (startDate > endDate) {
      setPageError("Tanggal mulai tidak boleh melewati tanggal akhir.");
      return;
    }

    try {
      setLoading(true);
      setPageError("");
      setReport(await getFinancialReport({ startDate, endDate }));
    } catch (error) {
      console.error("Gagal memuat laporan:", error);
      setPageError(error.message || "Laporan gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExport(kind) {
    if (!report) {
      setPageError("Tampilkan laporan terlebih dahulu sebelum export.");
      return;
    }

    try {
      setPageError("");
      if (kind === "excel") {
        exportReportToExcel(report, reportType, role);
      } else {
        exportReportToPdf(report, reportType, role);
      }
    } catch (error) {
      console.error(`Gagal export ${kind}:`, error);
      setPageError(error.message || `File ${kind} gagal dibuat.`);
    }
  }

  const selectedLabel =
    availableReportTypes.find((item) => item.value === reportType)?.label || "Laporan";

  const purchaseColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
      render: (item) => formatDate(item.tanggal),
    },
    {
      key: "supplierNama",
      title: "Supplier",
      render: (item) => item.supplierNama || "-",
    },
    {
      key: "ingredientNama",
      title: "Bahan Baku",
      render: (item) => `${item.ingredientKode || ""} — ${item.ingredientNama || "-"}`,
    },
    {
      key: "jumlah",
      title: "Jumlah",
      render: (item) => `${formatNumber(item.jumlah)} ${item.satuan || ""}`,
    },
    {
      key: "keterangan",
      title: "Keterangan",
      render: (item) => item.keterangan || "-",
    },
  ];

  const incomeColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
      render: (item) => formatDate(item.tanggal),
    },
    { key: "asalSetoran", title: "Asal Setoran" },
    {
      key: "totalPenjualan",
      title: "Jumlah",
      render: (item) => <Currency value={item.totalPenjualan} />,
    },
    {
      key: "keterangan",
      title: "Keterangan",
      render: (item) => item.keterangan || "-",
    },
  ];

  const expenseColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
      render: (item) => formatDate(item.tanggal),
    },
    { key: "kategori", title: "Kategori" },
    {
      key: "nominal",
      title: "Jumlah",
      render: (item) => <Currency value={item.nominal} />,
    },
    {
      key: "keterangan",
      title: "Keterangan",
      render: (item) => item.keterangan || "-",
    },
  ];

  const salesColumns = [
    { key: "productSku", title: "Kode", render: (item) => item.productSku || "-" },
    { key: "productName", title: "Produk" },
    { key: "dineIn", title: "Dine In", render: (item) => formatNumber(item.dineIn) },
    { key: "takeAway", title: "Take Away", render: (item) => formatNumber(item.takeAway) },
    { key: "totalQty", title: "Total Qty", render: (item) => formatNumber(item.totalQty) },
    { key: "totalAmount", title: "Total Penjualan", render: (item) => <Currency value={item.totalAmount} /> },
  ];

  const stockColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
      render: (item) => formatDate(item.tanggal),
    },
    { key: "productSku", title: "Kode", render: (item) => item.productSku || "-" },
    { key: "productName", title: "Produk" },
    { key: "tipe", title: "Pergerakan", render: (item) => getStockTypeLabel(item.tipe) },
    { key: "jumlah", title: "Qty", render: (item) => `${formatNumber(item.jumlah)} ${item.satuan}` },
    { key: "lotCode", title: "Lot", render: (item) => item.lotCode || "-" },
    { key: "keterangan", title: "Keterangan", render: (item) => item.keterangan || "-" },
  ];

  const productOutColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
      render: (item) => formatDate(item.tanggal),
    },
    { key: "productSku", title: "Kode", render: (item) => item.productSku || "-" },
    { key: "productName", title: "Produk" },
    { key: "jumlah", title: "Qty", render: (item) => `${formatNumber(item.jumlah)} ${item.satuan}` },
    { key: "destination", title: "Keperluan", render: (item) => item.destination || "-" },
    { key: "keterangan", title: "Keterangan", render: (item) => item.keterangan || "-" },
  ];

  const productionColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
      render: (item) => formatDate(item.tanggal),
    },
    { key: "kode", title: "Batch" },
    { key: "recipe", title: "Recipe" },
    { key: "target", title: "Target", render: (item) => `${formatNumber(item.target)} pcs` },
    { key: "selesai", title: "Selesai", render: (item) => `${formatNumber(item.selesai)} pcs` },
    { key: "reject", title: "Reject", render: (item) => `${formatNumber(item.reject)} pcs` },
    { key: "status", title: "Status" },
  ];

  if (loading && !report) {
    return <LoadingState message="Memuat laporan..." />;
  }

  let table = null;
  let totalLabel = "Total";
  let totalValue = 0;
  let showTotal = false;

  if (report) {
    if (reportType === "income" && !isBaker) {
      table = <DataTable columns={incomeColumns} data={report.incomes} emptyMessage="Tidak ada pemasukan pada periode ini" />;
      totalLabel = "Total Pemasukan";
      totalValue = report.summary.totalIncome;
      showTotal = true;
    } else if (reportType === "expense" && !isBaker) {
      table = <DataTable columns={expenseColumns} data={report.expenses} emptyMessage="Tidak ada pengeluaran pada periode ini" />;
      totalLabel = "Total Pengeluaran";
      totalValue = report.summary.totalExpense;
      showTotal = true;
    } else if (reportType === "purchase") {
      table = <DataTable columns={purchaseColumns} data={report.purchases} emptyMessage="Tidak ada purchasing pada periode ini" />;
    } else if (reportType === "sales" && !isBaker) {
      table = <DataTable columns={salesColumns} data={report.sales} emptyMessage="Tidak ada penjualan pada periode ini" />;
      totalLabel = "Total Penjualan";
      totalValue = report.summary.totalSales;
      showTotal = true;
    } else if (reportType === "stock") {
      table = <DataTable columns={stockColumns} data={report.stock} emptyMessage="Tidak ada pergerakan stok pada periode ini" />;
    } else if (reportType === "product_out") {
      table = <DataTable columns={productOutColumns} data={report.productOut} emptyMessage="Tidak ada produk keluar pada periode ini" />;
      totalLabel = "Total Produk Keluar";
      totalValue = report.summary.totalProductOut;
      showTotal = true;
    } else if (reportType === "production") {
      table = <DataTable columns={productionColumns} data={report.batches} emptyMessage="Tidak ada produksi pada periode ini" />;
    }
  }

  const isCurrencyTotal = ["income", "expense", "sales"].includes(reportType);

  return (
    <div>
      <PageTitle
        title="Laporan"
        subtitle={
          isBaker
            ? "Rekap operasional Bunbun Kitchen"
            : "Tampilkan laporan berdasarkan jenis dan periode tanggal"
        }
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <Card>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Jenis Laporan
            </label>
            <select
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            >
              {availableReportTypes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Tanggal Mulai
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Tanggal Akhir
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            />
          </div>

          <div className="flex items-end">
            <Button onClick={loadReport} disabled={loading} className="w-full">
              {loading ? "Memuat..." : "Tampilkan Laporan"}
            </Button>
          </div>
        </div>
      </Card>

      {report && (
        <>
          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selectedLabel}</h2>
              <p className="text-sm text-gray-500">
                Periode {formatDate(startDate)} — {formatDate(endDate)}
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => handleExport("excel")}>Export Excel</Button>
              <Button onClick={() => handleExport("pdf")}>Export PDF</Button>
            </div>
          </div>

          {showTotal && (
            <Card className="mt-6">
              <p className="text-sm text-gray-500">{totalLabel}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {isCurrencyTotal ? (
                  <Currency value={totalValue} />
                ) : (
                  `${formatNumber(totalValue)} pcs`
                )}
              </p>
            </Card>
          )}

          {reportType === "purchase" && (
            <Card className="mt-6">
              <p className="text-sm text-gray-500">Rekap Pembelian</p>
              <p className="mt-2 text-sm text-gray-700">
                {isBaker
                  ? "Detail pembelian untuk kebutuhan operasional. Nilai pembelian tidak ditampilkan."
                  : `${formatNumber(report.purchases.length)} transaksi pembelian pada periode ini.`}
              </p>
            </Card>
          )}

          {reportType === "stock" && (
            <Card className="mt-6">
              <p className="text-sm text-gray-500">Jumlah Pergerakan Stok</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatNumber(report.stock.length)} transaksi
              </p>
            </Card>
          )}

          {reportType === "production" && (
            <Card className="mt-6">
              <p className="text-sm text-gray-500">Ringkasan Produksi</p>
              <p className="mt-2 text-sm text-gray-700">
                Batch: <strong>{formatNumber(report.summary.totalBatches)}</strong> · Selesai: <strong>{formatNumber(report.summary.totalFinished)} pcs</strong> · Reject: <strong>{formatNumber(report.summary.totalReject)} pcs</strong>
              </p>
            </Card>
          )}

          <Card className="mt-6">{table}</Card>
        </>
      )}
    </div>
  );
}

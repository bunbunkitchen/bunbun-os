import {
  useEffect,
  useMemo,
  useState,
} from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import Currency from "../../components/ui/Currency";
import DataTable from "../../components/ui/DataTable";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";

import {
  getFinancialReport,
} from "../../services/reportService";

import {
  exportReportToExcel,
  exportReportToPdf,
} from "../../services/reportExportService";

function getCurrentMonthRange() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const lastDay = new Date(
    year,
    now.getMonth() + 1,
    0
  ).getDate();

  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(
      lastDay
    ).padStart(2, "0")}`,
  };
}

export default function Reports() {
  const defaultRange = useMemo(
    () => getCurrentMonthRange(),
    []
  );

  const [startDate, setStartDate] =
    useState(defaultRange.startDate);

  const [endDate, setEndDate] =
    useState(defaultRange.endDate);

  const [report, setReport] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  async function loadReport() {
    if (!startDate || !endDate) {
      setPageError(
        "Tanggal mulai dan tanggal akhir wajib diisi."
      );
      return;
    }

    if (startDate > endDate) {
      setPageError(
        "Tanggal mulai tidak boleh melewati tanggal akhir."
      );
      return;
    }

    try {
      setLoading(true);
      setPageError("");

      const data =
        await getFinancialReport({
          startDate,
          endDate,
        });

      setReport(data);
    } catch (error) {
      console.error(
        "Gagal memuat laporan:",
        error
      );

      setPageError(
        error.message ||
          "Laporan gagal dimuat."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExportExcel() {
  if (!report) {
    setPageError(
      "Tampilkan laporan terlebih dahulu sebelum export Excel."
    );
    return;
  }

  try {
    setPageError("");

    exportReportToExcel(report);
  } catch (error) {
    console.error(
      "Gagal export Excel:",
      error
    );

    setPageError(
      error.message ||
      "File Excel gagal dibuat."
    );
  }
}

function handleExportPdf() {
  if (!report) {
    setPageError(
      "Tampilkan laporan terlebih dahulu sebelum export PDF."
    );
    return;
  }

  try {
    setPageError("");

    exportReportToPdf(report);
  } catch (error) {
    console.error(
      "Gagal export PDF:",
      error
    );

    setPageError(
      error.message ||
      "File PDF gagal dibuat."
    );
  }
}

  useEffect(() => {
    async function loadInitialReport() {
      try {
        setLoading(true);
        setPageError("");

        const data =
          await getFinancialReport({
            startDate:
              defaultRange.startDate,
            endDate:
              defaultRange.endDate,
          });

        setReport(data);
      } catch (error) {
        console.error(
          "Gagal memuat laporan awal:",
          error
        );

        setPageError(
          error.message ||
            "Laporan gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadInitialReport();
  }, [
    defaultRange.startDate,
    defaultRange.endDate,
  ]);

  const incomeColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "totalPenjualan",
      title: "Total Penjualan",
      render: (item) => (
        <Currency
          value={item.totalPenjualan}
        />
      ),
    },
    {
      key: "pemasukanBunbun",
      title: "Pemasukan Bunbun",
      render: (item) => (
        <Currency
          value={item.pemasukanBunbun}
        />
      ),
    },
    {
      key: "keterangan",
      title: "Keterangan",
    },
  ];

  const expenseColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "kategori",
      title: "Kategori",
    },
    {
      key: "nominal",
      title: "Nominal",
      render: (item) => (
        <Currency value={item.nominal} />
      ),
    },
    {
      key: "keterangan",
      title: "Keterangan",
    },
  ];

  const batchColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "kode",
      title: "Batch",
    },
    {
      key: "recipe",
      title: "Recipe",
    },
    {
      key: "target",
      title: "Target",
      render: (item) =>
        `${Number(
          item.target || 0
        ).toLocaleString("id-ID")} pcs`,
    },
    {
      key: "selesai",
      title: "Selesai",
      render: (item) =>
        `${Number(
          item.selesai || 0
        ).toLocaleString("id-ID")} pcs`,
    },
    {
      key: "reject",
      title: "Reject",
      render: (item) =>
        `${Number(
          item.reject || 0
        ).toLocaleString("id-ID")} pcs`,
    },
    {
      key: "status",
      title: "Status",
    },
  ];

  const purchaseColumns = [
  {
    key: "tanggal",
    title: "Tanggal",
  },
  {
    key: "supplierNama",
    title: "Supplier",
    render: (item) =>
      item.supplierNama || "-",
  },
  {
    key: "ingredientNama",
    title: "Bahan Baku",
    render: (item) =>
      `${item.ingredientKode} — ${item.ingredientNama}`,
  },
  {
    key: "jumlah",
    title: "Jumlah",
    render: (item) =>
      `${Number(
        item.jumlah || 0
      ).toLocaleString("id-ID")} ${
        item.satuan
      }`,
  },
  {
    key: "total",
    title: "Total",
    render: (item) => (
      <Currency value={item.total} />
    ),
  },
  {
    key: "keterangan",
    title: "Keterangan",
    render: (item) =>
      item.keterangan || "-",
  },
];

  if (loading) {
  return (
    <LoadingState message="Memuat laporan..." />
  );
}

  return (
    <div>
      <PageTitle
        title="Laporan"
        subtitle="Rekap mingguan atau bulanan Bunbun Kitchen"
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Tanggal Mulai
            </label>

            <input
              type="date"
              value={startDate}
              onChange={(event) =>
                setStartDate(
                  event.target.value
                )
              }
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
              onChange={(event) =>
                setEndDate(
                  event.target.value
                )
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-amber-600"
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={loadReport}
              disabled={loading}
            >
              {loading
                ? "Memuat..."
                : "Tampilkan Laporan"}
            </Button>
          </div>
        </div>
      </Card>

      {report && (
        <>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button onClick={handleExportExcel}>
                Export Excel
            </Button>

            <Button onClick={handleExportPdf}>
                Export PDF
            </Button>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <Card>
              <p className="text-sm text-gray-500">
                Total Pemasukan
              </p>

              <p className="mt-2 text-2xl font-bold text-green-700">
                <Currency
                  value={
                    report.summary
                      .totalIncome
                  }
                />
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Total Pengeluaran
              </p>

              <p className="mt-2 text-2xl font-bold text-red-700">
                <Currency
                  value={
                    report.summary
                      .totalExpense
                  }
                />
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Saldo Bersih
              </p>

              <p
                className={`mt-2 text-2xl font-bold ${
                  report.summary
                    .netProfit >= 0
                    ? "text-amber-700"
                    : "text-red-700"
                }`}
              >
                <Currency
                  value={
                    report.summary
                      .netProfit
                  }
                />
              </p>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <Card>
              <p className="text-sm text-gray-500">
                Gaji
              </p>

              <p className="mt-2 text-xl font-bold">
                <Currency
                  value={
                    report.summary
                      .expenseByCategory
                      .Gaji
                  }
                />
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Bahan Baku
              </p>

              <p className="mt-2 text-xl font-bold">
                <Currency
                  value={
                    report.summary
                      .expenseByCategory[
                      "Bahan Baku"
                    ]
                  }
                />
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Maintenance
              </p>

              <p className="mt-2 text-xl font-bold">
                <Currency
                  value={
                    report.summary
                      .expenseByCategory
                      .Maintenance
                  }
                />
              </p>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-4">
            <Card>
              <p className="text-sm text-gray-500">
                Total Batch
              </p>

              <p className="mt-2 text-xl font-bold">
                {
                  report.summary
                    .totalBatches
                }
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Batch Selesai
              </p>

              <p className="mt-2 text-xl font-bold">
                {
                  report.summary
                    .finishedBatches
                }
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Produk Selesai
              </p>

              <p className="mt-2 text-xl font-bold">
                {Number(
                  report.summary
                    .totalFinished || 0
                ).toLocaleString(
                  "id-ID"
                )}{" "}
                pcs
              </p>
            </Card>

            <Card>
              <p className="text-sm text-gray-500">
                Reject
              </p>

              <p className="mt-2 text-xl font-bold">
                {Number(
                  report.summary
                    .totalReject || 0
                ).toLocaleString(
                  "id-ID"
                )}{" "}
                pcs
              </p>
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <p className="text-sm text-gray-500">
                Total Pembelian Bahan Baku
              </p>

              <p className="mt-2 text-2xl font-bold text-amber-700">
                <Currency
                  value={
                    report.summary.totalPurchase
                  }
               />
             </p>
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold">
                Rincian Pemasukan
              </h2>

              <DataTable
                columns={incomeColumns}
                data={report.incomes}
                emptyMessage="Tidak ada pemasukan pada periode ini"
              />
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold">
                Rincian Pengeluaran
              </h2>

              <DataTable
                columns={expenseColumns}
                data={report.expenses}
                emptyMessage="Tidak ada pengeluaran pada periode ini"
              />
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold">
                Rekap Produksi
              </h2>

              <DataTable
                columns={batchColumns}
                data={report.batches}
                emptyMessage="Tidak ada produksi pada periode ini"
              />
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold">
                Rekap Pembelian
              </h2>

              <DataTable
                columns={purchaseColumns}
                data={report.purchases}
              emptyMessage="Tidak ada pembelian pada periode ini"
              />
            </Card>
          </div>
          
        </>
      )}
    </div>
  );
}
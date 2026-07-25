import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function formatDateForFilename(dateString) {
  return dateString.replaceAll("-", "");
}

function setColumnWidths(worksheet, widths) {
  worksheet["!cols"] = widths.map((width) => ({
    wch: width,
  }));
}

export function exportReportToExcel(report) {
  if (!report) {
    throw new Error(
      "Data laporan belum tersedia."
    );
  }

  const workbook = XLSX.utils.book_new();

  const {
    startDate,
    endDate,
  } = report.period;

  /*
   * SHEET 1 — RINGKASAN
   */
  const summaryRows = [
    ["BUNBUN KITCHEN"],
    ["Laporan Operasional dan Keuangan"],
    [],
    ["Periode", `${startDate} s.d. ${endDate}`],
    [],
    ["RINGKASAN KEUANGAN"],
    ["Total Pemasukan", report.summary.totalIncome],
    ["Total Pengeluaran", report.summary.totalExpense],
    ["Saldo Bersih", report.summary.netProfit],
    [],
    ["PENGELUARAN PER KATEGORI"],
    [
      "Gaji",
      report.summary.expenseByCategory.Gaji,
    ],
    [
      "Bahan Baku",
      report.summary.expenseByCategory[
        "Bahan Baku"
      ],
    ],
    [
      "Maintenance",
      report.summary.expenseByCategory
        .Maintenance,
    ],
    [],
    ["RINGKASAN PRODUKSI"],
    ["Total Batch", report.summary.totalBatches],
    [
      "Batch Selesai",
      report.summary.finishedBatches,
    ],
    [
      "Produk Selesai",
      report.summary.totalFinished,
    ],
    ["Reject", report.summary.totalReject],
  ];

  const summarySheet =
    XLSX.utils.aoa_to_sheet(summaryRows);

  summarySheet["B7"].z = '"Rp"#,##0';
  summarySheet["B8"].z = '"Rp"#,##0';
  summarySheet["B9"].z = '"Rp"#,##0';
  summarySheet["B12"].z = '"Rp"#,##0';
  summarySheet["B13"].z = '"Rp"#,##0';
  summarySheet["B14"].z = '"Rp"#,##0';

  setColumnWidths(summarySheet, [30, 24]);

  XLSX.utils.book_append_sheet(
    workbook,
    summarySheet,
    "Ringkasan"
  );

  /*
   * SHEET 2 — PEMASUKAN
   */
  const incomeRows = report.incomes.map(
    (item) => ({
      Tanggal: item.tanggal,
      "Total Penjualan": Number(
        item.totalPenjualan
      ),
      "Persentase Bunbun": Number(
        item.persentaseBunbun
      ),
      "Pemasukan Bunbun": Number(
        item.pemasukanBunbun
      ),
      Keterangan: item.keterangan || "",
    })
  );

  const incomeSheet =
    XLSX.utils.json_to_sheet(incomeRows);

  setColumnWidths(
    incomeSheet,
    [14, 20, 20, 22, 35]
  );

  XLSX.utils.book_append_sheet(
    workbook,
    incomeSheet,
    "Pemasukan"
  );

  /*
   * SHEET 3 — PENGELUARAN
   */
  const expenseRows = report.expenses.map(
    (item) => ({
      Tanggal: item.tanggal,
      Kategori: item.kategori,
      Nominal: Number(item.nominal),
      Keterangan: item.keterangan || "",
    })
  );

  const expenseSheet =
    XLSX.utils.json_to_sheet(expenseRows);

  setColumnWidths(
    expenseSheet,
    [14, 20, 18, 40]
  );

  XLSX.utils.book_append_sheet(
    workbook,
    expenseSheet,
    "Pengeluaran"
  );

  /*
   * SHEET 4 — PRODUKSI
   */
  const productionRows = report.batches.map(
    (item) => ({
      Tanggal: item.tanggal,
      "Kode Batch": item.kode,
      Recipe: item.recipe,
      Target: Number(item.target),
      Selesai: Number(item.selesai),
      Reject: Number(item.reject),
      Status: item.status,
    })
  );

  const productionSheet =
    XLSX.utils.json_to_sheet(productionRows);

  setColumnWidths(
    productionSheet,
    [14, 30, 28, 12, 12, 12, 16]
  );

  XLSX.utils.book_append_sheet(
    workbook,
    productionSheet,
    "Produksi"
  );

  const filename =
    `Laporan-Bunbun-Kitchen-` +
    `${formatDateForFilename(startDate)}-` +
    `${formatDateForFilename(endDate)}.xlsx`;

  XLSX.writeFile(workbook, filename, {
    compression: true,
  });
}

function formatRupiah(value) {
  return `Rp${Number(value || 0).toLocaleString(
    "id-ID"
  )}`;
}

function formatDateForPdf(dateString) {
  if (!dateString) {
    return "-";
  }

  const [year, month, day] =
    dateString.split("-");

  return `${day}-${month}-${year}`;
}

export function exportReportToPdf(report) {
  if (!report) {
    throw new Error(
      "Data laporan belum tersedia."
    );
  }

  const document = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const {
    startDate,
    endDate,
  } = report.period;

  document.setFontSize(18);
  document.text(
    "BUNBUN KITCHEN",
    14,
    18
  );

  document.setFontSize(12);
  document.text(
    "Laporan Operasional dan Keuangan",
    14,
    25
  );

  document.setFontSize(10);
  document.text(
    `Periode: ${formatDateForPdf(
      startDate
    )} s.d. ${formatDateForPdf(
      endDate
    )}`,
    14,
    32
  );

  autoTable(document, {
    startY: 38,
    head: [["Ringkasan Keuangan", "Nominal"]],
    body: [
      [
        "Total Pemasukan",
        formatRupiah(
          report.summary.totalIncome
        ),
      ],
      [
        "Total Pengeluaran",
        formatRupiah(
          report.summary.totalExpense
        ),
      ],
      [
        "Saldo Bersih",
        formatRupiah(
          report.summary.netProfit
        ),
      ],
    ],
    theme: "grid",
  });

  autoTable(document, {
    startY:
      document.lastAutoTable.finalY + 7,
    head: [
      [
        "Pengeluaran per Kategori",
        "Nominal",
      ],
    ],
    body: [
      [
        "Gaji",
        formatRupiah(
          report.summary
            .expenseByCategory.Gaji
        ),
      ],
      [
        "Bahan Baku",
        formatRupiah(
          report.summary
            .expenseByCategory[
            "Bahan Baku"
          ]
        ),
      ],
      [
        "Maintenance",
        formatRupiah(
          report.summary
            .expenseByCategory
            .Maintenance
        ),
      ],
    ],
    theme: "grid",
  });

  autoTable(document, {
    startY:
      document.lastAutoTable.finalY + 7,
    head: [
      [
        "Ringkasan Produksi",
        "Jumlah",
      ],
    ],
    body: [
      [
        "Total Batch",
        report.summary.totalBatches,
      ],
      [
        "Batch Selesai",
        report.summary.finishedBatches,
      ],
      [
        "Produk Selesai",
        `${report.summary.totalFinished} pcs`,
      ],
      [
        "Reject",
        `${report.summary.totalReject} pcs`,
      ],
    ],
    theme: "grid",
  });

  document.addPage();

  document.setFontSize(14);
  document.text(
    "Rincian Pemasukan",
    14,
    18
  );

  autoTable(document, {
    startY: 24,
    head: [
      [
        "Tanggal",
        "Total Penjualan",
        "Pemasukan Bunbun",
        "Keterangan",
      ],
    ],
    body: report.incomes.map(
      (item) => [
        formatDateForPdf(item.tanggal),
        formatRupiah(
          item.totalPenjualan
        ),
        formatRupiah(
          item.pemasukanBunbun
        ),
        item.keterangan || "-",
      ]
    ),
    theme: "grid",
    styles: {
      fontSize: 8,
    },
  });

  document.addPage();

  document.setFontSize(14);
  document.text(
    "Rincian Pengeluaran",
    14,
    18
  );

  autoTable(document, {
    startY: 24,
    head: [
      [
        "Tanggal",
        "Kategori",
        "Nominal",
        "Keterangan",
      ],
    ],
    body: report.expenses.map(
      (item) => [
        formatDateForPdf(item.tanggal),
        item.kategori,
        formatRupiah(item.nominal),
        item.keterangan || "-",
      ]
    ),
    theme: "grid",
    styles: {
      fontSize: 8,
    },
  });

  document.addPage();

  document.setFontSize(14);
  document.text(
    "Rekap Produksi",
    14,
    18
  );

  autoTable(document, {
    startY: 24,
    head: [
      [
        "Tanggal",
        "Batch",
        "Recipe",
        "Target",
        "Selesai",
        "Reject",
        "Status",
      ],
    ],
    body: report.batches.map(
      (item) => [
        formatDateForPdf(item.tanggal),
        item.kode,
        item.recipe,
        item.target,
        item.selesai,
        item.reject,
        item.status,
      ]
    ),
    theme: "grid",
    styles: {
      fontSize: 7,
    },
  });

  const filename =
    `Laporan-Bunbun-Kitchen-` +
    `${startDate.replaceAll("-", "")}-` +
    `${endDate.replaceAll("-", "")}.pdf`;

  document.save(filename);
}
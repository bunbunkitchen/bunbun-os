import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const REPORT_LABELS = {
  sales: "Penjualan",
  income: "Pemasukan",
  expense: "Pengeluaran",
  purchase: "Purchasing",
  stock: "Stok Produk",
  production: "Produksi",
};

function formatDate(dateString) {
  if (!dateString) return "-";
  const [year, month, day] = dateString.split("-");
  return day && month && year ? `${day}/${month}/${year}` : dateString;
}

function formatFilenameDate(dateString) {
  return String(dateString || "").replaceAll("-", "");
}

function formatRupiah(value) {
  return `Rp${Number(value || 0).toLocaleString("id-ID")}`;
}

function stockTypeLabel(type) {
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

function buildRows(report, type) {
  if (type === "income") {
    return report.incomes.map((item) => ({
      Tanggal: formatDate(item.tanggal),
      "Asal Setoran": item.asalSetoran || "-",
      Jumlah: Number(item.totalPenjualan || 0),
      Keterangan: item.keterangan || "",
    }));
  }

  if (type === "expense") {
    return report.expenses.map((item) => ({
      Tanggal: formatDate(item.tanggal),
      Kategori: item.kategori || "-",
      Jumlah: Number(item.nominal || 0),
      Keterangan: item.keterangan || "",
    }));
  }

  if (type === "purchase") {
    return report.purchases.map((item) => ({
      Tanggal: formatDate(item.tanggal),
      Supplier: item.supplierNama || "-",
      "Bahan Baku": item.ingredientNama || "-",
      Jumlah: `${Number(item.jumlah || 0).toLocaleString("id-ID")} ${item.satuan || ""}`.trim(),
      Total: Number(item.total || 0),
      Keterangan: item.keterangan || "",
    }));
  }

  if (type === "sales") {
    return report.sales.map((item) => ({
      Kode: item.productSku || "-",
      Produk: item.productName || "-",
      "Dine In": Number(item.dineIn || 0),
      "Take Away": Number(item.takeAway || 0),
      "Total Qty": Number(item.totalQty || 0),
      "Total Penjualan": Number(item.totalAmount || 0),
    }));
  }

  if (type === "stock") {
    return report.stock.map((item) => ({
      Tanggal: formatDate(item.tanggal),
      Kode: item.productSku || "-",
      Produk: item.productName || "-",
      Pergerakan: stockTypeLabel(item.tipe),
      Qty: Number(item.jumlah || 0),
      Satuan: item.satuan || "pcs",
      Lot: item.lotCode || "-",
      Keterangan: item.keterangan || "",
    }));
  }

  return report.batches.map((item) => ({
    Tanggal: formatDate(item.tanggal),
    Batch: item.kode || "-",
    Recipe: item.recipe || "-",
    Target: Number(item.target || 0),
    Selesai: Number(item.selesai || 0),
    Reject: Number(item.reject || 0),
    Status: item.status || "-",
  }));
}

function getTotal(report, type) {
  if (type === "income") return report.summary.totalIncome;
  if (type === "expense") return report.summary.totalExpense;
  if (type === "purchase") return report.summary.totalPurchase;
  if (type === "sales") return report.summary.totalSales;
  return null;
}

export function exportReportToExcel(report, type) {
  if (!report) throw new Error("Data laporan belum tersedia.");

  const label = REPORT_LABELS[type] || "Laporan";
  const rows = buildRows(report, type);
  const total = getTotal(report, type);
  const workbook = XLSX.utils.book_new();

  const headerRows = [
    ["BUNBUN KITCHEN"],
    [label],
    [`Periode: ${formatDate(report.period.startDate)} s.d. ${formatDate(report.period.endDate)}`],
    [],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(headerRows);
  XLSX.utils.sheet_add_json(sheet, rows, { origin: "A5" });

  if (total !== null) {
    const totalRow = rows.length + 6;
    XLSX.utils.sheet_add_aoa(sheet, [[`TOTAL ${label.toUpperCase()}`, total]], {
      origin: `A${totalRow}`,
    });
    const lastColumn = Object.keys(rows[0] || {}).length;
    const totalValueColumn = XLSX.utils.encode_col(Math.max(lastColumn - 1, 1));
    const cell = sheet[`${totalValueColumn}${totalRow}`];
    if (cell) cell.z = '"Rp"#,##0';
  }

  if (type === "income") {
    for (let row = 6; row <= rows.length + 5; row += 1) {
      if (sheet[`C${row}`]) sheet[`C${row}`].z = '"Rp"#,##0';
    }
  }

  if (type === "expense") {
    for (let row = 6; row <= rows.length + 5; row += 1) {
      if (sheet[`C${row}`]) sheet[`C${row}`].z = '"Rp"#,##0';
    }
  }

  if (type === "purchase") {
    for (let row = 6; row <= rows.length + 5; row += 1) {
      if (sheet[`E${row}`]) sheet[`E${row}`].z = '"Rp"#,##0';
    }
  }

  if (type === "sales") {
    for (let row = 6; row <= rows.length + 5; row += 1) {
      if (sheet[`F${row}`]) sheet[`F${row}`].z = '"Rp"#,##0';
    }
  }

  const widths = {
    income: [16, 30, 20, 42],
    expense: [16, 22, 20, 42],
    purchase: [16, 28, 32, 18, 20, 42],
    sales: [18, 30, 14, 14, 14, 24],
    stock: [16, 18, 30, 24, 12, 12, 24, 42],
    production: [16, 28, 30, 14, 14, 14, 18],
  };
  sheet["!cols"] = (widths[type] || [20, 30, 20]).map((wch) => ({ wch }));

  XLSX.utils.book_append_sheet(workbook, sheet, label.slice(0, 31));

  const filename = `Laporan-${label.replaceAll(" ", "-")}-${formatFilenameDate(report.period.startDate)}-${formatFilenameDate(report.period.endDate)}.xlsx`;
  XLSX.writeFile(workbook, filename, { compression: true });
}

export function exportReportToPdf(report, type) {
  if (!report) throw new Error("Data laporan belum tersedia.");

  const label = REPORT_LABELS[type] || "Laporan";
  const rows = buildRows(report, type);
  const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  document.setFontSize(18);
  document.text("BUNBUN KITCHEN", 14, 16);
  document.setFontSize(13);
  document.text(label, 14, 23);
  document.setFontSize(9);
  document.text(
    `Periode: ${formatDate(report.period.startDate)} s.d. ${formatDate(report.period.endDate)}`,
    14,
    29
  );

  const headers = Object.keys(rows[0] || {
    Keterangan: "Tidak ada data",
  });
  const body = rows.length
    ? rows.map((row) => headers.map((header) => {
        const value = row[header];
        if (["Jumlah", "Total", "Total Penjualan"].includes(header)) {
          return formatRupiah(value);
        }
        return value ?? "-";
      }))
    : [["Tidak ada data pada periode ini"]];

  autoTable(document, {
    startY: 35,
    head: [headers],
    body,
    theme: "grid",
    styles: { fontSize: 7, overflow: "linebreak" },
    headStyles: { fontSize: 7 },
  });

  const total = getTotal(report, type);
  if (total !== null) {
    const y = document.lastAutoTable.finalY + 8;
    document.setFontSize(10);
    document.text(`${`Total ${label}`}: ${formatRupiah(total)}`, 14, y);
  }

  const filename = `Laporan-${label.replaceAll(" ", "-")}-${formatFilenameDate(report.period.startDate)}-${formatFilenameDate(report.period.endDate)}.pdf`;
  document.save(filename);
}

import { getAllIncomes } from "./incomeService";
import { getAllExpenses } from "./expenseService";
import { getAllProductionBatches } from "./productionService";
import { getAllPurchases } from "./purchaseService";
import { getAllSales } from "./salesService";
import { getProductStockMovements } from "./productStockService";

export const REPORT_TYPES = [
  { value: "sales", label: "Penjualan" },
  { value: "income", label: "Pemasukan" },
  { value: "expense", label: "Pengeluaran" },
  { value: "purchase", label: "Purchasing" },
  { value: "stock", label: "Stok Produk" },
  { value: "product_out", label: "Produk Keluar" },
  { value: "production", label: "Produksi" },
];

function isDateInRange(dateString, startDate, endDate) {
  if (!dateString) return false;
  return dateString >= startDate && dateString <= endDate;
}

function aggregateSales(sales) {
  const products = new Map();
  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = item.productId;
      const current = products.get(key) || {
        productId: item.productId,
        productSku: item.productSku || "",
        productName: item.productName || "",
        dineIn: 0,
        takeAway: 0,
        totalQty: 0,
        totalAmount: 0,
      };
      const qty = Number(item.quantity || 0);
      const amount = Number(item.subtotal || 0);
      if (item.orderType === "DINE_IN") current.dineIn += qty;
      if (item.orderType === "TAKE_AWAY") current.takeAway += qty;
      current.totalQty += qty;
      current.totalAmount += amount;
      products.set(key, current);
    });
  });
  return Array.from(products.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, "id")
  );
}

function mapStockMovements(movements) {
  return movements.map((item) => ({
    tanggal: item.tanggal,
    productSku: item.productSku,
    productName: item.productNama,
    tipe: item.tipe,
    jumlah: item.jumlah,
    satuan: item.satuan || "pcs",
    keterangan: item.keterangan || "",
    lotCode: item.lotCode || "",
    destination: item.keterangan?.match(/^Tujuan:\s*([^·]+)/)?.[1]?.trim() || "",
  }));
}

export async function getFinancialReport({ startDate, endDate }) {
  const [allIncomes, allExpenses, allBatches, allPurchases, allSales, allStockMovements] =
    await Promise.all([
      getAllIncomes(),
      getAllExpenses(),
      getAllProductionBatches(),
      getAllPurchases(),
      getAllSales(),
      getProductStockMovements(),
    ]);

  const incomes = allIncomes.filter((item) => isDateInRange(item.tanggal, startDate, endDate));
  const expenses = allExpenses.filter((item) => isDateInRange(item.tanggal, startDate, endDate));
  const batches = allBatches.filter((item) => isDateInRange(item.tanggal, startDate, endDate));
  const purchases = allPurchases.filter((item) => isDateInRange(item.tanggal, startDate, endDate));
  const sales = allSales.filter((item) => isDateInRange(item.saleDate, startDate, endDate));
  const stockMovements = allStockMovements.filter((item) => isDateInRange(item.tanggal, startDate, endDate));

  const salesByProduct = aggregateSales(sales);
  const stock = mapStockMovements(stockMovements);
  const productOut = stock
    .filter((item) => item.tipe === "CAFE_OUT")
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.productName.localeCompare(b.productName, "id"));

  const totalIncome = incomes.reduce((total, item) => total + Number(item.pemasukanBunbun || 0), 0);
  const totalExpense = expenses.reduce((total, item) => total + Number(item.nominal || 0), 0);
  const totalPurchase = purchases.reduce((total, item) => total + Number(item.total || 0), 0);
  const totalSales = salesByProduct.reduce((total, item) => total + Number(item.totalAmount || 0), 0);
  const totalProductOut = productOut.reduce((total, item) => total + Number(item.jumlah || 0), 0);

  const expenseByCategory = {};
  expenses.forEach((item) => {
    const category = item.kategori || "Lainnya";
    expenseByCategory[category] = Number(expenseByCategory[category] || 0) + Number(item.nominal || 0);
  });

  const finishedBatches = batches.filter((batch) => batch.status === "Finished");
  const totalFinished = batches.reduce((total, batch) => total + Number(batch.selesai || 0), 0);
  const totalReject = batches.reduce((total, batch) => total + Number(batch.reject || 0), 0);

  return {
    period: { startDate, endDate },
    incomes,
    expenses,
    purchases,
    sales: salesByProduct,
    stock,
    productOut,
    batches,
    summary: {
      totalIncome,
      totalExpense,
      totalPurchase,
      totalSales,
      totalProductOut,
      netProfit: totalIncome - totalExpense,
      expenseByCategory,
      totalBatches: batches.length,
      finishedBatches: finishedBatches.length,
      totalFinished,
      totalReject,
    },
  };
}

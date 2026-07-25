import { getAllIncomes } from "./incomeService";
import { getAllExpenses } from "./expenseService";
import {
  getAllProductionBatches,
} from "./productionService";
import {
  getAllPurchases,
} from "./purchaseService";

function isDateInRange(
  dateString,
  startDate,
  endDate
) {
  if (!dateString) {
    return false;
  }

  return (
    dateString >= startDate &&
    dateString <= endDate
  );
}

export async function getFinancialReport({
  startDate,
  endDate,
}) {
  const [
    allIncomes,
    allExpenses,
    allBatches,
    allPurchases,
  ] = await Promise.all([
    getAllIncomes(),
    getAllExpenses(),
    getAllProductionBatches(),
    getAllPurchases(),
  ]);

  const incomes = allIncomes.filter(
    (item) =>
      isDateInRange(
        item.tanggal,
        startDate,
        endDate
      )
  );

  const expenses = allExpenses.filter(
    (item) =>
      isDateInRange(
        item.tanggal,
        startDate,
        endDate
      )
  );

  const batches = allBatches.filter(
    (item) =>
      isDateInRange(
        item.tanggal,
        startDate,
        endDate
      )
  );

  const purchases = allPurchases.filter(
    (item) =>
      isDateInRange(
        item.tanggal,
        startDate,
        endDate
      )
  );

  const totalIncome = incomes.reduce(
    (total, item) =>
      total +
      Number(
        item.pemasukanBunbun || 0
      ),
    0
  );

  const totalExpense = expenses.reduce(
    (total, item) =>
      total +
      Number(item.nominal || 0),
    0
  );

  const totalPurchase =
    purchases.reduce(
      (total, item) =>
        total +
        Number(item.total || 0),
      0
    );

  const expenseByCategory = {
    Gaji: 0,
    "Bahan Baku": 0,
    Maintenance: 0,
  };

  expenses.forEach((item) => {
    if (
      Object.prototype.hasOwnProperty.call(
        expenseByCategory,
        item.kategori
      )
    ) {
      expenseByCategory[
        item.kategori
      ] += Number(
        item.nominal || 0
      );
    }
  });

  const finishedBatches =
    batches.filter(
      (batch) =>
        batch.status === "Finished"
    );

  const totalFinished =
    batches.reduce(
      (total, batch) =>
        total +
        Number(batch.selesai || 0),
      0
    );

  const totalReject =
    batches.reduce(
      (total, batch) =>
        total +
        Number(batch.reject || 0),
      0
    );

  return {
    period: {
      startDate,
      endDate,
    },

    incomes,
    expenses,
    batches,
    purchases,

    summary: {
      totalIncome,
      totalExpense,
      netProfit:
        totalIncome - totalExpense,

      totalPurchase,

      expenseByCategory,

      totalBatches:
        batches.length,

      finishedBatches:
        finishedBatches.length,

      totalFinished,
      totalReject,
    },
  };
}
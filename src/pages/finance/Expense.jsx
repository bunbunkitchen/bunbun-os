import {
  useEffect,
  useMemo,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import Currency from "../../components/ui/Currency";
import LoadingState from "../../components/ui/LoadingState";
import ExpenseForm from "../../components/forms/ExpenseForm";

import {
  createExpense,
  getAllExpenses,
  softDeleteExpense,
  updateExpense,
} from "../../services/expenseService";

export default function Expense() {
  const [expenses, setExpenses] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadExpenses() {
      try {
        setPageError("");

        const data =
          await getAllExpenses();

        setExpenses(data);
      } catch (error) {
        console.error(
          "Gagal mengambil pengeluaran:",
          error
        );

        setPageError(
          error.message ||
            "Data pengeluaran gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadExpenses();
  }, []);

  const totalExpense = useMemo(
    () =>
      expenses.reduce(
        (total, item) =>
          total +
          Number(item.nominal || 0),
        0
      ),
    [expenses]
  );

  const columns = [
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
        <Currency
          value={item.nominal}
        />
      ),
    },
    {
      key: "keterangan",
      title: "Keterangan",
      render: (item) =>
        item.keterangan || "-",
    },
  ];

  async function handleCreateExpense(
    expense
  ) {
    const savedExpense =
      await createExpense(expense);

    setExpenses((previous) => [
      savedExpense,
      ...previous,
    ]);
  }

  async function handleUpdateExpense(
    selectedExpense,
    values
  ) {
    const updatedExpense =
      await updateExpense(
        selectedExpense.id,
        values
      );

    setExpenses((previous) =>
      previous.map((item) =>
        item.id === updatedExpense.id
          ? updatedExpense
          : item
      )
    );
  }

  async function handleDeleteExpense(
    expense
  ) {
    await softDeleteExpense(
      expense.id
    );

    setExpenses((previous) =>
      previous.filter(
        (item) =>
          item.id !== expense.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data pengeluaran..." />
    );
  }

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-medium text-red-800">
          Total Pengeluaran
        </p>

        <p className="mt-2 text-3xl font-bold text-red-700">
          <Currency
            value={totalExpense}
          />
        </p>
      </div>

      <MasterPage
        title="Pengeluaran"
        subtitle="Catat pengeluaran operasional Bunbun Kitchen"
        sectionTitle="Daftar Pengeluaran"
        sectionDescription="Kategori: gaji, bahan baku, dan maintenance"
        searchPlaceholder="Cari pengeluaran..."
        addButtonText="+ Tambah Pengeluaran"
        columns={columns}
        data={expenses}
        FormComponent={ExpenseForm}
        onSave={
          handleCreateExpense
        }
        onUpdate={
          handleUpdateExpense
        }
        onDelete={
          handleDeleteExpense
        }
        getItemLabel={(item) =>
          `${item.kategori} tanggal ${item.tanggal}`
        }
        emptyMessage="Belum ada data pengeluaran"
      />
    </div>
  );
}
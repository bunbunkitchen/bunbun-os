import {
  useEffect,
  useMemo,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import Currency from "../../components/ui/Currency";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import Modal from "../../components/modal/Modal";
import IncomeForm from "../../components/forms/IncomeForm";

import { useToast } from "../../context/ToastContext";

import {
  createIncome,
  getAllIncomes,
  softDeleteIncome,
  updateIncome,
} from "../../services/incomeService";

export default function Income() {
  const toast = useToast();

  const [incomes, setIncomes] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  const [
    selectedIncome,
    setSelectedIncome,
  ] = useState(null);

  const [savingEdit, setSavingEdit] =
    useState(false);

  const [
    deletingId,
    setDeletingId,
  ] = useState(null);

  useEffect(() => {
    async function loadIncomes() {
      try {
        setPageError("");

        const data =
          await getAllIncomes();

        setIncomes(data);
      } catch (error) {
        console.error(
          "Gagal mengambil pemasukan:",
          error
        );

        setPageError(
          error.message ||
            "Data pemasukan gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadIncomes();
  }, []);

  const totalPemasukan = useMemo(
    () =>
      incomes.reduce(
        (total, item) =>
          total +
          Number(
            item.pemasukanBunbun || 0
          ),
        0
      ),
    [incomes]
  );

  async function handleSaveIncome(
    income
  ) {
    const savedIncome =
      await createIncome(income);

    setIncomes((previous) => [
      savedIncome,
      ...previous,
    ]);
  }

  async function handleUpdateIncome(
    income
  ) {
    if (!selectedIncome) {
      return;
    }

    try {
      setSavingEdit(true);
      setPageError("");

      const updatedIncome =
        await updateIncome(
          selectedIncome.id,
          income
        );

      setIncomes((previous) =>
        previous.map((item) =>
          item.id === updatedIncome.id
            ? updatedIncome
            : item
        )
      );

      setSelectedIncome(null);

      toast.success(
        "Pemasukan berhasil diperbarui."
      );
    } catch (error) {
      console.error(
        "Gagal memperbarui pemasukan:",
        error
      );

      const message =
        error.message ||
        "Pemasukan gagal diperbarui.";

      setPageError(message);
      toast.error(message);

      throw error;
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteIncome(
    income
  ) {
    const confirmed = window.confirm(
      `Hapus data pemasukan tanggal ${income.tanggal}?\n\nData tidak akan hilang permanen, tetapi tidak lagi tampil di laporan aktif.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(income.id);
      setPageError("");

      await softDeleteIncome(
        income.id
      );

      setIncomes((previous) =>
        previous.filter(
          (item) =>
            item.id !== income.id
        )
      );

      toast.success(
        "Pemasukan berhasil dihapus."
      );
    } catch (error) {
      console.error(
        "Gagal menghapus pemasukan:",
        error
      );

      const message =
        error.message ||
        "Pemasukan gagal dihapus.";

      setPageError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }

  const columns = [
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "asalSetoran",
      title: "Asal Setoran",
    },
    {
      key: "kodeLot",
      title: "Kode Lot",
      render: (income) =>
        income.kodeLot || "-",
    },
    {
      key: "totalPenjualan",
      title: "Setoran Diterima",
      render: (income) => (
        <Currency
          value={
            income.totalPenjualan
          }
        />
      ),
    },
    {
      key: "keterangan",
      title: "Keterangan",
    },
    {
      key: "aksi",
      title: "Aksi",
      render: (income) => (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              setSelectedIncome(income)
            }
            disabled={
              deletingId === income.id
            }
            className="bg-blue-600 hover:bg-blue-700"
          >
            Edit
          </Button>

          <Button
            onClick={() =>
              handleDeleteIncome(income)
            }
            disabled={
              deletingId === income.id
            }
            className="bg-red-600 hover:bg-red-700"
          >
            {deletingId === income.id
              ? "Menghapus..."
              : "Hapus"}
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <LoadingState message="Memuat data pemasukan..." />
    );
  }

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="text-sm font-medium text-green-800">
          Total Pemasukan Bunbun
        </p>

        <p className="mt-2 text-3xl font-bold text-green-700">
          <Currency
            value={totalPemasukan}
          />
        </p>
      </div>

      <MasterPage
        title="Pemasukan"
        subtitle="Catat nominal setoran aktual dari kafe, event, atau sumber lainnya"
        sectionTitle="Daftar Pemasukan"
        sectionDescription="Setoran dicatat sesuai uang yang diterima, tanpa perhitungan persentase"
        searchPlaceholder="Cari pemasukan..."
        addButtonText="+ Tambah Pemasukan"
        columns={columns}
        data={incomes}
        FormComponent={IncomeForm}
        onSave={handleSaveIncome}
        emptyMessage="Belum ada data pemasukan"
      />

      <Modal
        open={Boolean(selectedIncome)}
        onClose={() => {
          if (!savingEdit) {
            setSelectedIncome(null);
          }
        }}
      >
        {selectedIncome && (
          <IncomeForm
            initialData={
              selectedIncome
            }
            onSave={
              handleUpdateIncome
            }
            onCancel={() =>
              setSelectedIncome(null)
            }
            saving={savingEdit}
          />
        )}
      </Modal>
    </div>
  );
}

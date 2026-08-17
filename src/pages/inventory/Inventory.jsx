import {
  useEffect,
  useMemo,
  useState,
} from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import DataTable from "../../components/ui/DataTable";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import Button from "../../components/ui/Button";
import Modal from "../../components/modal/Modal";
import StockAdditionForm from "../../components/forms/StockAdditionForm";
import StockAdjustmentForm from "../../components/forms/StockAdjustmentForm";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";

import {
  getAllInventoryTransactions,
  createNonPurchaseStockAddition,
  createInventoryAdjustment,
} from "../../services/inventoryService";

function convertToBaseUnit(jumlah, satuan) {
  const qty = Number(jumlah) || 0;

  const unit = String(satuan || "")
    .trim()
    .toLowerCase();

  if (unit === "kg") {
    return {
      jumlah: qty * 1000,
      satuan: "gram",
    };
  }

  if (
    unit === "gram" ||
    unit === "gr" ||
    unit === "g"
  ) {
    return {
      jumlah: qty,
      satuan: "gram",
    };
  }

  if (
    unit === "liter" ||
    unit === "litre" ||
    unit === "l"
  ) {
    return {
      jumlah: qty * 1000,
      satuan: "ml",
    };
  }

  if (unit === "ml") {
    return {
      jumlah: qty,
      satuan: "ml",
    };
  }

  return {
    jumlah: qty,
    satuan: satuan || "",
  };
}

function formatStock(stok, satuan) {
  const value = Number(stok) || 0;

  if (
    satuan === "gram" &&
    Math.abs(value) >= 1000
  ) {
    return `${(value / 1000).toLocaleString(
      "id-ID",
      {
        maximumFractionDigits: 3,
      }
    )} kg`;
  }

  if (
    satuan === "ml" &&
    Math.abs(value) >= 1000
  ) {
    return `${(value / 1000).toLocaleString(
      "id-ID",
      {
        maximumFractionDigits: 3,
      }
    )} liter`;
  }

  return `${value.toLocaleString("id-ID", {
    maximumFractionDigits: 3,
  })} ${satuan}`;
}

export default function Inventory() {
  const toast = useToast();
  const { role } = useAuth();
  const [transactions, setTransactions] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  const [additionOpen, setAdditionOpen] = useState(false);
  const [savingAddition, setSavingAddition] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  async function loadInventory() {
    try {
      setPageError("");
      const data = await getAllInventoryTransactions();
      setTransactions(data);
    } catch (error) {
      console.error("Gagal memuat inventory:", error);
      setPageError(error.message || "Data inventory gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  async function handleStockAddition(values) {
    if (savingAddition) return;
    setSavingAddition(true);
    try {
      await createNonPurchaseStockAddition(values);
      await loadInventory();
      setAdditionOpen(false);
      toast.success("Stok berhasil ditambahkan tanpa pengeluaran kas.");
    } catch (error) {
      toast.error(error.message || "Penambahan stok gagal.");
      throw error;
    } finally {
      setSavingAddition(false);
    }
  }

  async function handleStockAdjustment(values) {
    if (savingAdjustment) return;
    setSavingAdjustment(true);
    try {
      await createInventoryAdjustment(values);
      await loadInventory();
      setAdjustmentOpen(false);
      toast.success("Stock adjustment berhasil disimpan.");
    } catch (error) {
      toast.error(error.message || "Stock adjustment gagal.");
      throw error;
    } finally {
      setSavingAdjustment(false);
    }
  }

  const stockSummary = useMemo(() => {
    const map = new Map();

    transactions.forEach((transaction) => {
      const isIngredient = Boolean(
        transaction.ingredientId
      );

      const isRecipe = Boolean(
        transaction.recipeId
      );

      if (!isIngredient && !isRecipe) {
        return;
      }

      const itemKey = isIngredient
        ? `ingredient-${transaction.ingredientId}`
        : `recipe-${transaction.recipeId}`;

      const itemKode = isIngredient
        ? transaction.ingredientKode
        : transaction.recipeKode;

      const itemNama = isIngredient
        ? transaction.ingredientNama
        : transaction.recipeNama;

      const normalized =
        convertToBaseUnit(
          transaction.jumlah,
          transaction.satuan
        );

      if (!map.has(itemKey)) {
        map.set(itemKey, {
          itemKode,
          itemNama,
          satuan: normalized.satuan,
          stok: 0,
        });
      }

      const current = map.get(itemKey);
      const jumlah = normalized.jumlah;

      if (
        transaction.tipe === "PURCHASE" ||
        transaction.tipe ===
          "PRODUCTION_IN" ||
        transaction.tipe ===
          "ADJUSTMENT" ||
        transaction.tipe ===
          "ADJUSTMENT_IN"
      ) {
        current.stok += jumlah;
      }

      if (
        transaction.tipe ===
          "PRODUCTION_OUT" ||
        transaction.tipe === "SALE" ||
        transaction.tipe ===
          "ADJUSTMENT_OUT"
      ) {
        current.stok -= jumlah;
      }
    });

    return Array.from(map.values());
  }, [transactions]);

  const stockColumns = [
    {
      key: "itemKode",
      title: "Kode",
    },
    {
      key: "itemNama",
      title: "Nama Item",
    },
    {
      key: "stok",
      title: "Stok",
      render: (item) =>
        formatStock(
          item.stok,
          item.satuan
        ),
    },
    {
      key: "status",
      title: "Status",
      render: (item) => (
        <StatusBadge
          status={
            item.stok > 0
              ? "Aktif"
              : "Habis"
          }
        />
      ),
    },
  ];

  const transactionColumns = [
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "tipe",
      title: "Tipe",
    },
    {
      key: "productionBatchKode",
      title: "Referensi",
      render: (transaction) =>
        transaction.productionBatchKode ||
        "-",
    },
    {
      key: "item",
      title: "Item",
      render: (transaction) =>
        transaction.ingredientNama ||
        transaction.recipeNama ||
        "-",
    },
    {
      key: "jumlah",
      title: "Jumlah",
      render: (transaction) =>
        `${Number(
          transaction.jumlah || 0
        ).toLocaleString("id-ID", {
          maximumFractionDigits: 3,
        })} ${transaction.satuan || ""}`,
    },
    {
      key: "keterangan",
      title: "Keterangan",
      render: (transaction) =>
        transaction.sumberStok
          ? `${transaction.sumberStok}${transaction.keterangan ? ` — ${transaction.keterangan}` : ""}`
          : transaction.keterangan,
    },
  ];

  if (loading) {
    return (
      <LoadingState message="Memuat inventory..." />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Inventory"
          subtitle="Pantau stok dan pergerakan item Bunbun Kitchen"
        />
        {role === "owner" && (
  <div className="flex flex-wrap gap-2">
    <Button
      onClick={() =>
        setAdditionOpen(true)
      }
    >
      + Penambahan Stok
    </Button>

    <Button
      onClick={() =>
        setAdjustmentOpen(true)
      }
      className="bg-gray-700 hover:bg-gray-800"
    >
      ± Stock Adjustment
    </Button>
  </div>
)}
      </div>

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <Card>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800">
            Ringkasan Stok
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Saldo stok berdasarkan transaksi
            masuk dan keluar
          </p>
        </div>

        <DataTable
          columns={stockColumns}
          data={stockSummary}
          emptyMessage="Belum ada data stok"
        />
      </Card>

      <div className="mt-6">
        <Card>
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-800">
              Pergerakan Inventory
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Riwayat stok masuk dan keluar
            </p>
          </div>

          <DataTable
            columns={transactionColumns}
            data={transactions}
            emptyMessage="Belum ada transaksi inventory"
          />
        </Card>
      </div>

      <Modal open={additionOpen} onClose={() => !savingAddition && setAdditionOpen(false)}>
        <StockAdditionForm
          onSave={handleStockAddition}
          onCancel={() => setAdditionOpen(false)}
          saving={savingAddition}
        />
      </Modal>

      <Modal
  open={adjustmentOpen}
  onClose={() =>
    !savingAdjustment &&
    setAdjustmentOpen(false)
  }
>
  <StockAdjustmentForm
    onSave={handleStockAdjustment}
    onCancel={() =>
      setAdjustmentOpen(false)
    }
    saving={savingAdjustment}
  />
</Modal>

    </div>
  );
}

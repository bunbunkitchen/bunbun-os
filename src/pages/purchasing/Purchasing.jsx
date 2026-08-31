import {
  useEffect,
  useMemo,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import Currency from "../../components/ui/Currency";
import LoadingState from "../../components/ui/LoadingState";
import PurchaseForm from "../../components/forms/PurchaseForm";
import { useAuth } from "../../context/AuthContext";

import {
  createPurchase,
  getAllPurchases,
  softDeletePurchase,
  updatePurchase,
} from "../../services/purchaseService";

export default function Purchasing() {
  const { role } = useAuth();
  const isOwner = role === "owner";

  const [purchases, setPurchases] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadPurchases() {
      try {
        setPageError("");

        const data = await getAllPurchases();

        const maintenancePurchases = data.filter(
          (item) => item.purchaseType === "MAINTENANCE"
        );

        console.log(
          "MAINTENANCE DETAIL JSON:",
          JSON.stringify(
            maintenancePurchases,
            null,
            2
          )
        );

        setPurchases(data);
      } catch (error) {
        console.error(
          "Gagal memuat pembelian:",
          error
        );

        setPageError(
          error.message ||
            "Data pembelian gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadPurchases();
  }, []);

  const totalPembelian = useMemo(
    () =>
      purchases.reduce(
        (total, item) =>
          total +
          Number(item.total || 0),
        0
      ),
    [purchases]
  );

  const columns = [
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "supplierNama",
      title: "Supplier",
      render: (purchase) =>
        purchase.supplierNama || "-",
    },
    {
      key: "itemNama",
      title: "Bahan Baku / Maintenance",
      render: (purchase) =>
        purchase.itemNama
          ? `${purchase.itemKode} — ${purchase.itemNama}`
          : "-",
    },
    {
      key: "jumlah",
      title: "Jumlah",
      render: (purchase) =>
        `${purchase.jumlah.toLocaleString(
          "id-ID"
        )} ${purchase.satuan}`,
    },
    {
      key: "hargaSatuan",
      title: "Harga Satuan",
      render: (purchase) => (
        <Currency
          value={
            purchase.hargaSatuan
          }
        />
      ),
    },
    {
      key: "total",
      title: "Total",
      render: (purchase) => (
        <Currency
          value={purchase.total}
        />
      ),
    },
    {
      key: "keterangan",
      title: "Keterangan",
      render: (purchase) =>
        purchase.keterangan || "-",
    },
  ];

  async function handleCreatePurchase(
    purchase
  ) {
    const savedPurchase =
      await createPurchase(purchase);

    setPurchases((previous) => [
      savedPurchase,
      ...previous,
    ]);
  }

  async function handleUpdatePurchase(
    selectedPurchase,
    values
  ) {
    const updatedPurchase =
      await updatePurchase(
        selectedPurchase.id,
        values
      );

    setPurchases((previous) =>
      previous.map((item) =>
        item.id ===
        updatedPurchase.id
          ? updatedPurchase
          : item
      )
    );
  }

  async function handleDeletePurchase(
    purchase
  ) {
    await softDeletePurchase(
      purchase.id
    );

    setPurchases((previous) =>
      previous.filter(
        (item) =>
          item.id !== purchase.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data pembelian..." />
    );
  }

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      {isOwner && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-medium text-amber-800">
            Total Pembelian
          </p>

          <p className="mt-2 text-3xl font-bold text-amber-700">
            <Currency
              value={totalPembelian}
            />
          </p>
        </div>
      )}

      <MasterPage
        title="Purchasing"
        subtitle="Catat pembelian bahan baku Bunbun Kitchen"
        sectionTitle="Daftar Pembelian"
        sectionDescription="Pembelian otomatis menambah stok bahan baku dan mencatat pengeluaran"
        searchPlaceholder="Cari pembelian..."
        addButtonText="+ Tambah Pembelian"
        columns={columns}
        data={purchases}
        FormComponent={PurchaseForm}
        onSave={
          handleCreatePurchase
        }
        onUpdate={
          handleUpdatePurchase
        }
        onDelete={
          handleDeletePurchase
        }
        getItemLabel={(item) =>
         `${item.itemNama} tanggal ${item.tanggal}`
        }
        emptyMessage="Belum ada pembelian"
      />
    </div>
  );
}
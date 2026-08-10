import {
  useEffect,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import Currency from "../../components/ui/Currency";
import StatusBadge from "../../components/ui/StatusBadge";
import Button from "../../components/ui/Button";
import ProductionOrderForm from "../../components/forms/ProductionOrderForm";
import LoadingState from "../../components/ui/LoadingState";

import {
  createProductionOrder,
  generateBatchFromOrder,
  getAllProductionOrders,
} from "../../services/productionService";

export default function Production() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [generatingId, setGeneratingId] =
    useState(null);

  useEffect(() => {
    async function loadOrders() {
      try {
        setPageError("");

        const data =
          await getAllProductionOrders();

        setOrders(data);
      } catch (error) {
        console.error(
          "Gagal memuat Production Order:",
          error
        );

        setPageError(
          error.message ||
            "Production Order gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, []);

  async function handleSaveOrder(order) {
    try {
      setPageError("");

      const savedOrder =
        await createProductionOrder(order);

      setOrders((previous) => [
        savedOrder,
        ...previous,
      ]);
    } catch (error) {
      console.error(
        "Gagal menyimpan Production Order:",
        error
      );

      setPageError(
        error.message ||
          "Production Order gagal disimpan."
      );

      throw error;
    }
  }

  async function handleGenerateBatch(order) {
    try {
      setPageError("");
      setGeneratingId(order.id);

      await generateBatchFromOrder(order);

      setOrders((previous) =>
        previous.map((item) =>
          item.id === order.id
            ? {
                ...item,
                status: "Generated",
              }
            : item
        )
      );
    } catch (error) {
      console.error(
        "Gagal membuat Production Batch:",
        error
      );

      setPageError(
        error.message ||
          "Production Batch gagal dibuat."
      );
    } finally {
      setGeneratingId(null);
    }
  }

  const columns = [
    {
      key: "kode",
      title: "Kode",
    },
    {
      key: "tanggal",
      title: "Tanggal",
    },
    {
      key: "recipeNama",
      title: "Recipe",
    },
    {
      key: "targetProduksi",
      title: "Target",
      render: (order) =>
        `${order.targetProduksi} ${order.satuan}`,
    },
    {
      key: "estimasiBiaya",
      title: "Estimasi Biaya",
      render: (order) => (
        <Currency
          value={order.estimasiBiaya}
        />
      ),
    },
    {
      key: "status",
      title: "Status",
      render: (order) => (
        <StatusBadge
          status={order.status}
        />
      ),
    },
    {
      key: "aksi",
      title: "Aksi",
      render: (order) => {
        const isGenerated =
          order.status === "Generated";

        const isCancelled =
          order.status === "Cancelled";

        const isGenerating =
          generatingId === order.id;

        return (
          <Button
            onClick={() =>
              handleGenerateBatch(order)
            }
            disabled={
              isGenerated ||
              isCancelled ||
              isGenerating
            }
          >
            {isGenerating
              ? "Membuat..."
              : isGenerated
              ? "Batch Dibuat"
              : "Generate Batch"}
          </Button>
        );
      },
    },
  ];

  if (loading) {
  return (
    <LoadingState message="Memuat dashboard..." />
  );
}

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <MasterPage
        title="Produksi"
        subtitle="Kelola production order Bunbun Kitchen"
        sectionTitle="Daftar Production Order"
        sectionDescription="Rencana produksi berdasarkan recipe dan target output"
        searchPlaceholder="Cari production order..."
        addButtonText="+ Buat Production Order"
        columns={columns}
        data={orders}
        FormComponent={ProductionOrderForm}
        onSave={handleSaveOrder}
        emptyMessage="Belum ada production order"
      />
    </div>
  );
}
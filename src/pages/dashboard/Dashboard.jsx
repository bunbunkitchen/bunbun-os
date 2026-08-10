import {
  useEffect,
  useState,
} from "react";

import {
  MdAttachMoney,
  MdMoneyOff,
  MdAccountBalanceWallet,
  MdBakeryDining,
  MdViewKanban,
  MdFactory,
  MdShoppingCart,
  MdWarning,
} from "react-icons/md";

import PageTitle from "../../components/ui/PageTitle";
import Currency from "../../components/ui/Currency";
import LoadingState from "../../components/ui/LoadingState";
import KpiCard from "../../components/dashboard/KpiCard";
import BusinessIntelligence from "../../components/dashboard/BusinessIntelligence";

import {
  useAuth,
} from "../../context/AuthContext";

import {
  getBusinessIntelligence,
  getDashboardSummary,
} from "../../services/dashboardService";

export default function Dashboard() {
  const { role } = useAuth();

  const isOwner =
    role === "owner";

  const isBaker =
    role === "baker";

  const canSeePurchase =
    isOwner || isBaker;

  const [summary, setSummary] =
    useState({
      income: 0,
      expense: 0,
      profit: 0,
      purchaseToday: 0,

      productionOrders: 0,
      draftOrders: 0,
      generatedOrders: 0,

      activeBatch: 0,
      finishedBatch: 0,

      finishedQty: 0,
      rejectedQty: 0,

      inventoryTransactions: 0,

      activeBatchItems: [],
    });

  const [
    businessIntelligence,
    setBusinessIntelligence,
  ] = useState(null);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        setPageError("");

        const [
          summaryData,
          intelligenceData,
        ] = await Promise.all([
          getDashboardSummary(),
          getBusinessIntelligence(),
        ]);

        if (!isMounted) {
          return;
        }

        setSummary(summaryData);

        setBusinessIntelligence(
          intelligenceData
        );
      } catch (error) {
        console.error(
          "Gagal memuat dashboard:",
          error
        );

        if (!isMounted) {
          return;
        }

        setPageError(
          error?.message ||
            "Dashboard gagal dimuat."
        );
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <LoadingState message="Memuat dashboard..." />
    );
  }

  const lowStockCount =
    businessIntelligence
      ?.lowStockCount ?? 0;

  return (
    <div>
      <PageTitle
        title="Dashboard"
        subtitle="Ringkasan operasional Bunbun Kitchen hari ini"
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {/* KEUANGAN — OWNER SAJA */}
        {isOwner && (
          <>
            <KpiCard
              title="Pemasukan Hari Ini"
              value={
                <Currency
                  value={
                    summary.income
                  }
                />
              }
              subtitle="Bagian pendapatan Bunbun"
              icon={
                <MdAttachMoney />
              }
              tone="green"
            />

            <KpiCard
              title="Pengeluaran Hari Ini"
              value={
                <Currency
                  value={
                    summary.expense
                  }
                />
              }
              subtitle="Seluruh biaya operasional"
              icon={
                <MdMoneyOff />
              }
              tone="red"
            />

            <KpiCard
              title="Saldo Hari Ini"
              value={
                <Currency
                  value={
                    summary.profit
                  }
                />
              }
              subtitle="Pemasukan dikurangi pengeluaran"
              icon={
                <MdAccountBalanceWallet />
              }
              tone={
                summary.profit >= 0
                  ? "amber"
                  : "red"
              }
            />
          </>
        )}

        {/* PEMBELIAN — OWNER + BAKER */}
        {canSeePurchase && (
          <KpiCard
            title="Pembelian Hari Ini"
            value={
              <Currency
                value={
                  summary.purchaseToday
                }
              />
            }
            subtitle="Pembelian bahan baku"
            icon={
              <MdShoppingCart />
            }
            tone="amber"
          />
        )}

        {/* OPERASIONAL — SEMUA ROLE */}
        <KpiCard
          title="Hasil Produksi"
          value={`${Number(
            summary.finishedQty || 0
          ).toLocaleString(
            "id-ID"
          )} pcs`}
          subtitle="Produk selesai hari ini"
          icon={
            <MdBakeryDining />
          }
          tone="blue"
        />

        <KpiCard
          title="Batch Aktif"
          value={
            summary.activeBatch || 0
          }
          subtitle="Batch belum Finished"
          icon={
            <MdViewKanban />
          }
          tone="amber"
        />

        <KpiCard
          title="Production Order"
          value={
            summary.productionOrders ||
            0
          }
          subtitle={`${summary.draftOrders || 0} Draft · ${
            summary.generatedOrders ||
            0
          } Generated`}
          icon={
            <MdFactory />
          }
          tone="gray"
        />

        <KpiCard
          title="Stok Rendah"
          value={lowStockCount}
          subtitle={
            lowStockCount > 0
              ? "Bahan perlu diperiksa"
              : "Semua stok dalam batas aman"
          }
          icon={
            <MdWarning />
          }
          tone={
            lowStockCount > 0
              ? "red"
              : "green"
          }
        />
      </div>

      <div className="mt-8">
        <BusinessIntelligence
          data={
            businessIntelligence
          }
          showFinance={
            isOwner
          }
        />
      </div>
    </div>
  );
}
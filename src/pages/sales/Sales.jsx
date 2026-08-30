import { useEffect, useMemo, useState } from "react";

import Button from "../../components/ui/Button";
import Currency from "../../components/ui/Currency";
import LoadingState from "../../components/ui/LoadingState";
import Modal from "../../components/modal/Modal";
import SalesForm from "../../components/forms/SalesForm";

import {
  createSale,
  getAllSales,
} from "../../services/salesService";

const CHANNEL_OPTIONS = [
  { value: "ALL", label: "Semua" },
  { value: "PUBLIC_HUB", label: "Public Hub" },
  { value: "PUBLIC_COFFEE", label: "The Public Coffee" },
  { value: "DIRECT", label: "Direct / Online" },
  { value: "CAFE_OTHER", label: "Cafe Lain" },
];

function formatDate(date) {
  if (!date) return "-";

  const parts = date.split("-");
  if (parts.length !== 3) return date;

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);

  const [channelFilter, setChannelFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState(getToday());

  async function loadSales() {
    try {
      setLoading(true);
      setPageError("");
      setSales(await getAllSales());
    } catch (error) {
      console.error("Gagal mengambil penjualan:", error);
      setPageError(error.message || "Data penjualan gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSales();
  }, []);

  const filteredSales = useMemo(
    () =>
      sales.filter((sale) => {
        const matchChannel =
          channelFilter === "ALL" || sale.salesChannel === channelFilter;

        const matchDate = !dateFilter || sale.saleDate === dateFilter;

        return matchChannel && matchDate;
      }),
    [sales, channelFilter, dateFilter]
  );

  const reportRows = useMemo(() => {
    const grouped = new Map();

    filteredSales.forEach((sale) => {
      sale.items.forEach((item) => {
        const productKey = String(
          item.productId ?? item.productSku ?? item.productName
        );

        if (!grouped.has(productKey)) {
          grouped.set(productKey, {
            productId: item.productId,
            productSku: item.productSku || "",
            productName: item.productName || "Produk",
            dineInQty: 0,
            takeAwayQty: 0,
            totalQty: 0,
            totalSales: 0,
          });
        }

        const row = grouped.get(productKey);
        const quantity = Number(item.quantity || 0);
        const subtotal = Number(
          item.subtotal ?? quantity * Number(item.sellingPrice || 0)
        );

        if (item.orderType === "DINE_IN") {
          row.dineInQty += quantity;
        } else if (item.orderType === "TAKE_AWAY") {
          row.takeAwayQty += quantity;
        }

        row.totalQty += quantity;
        row.totalSales += subtotal;
      });
    });

    return Array.from(grouped.values()).sort((a, b) =>
      a.productName.localeCompare(b.productName, "id", {
        sensitivity: "base",
      })
    );
  }, [filteredSales]);

  const summary = useMemo(() => {
    return reportRows.reduce(
      (result, row) => {
        result.dineInQty += row.dineInQty;
        result.takeAwayQty += row.takeAwayQty;
        result.totalQty += row.totalQty;
        result.totalSales += row.totalSales;
        return result;
      },
      {
        dineInQty: 0,
        takeAwayQty: 0,
        totalQty: 0,
        totalSales: 0,
      }
    );
  }, [reportRows]);

  async function handleCreateSale(sale) {
    try {
      setSaving(true);
      setPageError("");

      const savedSale = await createSale(sale);
      setSales((previous) => [savedSale, ...previous]);
    } catch (error) {
      console.error("Gagal menyimpan penjualan:", error);
      throw error;
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingState message="Memuat data penjualan..." />;
  }

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {pageError}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            Rekap Penjualan
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Rekap penjualan per produk berdasarkan Dine In dan Take Away.
          </p>
        </div>

        <Button
          onClick={() => setShowInput(true)}
          className="bg-amber-700 hover:bg-amber-800"
        >
          + Input Penjualan Harian
        </Button>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3 md:items-end">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Tanggal
            </label>
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Sumber Penjualan
            </label>
            <select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                setDateFilter("");
                setChannelFilter("ALL");
              }}
              className="bg-gray-500 hover:bg-gray-600"
            >
              Reset Filter
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="text-sm font-medium text-green-800">Total Penjualan</p>
          <p className="mt-2 text-2xl font-bold text-green-700">
            <Currency value={summary.totalSales} />
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-medium text-amber-800">Total Item</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">
            {summary.totalQty}
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-medium text-blue-800">Dine In</p>
          <p className="mt-2 text-2xl font-bold text-blue-700">
            {summary.dineInQty}
          </p>
        </div>

        <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
          <p className="text-sm font-medium text-purple-800">Take Away</p>
          <p className="mt-2 text-2xl font-bold text-purple-700">
            {summary.takeAwayQty}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold text-gray-800">
            Rekap Penjualan per Item
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {dateFilter
              ? `Periode ${formatDate(dateFilter)}`
              : "Semua tanggal"}
            {channelFilter !== "ALL"
              ? ` • ${
                  CHANNEL_OPTIONS.find(
                    (option) => option.value === channelFilter
                  )?.label || channelFilter
                }`
              : " • Semua sumber"}
          </p>
        </div>

        {reportRows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            Belum ada penjualan pada filter yang dipilih.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Produk
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                    Dine In
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                    Take Away
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                    Total Qty
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                    Total Penjualan
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {reportRows.map((row) => (
                  <tr key={String(row.productId ?? row.productSku ?? row.productName)} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="text-sm font-medium text-gray-800">
                        {row.productName}
                      </div>
                      {row.productSku && (
                        <div className="mt-0.5 text-xs text-gray-500">
                          SKU: {row.productSku}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-sm text-gray-700">
                      {row.dineInQty}
                    </td>
                    <td className="px-5 py-4 text-right text-sm text-gray-700">
                      {row.takeAwayQty}
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-gray-800">
                      {row.totalQty}
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-gray-800">
                      <Currency value={row.totalSales} />
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="border-t bg-gray-50">
                <tr>
                  <td className="px-5 py-4 text-sm font-bold text-gray-800">
                    TOTAL
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-bold text-gray-800">
                    {summary.dineInQty}
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-bold text-gray-800">
                    {summary.takeAwayQty}
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-bold text-gray-800">
                    {summary.totalQty}
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-bold text-gray-800">
                    <Currency value={summary.totalSales} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={showInput}
        onClose={() => {
          if (!saving) setShowInput(false);
        }}
      >
        <SalesForm
          onSave={handleCreateSale}
          onCancel={() => setShowInput(false)}
          saving={saving}
        />
      </Modal>
    </div>
  );
}

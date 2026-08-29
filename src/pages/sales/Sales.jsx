import { useEffect, useMemo, useState } from "react";

import Button from "../../components/ui/Button";
import Currency from "../../components/ui/Currency";
import LoadingState from "../../components/ui/LoadingState";
import Modal from "../../components/modal/Modal";
import SalesForm from "../../components/forms/SalesForm";

import {
  createSale,
  getAllSales,
  softDeleteSale,
  updateSale,
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

function orderTypeClass(orderType) {
  if (orderType === "DINE_IN") return "bg-green-100 text-green-800";
  if (orderType === "TAKE_AWAY") return "bg-blue-100 text-blue-800";
  return "bg-gray-100 text-gray-500";
}

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");

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

  const totalAmount = useMemo(
    () =>
      filteredSales.reduce(
        (total, sale) => total + Number(sale.totalAmount || 0),
        0
      ),
    [filteredSales]
  );

  const totalItems = useMemo(
    () =>
      filteredSales.reduce(
        (total, sale) =>
          total +
          sale.items.reduce(
            (itemTotal, item) => itemTotal + Number(item.quantity || 0),
            0
          ),
        0
      ),
    [filteredSales]
  );

  async function handleCreateSale(sale) {
    setSaving(true);
    setPageError("");
    try {
      const savedSale = await createSale(sale);
      setSales((previous) => [savedSale, ...previous]);
    } catch (error) {
      console.error("Gagal menyimpan penjualan:", error);
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateSale(sale) {
    if (!selectedSale) return;
    try {
      setSaving(true);
      setPageError("");
      const updatedSale = await updateSale(selectedSale.id, sale);
      setSales((previous) =>
        previous.map((item) =>
          item.id === updatedSale.id ? updatedSale : item
        )
      );
      setSelectedSale(null);
    } catch (error) {
      console.error("Gagal memperbarui penjualan:", error);
      setPageError(error.message || "Penjualan gagal diperbarui.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSale(sale) {
    const confirmed = window.confirm(
      `Hapus transaksi penjualan tanggal ${formatDate(sale.saleDate)} dari ${sale.channelLabel}?\n\nData akan disembunyikan dari daftar aktif.`
    );
    if (!confirmed) return;

    try {
      setDeletingId(sale.id);
      setPageError("");
      await softDeleteSale(sale.id);
      setSales((previous) => previous.filter((item) => item.id !== sale.id));
    } catch (error) {
      console.error("Gagal menghapus penjualan:", error);
      setPageError(error.message || "Penjualan gagal dihapus.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <LoadingState message="Memuat data penjualan..." />;
  }

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Catatan Penjualan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Catat penjualan berdasarkan transaksi tanpa mengurangi inventory.
        </p>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="text-sm font-medium text-green-800">Total Penjualan</p>
          <p className="mt-2 text-3xl font-bold text-green-700">
            <Currency value={totalAmount} />
          </p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-medium text-blue-800">Jumlah Transaksi</p>
          <p className="mt-2 text-3xl font-bold text-blue-700">
            {filteredSales.length}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-medium text-amber-800">Total Item</p>
          <p className="mt-2 text-3xl font-bold text-amber-700">{totalItems}</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Sumber Penjualan
              </label>
              <select
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2"
              >
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Tanggal
              </label>
              <input
                type="date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
          </div>
          <Button
            onClick={() => {
              setChannelFilter("ALL");
              setDateFilter("");
            }}
            className="bg-gray-500 hover:bg-gray-600"
          >
            Reset Filter
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Daftar Transaksi</h2>
            <p className="text-sm text-gray-500">
              Satu baris mewakili satu transaksi/bill yang diinput.
            </p>
          </div>
          <Button
            onClick={() => setSelectedSale("new")}
            className="bg-amber-700 hover:bg-amber-800"
          >
            + Input Penjualan Harian
          </Button>
        </div>

        {filteredSales.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Belum ada transaksi penjualan.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-gray-500">Tanggal</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-gray-500">Sumber</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-gray-500">Item</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">Total</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
                      {formatDate(sale.saleDate)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-sm font-medium text-gray-800">
                      {sale.channelLabel}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-700">
                      <div className="space-y-2">
                        {sale.items.map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center gap-2">
                            <span>
                              {item.productName} × {item.quantity}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${orderTypeClass(item.orderType)}`}>
                              {item.orderTypeLabel}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold text-gray-800">
                      <Currency value={sale.totalAmount} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => setSelectedSale(sale)}
                          disabled={deletingId === sale.id}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          Edit
                        </Button>
                        <Button
                          onClick={() => handleDeleteSale(sale)}
                          disabled={deletingId === sale.id}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          {deletingId === sale.id ? "Menghapus..." : "Hapus"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={selectedSale !== null}
        onClose={() => {
          if (!saving) setSelectedSale(null);
        }}
      >
        {selectedSale === "new" && (
          <SalesForm
            onSave={handleCreateSale}
            onCancel={() => setSelectedSale(null)}
            saving={saving}
          />
        )}
        {selectedSale && selectedSale !== "new" && (
          <SalesForm
            initialData={selectedSale}
            onSave={handleUpdateSale}
            onCancel={() => setSelectedSale(null)}
            saving={saving}
          />
        )}
      </Modal>
    </div>
  );
}

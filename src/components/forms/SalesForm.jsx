import { useEffect, useMemo, useRef, useState } from "react";

import Button from "../ui/Button";
import { getAllProducts } from "../../services/productService";
import { createProductStockOperationKey } from "../../services/productStockService";

const CHANNEL_OPTIONS = [
  { value: "PUBLIC_HUB", label: "Public Hub" },
  { value: "PUBLIC_COFFEE", label: "The Public Coffee" },
  { value: "DIRECT", label: "Direct / Online" },
  { value: "CAFE_OTHER", label: "Cafe Lain" },
];

const ORDER_TYPE_OPTIONS = [
  { value: "DINE_IN", label: "Dine In" },
  { value: "TAKE_AWAY", label: "Take Away" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function emptyItem() {
  return {
    productId: "",
    productSku: "",
    productName: "",
    quantity: 1,
    sellingPrice: 0,
    orderType: "DINE_IN",
  };
}

export default function SalesForm({
  initialData = null,
  onSave,
  onCancel,
  saving = false,
}) {
  const isEdit = Boolean(initialData);
  const operationKeyRef = useRef(createProductStockOperationKey());

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState("");

  const [saleDate, setSaleDate] = useState(
    initialData?.saleDate || today()
  );
  const [salesChannel, setSalesChannel] = useState(
    initialData?.salesChannel || "PUBLIC_HUB"
  );
  const [notes, setNotes] = useState(initialData?.notes || "");

  const [items, setItems] = useState(
    initialData?.items?.length
      ? initialData.items.map((item) => ({
          productId: String(item.productId),
          productSku: item.productSku || "",
          productName: item.productName || "",
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
          orderType: item.orderType || "DINE_IN",
        }))
      : [emptyItem()]
  );

  const [savedTransactions, setSavedTransactions] = useState(0);
  const [savedItems, setSavedItems] = useState(0);
  const [savedAmount, setSavedAmount] = useState(0);

  useEffect(() => {
    async function loadProducts() {
      try {
        setLoadingProducts(true);
        setError("");
        const data = await getAllProducts();
        setProducts(
          data
            .filter((product) => product.status === "Aktif")
            .sort((a, b) =>
              String(a.nama || "").localeCompare(String(b.nama || ""), "id", {
                sensitivity: "base",
              })
            )
        );
      } catch (err) {
        console.error("Gagal memuat produk:", err);
        setError(err.message || "Produk gagal dimuat.");
      } finally {
        setLoadingProducts(false);
      }
    }
    loadProducts();
  }, []);

  const totalAmount = useMemo(
    () =>
      items.reduce(
        (total, item) =>
          total + Number(item.quantity || 0) * Number(item.sellingPrice || 0),
        0
      ),
    [items]
  );

  const totalItems = useMemo(
    () => items.reduce((total, item) => total + Number(item.quantity || 0), 0),
    [items]
  );

  function handleProductChange(index, productId) {
    const product = products.find(
      (item) => String(item.id) === String(productId)
    );

    setItems((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              productId,
              productSku: product?.sku || "",
              productName: product?.nama || "",
              sellingPrice: Number(product?.harga || 0),
            }
          : item
      )
    );
  }

  function handleItemChange(index, field, value) {
    setItems((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function addItem() {
    setItems((previous) => [...previous, emptyItem()]);
  }

  function removeItem(index) {
    if (items.length === 1) return;
    setItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }

  function resetTransaction() {
    setItems([emptyItem()]);
    setNotes("");
    setError("");
    operationKeyRef.current = createProductStockOperationKey();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!saleDate) {
      setError("Tanggal penjualan wajib diisi.");
      return;
    }

    if (!salesChannel) {
      setError("Sumber penjualan wajib dipilih.");
      return;
    }

    const validItems = items.filter(
      (item) => item.productId && Number(item.quantity) > 0
    );

    if (validItems.length === 0) {
      setError("Minimal pilih satu produk.");
      return;
    }

    const missingOrderType = validItems.find(
      (item) => !["DINE_IN", "TAKE_AWAY"].includes(item.orderType)
    );

    if (missingOrderType) {
      setError(
        `Jenis pesanan untuk ${missingOrderType.productName || "produk"} belum dipilih.`
      );
      return;
    }

    try {
      await onSave({
        saleDate,
        salesChannel,
        notes,
        items: validItems,
        operationKey: operationKeyRef.current,
      });

      if (!isEdit) {
        setSavedTransactions((value) => value + 1);
        setSavedItems(
          (value) =>
            value +
            validItems.reduce(
              (total, item) => total + Number(item.quantity || 0),
              0
            )
        );
        setSavedAmount(
          (value) =>
            value +
            validItems.reduce(
              (total, item) =>
                total +
                Number(item.quantity || 0) * Number(item.sellingPrice || 0),
              0
            )
        );
        resetTransaction();
      }
    } catch (err) {
      setError(err.message || "Penjualan gagal disimpan.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-800">
          {isEdit ? "Edit Penjualan" : "Input Penjualan Harian"}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {isEdit
            ? "Perbarui transaksi penjualan."
            : "Masukkan bill satu per satu. Tanggal dan sumber tetap untuk seluruh sesi."}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Sesi Penjualan
        </p>
        {!isEdit && (
          <p className="mt-1 text-xs text-amber-700">
            Tanggal dan sumber dipakai untuk setiap transaksi sampai sesi selesai.
          </p>
        )}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Tanggal
            </label>
            <input
              type="date"
              value={saleDate}
              onChange={(event) => setSaleDate(event.target.value)}
              disabled={!isEdit && savedTransactions > 0}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Sumber Penjualan
            </label>
            <select
              value={salesChannel}
              onChange={(event) => setSalesChannel(event.target.value)}
              disabled={!isEdit && savedTransactions > 0}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100"
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!isEdit && savedTransactions > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-medium text-blue-700">Transaksi Tersimpan</p>
            <p className="mt-1 text-2xl font-bold text-blue-800">{savedTransactions}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-medium text-amber-700">Total Item</p>
            <p className="mt-1 text-2xl font-bold text-amber-800">{savedItems}</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-xs font-medium text-green-700">Total Penjualan</p>
            <p className="mt-1 text-xl font-bold text-green-800">
              {formatCurrency(savedAmount)}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200">
        <div className="border-b bg-gray-50 px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-semibold text-gray-800">Item Terjual</h3>
              <p className="text-xs text-gray-500">
                Setiap item dapat memiliki jenis pesanan yang berbeda.
              </p>
            </div>
            <Button
              type="button"
              onClick={addItem}
              className="bg-amber-700 hover:bg-amber-800"
            >
              + Tambah Item
            </Button>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {loadingProducts ? (
            <p className="text-sm text-gray-500">Memuat produk...</p>
          ) : (
            items.map((item, index) => (
              <div key={index} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="grid gap-3 md:grid-cols-12 md:items-end">
                  <div className="md:col-span-5">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Produk
                    </label>
                    <select
                      value={item.productId}
                      onChange={(event) => handleProductChange(index, event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      required
                    >
                      <option value="">Pilih produk</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.nama}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Qty
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(event) =>
                        handleItemChange(index, "quantity", event.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      required
                    />
                  </div>

                  <div className="md:col-span-3">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Jenis Pesanan
                    </label>
                    <div className="flex overflow-hidden rounded-lg border border-gray-300">
                      {ORDER_TYPE_OPTIONS.map((option) => {
                        const active = item.orderType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              handleItemChange(index, "orderType", option.value)
                            }
                            className={`flex-1 px-3 py-2 text-sm font-medium ${
                              active
                                ? option.value === "DINE_IN"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-blue-100 text-blue-800"
                                : "bg-white text-gray-500 hover:bg-gray-50"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Subtotal
                    </label>
                    <div className="rounded-lg bg-gray-50 px-3 py-2 font-semibold text-gray-800">
                      {formatCurrency(
                        Number(item.quantity || 0) * Number(item.sellingPrice || 0)
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-500">
                    Harga: {formatCurrency(item.sellingPrice)}
                  </div>
                  {items.length > 1 && (
                    <Button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Hapus
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-green-800">Transaksi Ini</p>
            <p className="mt-1 text-xs text-green-700">{totalItems} item</p>
          </div>
          <p className="text-2xl font-bold text-green-700">
            {formatCurrency(totalAmount)}
          </p>
        </div>
      </div>

      {isEdit && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Catatan</label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Catatan tambahan..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="bg-gray-500 hover:bg-gray-600"
          >
            {isEdit ? "Batal" : "Selesai Input"}
          </Button>
        )}
        <Button
          type="submit"
          disabled={saving || loadingProducts}
          className="bg-amber-700 hover:bg-amber-800"
        >
          {saving
            ? "Menyimpan..."
            : isEdit
            ? "Simpan Perubahan"
            : "Simpan & Transaksi Berikutnya"}
        </Button>
      </div>
    </form>
  );
}

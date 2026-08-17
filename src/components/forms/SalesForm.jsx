import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Button from "../ui/Button";

import {
  getAllProducts,
} from "../../services/productService";


const CHANNEL_OPTIONS = [
  {
    value: "PUBLIC_HUB",
    label: "Public Hub",
  },
  {
    value: "PUBLIC_COFFEE",
    label: "The Public Coffee",
  },
  {
    value: "DIRECT",
    label: "Direct / Online",
  },
  {
    value: "CAFE_OTHER",
    label: "Cafe Lain",
  },
];


function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}


function formatCurrency(value) {
  return new Intl.NumberFormat(
    "id-ID",
    {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }
  ).format(Number(value || 0));
}


export default function SalesForm({
  initialData = null,
  onSave,
  onCancel,
  saving = false,
}) {
  const [products, setProducts] =
    useState([]);

  const [loadingProducts, setLoadingProducts] =
    useState(true);

  const [error, setError] =
    useState("");

  const [saleDate, setSaleDate] =
    useState(
      initialData?.saleDate ||
        today()
    );

  const [salesChannel, setSalesChannel] =
    useState(
      initialData?.salesChannel ||
        "PUBLIC_HUB"
    );

  const [notes, setNotes] =
    useState(
      initialData?.notes || ""
    );

  const [items, setItems] =
    useState(
      initialData?.items?.length
        ? initialData.items.map(
            (item) => ({
              productId:
                String(
                  item.productId
                ),
              productSku:
                item.productSku,
              productName:
                item.productName,
              quantity:
                item.quantity,
              sellingPrice:
                item.sellingPrice,
            })
          )
        : [
            {
              productId: "",
              productSku: "",
              productName: "",
              quantity: 1,
              sellingPrice: 0,
            },
          ]
    );


  useEffect(() => {
    async function loadProducts() {
      try {
        setLoadingProducts(true);
        setError("");

        const data =
          await getAllProducts();

        setProducts(
          data.filter(
            (product) =>
              product.status ===
              "Aktif"
          )
        );
      } catch (err) {
        console.error(
          "Gagal memuat produk:",
          err
        );

        setError(
          err.message ||
            "Produk gagal dimuat."
        );
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
          total +
          Number(
            item.quantity || 0
          ) *
            Number(
              item.sellingPrice || 0
            ),
        0
      ),
    [items]
  );


  function handleProductChange(
    index,
    productId
  ) {
    const product =
      products.find(
        (item) =>
          String(item.id) ===
          String(productId)
      );

    setItems((previous) =>
      previous.map(
        (item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                productId,
                productSku:
                  product?.sku ||
                  "",
                productName:
                  product?.nama ||
                  "",
                sellingPrice:
                  product?.harga ||
                  0,
              }
            : item
      )
    );
  }


  function handleItemChange(
    index,
    field,
    value
  ) {
    setItems((previous) =>
      previous.map(
        (item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                [field]: value,
              }
            : item
      )
    );
  }


  function addItem() {
    setItems((previous) => [
      ...previous,
      {
        productId: "",
        productSku: "",
        productName: "",
        quantity: 1,
        sellingPrice: 0,
      },
    ]);
  }


  function removeItem(index) {
    if (items.length === 1) {
      return;
    }

    setItems((previous) =>
      previous.filter(
        (_, itemIndex) =>
          itemIndex !== index
      )
    );
  }


  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    setError("");

    if (!saleDate) {
      setError(
        "Tanggal penjualan wajib diisi."
      );
      return;
    }

    if (!salesChannel) {
      setError(
        "Jenis penjualan wajib dipilih."
      );
      return;
    }

    const validItems =
      items.filter(
        (item) =>
          item.productId &&
          Number(item.quantity) > 0
      );

    if (
      validItems.length === 0
    ) {
      setError(
        "Minimal pilih satu produk."
      );
      return;
    }

    try {
      await onSave({
        saleDate,
        salesChannel,
        notes,
        items: validItems,
      });
    } catch (err) {
      setError(
        err.message ||
          "Penjualan gagal disimpan."
      );
    }
  }


  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      <div>
        <h2 className="text-xl font-bold text-gray-800">
          {initialData
            ? "Edit Penjualan"
            : "Tambah Penjualan"}
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Catatan penjualan saja. Data ini
          tidak mengurangi inventory.
        </p>
      </div>


      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}


      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Tanggal
          </label>

          <input
            type="date"
            value={saleDate}
            onChange={(event) =>
              setSaleDate(
                event.target.value
              )
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
            required
          />
        </div>


        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Sumber Penjualan
          </label>

          <select
            value={salesChannel}
            onChange={(event) =>
              setSalesChannel(
                event.target.value
              )
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
          >
            {CHANNEL_OPTIONS.map(
              (option) => (
                <option
                  key={
                    option.value
                  }
                  value={
                    option.value
                  }
                >
                  {option.label}
                </option>
              )
            )}
          </select>
        </div>
      </div>


      {salesChannel ===
        "PUBLIC_COFFEE" && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Untuk The Public Coffee,
          catat satu rekap penjualan
          untuk periode bulan yang
          dilaporkan.
        </div>
      )}


      <div className="rounded-xl border border-gray-200">
        <div className="border-b bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-800">
                Item Terjual
              </h3>

              <p className="text-xs text-gray-500">
                Harga disimpan sebagai
                snapshot histori penjualan.
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


        <div className="space-y-4 p-4">
          {loadingProducts ? (
            <p className="text-sm text-gray-500">
              Memuat produk...
            </p>
          ) : (
            items.map(
              (item, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-gray-200 p-4"
                >
                  <div className="grid gap-4 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Produk
                      </label>

                      <select
                        value={
                          item.productId
                        }
                        onChange={(
                          event
                        ) =>
                          handleProductChange(
                            index,
                            event.target
                              .value
                          )
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                        required
                      >
                        <option value="">
                          Pilih produk
                        </option>

                        {products.map(
                          (product) => (
                            <option
                              key={
                                product.id
                              }
                              value={
                                product.id
                              }
                            >
                              {product.nama}
                            </option>
                          )
                        )}
                      </select>

                      {item.productSku && (
                        <p className="mt-1 text-xs text-gray-500">
                          SKU:{" "}
                          {
                            item.productSku
                          }
                        </p>
                      )}
                    </div>


                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Qty
                      </label>

                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={
                          item.quantity
                        }
                        onChange={(
                          event
                        ) =>
                          handleItemChange(
                            index,
                            "quantity",
                            event.target
                              .value
                          )
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                        required
                      />
                    </div>


                    <div className="md:col-span-3">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Harga Jual
                      </label>

                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={
                          item.sellingPrice
                        }
                        onChange={(
                          event
                        ) =>
                          handleItemChange(
                            index,
                            "sellingPrice",
                            event.target
                              .value
                          )
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                        required
                      />

                      <p className="mt-1 text-xs text-gray-500">
                        Harga default dari
                        master produk.
                      </p>
                    </div>


                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Subtotal
                      </label>

                      <div className="rounded-lg bg-gray-50 px-3 py-2 font-semibold text-gray-800">
                        {formatCurrency(
                          Number(
                            item.quantity ||
                              0
                          ) *
                            Number(
                              item.sellingPrice ||
                                0
                            )
                        )}
                      </div>
                    </div>
                  </div>


                  {items.length > 1 && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        onClick={() =>
                          removeItem(
                            index
                          )
                        }
                        className="bg-red-600 hover:bg-red-700"
                      >
                        Hapus Item
                      </Button>
                    </div>
                  )}
                </div>
              )
            )
          )}
        </div>
      </div>


      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="text-sm font-medium text-green-800">
          Total Penjualan
        </p>

        <p className="mt-1 text-3xl font-bold text-green-700">
          {formatCurrency(
            totalAmount
          )}
        </p>
      </div>


      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Catatan
        </label>

        <textarea
          value={notes}
          onChange={(event) =>
            setNotes(
              event.target.value
            )
          }
          rows={3}
          placeholder="Catatan tambahan..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
        />
      </div>


      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="bg-gray-500 hover:bg-gray-600"
          >
            Batal
          </Button>
        )}

        <Button
          type="submit"
          disabled={
            saving ||
            loadingProducts
          }
          className="bg-amber-700 hover:bg-amber-800"
        >
          {saving
            ? "Menyimpan..."
            : initialData
            ? "Simpan Perubahan"
            : "Simpan Penjualan"}
        </Button>
      </div>
    </form>
  );
}
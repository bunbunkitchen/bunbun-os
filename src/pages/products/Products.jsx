import {
  useEffect,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import Currency from "../../components/ui/Currency";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import ProductForm from "../../components/forms/ProductForm";

import {
  createProduct,
  getAllProducts,
  softDeleteProduct,
  updateProduct,
} from "../../services/productService";

export default function Products() {
  const [products, setProducts] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadProducts() {
      try {
        setPageError("");

        const data =
          await getAllProducts();

        setProducts(data);
      } catch (error) {
        console.error(
          "Gagal mengambil produk:",
          error
        );

        setPageError(
          error.message ||
            "Data produk gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadProducts();
  }, []);

  const columns = [
    {
      key: "sku",
      title: "SKU",
    },
    {
      key: "nama",
      title: "Nama Produk",
    },
    {
      key: "kategori",
      title: "Kategori",
      render: (product) =>
        product.kategori || "-",
    },
    {
      key: "harga",
      title: "Harga Jual",
      render: (product) => (
        <Currency
          value={product.harga}
        />
      ),
    },
    {
      key: "status",
      title: "Status",
      render: (product) => (
        <StatusBadge
          status={product.status}
        />
      ),
    },
  ];

  async function handleCreateProduct(
    product
  ) {
    const savedProduct =
      await createProduct(product);

    setProducts((previous) =>
      [...previous, savedProduct].sort(
        (a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
      )
    );
  }

  async function handleUpdateProduct(
    selectedProduct,
    values
  ) {
    const updatedProduct =
      await updateProduct(
        selectedProduct.id,
        values
      );

    setProducts((previous) =>
      previous
        .map((item) =>
          item.id ===
          updatedProduct.id
            ? updatedProduct
            : item
        )
        .sort((a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
        )
    );
  }

  async function handleDeleteProduct(
    product
  ) {
    await softDeleteProduct(
      product.id
    );

    setProducts((previous) =>
      previous.filter(
        (item) =>
          item.id !== product.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data produk..." />
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
        title="Produk"
        subtitle="Kelola master produk Bunbun Kitchen"
        sectionTitle="Daftar Produk"
        sectionDescription="Master data seluruh produk Bunbun Kitchen"
        searchPlaceholder="Cari produk..."
        addButtonText="+ Tambah Produk"
        columns={columns}
        data={products}
        FormComponent={ProductForm}
        onSave={
          handleCreateProduct
        }
        onUpdate={
          handleUpdateProduct
        }
        onDelete={
          handleDeleteProduct
        }
        getItemLabel={(item) =>
          `${item.sku} — ${item.nama}`
        }
        emptyMessage="Belum ada produk"
      />
    </div>
  );
}
import {
  useEffect,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import CategoryForm from "../../components/forms/CategoryForm";

import {
  createCategory,
  getAllCategories,
  softDeleteCategory,
  updateCategory,
} from "../../services/categoryService";

export default function Categories() {
  const [categories, setCategories] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadCategories() {
      try {
        setPageError("");

        const data =
          await getAllCategories();

        setCategories(data);
      } catch (error) {
        console.error(
          "Gagal mengambil kategori:",
          error
        );

        setPageError(
          error.message ||
            "Data kategori gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadCategories();
  }, []);

  const columns = [
    {
      key: "kode",
      title: "Kode",
    },
    {
      key: "nama",
      title: "Nama Kategori",
    },
    {
      key: "status",
      title: "Status",
      render: (category) => (
        <StatusBadge
          status={category.status}
        />
      ),
    },
  ];

  async function handleCreateCategory(
    category
  ) {
    const savedCategory =
      await createCategory(category);

    setCategories((previous) =>
      [...previous, savedCategory].sort(
        (a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
      )
    );
  }

  async function handleUpdateCategory(
    selectedCategory,
    values
  ) {
    const updatedCategory =
      await updateCategory(
        selectedCategory.id,
        values
      );

    setCategories((previous) =>
      previous
        .map((item) =>
          item.id === updatedCategory.id
            ? updatedCategory
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

  async function handleDeleteCategory(
    category
  ) {
    await softDeleteCategory(
      category.id
    );

    setCategories((previous) =>
      previous.filter(
        (item) =>
          item.id !== category.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data kategori..." />
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
        title="Kategori"
        subtitle="Kelola kategori produk Bunbun Kitchen"
        sectionTitle="Daftar Kategori"
        sectionDescription="Master kategori untuk pengelompokan produk"
        searchPlaceholder="Cari kategori..."
        addButtonText="+ Tambah Kategori"
        columns={columns}
        data={categories}
        FormComponent={CategoryForm}
        onSave={
          handleCreateCategory
        }
        onUpdate={
          handleUpdateCategory
        }
        onDelete={
          handleDeleteCategory
        }
        getItemLabel={(item) =>
          `${item.kode} — ${item.nama}`
        }
        emptyMessage="Belum ada kategori"
      />
    </div>
  );
}
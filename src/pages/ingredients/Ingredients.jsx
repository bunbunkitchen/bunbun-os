import {
  useEffect,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import Currency from "../../components/ui/Currency";
import StatusBadge from "../../components/ui/StatusBadge";
import IngredientForm from "../../components/forms/IngredientForm";
import LoadingState from "../../components/ui/LoadingState";

import {
  createIngredient,
  getAllIngredients,
  softDeleteIngredient,
  updateIngredient,
} from "../../services/ingredientService";

export default function Ingredients() {
  const [ingredients, setIngredients] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadIngredients() {
      try {
        setPageError("");

        const data =
          await getAllIngredients();

        setIngredients(data);
      } catch (error) {
        console.error(
          "Gagal mengambil bahan baku:",
          error
        );

        setPageError(
          error.message ||
            "Data bahan baku gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadIngredients();
  }, []);

  const columns = [
    {
      key: "kode",
      title: "Kode",
    },
    {
      key: "nama",
      title: "Nama Bahan",
    },
    {
      key: "kategori",
      title: "Kategori",
    },
    {
      key: "satuan",
      title: "Satuan",
    },
    {
      key: "harga",
      title: "Harga Beli",
      render: (ingredient) => (
        <Currency
          value={ingredient.harga}
        />
      ),
    },
    {
      key: "minimumStok",
      title: "Min. Stok",
      render: (ingredient) =>
        `${ingredient.minimumStok.toLocaleString(
          "id-ID"
        )} ${ingredient.satuan}`,
    },
    {
      key: "status",
      title: "Status",
      render: (ingredient) => (
        <StatusBadge
          status={ingredient.status}
        />
      ),
    },
  ];

  async function handleCreateIngredient(
    ingredient
  ) {
    const savedIngredient =
      await createIngredient(
        ingredient
      );

    setIngredients((previous) =>
      [...previous, savedIngredient].sort(
        (a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
      )
    );
  }

  async function handleUpdateIngredient(
    selectedIngredient,
    values
  ) {
    const updatedIngredient =
      await updateIngredient(
        selectedIngredient.id,
        values
      );

    setIngredients((previous) =>
      previous
        .map((item) =>
          item.id ===
          updatedIngredient.id
            ? updatedIngredient
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

  async function handleDeleteIngredient(
    ingredient
  ) {
    await softDeleteIngredient(
      ingredient.id
    );

    setIngredients((previous) =>
      previous.filter(
        (item) =>
          item.id !== ingredient.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data bahan baku..." />
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
        title="Bahan Baku"
        subtitle="Kelola master bahan baku Bunbun Kitchen"
        sectionTitle="Daftar Bahan Baku"
        sectionDescription="Master data bahan untuk recipe, purchasing, inventory, dan produksi"
        searchPlaceholder="Cari bahan baku..."
        addButtonText="+ Tambah Bahan"
        columns={columns}
        data={ingredients}
        FormComponent={IngredientForm}
        onSave={
          handleCreateIngredient
        }
        onUpdate={
          handleUpdateIngredient
        }
        onDelete={
          handleDeleteIngredient
        }
        getItemLabel={(item) =>
          `${item.kode} — ${item.nama}`
        }
        emptyMessage="Belum ada bahan baku"
      />
    </div>
  );
}
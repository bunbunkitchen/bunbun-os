import {
  useEffect,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import MasterPage from "../../components/ui/MasterPage";
import StatusBadge from "../../components/ui/StatusBadge";
import Button from "../../components/ui/Button";
import RecipeForm from "../../components/forms/RecipeForm";
import LoadingState from "../../components/ui/LoadingState";

import {
  createRecipe,
  getAllRecipes,
  softDeleteRecipe,
  updateRecipe,
} from "../../services/recipeService";

export default function Recipes() {
  const navigate = useNavigate();

  const [recipes, setRecipes] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  useEffect(() => {
    async function loadRecipes() {
      try {
        setPageError("");

        const data =
          await getAllRecipes();

        setRecipes(data);
      } catch (error) {
        console.error(
          "Gagal mengambil Recipe:",
          error
        );

        setPageError(
          error.message ||
            "Data Recipe gagal dimuat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadRecipes();
  }, []);

  const columns = [
    {
      key: "kode",
      title: "Kode",
    },
    {
      key: "nama",
      title: "Nama Recipe",
    },
    {
      key: "productNama",
      title: "Produk",
      render: (recipe) =>
        recipe.productNama
          ? `${recipe.productSku} — ${recipe.productNama}`
          : "Belum dihubungkan",
    },
    {
      key: "kategori",
      title: "Kategori",
      render: (recipe) =>
        recipe.kategori || "-",
    },
    {
      key: "yield",
      title: "Yield",
      render: (recipe) =>
        `${recipe.yield.toLocaleString(
          "id-ID"
        )} ${recipe.satuanYield}`,
    },
    {
      key: "status",
      title: "Status",
      render: (recipe) => (
        <StatusBadge
          status={recipe.status}
        />
      ),
    },
    {
      key: "detail",
      title: "Detail",
      render: (recipe) => (
        <Button
          onClick={() =>
            navigate(
              `/recipes/${recipe.kode}`
            )
          }
          className="bg-stone-700 hover:bg-stone-800"
        >
          Komposisi
        </Button>
      ),
    },
  ];

  async function handleCreateRecipe(
    recipe
  ) {
    const savedRecipe =
      await createRecipe(recipe);

    setRecipes((previous) =>
      [...previous, savedRecipe].sort(
        (a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
      )
    );
  }

  async function handleUpdateRecipe(
    selectedRecipe,
    values
  ) {
    const updatedRecipe =
      await updateRecipe(
        selectedRecipe.id,
        values
      );

    setRecipes((previous) =>
      previous
        .map((item) =>
          item.id === updatedRecipe.id
            ? updatedRecipe
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

  async function handleDeleteRecipe(
    recipe
  ) {
    await softDeleteRecipe(
      recipe.id
    );

    setRecipes((previous) =>
      previous.filter(
        (item) =>
          item.id !== recipe.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data Recipe..." />
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
        title="Recipe"
        subtitle="Kelola master Recipe Bunbun Kitchen"
        sectionTitle="Daftar Recipe"
        sectionDescription="Master Recipe untuk costing, produksi, dan kebutuhan bahan baku"
        searchPlaceholder="Cari Recipe..."
        addButtonText="+ Tambah Recipe"
        columns={columns}
        data={recipes}
        FormComponent={RecipeForm}
        onSave={
          handleCreateRecipe
        }
        onUpdate={
          handleUpdateRecipe
        }
        onDelete={
          handleDeleteRecipe
        }
        getItemLabel={(item) =>
          `${item.kode} — ${item.nama}`
        }
        emptyMessage="Belum ada Recipe"
      />
    </div>
  );
}
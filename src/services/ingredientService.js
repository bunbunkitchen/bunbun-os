import { supabase } from "../lib/supabase";

const TABLE_NAME = "ingredients";

function mapIngredient(row) {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    kategori: row.kategori,
    satuan: row.satuan,
    harga: Number(row.harga),
    minimumStok: Number(
      row.minimum_stok
    ),
    status: row.is_active
      ? "Aktif"
      : "Nonaktif",
  };
}

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error(
      "Pengguna belum login."
    );
  }

  return user;
}

export async function getAllIngredients() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("is_deleted", false)
    .order("nama", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    mapIngredient
  );
}

export async function createIngredient(
  ingredient
) {
  const user = await getCurrentUser();

  const payload = {
    kode: ingredient.kode.trim(),
    nama: ingredient.nama.trim(),
    kategori:
      ingredient.kategori.trim(),
    satuan:
      ingredient.satuan.trim(),
    harga: Number(
      ingredient.harga
    ),
    minimum_stok: Number(
      ingredient.minimumStok
    ),
    is_active: true,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapIngredient(data);
}

export async function updateIngredient(
  ingredientId,
  ingredient
) {
  const user = await getCurrentUser();

  const payload = {
    kode: ingredient.kode.trim(),
    nama: ingredient.nama.trim(),
    kategori:
      ingredient.kategori.trim(),
    satuan:
      ingredient.satuan.trim(),
    harga: Number(
      ingredient.harga
    ),
    minimum_stok: Number(
      ingredient.minimumStok
    ),
    is_active:
      ingredient.status !==
      "Nonaktif",
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", ingredientId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapIngredient(data);
}

async function countActiveReferences({
  table,
  column,
  ingredientId,
}) {
  let query = supabase
    .from(table)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq(column, ingredientId);

  if (
    table === "recipe_items" ||
    table === "purchases" ||
    table ===
      "inventory_transactions"
  ) {
    query = query.eq(
      "is_deleted",
      false
    );
  }

  const { count, error } =
    await query;

  if (error) {
    throw error;
  }

  return Number(count || 0);
}

export async function softDeleteIngredient(
  ingredientId
) {
  const user = await getCurrentUser();

  const [
    recipeUsage,
    purchaseUsage,
    inventoryUsage,
  ] = await Promise.all([
    countActiveReferences({
      table: "recipe_items",
      column: "ingredient_id",
      ingredientId,
    }),

    countActiveReferences({
      table: "purchases",
      column: "ingredient_id",
      ingredientId,
    }),

    countActiveReferences({
      table:
        "inventory_transactions",
      column: "ingredient_id",
      ingredientId,
    }),
  ]);

  if (
    recipeUsage > 0 ||
    purchaseUsage > 0 ||
    inventoryUsage > 0
  ) {
    throw new Error(
      "Bahan baku sudah digunakan pada recipe, purchasing, atau inventory dan tidak dapat dihapus. Ubah status bahan menjadi Nonaktif."
    );
  }

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      is_active: false,
      updated_by: user.id,
    })
    .eq("id", ingredientId);

  if (error) {
    throw error;
  }
}
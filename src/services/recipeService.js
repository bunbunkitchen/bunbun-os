import { supabase } from "../lib/supabase";

const RECIPE_TABLE = "recipes";
const RECIPE_ITEM_TABLE = "recipe_items";

function mapRecipe(row) {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    kategori:
      row.products?.categories?.nama ??
      row.kategori ??
      "",
    productId: row.product_id,
    productSku: row.products?.sku ?? "",
    productNama: row.products?.nama ?? "",
    yield: Number(row.yield_qty),
    satuanYield: row.yield_unit,
    status: row.is_active
      ? "Aktif"
      : "Nonaktif",
  };
}

function mapRecipeItem(row) {
  const ingredientUnit =
    row.ingredients?.satuan ?? "";

  const ingredientPrice = Number(
    row.ingredients?.harga || 0
  );

  const unitDivider =
    ingredientUnit === "kg"
      ? 1000
      : ingredientUnit === "liter"
      ? 1000
      : 1;

  return {
    id: row.id,
    recipeId: row.recipe_id,
    ingredientId: row.ingredient_id,
    ingredientKode:
      row.ingredients?.kode ?? "",
    ingredientNama:
      row.ingredients?.nama ?? "",
    jumlah: Number(row.jumlah),
    satuan: row.satuan,
    urutan: row.urutan,
    hargaPerSatuan:
      ingredientPrice / unitDivider,
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

const recipeSelect = `
  *,
  products (
    sku,
    nama,
    categories (
      nama
    )
  )
`;

export async function getAllRecipes() {
  const { data, error } = await supabase
    .from(RECIPE_TABLE)
    .select(recipeSelect)
    .eq("is_deleted", false)
    .order("nama", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapRecipe);
}

export async function getRecipeByCode(
  recipeKode
) {
  const { data, error } = await supabase
    .from(RECIPE_TABLE)
    .select(recipeSelect)
    .eq("kode", recipeKode)
    .eq("is_deleted", false)
    .single();

  if (error) {
    throw error;
  }

  return mapRecipe(data);
}

export async function createRecipe(recipe) {
  const user = await getCurrentUser();

  const payload = {
    kode: recipe.kode.trim(),
    nama: recipe.nama.trim(),
    kategori:
      recipe.kategori?.trim() || null,
    product_id: recipe.productId,
    yield_qty: Number(recipe.yield),
    yield_unit:
      recipe.satuanYield.trim(),
    is_active: true,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(RECIPE_TABLE)
    .insert(payload)
    .select(recipeSelect)
    .single();

  if (error) {
    throw error;
  }

  return mapRecipe(data);
}

export async function updateRecipe(
  recipeId,
  recipe
) {
  const user = await getCurrentUser();

  const payload = {
    kode: recipe.kode.trim(),
    nama: recipe.nama.trim(),
    kategori:
      recipe.kategori?.trim() || null,
    product_id: recipe.productId,
    yield_qty: Number(recipe.yield),
    yield_unit:
      recipe.satuanYield.trim(),
    is_active:
      recipe.status !== "Nonaktif",
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(RECIPE_TABLE)
    .update(payload)
    .eq("id", recipeId)
    .select(recipeSelect)
    .single();

  if (error) {
    throw error;
  }

  return mapRecipe(data);
}

export async function softDeleteRecipe(
  recipeId
) {
  const user = await getCurrentUser();

  const {
    count,
    error: usageError,
  } = await supabase
    .from("production_orders")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("recipe_id", recipeId)
    .eq("is_deleted", false);

  if (usageError) {
    throw usageError;
  }

  if (Number(count || 0) > 0) {
    throw new Error(
      "Recipe sudah digunakan pada Production Order dan tidak dapat dihapus. Ubah status Recipe menjadi Nonaktif."
    );
  }

  const { error: itemError } =
    await supabase
      .from(RECIPE_ITEM_TABLE)
      .update({
        is_deleted: true,
        updated_by: user.id,
      })
      .eq("recipe_id", recipeId)
      .eq("is_deleted", false);

  if (itemError) {
    throw itemError;
  }

  const { error: recipeError } =
    await supabase
      .from(RECIPE_TABLE)
      .update({
        is_deleted: true,
        is_active: false,
        updated_by: user.id,
      })
      .eq("id", recipeId);

  if (recipeError) {
    throw recipeError;
  }
}

export async function getRecipeItems(
  recipeId
) {
  const { data, error } = await supabase
    .from(RECIPE_ITEM_TABLE)
    .select(`
      *,
      ingredients (
        kode,
        nama,
        harga,
        satuan
      )
    `)
    .eq("recipe_id", recipeId)
    .eq("is_deleted", false)
    .order("urutan", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    mapRecipeItem
  );
}

export async function createRecipeItem(
  item
) {
  const user = await getCurrentUser();

  const payload = {
    recipe_id: item.recipeId,
    ingredient_id:
      item.ingredientId,
    jumlah: Number(item.jumlah),
    satuan: item.satuan.trim(),
    urutan: Number(
      item.urutan || 1
    ),
    created_by: user.id,
    updated_by: user.id,
  };

  /*
   * Cek apakah bahan pernah ada,
   * termasuk yang sudah di-soft delete.
   */
  const {
    data: existingItem,
    error: existingError,
  } = await supabase
    .from(RECIPE_ITEM_TABLE)
    .select("id, is_deleted")
    .eq(
      "recipe_id",
      item.recipeId
    )
    .eq(
      "ingredient_id",
      item.ingredientId
    )
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  /*
   * Kalau masih aktif, benar-benar duplikat.
   */
  if (
    existingItem &&
    existingItem.is_deleted === false
  ) {
    throw new Error(
      "Bahan tersebut sudah ada dalam Recipe."
    );
  }

  /*
   * Kalau pernah dihapus, aktifkan kembali
   * dan perbarui jumlah/satuannya.
   */
  if (
    existingItem &&
    existingItem.is_deleted === true
  ) {
    const { data, error } =
      await supabase
        .from(RECIPE_ITEM_TABLE)
        .update({
          jumlah: payload.jumlah,
          satuan: payload.satuan,
          urutan: payload.urutan,
          is_deleted: false,
          updated_by: user.id,
        })
        .eq("id", existingItem.id)
        .select(`
          *,
          ingredients (
            kode,
            nama,
            harga,
            satuan
          )
        `)
        .single();

    if (error) {
      throw error;
    }

    return mapRecipeItem(data);
  }

  /*
   * Kalau belum pernah ada, insert baru.
   */
  const { data, error } = await supabase
    .from(RECIPE_ITEM_TABLE)
    .insert(payload)
    .select(`
      *,
      ingredients (
        kode,
        nama,
        harga,
        satuan
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapRecipeItem(data);
}

export async function softDeleteRecipeItem(
  recipeItemId
) {
  const user = await getCurrentUser();

  const { error } = await supabase
    .from(RECIPE_ITEM_TABLE)
    .update({
      is_deleted: true,
      updated_by: user.id,
    })
    .eq("id", recipeItemId)
    .eq("is_deleted", false);

  if (error) {
    throw error;
  }
}
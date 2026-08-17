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

    productId:
      row.product_id,

    productSku:
      row.products?.sku ?? "",

    productNama:
      row.products?.nama ?? "",

    yield:
      Number(row.yield_qty),

    satuanYield:
      row.yield_unit,

    status:
      row.is_active
        ? "Aktif"
        : "Nonaktif",
  };
}

function getUnitDivider(unit) {
  const normalized =
    String(unit || "")
      .trim()
      .toLowerCase();

  if (
    normalized === "kg" ||
    normalized === "liter" ||
    normalized === "l"
  ) {
    return 1000;
  }

  return 1;
}

function mapRecipeItem(row) {
  const ingredientUnit =
    row.ingredients?.satuan ?? "";

  const ingredientPrice =
    Number(
      row.ingredients?.harga || 0
    );

  const unitDivider =
    getUnitDivider(
      ingredientUnit
    );

  return {
    id:
      row.id,

    recipeId:
      row.recipe_id,

    ingredientId:
      row.ingredient_id,

    ingredientKode:
      row.ingredients?.kode ?? "",

    ingredientNama:
      row.ingredients?.nama ?? "",

    subRecipeId:
      row.sub_recipe_id,

    subRecipeKode:
      row.sub_recipes?.kode ?? "",

    subRecipeNama:
      row.sub_recipes?.nama ?? "",

    subRecipeYield:
      Number(
        row.sub_recipes?.yield_qty || 0
      ),

    subRecipeYieldUnit:
      row.sub_recipes?.yield_unit ?? "",

    jumlah:
      Number(
        row.jumlah || 0
      ),

    satuan:
      row.satuan ?? "",

    urutan:
      Number(
        row.urutan || 0
      ),

    /*
     * Harga bahan baku:
     *
     * kg    -> harga / 1000
     * liter -> harga / 1000
     * gram/ml/pcs -> harga langsung
     */
    hargaPerSatuan:
      row.ingredient_id
        ? ingredientPrice /
          unitDivider
        : 0,

    /*
     * Akan diisi khusus untuk
     * sub-recipe.
     */
    subRecipeHargaPerSatuan:
      0,
  };
}

async function getCurrentUser() {
  const {
    data: {
      user,
    },
    error,
  } =
    await supabase.auth.getUser();

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

const recipeItemSelect = `
  *,
  ingredients (
    kode,
    nama,
    harga,
    satuan
  ),
  sub_recipes:recipes!recipe_items_sub_recipe_id_fkey (
    id,
    kode,
    nama,
    yield_qty,
    yield_unit
  )
`;

export async function getAllRecipes() {
  const {
    data,
    error,
  } =
    await supabase
      .from(RECIPE_TABLE)
      .select(recipeSelect)
      .eq(
        "is_deleted",
        false
      )
      .order("nama", {
        ascending: true,
      });

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ).map(
    mapRecipe
  );
}

export async function getRecipeByCode(
  recipeKode
) {
  const {
    data,
    error,
  } =
    await supabase
      .from(RECIPE_TABLE)
      .select(recipeSelect)
      .eq(
        "kode",
        recipeKode
      )
      .eq(
        "is_deleted",
        false
      )
      .single();

  if (error) {
    throw error;
  }

  return mapRecipe(data);
}

export async function createRecipe(
  recipe
) {
  const user =
    await getCurrentUser();

  const payload = {
    kode:
      recipe.kode.trim(),

    nama:
      recipe.nama.trim(),

    kategori:
      recipe.kategori?.trim() ||
      null,

    product_id:
      recipe.productId,

    yield_qty:
      Number(recipe.yield),

    yield_unit:
      recipe.satuanYield.trim(),

    is_active:
      true,

    created_by:
      user.id,

    updated_by:
      user.id,
  };

  const {
    data,
    error,
  } =
    await supabase
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
  const user =
    await getCurrentUser();

  const payload = {
    kode:
      recipe.kode.trim(),

    nama:
      recipe.nama.trim(),

    kategori:
      recipe.kategori?.trim() ||
      null,

    product_id:
      recipe.productId,

    yield_qty:
      Number(recipe.yield),

    yield_unit:
      recipe.satuanYield.trim(),

    is_active:
      recipe.status !==
      "Nonaktif",

    updated_by:
      user.id,
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(RECIPE_TABLE)
      .update(payload)
      .eq(
        "id",
        recipeId
      )
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
  const user =
    await getCurrentUser();

  const {
    count,
    error: usageError,
  } =
    await supabase
      .from("production_orders")
      .select("id", {
        count:
          "exact",
        head: true,
      })
      .eq(
        "recipe_id",
        recipeId
      )
      .eq(
        "is_deleted",
        false
      );

  if (usageError) {
    throw usageError;
  }

  if (
    Number(count || 0) > 0
  ) {
    throw new Error(
      "Recipe sudah digunakan pada Production Order dan tidak dapat dihapus. Ubah status Recipe menjadi Nonaktif."
    );
  }

  const {
    error: itemError,
  } =
    await supabase
      .from(RECIPE_ITEM_TABLE)
      .update({
        is_deleted:
          true,

        updated_by:
          user.id,
      })
      .eq(
        "recipe_id",
        recipeId
      )
      .eq(
        "is_deleted",
        false
      );

  if (itemError) {
    throw itemError;
  }

  const {
    error: recipeError,
  } =
    await supabase
      .from(RECIPE_TABLE)
      .update({
        is_deleted:
          true,

        is_active:
          false,

        updated_by:
          user.id,
      })
      .eq(
        "id",
        recipeId
      );

  if (recipeError) {
    throw recipeError;
  }
}


/* ============================================================
   HITUNG HPP SUB-RECIPE
   ============================================================ */

async function calculateSubRecipeCostPerUnit(
  subRecipeId
) {
  const {
    data: recipe,
    error: recipeError,
  } =
    await supabase
      .from(RECIPE_TABLE)
      .select(
        "id, yield_qty, yield_unit"
      )
      .eq(
        "id",
        subRecipeId
      )
      .eq(
        "is_deleted",
        false
      )
      .single();

  if (recipeError) {
    throw recipeError;
  }

  const {
    data: items,
    error: itemsError,
  } =
    await supabase
      .from(RECIPE_ITEM_TABLE)
      .select(recipeItemSelect)
      .eq(
        "recipe_id",
        subRecipeId
      )
      .eq(
        "is_deleted",
        false
      )
      .order("urutan", {
        ascending: true,
      });

  if (itemsError) {
    throw itemsError;
  }

  let totalCost = 0;

  for (
    const item of
    items ?? []
  ) {
    /*
     * BAHAN BAKU
     */
    if (
      item.ingredient_id
    ) {
      const ingredientUnit =
        item.ingredients?.satuan ??
        "";

      const ingredientPrice =
        Number(
          item.ingredients?.harga ||
            0
        );

      const unitDivider =
        getUnitDivider(
          ingredientUnit
        );

      const hargaPerSatuan =
        ingredientPrice /
        unitDivider;

      totalCost +=
        Number(
          item.jumlah || 0
        ) *
        hargaPerSatuan;

      continue;
    }

    /*
     * SUB-RECIPE
     *
     * Kita hitung recursively.
     */
    if (
      item.sub_recipe_id
    ) {
      const hargaSubRecipe =
        await calculateSubRecipeCostPerUnit(
          item.sub_recipe_id
        );

      totalCost +=
        Number(
          item.jumlah || 0
        ) *
        hargaSubRecipe;
    }
  }

  const yieldQty =
    Number(
      recipe.yield_qty || 0
    );

  if (
    yieldQty <= 0
  ) {
    return 0;
  }

  return Number(
    (
      totalCost /
      yieldQty
    ).toFixed(6)
  );
}


/* ============================================================
   GET RECIPE ITEMS
   ============================================================ */

export async function getRecipeItems(
  recipeId
) {
  const {
    data,
    error,
  } =
    await supabase
      .from(RECIPE_ITEM_TABLE)
      .select(recipeItemSelect)
      .eq(
        "recipe_id",
        recipeId
      )
      .eq(
        "is_deleted",
        false
      )
      .order("urutan", {
        ascending: true,
      });

  if (error) {
    throw error;
  }

  const mappedItems =
    (
      data ?? []
    ).map(
      mapRecipeItem
    );

  /*
   * Hitung HPP per satuan
   * untuk setiap sub-recipe.
   */
  for (
    const item of
    mappedItems
  ) {
    if (
      item.subRecipeId
    ) {
      item.subRecipeHargaPerSatuan =
        await calculateSubRecipeCostPerUnit(
          item.subRecipeId
        );

      /*
       * Untuk calculator utama,
       * hargaPerSatuan harus
       * menggunakan HPP sub-recipe.
       */
      item.hargaPerSatuan =
        item.subRecipeHargaPerSatuan;
    }
  }

  return mappedItems;
}


/* ============================================================
   CREATE RECIPE ITEM
   ============================================================ */

export async function createRecipeItem(
  item
) {
  const user =
    await getCurrentUser();

  const isSubRecipe =
    Boolean(
      item.subRecipeId
    );

  const payload = {
    recipe_id:
      item.recipeId,

    ingredient_id:
      isSubRecipe
        ? null
        : item.ingredientId,

    sub_recipe_id:
      isSubRecipe
        ? item.subRecipeId
        : null,

    jumlah:
      Number(
        item.jumlah
      ),

    satuan:
      item.satuan.trim(),

    urutan:
      Number(
        item.urutan || 1
      ),

    created_by:
      user.id,

    updated_by:
      user.id,
  };

  const duplicateColumn =
    isSubRecipe
      ? "sub_recipe_id"
      : "ingredient_id";

  const duplicateValue =
    isSubRecipe
      ? item.subRecipeId
      : item.ingredientId;

  const {
    data:
      existingRows,
    error:
      existingError,
  } =
    await supabase
      .from(
        RECIPE_ITEM_TABLE
      )
      .select(
        "id, is_deleted"
      )
      .eq(
        "recipe_id",
        item.recipeId
      )
      .eq(
        duplicateColumn,
        duplicateValue
      )
      .limit(1);

  if (existingError) {
    throw existingError;
  }

  const existingItem =
    existingRows?.[0] ??
    null;

  if (
    existingItem &&
    existingItem.is_deleted ===
      false
  ) {
    throw new Error(
      isSubRecipe
        ? "Sub-recipe tersebut sudah ada dalam Recipe."
        : "Bahan tersebut sudah ada dalam Recipe."
    );
  }

  if (
    existingItem &&
    existingItem.is_deleted ===
      true
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          RECIPE_ITEM_TABLE
        )
        .update({
          ingredient_id:
            payload.ingredient_id,

          sub_recipe_id:
            payload.sub_recipe_id,

          jumlah:
            payload.jumlah,

          satuan:
            payload.satuan,

          urutan:
            payload.urutan,

          is_deleted:
            false,

          updated_by:
            user.id,
        })
        .eq(
          "id",
          existingItem.id
        )
        .select(
          recipeItemSelect
        )
        .single();

    if (error) {
      throw error;
    }

    const mapped =
      mapRecipeItem(data);

    if (
      mapped.subRecipeId
    ) {
      mapped.subRecipeHargaPerSatuan =
        await calculateSubRecipeCostPerUnit(
          mapped.subRecipeId
        );

      mapped.hargaPerSatuan =
        mapped.subRecipeHargaPerSatuan;
    }

    return mapped;
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        RECIPE_ITEM_TABLE
      )
      .insert(payload)
      .select(
        recipeItemSelect
      )
      .single();

  if (error) {
    throw error;
  }

  const mapped =
    mapRecipeItem(data);

  if (
    mapped.subRecipeId
  ) {
    mapped.subRecipeHargaPerSatuan =
      await calculateSubRecipeCostPerUnit(
        mapped.subRecipeId
      );

    mapped.hargaPerSatuan =
      mapped.subRecipeHargaPerSatuan;
  }

  return mapped;
}


/* ============================================================
   UPDATE RECIPE ITEM
   ============================================================ */

export async function updateRecipeItem(
  recipeItemId,
  item
) {
  const user =
    await getCurrentUser();

  const isSubRecipe =
    Boolean(
      item.subRecipeId
    );

  const payload = {
    ingredient_id:
      isSubRecipe
        ? null
        : item.ingredientId,

    sub_recipe_id:
      isSubRecipe
        ? item.subRecipeId
        : null,

    jumlah:
      Number(
        item.jumlah
      ),

    satuan:
      item.satuan.trim(),

    urutan:
      Number(
        item.urutan || 1
      ),

    updated_by:
      user.id,
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(
        RECIPE_ITEM_TABLE
      )
      .update(payload)
      .eq(
        "id",
        recipeItemId
      )
      .eq(
        "is_deleted",
        false
      )
      .select(
        recipeItemSelect
      )
      .single();

  if (error) {
    throw error;
  }

  const mapped =
    mapRecipeItem(data);

  if (
    mapped.subRecipeId
  ) {
    mapped.subRecipeHargaPerSatuan =
      await calculateSubRecipeCostPerUnit(
        mapped.subRecipeId
      );

    mapped.hargaPerSatuan =
      mapped.subRecipeHargaPerSatuan;
  }

  return mapped;
}


/* ============================================================
   DELETE RECIPE ITEM
   ============================================================ */

export async function softDeleteRecipeItem(
  recipeItemId
) {
  const user =
    await getCurrentUser();

  const {
    error,
  } =
    await supabase
      .from(
        RECIPE_ITEM_TABLE
      )
      .update({
        is_deleted:
          true,

        updated_by:
          user.id,
      })
      .eq(
        "id",
        recipeItemId
      )
      .eq(
        "is_deleted",
        false
      );

  if (error) {
    throw error;
  }
}
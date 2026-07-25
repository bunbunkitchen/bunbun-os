import { supabase } from "../lib/supabase";

const TABLE_NAME = "products";

function mapProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    nama: row.nama,
    categoryId: row.category_id,
    kategori: row.categories?.nama ?? "",
    harga: Number(row.harga),
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

export async function getAllProducts() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(`
      *,
      categories (
        nama
      )
    `)
    .eq("is_deleted", false)
    .order("nama", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapProduct);
}

export async function createProduct(product) {
  const user = await getCurrentUser();

  const payload = {
    sku: product.sku.trim(),
    nama: product.nama.trim(),
    category_id: product.categoryId,
    harga: Number(product.harga),
    is_active: true,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select(`
      *,
      categories (
        nama
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapProduct(data);
}

export async function updateProduct(
  productId,
  product
) {
  const user = await getCurrentUser();

  const payload = {
    sku: product.sku.trim(),
    nama: product.nama.trim(),
    category_id: product.categoryId,
    harga: Number(product.harga),
    is_active:
      product.status !== "Nonaktif",
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", productId)
    .select(`
      *,
      categories (
        nama
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapProduct(data);
}

export async function softDeleteProduct(
  productId
) {
  const user = await getCurrentUser();

  const {
    count,
    error: usageError,
  } = await supabase
    .from("recipes")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("product_id", productId)
    .eq("is_deleted", false);

  if (usageError) {
    if (
      usageError.message?.includes(
        "product_id"
      )
    ) {
      // Struktur recipes lama belum memiliki product_id.
      // Dalam kondisi ini product tetap boleh di-soft delete.
    } else {
      throw usageError;
    }
  }

  if (Number(count || 0) > 0) {
    throw new Error(
      "Produk sudah digunakan oleh recipe dan tidak dapat dihapus. Ubah status produk menjadi Nonaktif."
    );
  }

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      is_active: false,
      updated_by: user.id,
    })
    .eq("id", productId);

  if (error) {
    throw error;
  }
}
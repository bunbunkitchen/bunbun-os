import { supabase } from "../lib/supabase";

const TABLE_NAME = "categories";

function mapCategory(row) {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
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

export async function getAllCategories() {
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
    mapCategory
  );
}

export async function createCategory(
  category
) {
  const user = await getCurrentUser();

  const payload = {
    kode: category.kode.trim(),
    nama: category.nama.trim(),
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

  return mapCategory(data);
}

export async function updateCategory(
  categoryId,
  category
) {
  const user = await getCurrentUser();

  const payload = {
    kode: category.kode.trim(),
    nama: category.nama.trim(),
    is_active:
      category.status !== "Nonaktif",
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", categoryId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapCategory(data);
}

export async function softDeleteCategory(
  categoryId
) {
  const user = await getCurrentUser();

  const {
    count,
    error: usageError,
  } = await supabase
    .from("products")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("category_id", categoryId)
    .eq("is_deleted", false);

  if (usageError) {
    throw usageError;
  }

  if (Number(count || 0) > 0) {
    throw new Error(
      "Kategori sudah digunakan oleh produk dan tidak dapat dihapus. Ubah status kategori menjadi Nonaktif."
    );
  }

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      is_active: false,
      updated_by: user.id,
    })
    .eq("id", categoryId);

  if (error) {
    throw error;
  }
}
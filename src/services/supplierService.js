import { supabase } from "../lib/supabase";

const TABLE_NAME = "suppliers";

function mapSupplier(row) {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    kontak: row.kontak ?? "",
    telepon: row.telepon ?? "",
    email: row.email ?? "",
    alamat: row.alamat ?? "",
    status: row.is_active ? "Aktif" : "Nonaktif",
  };
}

export async function getAllSuppliers() {
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

  return (data ?? []).map(mapSupplier);
}

export async function createSupplier(supplier) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("Pengguna belum login.");
  }

  const payload = {
    kode: supplier.kode.trim(),
    nama: supplier.nama.trim(),
    kontak: supplier.kontak.trim() || null,
    telepon: supplier.telepon.trim() || null,
    email: supplier.email.trim() || null,
    alamat: supplier.alamat.trim() || null,
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

  return mapSupplier(data);
}

export async function updateSupplier(
  supplierId,
  supplier
) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error(
      "Pengguna belum login."
    );
  }

  const payload = {
    kode: supplier.kode.trim(),
    nama: supplier.nama.trim(),
    kontak:
      supplier.kontak.trim() || null,
    telepon:
      supplier.telepon.trim() || null,
    email:
      supplier.email.trim() || null,
    alamat:
      supplier.alamat.trim() || null,
    is_active:
      supplier.status !== "Nonaktif",
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", supplierId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapSupplier(data);
}

export async function softDeleteSupplier(
  supplierId
) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error(
      "Pengguna belum login."
    );
  }

  const {
    count,
    error: usageError,
  } = await supabase
    .from("purchases")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("supplier_id", supplierId)
    .eq("is_deleted", false);

  if (usageError) {
    throw usageError;
  }

  if (Number(count || 0) > 0) {
    throw new Error(
      "Supplier sudah digunakan pada transaksi pembelian dan tidak dapat dihapus. Ubah status supplier menjadi Nonaktif."
    );
  }

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      is_active: false,
      updated_by: user.id,
    })
    .eq("id", supplierId);

  if (error) {
    throw error;
  }
}
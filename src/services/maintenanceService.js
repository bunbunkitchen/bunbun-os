import { supabase } from "../lib/supabase";

const TABLE_NAME = "maintenance_items";

function mapMaintenanceItem(row) {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    satuan: row.satuan,
    harga: Number(row.harga || 0),
    minimumStok: Number(row.minimum_stok || 0),
    isActive: row.is_active,
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
    throw new Error("Pengguna belum login.");
  }

  return user;
}

export async function getAllMaintenanceItems() {
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
    mapMaintenanceItem
  );
}

export async function createMaintenanceItem(item) {
  const user = await getCurrentUser();

  const payload = {
    kode: item.kode.trim(),
    nama: item.nama.trim(),
    satuan: item.satuan.trim(),
    harga: Number(item.harga || 0),
    minimum_stok: Number(
      item.minimumStok || 0
    ),
    is_active: true,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapMaintenanceItem(data);
}

export async function updateMaintenanceItem(
  itemId,
  item
) {
  const user = await getCurrentUser();

  const payload = {
    kode: item.kode.trim(),
    nama: item.nama.trim(),
    satuan: item.satuan.trim(),
    harga: Number(item.harga || 0),
    minimum_stok: Number(
      item.minimumStok || 0
    ),
    is_active:
      item.isActive !== false,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", itemId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapMaintenanceItem(data);
}

export async function softDeleteMaintenanceItem(
  itemId
) {
  const user = await getCurrentUser();

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      updated_by: user.id,
    })
    .eq("id", itemId);

  if (error) {
    throw error;
  }
}
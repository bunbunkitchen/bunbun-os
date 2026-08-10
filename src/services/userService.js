import { supabase } from "../lib/supabase";

export async function getAllUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, role, is_active, created_at, updated_at"
    )
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function updateUserProfile(
  userId,
  payload
) {
  const allowedRoles = [
    "owner",
    "baker",
    "helper",
  ];

  const normalizedRole = String(
    payload.role ?? ""
  )
    .trim()
    .toLowerCase();

  if (!userId) {
    throw new Error(
      "ID pengguna tidak ditemukan."
    );
  }

  if (
    !String(payload.full_name ?? "").trim()
  ) {
    throw new Error(
      "Nama pengguna wajib diisi."
    );
  }

  if (
    !allowedRoles.includes(normalizedRole)
  ) {
    throw new Error(
      "Role pengguna tidak valid."
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: String(
        payload.full_name
      ).trim(),
      role: normalizedRole,
      is_active:
        payload.is_active === true,
    })
    .eq("id", userId)
    .select(
      "id, full_name, role, is_active, created_at, updated_at"
    )
    .single();

  if (error) {
    throw error;
  }

  return data;
}
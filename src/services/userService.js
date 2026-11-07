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
    "admin",
    "baker",
    "helper",
    "cashier",
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

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  if (currentUser?.id === userId) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      console.warn("Gagal menyegarkan sesi setelah perubahan profil sendiri:", refreshError);
    }
  }

  return data;
}

export async function inviteManagedUser({ email, fullName, role }) {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const allowedRoles = ["owner", "admin", "baker", "helper", "cashier"];

  if (!String(email ?? "").trim()) {
    throw new Error("Email pengguna wajib diisi.");
  }
  if (!String(fullName ?? "").trim()) {
    throw new Error("Nama pengguna wajib diisi.");
  }
  if (!allowedRoles.includes(normalizedRole)) {
    throw new Error("Role pengguna tidak valid.");
  }

  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: {
      action: "invite",
      email: String(email).trim().toLowerCase(),
      fullName: String(fullName).trim(),
      role: normalizedRole,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

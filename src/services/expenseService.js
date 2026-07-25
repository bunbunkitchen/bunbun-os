import { supabase } from "../lib/supabase";

const TABLE_NAME = "expenses";

function mapExpense(row) {
  return {
    id: row.id,
    tanggal: row.tanggal,
    kategori: row.kategori,
    nominal: Number(row.nominal),
    keterangan: row.keterangan ?? "",
  };
}

export async function getAllExpenses() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("is_deleted", false)
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(mapExpense);
}

export async function createExpense(expense) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;

  if (!user) {
    throw new Error("Pengguna belum login.");
  }

  const payload = {
    tanggal: expense.tanggal,
    kategori: expense.kategori,
    nominal: Number(expense.nominal),
    keterangan: expense.keterangan || "",
    purchase_id: expense.purchaseId || null,
    created_by: user.id,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  return mapExpense(data);
}

export async function updateExpense(
  expenseId,
  expense
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
    tanggal: expense.tanggal,
    kategori: expense.kategori,
    nominal: Number(expense.nominal),
    keterangan:
      expense.keterangan?.trim() || null,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", expenseId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapExpense(data);
}

export async function softDeleteExpense(
  expenseId
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

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      updated_by: user.id,
    })
    .eq("id", expenseId);

  if (error) {
    throw error;
  }
}
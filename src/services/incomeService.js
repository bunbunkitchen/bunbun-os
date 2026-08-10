import { supabase } from "../lib/supabase";

const TABLE_NAME = "incomes";

export async function getAvailableIncomeLots() {
  const { data, error } = await supabase
    .from("production_batch_splits")
    .select(`
      lot_code,
      products (
        sku,
        nama
      )
    `)
    .eq("is_deleted", false)
    .not("lot_code", "is", null)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  const lots = new Map();

  (data ?? []).forEach((row) => {
    const code = String(row.lot_code || "").trim();

    if (!code || lots.has(code)) {
      return;
    }

    lots.set(code, {
      kodeLot: code,
      productSku: row.products?.sku ?? "",
      productNama: row.products?.nama ?? "",
    });
  });

  return Array.from(lots.values());
}

function mapIncome(row) {
  return {
    id: row.id,
    tanggal: row.tanggal,
    totalPenjualan:
      Number(row.total_penjualan),
    persentaseBunbun:
      Number(row.persentase_bunbun),
    pemasukanBunbun:
      Number(row.pemasukan_bunbun),
    asalSetoran: row.asal_setoran ?? "",
    kodeLot: row.kode_lot ?? "",
    keterangan: row.keterangan ?? "",
  };
}

export async function getAllIncomes() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("is_deleted", false)
    .order("tanggal", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapIncome);
}

export async function createIncome(income) {
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
    tanggal: income.tanggal,
    total_penjualan: Number(
      income.totalPenjualan
    ),
    persentase_bunbun: Number(
      income.persentaseBunbun
    ),
    pemasukan_bunbun: Number(
      income.pemasukanBunbun
    ),
    asal_setoran: income.asalSetoran,
    kode_lot: income.kodeLot || null,
    keterangan:
      income.keterangan ||
      "Penjualan harian",
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

  return mapIncome(data);
}

export async function updateIncome(
  incomeId,
  income
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
    tanggal: income.tanggal,
    total_penjualan: Number(
      income.totalPenjualan
    ),
    persentase_bunbun: Number(
      income.persentaseBunbun
    ),
    pemasukan_bunbun: Number(
      income.pemasukanBunbun
    ),
    asal_setoran: income.asalSetoran,
    kode_lot: income.kodeLot || null,
    keterangan:
      income.keterangan ||
      "Penjualan harian",
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", incomeId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapIncome(data);
}

export async function softDeleteIncome(
  incomeId
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
    .eq("id", incomeId);

  if (error) {
    throw error;
  }
}

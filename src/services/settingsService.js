import { supabase } from "../lib/supabase";

const TABLE_NAME = "application_settings";

function mapSettings(row) {
  return {
    id: row.id,
    businessName: row.business_name,
    businessAddress: row.business_address ?? "",
    businessPhone: row.business_phone ?? "",
    businessEmail: row.business_email ?? "",
    bunbunPercentage: Number(
      row.bunbun_percentage
    ),
    currencyCode: row.currency_code,
  };
}

async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;

  if (!user) {
    throw new Error("Pengguna belum login.");
  }

  return user;
}

export async function getSettings() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("is_deleted", false)
    .limit(1)
    .single();

  if (error) {
    throw error;
  }

  return mapSettings(data);
}

export async function updateSettings(values) {
  const user = await getCurrentUser();

  const current = await getSettings();

  const payload = {
    business_name: values.businessName,
    business_address:
      values.businessAddress || null,
    business_phone:
      values.businessPhone || null,
    business_email:
      values.businessEmail || null,
    bunbun_percentage: Number(
      values.bunbunPercentage
    ),
    currency_code: values.currencyCode,
    updated_by: user.id,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", current.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return mapSettings(data);
}
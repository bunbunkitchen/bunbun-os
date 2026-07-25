import { supabase } from "../../lib/supabase";

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

export function createCrudService({
  table,
  mapper = (row) => row,
  buildCreatePayload,
  buildUpdatePayload,
  defaultOrder = {
    column: "created_at",
    ascending: false,
  },
}) {
  if (!table) {
    throw new Error(
      "Nama tabel wajib diberikan."
    );
  }

  if (
    typeof buildCreatePayload !==
    "function"
  ) {
    throw new Error(
      "buildCreatePayload wajib berupa fungsi."
    );
  }

  if (
    typeof buildUpdatePayload !==
    "function"
  ) {
    throw new Error(
      "buildUpdatePayload wajib berupa fungsi."
    );
  }

  async function getAll() {
    let query = supabase
      .from(table)
      .select("*")
      .eq("is_deleted", false);

    if (defaultOrder?.column) {
      query = query.order(
        defaultOrder.column,
        {
          ascending:
            defaultOrder.ascending ??
            false,
        }
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapper);
  }

  async function create(values) {
    const user =
      await getCurrentUser();

    const payload = {
      ...buildCreatePayload(values),
      created_by: user.id,
      updated_by: user.id,
    };

    const { data, error } =
      await supabase
        .from(table)
        .insert(payload)
        .select()
        .single();

    if (error) {
      throw error;
    }

    return mapper(data);
  }

  async function update(
    id,
    values
  ) {
    const user =
      await getCurrentUser();

    const payload = {
      ...buildUpdatePayload(values),
      updated_by: user.id,
    };

    const { data, error } =
      await supabase
        .from(table)
        .update(payload)
        .eq("id", id)
        .select()
        .single();

    if (error) {
      throw error;
    }

    return mapper(data);
  }

  async function softDelete(id) {
    const user =
      await getCurrentUser();

    const { error } = await supabase
      .from(table)
      .update({
        is_deleted: true,
        updated_by: user.id,
      })
      .eq("id", id);

    if (error) {
      throw error;
    }
  }

  return {
    getAll,
    create,
    update,
    softDelete,
  };
}
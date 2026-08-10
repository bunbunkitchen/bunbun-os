import {
  useEffect,
  useState,
} from "react";

import {
  MdEdit,
  MdPeople,
  MdSave,
  MdClose,
} from "react-icons/md";

import {
  getAllUsers,
  updateUserProfile,
} from "../../services/userService";

function getRoleLabel(role) {
  const labels = {
    owner: "Owner",
    baker: "Baker",
    helper: "Helper",
  };

  return labels[role] ?? role;
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [editingUser, setEditingUser] =
    useState(null);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  async function loadUsers() {
    setLoading(true);
    setErrorMessage("");

    try {
      const data = await getAllUsers();
      setUsers(data);
    } catch (error) {
      console.error(
        "Gagal mengambil user:",
        error
      );

      setErrorMessage(
        error?.message ||
          "Daftar pengguna gagal dimuat."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  function openEdit(user) {
    setErrorMessage("");
    setSuccessMessage("");

    setEditingUser({
      ...user,
      full_name: user.full_name || "",
      role: user.role || "helper",
      is_active:
        user.is_active === true,
    });
  }

  function closeEdit() {
    if (saving) {
      return;
    }

    setEditingUser(null);
  }

  async function handleSave(event) {
    event.preventDefault();

    if (!editingUser) {
      return;
    }

    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const updatedUser =
        await updateUserProfile(
          editingUser.id,
          {
            full_name:
              editingUser.full_name,
            role: editingUser.role,
            is_active:
              editingUser.is_active,
          }
        );

      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.id === updatedUser.id
            ? updatedUser
            : user
        )
      );

      setEditingUser(null);

      setSuccessMessage(
        "Data pengguna berhasil diperbarui."
      );
    } catch (error) {
      console.error(
        "Gagal menyimpan user:",
        error
      );

      setErrorMessage(
        error?.message ||
          "Data pengguna gagal disimpan."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <MdPeople className="text-3xl text-amber-700" />

          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              User Management
            </h1>

            <p className="mt-1 text-sm text-gray-500">
              Kelola nama, role, dan
              status pengguna Bunbun OS.
            </p>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
          Memuat pengguna...
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
          Belum ada pengguna.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {users.map((user) => (
            <article
              key={user.id}
              className="rounded-2xl border bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-gray-900">
                    {user.full_name ||
                      "Tanpa Nama"}
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    {getRoleLabel(
                      user.role
                    )}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    user.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {user.is_active
                    ? "Aktif"
                    : "Nonaktif"}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  openEdit(user)
                }
                className="mt-5 inline-flex items-center gap-2 rounded-lg border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
              >
                <MdEdit />
                Edit User
              </button>
            </article>
          ))}
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Edit User
              </h2>

              <button
                type="button"
                onClick={closeEdit}
                aria-label="Tutup"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-gray-500 hover:bg-gray-100"
              >
                <MdClose />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="space-y-4 p-5"
            >
              <div>
                <label
                  htmlFor="user-name"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Nama
                </label>

                <input
                  id="user-name"
                  type="text"
                  value={
                    editingUser.full_name
                  }
                  onChange={(event) =>
                    setEditingUser(
                      (current) => ({
                        ...current,
                        full_name:
                          event.target.value,
                      })
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="user-role"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Role
                </label>

                <select
                  id="user-role"
                  value={editingUser.role}
                  onChange={(event) =>
                    setEditingUser(
                      (current) => ({
                        ...current,
                        role:
                          event.target.value,
                      })
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                >
                  <option value="owner">
                    Owner
                  </option>

                  <option value="baker">
                    Baker
                  </option>

                  <option value="helper">
                    Helper
                  </option>
                </select>
              </div>

              <label className="flex items-center gap-3 rounded-lg border p-3">
                <input
                  type="checkbox"
                  checked={
                    editingUser.is_active
                  }
                  onChange={(event) =>
                    setEditingUser(
                      (current) => ({
                        ...current,
                        is_active:
                          event.target
                            .checked,
                      })
                    )
                  }
                  className="h-4 w-4 accent-amber-700"
                />

                <span className="text-sm font-medium text-gray-700">
                  User aktif
                </span>
              </label>

              <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                Password tidak diubah dari
                halaman ini. Setiap user
                dapat mengganti password
                sendiri melalui menu Profil
                Saya.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  disabled={saving}
                  className="rounded-lg border px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Batal
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <MdSave />

                  {saving
                    ? "Menyimpan..."
                    : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
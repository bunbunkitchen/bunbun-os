import { useState } from "react";
import {
  MdLock,
  MdPerson,
  MdVisibility,
  MdVisibilityOff,
} from "react-icons/md";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

function getRoleLabel(role) {
  const labels = {
    owner: "Owner",
    baker: "Baker",
    helper: "Helper",
  };

  return labels[role] ?? "User";
}

export default function Profile() {
  const { user, profile, role } =
    useAuth();

  const [newPassword, setNewPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [loading, setLoading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (newPassword.length < 8) {
      setErrorMessage(
        "Password minimal 8 karakter."
      );
      return;
    }

    if (
      newPassword !== confirmPassword
    ) {
      setErrorMessage(
        "Konfirmasi password tidak sama."
      );
      return;
    }

    setLoading(true);

    try {
      const { error } =
        await supabase.auth.updateUser({
          password: newPassword,
        });

      if (error) {
        throw error;
      }

      setNewPassword("");
      setConfirmPassword("");

      setSuccessMessage(
        "Password berhasil diperbarui. Gunakan password baru saat login berikutnya."
      );
    } catch (error) {
      console.error(
        "Gagal mengganti password:",
        error
      );

      setErrorMessage(
        error?.message ||
          "Password gagal diperbarui."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Profil Saya
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Informasi akun dan pengaturan
          password.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl text-amber-700">
            <MdPerson />
          </div>

          <div>
            <h2 className="font-semibold text-gray-900">
              {profile?.full_name ||
                "Pengguna Bunbun OS"}
            </h2>

            <p className="text-sm text-gray-500">
              {getRoleLabel(role)}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Nama
            </p>

            <p className="mt-1 text-sm font-medium text-gray-900">
              {profile?.full_name || "-"}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Email
            </p>

            <p className="mt-1 break-all text-sm font-medium text-gray-900">
              {user?.email || "-"}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Role
            </p>

            <p className="mt-1 text-sm font-medium text-gray-900">
              {getRoleLabel(role)}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Status
            </p>

            <p className="mt-1 text-sm font-medium text-green-700">
              Aktif
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <MdLock className="text-2xl text-amber-700" />

          <div>
            <h2 className="font-semibold text-gray-900">
              Ubah Password
            </h2>

            <p className="text-sm text-gray-500">
              Password baru minimal 8
              karakter.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-6 max-w-xl space-y-4"
        >
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

          <div>
            <label
              htmlFor="new-password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Password Baru
            </label>

            <div className="relative">
              <input
                id="new-password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={newPassword}
                onChange={(event) =>
                  setNewPassword(
                    event.target.value
                  )
                }
                autoComplete="new-password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-11 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                placeholder="Minimal 8 karakter"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    (current) => !current
                  )
                }
                aria-label={
                  showPassword
                    ? "Sembunyikan password"
                    : "Tampilkan password"
                }
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-xl text-gray-500"
              >
                {showPassword ? (
                  <MdVisibilityOff />
                ) : (
                  <MdVisibility />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Konfirmasi Password
            </label>

            <input
              id="confirm-password"
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(
                  event.target.value
                )
              }
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
              placeholder="Ketik ulang password baru"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Menyimpan..."
              : "Simpan Password"}
          </button>
        </form>
      </section>
    </div>
  );
}
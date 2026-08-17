import { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ECE1DD]">
      <div className="text-center">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-[#C7CDBF] border-t-[#595E48]" />

        <p className="mt-4 font-medium text-[#595E48]">
          Memuat Bunbun OS...
        </p>
      </div>
    </div>
  );
}

function AccountProblem({
  title,
  message,
  onLogout,
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ECE1DD] p-5">
      <div className="w-full max-w-md rounded-2xl border border-[#D9D8D0] bg-white p-8 text-center shadow-lg">
        <h1 className="text-3xl font-bold text-[#595E48]">
          🍞 Bunbun OS
        </h1>

        <div className="mt-7 rounded-xl border border-[#EECFCA] bg-[#ECE1DD] p-5">
          <h2 className="font-bold text-[#C97B78]">
            {title}
          </h2>

          <p className="mt-2 text-sm leading-6 text-[#777A6D]">
            {message}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void onLogout();
          }}
          className="
            mt-6
            w-full
            rounded-lg
            bg-[#595E48]
            px-4
            py-3
            font-semibold
            text-white
            transition
            hover:bg-[#4D523E]
          "
        >
          Kembali ke Login
        </button>
      </div>
    </div>
  );
}

function getFriendlyLoginError(error) {
  const message = String(
    error?.message || ""
  ).toLowerCase();

  if (
    message.includes(
      "invalid login credentials"
    )
  ) {
    return "Email atau password tidak sesuai.";
  }

  if (
    message.includes(
      "email not confirmed"
    )
  ) {
    return "Email belum dikonfirmasi.";
  }

  if (
    message.includes("network") ||
    message.includes("fetch")
  ) {
    return "Tidak dapat terhubung ke server. Periksa koneksi internet.";
  }

  return "Login gagal. Silakan coba kembali.";
}

export default function Login() {
  const {
    signIn,
    signOut,
    loading,
    hasSession,
    hasValidProfile,
    isActive,
    isAuthenticated,
    authError,
  } = useAuth();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [error, setError] =
    useState("");

  const [submitting, setSubmitting] =
    useState(false);

  if (loading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (hasSession && !hasValidProfile) {
    return (
      <AccountProblem
        title="Profil tidak ditemukan"
        message={
          authError ||
          "Akun ini belum memiliki profil Bunbun OS. Hubungi Owner Bunbun Kitchen."
        }
        onLogout={signOut}
      />
    );
  }

  if (
    hasSession &&
    hasValidProfile &&
    !isActive
  ) {
    return (
      <AccountProblem
        title="Akun tidak aktif"
        message="Akses akun ini telah dinonaktifkan. Hubungi Owner Bunbun Kitchen apabila akun perlu diaktifkan kembali."
        onLogout={signOut}
      />
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Email wajib diisi.");
      return;
    }

    if (!password) {
      setError("Password wajib diisi.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      await signIn(
        normalizedEmail,
        password
      );
    } catch (loginError) {
      setError(
        getFriendlyLoginError(loginError)
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ECE1DD] p-5">
      <div className="w-full max-w-md rounded-2xl border border-[#D9D8D0] bg-white p-8 shadow-lg">

        {/* BRAND */}
        <h1 className="mb-2 text-center text-3xl font-bold text-[#595E48]">
          🍞 Bunbun OS
        </h1>

        <p className="mb-8 text-center text-[#777A6D]">
          Selamat datang kembali
        </p>

        {/* FORM */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5"
          noValidate
        >
          {/* EMAIL */}
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-[#3F4335]"
            >
              Email
              <span className="text-[#C97B78]">
                {" "}
                *
              </span>
            </label>

            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="nama@email.com"
              required
              disabled={submitting}
              className="
                w-full
                rounded-lg
                border
                border-[#D9D8D0]
                bg-white
                p-3
                text-[#3F4335]
                outline-none
                transition
                placeholder:text-[#A5A69D]
                focus:border-[#919682]
                focus:ring-2
                focus:ring-[#C7CDBF]
                disabled:cursor-not-allowed
                disabled:bg-[#F5F3EE]
              "
              value={email}
              onChange={(event) => {
                setEmail(
                  event.target.value
                );

                if (error) {
                  setError("");
                }
              }}
            />
          </div>

          {/* PASSWORD */}
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-[#3F4335]"
            >
              Password
              <span className="text-[#C97B78]">
                {" "}
                *
              </span>
            </label>

            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Masukkan password"
              required
              disabled={submitting}
              className="
                w-full
                rounded-lg
                border
                border-[#D9D8D0]
                bg-white
                p-3
                text-[#3F4335]
                outline-none
                transition
                placeholder:text-[#A5A69D]
                focus:border-[#919682]
                focus:ring-2
                focus:ring-[#C7CDBF]
                disabled:cursor-not-allowed
                disabled:bg-[#F5F3EE]
              "
              value={password}
              onChange={(event) => {
                setPassword(
                  event.target.value
                );

                if (error) {
                  setError("");
                }
              }}
            />
          </div>

          {/* ERROR */}
          {error && (
            <div
              role="alert"
              className="
                rounded-lg
                border
                border-[#EECFCA]
                bg-[#ECE1DD]
                px-4
                py-3
                text-sm
                text-[#C97B78]
              "
            >
              {error}
            </div>
          )}

          {/* LOGIN BUTTON */}
          <button
            type="submit"
            disabled={submitting}
            className="
              w-full
              rounded-lg
              bg-[#595E48]
              p-3
              font-semibold
              text-white
              transition
              hover:bg-[#4D523E]
              focus:outline-none
              focus:ring-2
              focus:ring-[#C7CDBF]
              focus:ring-offset-2
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {submitting
              ? "Memproses..."
              : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
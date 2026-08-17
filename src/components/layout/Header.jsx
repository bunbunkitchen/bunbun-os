import { useState } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../ui/Button";
import { useAuth } from "../../context/AuthContext";

function formatRole(role) {
  if (!role) {
    return "Pengguna";
  }

  return (
    role.charAt(0).toUpperCase() +
    role.slice(1)
  );
}

export default function Header() {
  const navigate = useNavigate();

  const {
    user,
    profile,
    role,
    signOut,
  } = useAuth();

  const [loggingOut, setLoggingOut] =
    useState(false);

  const [logoutError, setLogoutError] =
    useState("");

  const displayName =
    profile?.full_name ||
    user?.email ||
    "Pengguna Bunbun OS";

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    try {
      setLoggingOut(true);
      setLogoutError("");

      await signOut();

      navigate("/login", {
        replace: true,
      });
    } catch (error) {
      console.error(
        "Gagal logout:",
        error
      );

      setLogoutError(
        error.message ||
          "Logout gagal. Silakan coba lagi."
      );
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="border-b border-[#D9D8D0] bg-white px-8 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#3F4335]">
            Selamat Datang 👋
          </h2>

          <p className="mt-1 text-[#777A6D]">
            Bunbun Kitchen Operational System
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <div className="text-left sm:text-right">
            <p className="font-semibold text-[#3F4335]">
              {displayName}
            </p>

            <p className="text-sm text-[#777A6D]">
              {formatRole(role)}
            </p>
          </div>

          <Button
  onClick={handleLogout}
  disabled={loggingOut}
  className="
    !bg-[#595E48]
    !text-white
    hover:!bg-[#4D523E]
    focus:!ring-2
    focus:!ring-[#C7CDBF]
  "
>
  {loggingOut
    ? "Keluar..."
    : "Logout"}
</Button>
        </div>
      </div>

      {logoutError && (
        <div className="mt-4 rounded-lg border border-[#EECFCA] bg-[#ECE1DD] p-3 text-sm text-[#C97B78]">
          {logoutError}
        </div>
      )}
    </header>
  );
}
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function RoleRoute({
  allowedRoles = [],
  children,
}) {
  const {
    role,
    loading,
    isAuthenticated,
  } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="font-medium text-amber-700">
          Memuat hak akses...
        </p>
      </div>
    );
  }

  /*
   * Kondisi ini seharusnya sudah ditangani
   * oleh ProtectedRoute. Pemeriksaan tetap
   * dipertahankan sebagai pengaman tambahan.
   */
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  const normalizedAllowedRoles =
    allowedRoles.map((allowedRole) =>
      String(allowedRole)
        .trim()
        .toLowerCase()
    );

  if (
    normalizedAllowedRoles.length > 0 &&
    !normalizedAllowedRoles.includes(role)
  ) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  return children;
}
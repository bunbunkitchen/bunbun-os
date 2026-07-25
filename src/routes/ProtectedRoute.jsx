import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-amber-50">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-amber-200 border-t-amber-700" />

        <p className="mt-4 font-medium text-amber-700">
          Memuat Bunbun OS...
        </p>
      </div>
    </div>
  );
}

function AccessMessage({
  title,
  message,
  onLogout,
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-amber-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <h2 className="text-xl font-bold text-red-700">
          {title}
        </h2>

        <p className="mt-3 text-sm leading-6 text-gray-600">
          {message}
        </p>

        <button
          type="button"
          onClick={() => {
            void onLogout();
          }}
          className="mt-6 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
        >
          Kembali ke Login
        </button>
      </div>
    </div>
  );
}

export default function ProtectedRoute({
  children,
}) {
  const {
    loading,
    hasSession,
    hasValidProfile,
    isActive,
    authError,
    signOut,
  } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!hasSession) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  if (!hasValidProfile) {
    return (
      <AccessMessage
        title="Profil tidak ditemukan"
        message={
          authError ||
          "Akun ini belum memiliki profil Bunbun OS. Hubungi Owner Bunbun Kitchen."
        }
        onLogout={signOut}
      />
    );
  }

  if (!isActive) {
    return (
      <AccessMessage
        title="Akun tidak aktif"
        message="Akses akun ini telah dinonaktifkan. Hubungi Owner Bunbun Kitchen apabila akun perlu diaktifkan kembali."
        onLogout={signOut}
      />
    );
  }

  return children;
}
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { supabase } from "../lib/supabase";

import {
  getSession,
  login,
  logout,
} from "../services/authService";

const AuthContext = createContext(null);

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, role, is_active"
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export function AuthProvider({ children }) {
  const [session, setSession] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [authError, setAuthError] =
    useState("");

  const requestIdRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    async function synchronizeAuth(
      nextSession
    ) {
      const requestId =
        ++requestIdRef.current;

      if (!isMounted) {
        return;
      }

      setSession(nextSession);
      setAuthError("");

      if (!nextSession?.user?.id) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const nextProfile =
          await fetchProfile(
            nextSession.user.id
          );

        if (
          !isMounted ||
          requestId !== requestIdRef.current
        ) {
          return;
        }

        setProfile(nextProfile);

        if (!nextProfile) {
          setAuthError(
            "Profil pengguna tidak ditemukan."
          );
        }
      } catch (error) {
        if (
          !isMounted ||
          requestId !== requestIdRef.current
        ) {
          return;
        }

        console.error(
          "Gagal mengambil profil:",
          error
        );

        setProfile(null);
        setAuthError(
          error?.message ||
            "Gagal mengambil profil pengguna."
        );
      } finally {
        if (
          isMounted &&
          requestId === requestIdRef.current
        ) {
          setLoading(false);
        }
      }
    }

    async function initializeAuth() {
      setLoading(true);

      try {
        const currentSession =
          await getSession();

        await synchronizeAuth(
          currentSession
        );
      } catch (error) {
        if (!isMounted) {
          return;
        }

        console.error(
          "Gagal membaca session:",
          error
        );

        setSession(null);
        setProfile(null);
        setAuthError(
          error?.message ||
            "Gagal membaca sesi pengguna."
        );
        setLoading(false);
      }
    }

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        void synchronizeAuth(nextSession);
      }
    );

    return () => {
      isMounted = false;
      requestIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    setAuthError("");

    return login(email, password);
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      requestIdRef.current += 1;
      setSession(null);
      setProfile(null);
      setAuthError("");
      setLoading(false);
    }
  }

  const normalizedRole =
    profile?.role
      ? String(profile.role)
          .trim()
          .toLowerCase()
      : null;

  const hasSession = Boolean(session);

  const hasValidProfile = Boolean(
    profile?.id
  );

  const isActive =
    profile?.is_active === true;

  const isAuthenticated = Boolean(
    hasSession &&
      hasValidProfile &&
      isActive
  );

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: normalizedRole,

      loading,
      authError,

      hasSession,
      hasValidProfile,
      isActive,
      isAuthenticated,

      signIn,
      signOut,
    }),
    [
      session,
      profile,
      normalizedRole,
      loading,
      authError,
      hasSession,
      hasValidProfile,
      isActive,
      isAuthenticated,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth harus digunakan di dalam AuthProvider."
    );
  }

  return context;
}
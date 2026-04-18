"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

const AuthContext = createContext(null);

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

export function AuthProvider({ initialUser = null, children }) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);

  const refreshSession = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setIsLoadingAuth(true);
      }

      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const data = await readJsonSafe(response);

        if (response.status === 401) {
          // Temporary trace log while validating auth synchronization flow.
          console.info("[auth] Session refresh detected anonymous session.");
          setUser(null);
          return null;
        }

        if (!response.ok) {
          throw new Error(data.error || "No se pudo refrescar la sesion.");
        }

        // Temporary trace log while validating auth synchronization flow.
        console.info("[auth] Session refreshed and global user updated.");
        setUser(data.user ?? null);
        return data.user ?? null;
      } finally {
        if (!silent) {
          setIsLoadingAuth(false);
        }
      }
    },
    []
  );

  const login = useCallback(
    async ({ identifier, password }) => {
      setIsLoadingAuth(true);

      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ identifier, password }),
          credentials: "include",
        });
        const data = await readJsonSafe(response);

        if (!response.ok) {
          throw new Error(data.error || "No se pudo iniciar sesión.");
        }

        // Temporary trace log while validating auth synchronization flow.
        console.info("[auth] Login successful, updating global auth state.");
        setUser(data.user ?? null);
        router.refresh();
        return data.user ?? null;
      } finally {
        setIsLoadingAuth(false);
      }
    },
    [router]
  );

  const register = useCallback(
    async ({ fullName, cedula, email, password, confirmPassword }) => {
      setIsLoadingAuth(true);

      try {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fullName,
            cedula,
            email,
            password,
            confirmPassword,
          }),
          credentials: "include",
        });
        const data = await readJsonSafe(response);

        if (!response.ok) {
          throw new Error(data.error || "No se pudo completar el registro.");
        }

        // Temporary trace log while validating auth synchronization flow.
        console.info("[auth] Registration successful, user synchronized.");
        setUser(data.user ?? null);
        router.refresh();
        return data.user ?? null;
      } finally {
        setIsLoadingAuth(false);
      }
    },
    [router]
  );

  const logout = useCallback(
    async ({ redirectTo = "/" } = {}) => {
      setIsLoadingAuth(true);

      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const data = await readJsonSafe(response);

        if (!response.ok) {
          throw new Error(data.error || "No se pudo cerrar sesión.");
        }

        // Temporary trace log while validating auth synchronization flow.
        console.info("[auth] Logout successful, clearing global auth user.");
        setUser(null);

        if (redirectTo) {
          router.push(redirectTo);
        }
        router.refresh();
      } finally {
        setIsLoadingAuth(false);
      }
    },
    [router]
  );

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoadingAuth,
      login,
      register,
      logout,
      refreshSession,
    }),
    [isLoadingAuth, login, logout, refreshSession, register, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe utilizarse dentro de un AuthProvider.");
  }

  return context;
}

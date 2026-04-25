"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";

export default function LegacyAdminBandejaExpedientesPage() {
  const { user, isLoadingAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }
    if (user?.role === "agente") {
      router.replace("/funcionario/dashboard");
    }
  }, [isLoadingAuth, router, user]);

  if (isLoadingAuth) {
    return (
      <main className="page page--dashboard">
        <section className="card dashboard-header">
          <p className="info-message">Cargando…</p>
        </section>
      </main>
    );
  }

  if (user?.role === "agente") {
    return null;
  }

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header">
        <h1>Bandeja de expedientes</h1>
        <p className="description">
          Esta vista ya no está disponible en el panel administrativo. La bandeja operativa de funcionarios se
          encuentra en{" "}
          <Link href="/funcionario/dashboard" className="portal-action-link">
            /funcionario/dashboard
          </Link>
          .
        </p>
        <p className="small">
          Los administradores pueden seguir gestionando el catálogo de procedimientos desde el panel admin.
        </p>
      </section>
    </main>
  );
}

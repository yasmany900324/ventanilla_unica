"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const handleSubmit = (event) => {
    event.preventDefault();
    router.push("/ciudadano/dashboard");
  };

  return (
    <main className="page page--auth">
      <section className="card auth-card">
        <p className="eyebrow">Acceso ciudadano</p>
        <h1>Iniciar sesion</h1>
        <p className="description">
          Ingresa a tu espacio privado para registrar incidencias y revisar su
          seguimiento.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Correo electronico</label>
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="nombre@correo.com"
            required
          />

          <label htmlFor="password">Contrasena</label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Ingresa tu contrasena"
            required
          />

          <button type="submit">Entrar a mi panel</button>
        </form>

        <p className="small auth-footnote">
          Esta vista representa el flujo de autenticacion. En esta etapa no se
          conecta a un proveedor real de identidad.
        </p>

        <div className="auth-footer">
          <Link href="/registro" className="button-link button-link--secondary">
            Crear cuenta
          </Link>
          <Link href="/ciudadano/dashboard" className="button-link">
            Ver dashboard ciudadano
          </Link>
        </div>
      </section>
    </main>
  );
}

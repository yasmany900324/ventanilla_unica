"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegistroPage() {
  const router = useRouter();

  const handleSubmit = (event) => {
    event.preventDefault();
    router.push("/ciudadano/dashboard");
  };

  return (
    <main className="page page--auth">
      <section className="card auth-card">
        <p className="eyebrow">Crear cuenta</p>
        <h1>Registro ciudadano</h1>
        <p className="description">
          Completa tus datos para crear tu cuenta y acceder al dashboard privado.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Nombre completo
            <input type="text" name="name" placeholder="Ej. Ana Perez" required />
          </label>
          <label>
            Correo electronico
            <input
              type="email"
              name="email"
              placeholder="nombre@correo.com"
              required
            />
          </label>
          <label>
            Contrasena
            <input
              type="password"
              name="password"
              placeholder="Minimo 8 caracteres"
              required
            />
          </label>
          <button type="submit">Crear cuenta</button>
        </form>

        <p className="small auth-footnote">
          Este registro es una vista inicial de autenticacion y aun no persiste
          usuarios reales.
        </p>
        <p className="small">
          Ya tienes cuenta? <Link href="/login">Inicia sesion</Link>
        </p>
        <p className="small">
          <Link href="/">Volver a la landing publica</Link>
        </p>
      </section>
    </main>
  );
}

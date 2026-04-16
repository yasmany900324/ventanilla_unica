"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoadingAuth } = useAuth();
  const [formData, setFormData] = useState({
    identifier: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    const identifier = formData.identifier.trim();
    const password = formData.password.trim();

    if (!identifier || !password) {
      setErrorMessage("Debes completar identificacion y contrasena.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ identifier, password });
      router.push("/ciudadano/dashboard");
    } catch (error) {
      setErrorMessage(error.message || "No se pudo iniciar sesion.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  return (
    <main className="page page--auth">
      <section className="card auth-card">
        <p className="eyebrow">Acceso ciudadano</p>
        <h1>Iniciar sesion</h1>
        <p className="description">
          Accede con tu cedula o correo electronico y tu contrasena.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="identifier">Cedula o correo electronico</label>
          <input
            id="identifier"
            type="text"
            name="identifier"
            autoComplete="username"
            placeholder="Ej. 12345678 o nombre@correo.com"
            value={formData.identifier}
            onChange={handleChange}
            required
          />

          <label htmlFor="password">Contrasena</label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Ingresa tu contrasena"
            value={formData.password}
            onChange={handleChange}
            required
          />

          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting || isLoadingAuth}>
            {isSubmitting ? "Ingresando..." : "Entrar a mi panel"}
          </button>
        </form>

        <p className="small auth-footnote">
          La autenticacion valida tus credenciales contra usuarios persistidos en
          base de datos.
        </p>

        <div className="auth-footer">
          <Link href="/registro" className="button-link button-link--secondary">
            Crear cuenta
          </Link>
        </div>
      </section>
    </main>
  );
}

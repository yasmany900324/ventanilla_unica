"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegistroPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: "",
    cedula: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    const normalizedData = {
      fullName: formData.fullName.trim(),
      cedula: formData.cedula.trim(),
      email: formData.email.trim().toLowerCase(),
      password: formData.password.trim(),
      confirmPassword: formData.confirmPassword.trim(),
    };

    if (!normalizedData.fullName) {
      setErrorMessage("El nombre completo es obligatorio.");
      return;
    }

    if (!normalizedData.cedula) {
      setErrorMessage("La cedula es obligatoria.");
      return;
    }

    if (normalizedData.email && !EMAIL_PATTERN.test(normalizedData.email)) {
      setErrorMessage("El correo electronico informado no tiene un formato valido.");
      return;
    }

    if (!normalizedData.password) {
      setErrorMessage("La contrasena es obligatoria.");
      return;
    }

    if (!normalizedData.confirmPassword) {
      setErrorMessage("Debes confirmar la contrasena.");
      return;
    }

    if (normalizedData.password !== normalizedData.confirmPassword) {
      setErrorMessage("La confirmacion de contrasena no coincide.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizedData),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo completar el registro.");
      }

      router.push("/ciudadano/dashboard");
    } catch (error) {
      setErrorMessage(error.message || "No se pudo completar el registro.");
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
        <p className="eyebrow">Crear cuenta</p>
        <h1>Registro ciudadano</h1>
        <p className="description">
          Completa tus datos para crear tu cuenta y acceder a tu espacio
          ciudadano.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="fullName">
            Nombre completo
            <input
              id="fullName"
              type="text"
              name="fullName"
              placeholder="Ej. Ana Perez"
              value={formData.fullName}
              onChange={handleChange}
              required
            />
          </label>
          <label htmlFor="cedula">
            Cedula (obligatoria)
            <input
              id="cedula"
              type="text"
              name="cedula"
              autoComplete="off"
              placeholder="Ej. 12345678"
              value={formData.cedula}
              onChange={handleChange}
              required
            />
          </label>
          <label htmlFor="email">
            Correo electronico (opcional)
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="nombre@correo.com"
              value={formData.email}
              onChange={handleChange}
            />
          </label>
          <label htmlFor="password">
            Contrasena
            <input
              id="password"
              type="password"
              name="password"
              placeholder="Minimo 8 caracteres"
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>
          <label htmlFor="confirmPassword">
            Confirmar contrasena
            <input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              placeholder="Repite tu contrasena"
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />
          </label>
          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>

        <p className="small auth-footnote">
          El registro crea tu usuario en base de datos y abre una sesion real.
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

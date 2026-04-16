"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_STORAGE_KEY = "citizen-users";

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    identifier: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    setErrorMessage("");

    const identifier = formData.identifier.trim();
    const password = formData.password.trim();

    if (!identifier || !password) {
      setErrorMessage("Debes completar identificacion y contrasena.");
      return;
    }

    const normalizedIdentifier = EMAIL_PATTERN.test(identifier)
      ? identifier.toLowerCase()
      : identifier;
    const identifierType = EMAIL_PATTERN.test(identifier) ? "email" : "cedula";
    const storedUsers = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "[]");
    const matchedUser = storedUsers.find((user) =>
      identifierType === "email"
        ? user.email === normalizedIdentifier
        : user.cedula === normalizedIdentifier,
    );

    if (!matchedUser) {
      setErrorMessage(
        `No existe una cuenta asociada a ${
          identifierType === "email" ? "ese correo electronico." : "esa cedula."
        }`,
      );
      return;
    }

    if (matchedUser.password !== password) {
      setErrorMessage("La contrasena ingresada no es correcta.");
      return;
    }

    const authPayload = {
      identifier: normalizedIdentifier,
      password,
      identifierType,
    };

    console.log("Auth payload listo para backend:", authPayload);
    router.push("/ciudadano/dashboard");
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
          <button type="submit">Entrar a mi panel</button>
        </form>

        <p className="small auth-footnote">
          La autenticacion usa un identificador unico y detecta automaticamente
          si corresponde a cedula o correo electronico.
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const { register, isLoadingAuth } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const [formData, setFormData] = useState({
    fullName: "",
    cedula: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const localizedErrorText = useMemo(
    () => ({
      fullNameRequired: copy.auth.errors.fullNameRequired,
      cedulaRequired: copy.auth.errors.cedulaRequired,
      invalidEmail: copy.auth.errors.invalidEmail,
      passwordRequired: copy.auth.errors.passwordRequired,
      confirmPasswordRequired: copy.auth.errors.confirmPasswordRequired,
      passwordMismatch: copy.auth.errors.passwordMismatch,
      registerFailed: copy.auth.errors.registerFailed,
    }),
    [copy.auth.errors]
  );

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
      setErrorMessage(localizedErrorText.fullNameRequired);
      return;
    }

    if (!normalizedData.cedula) {
      setErrorMessage(localizedErrorText.cedulaRequired);
      return;
    }

    if (normalizedData.email && !EMAIL_PATTERN.test(normalizedData.email)) {
      setErrorMessage(localizedErrorText.invalidEmail);
      return;
    }

    if (!normalizedData.password) {
      setErrorMessage(localizedErrorText.passwordRequired);
      return;
    }

    if (!normalizedData.confirmPassword) {
      setErrorMessage(localizedErrorText.confirmPasswordRequired);
      return;
    }

    if (normalizedData.password !== normalizedData.confirmPassword) {
      setErrorMessage(localizedErrorText.passwordMismatch);
      return;
    }

    setIsSubmitting(true);
    try {
      await register(normalizedData);
      router.push("/ciudadano/dashboard");
    } catch (error) {
      setErrorMessage(error.message || localizedErrorText.registerFailed);
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
    <main className="page page--auth" lang={locale}>
      <section className="card auth-card">
        <p className="eyebrow">{copy.auth.registerEyebrow}</p>
        <h1>{copy.auth.registerTitle}</h1>
        <p className="description">{copy.auth.registerDescription}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="fullName">
            {copy.auth.fullNameLabel}
            <input
              id="fullName"
              type="text"
              name="fullName"
              placeholder={copy.auth.fullNamePlaceholder}
              value={formData.fullName}
              onChange={handleChange}
              required
            />
          </label>
          <label htmlFor="cedula">
            {copy.auth.cedulaLabel}
            <input
              id="cedula"
              type="text"
              name="cedula"
              autoComplete="off"
              placeholder={copy.auth.cedulaPlaceholder}
              value={formData.cedula}
              onChange={handleChange}
              required
            />
          </label>
          <label htmlFor="email">
            {copy.auth.emailLabel}
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder={copy.auth.emailPlaceholder}
              value={formData.email}
              onChange={handleChange}
            />
          </label>
          <label htmlFor="password">
            {copy.auth.passwordLabel}
            <input
              id="password"
              type="password"
              name="password"
              placeholder={copy.auth.newPasswordPlaceholder}
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>
          <label htmlFor="confirmPassword">
            {copy.auth.confirmPasswordLabel}
            <input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              placeholder={copy.auth.confirmPasswordPlaceholder}
              autoComplete="new-password"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />
          </label>
          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting || isLoadingAuth}>
            {isSubmitting ? copy.auth.registerSubmitting : copy.auth.registerCta}
          </button>
        </form>

        <p className="small auth-footnote">{copy.auth.registerFootnote}</p>
        <p className="small">
          {copy.auth.alreadyHaveAccount} <Link href="/login">{copy.auth.loginLink}</Link>
        </p>
        <p className="small">
          <Link href="/">{copy.auth.backToLanding}</Link>
        </p>
      </section>
    </main>
  );
}

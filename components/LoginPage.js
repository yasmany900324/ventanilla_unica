"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isLoadingAuth } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const nextPath = searchParams.get("next");
  const [formData, setFormData] = useState({
    identifier: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const localizedErrorText = useMemo(
    () => ({
      requiredIdentifierPassword: copy.auth.errors.requiredIdentifierPassword,
      loginFailed: copy.auth.errors.loginFailed,
    }),
    [copy.auth.errors]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    const identifier = formData.identifier.trim();
    const password = formData.password.trim();

    if (!identifier || !password) {
      setErrorMessage(localizedErrorText.requiredIdentifierPassword);
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ identifier, password });
      if (typeof nextPath === "string" && nextPath.startsWith("/")) {
        router.push(nextPath);
        return;
      }
      router.push("/ciudadano/dashboard");
    } catch (error) {
      setErrorMessage(error.message || localizedErrorText.loginFailed);
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
        <p className="eyebrow">{copy.auth.accessEyebrow}</p>
        <h1>{copy.auth.loginTitle}</h1>
        <p className="description">{copy.auth.loginDescription}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="identifier">{copy.auth.identifierLabel}</label>
          <input
            id="identifier"
            type="text"
            name="identifier"
            autoComplete="username"
            placeholder={copy.auth.identifierPlaceholder}
            value={formData.identifier}
            onChange={handleChange}
            required
          />

          <label htmlFor="password">{copy.auth.passwordLabel}</label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder={copy.auth.passwordPlaceholder}
            value={formData.password}
            onChange={handleChange}
            required
          />

          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting || isLoadingAuth}>
            {isSubmitting ? copy.auth.loginSubmitting : copy.auth.loginCta}
          </button>
        </form>

        <p className="small auth-footnote">{copy.auth.loginFootnote}</p>

        <div className="auth-footer">
          <Link href="/registro" className="button-link button-link--secondary">
            {copy.auth.createAccountCta}
          </Link>
        </div>
      </section>
    </main>
  );
}

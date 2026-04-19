"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

function normalizeCardId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function resolveCardType(item) {
  if (item?.badgeType === "anonymous") {
    return "incidencia";
  }

  return "tramite";
}

function resolveIncidentCategory(item) {
  const icon = typeof item?.icon === "string" ? item.icon.toUpperCase().trim() : "";
  if (icon === "AP") {
    return "alumbrado";
  }
  if (icon === "CD") {
    return "limpieza";
  }
  if (icon === "AR") {
    return "infraestructura";
  }
  return "otro";
}

function buildAssistantCardHref(item) {
  const cardType = resolveCardType(item);
  const params = new URLSearchParams();
  params.set("type", cardType);
  params.set("id", normalizeCardId(item?.title || "") || "item");
  params.set("title", item?.title || "");

  if (item?.description) {
    params.set("description", item.description);
  }
  if (cardType === "incidencia") {
    params.set("category", resolveIncidentCategory(item));
  }

  return `/asistente?${params.toString()}`;
}

export default function HomePageClient() {
  const { isAuthenticated } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const hasActiveSession = isAuthenticated;
  const assistantHref = "/asistente";
  const reportHref = assistantHref;
  const trackingHref = hasActiveSession ? "/mis-incidencias" : "/login";
  const accessTitle = copy.home.accessTitle;
  const accessDescription = hasActiveSession
    ? copy.home.accessDescriptionActive
    : copy.home.accessDescriptionInactive;
  const identityHref = hasActiveSession ? "/ciudadano/dashboard" : "/login";

  return (
    <main className="page page--home">
      <nav className="home-breadcrumb" aria-label={copy.home.breadcrumbAriaLabel}>
        <ol>
          <li>
            <Link href="/">{copy.nav.home}</Link>
          </li>
          <li aria-current="page">{copy.home.breadcrumbCurrent}</li>
        </ol>
      </nav>

      <section className="home-hero" aria-labelledby="titulo-home">
        <div className="home-hero__content">
          <span className="home-hero__kicker">{copy.home.kicker}</span>
          <h1 id="titulo-home">{copy.home.title}</h1>
          <p>{copy.home.description}</p>
          <div className="home-hero__actions">
            <Link href={reportHref} className="home-cta home-cta--primary">
              {copy.home.ctaStartProcedure}
            </Link>
            <Link href={reportHref} className="home-cta home-cta--secondary">
              {copy.home.ctaReportProblem}
            </Link>
            <Link href={trackingHref} className="home-cta home-cta--secondary">
              {copy.home.ctaCheckStatus}
            </Link>
          </div>
          <ul className="home-hero__chips" aria-label={copy.home.portalAttributesAria}>
            {copy.home.heroAttributes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <aside className="home-assistant-card" aria-label={copy.home.assistantTitle}>
          <span className="home-assistant-card__icon" aria-hidden="true">
            BOT
          </span>
          <h2>{copy.home.assistantTitle}</h2>
          <p>{copy.home.assistantDescription}</p>
          <Link href={assistantHref} className="home-cta home-cta--assistant">
            {copy.home.assistantCta}
          </Link>
        </aside>
      </section>

      <section id="tramites" className="home-frequent card" aria-labelledby="frequent-title">
        <header className="home-frequent__head">
          <div>
            <h2 id="frequent-title">{copy.home.frequentTitle}</h2>
            <p>{copy.home.frequentDescription}</p>
          </div>
          <Link href="/login" className="home-frequent__all-link">
            {copy.home.viewAllProcedures}
          </Link>
        </header>

        <div className="home-frequent__grid">
          {copy.home.frequentServices.map((item) => {
            const href =
              item.badgeType === "identity" && !hasActiveSession
                ? "/login"
                : buildAssistantCardHref(item);

            return (
              <article key={item.title} className="frequent-card">
                <div className="frequent-card__icon" aria-hidden="true">
                  {item.icon}
                </div>
                <div className="frequent-card__content">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <span className={`frequent-card__badge frequent-card__badge--${item.badgeType}`}>
                    {item.badge}
                  </span>
                </div>
                <Link
                  href={href}
                  className="frequent-card__arrow"
                  aria-label={`${copy.home.openItemAriaPrefix} ${item.title}`}
                >
                  &gt;
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-bottom-grid">
        <article className="card home-flow-card">
          <h2>{copy.home.flowTitle}</h2>
          <p>
            {copy.home.flowDescription}
          </p>
          <ol className="home-flow-card__steps" aria-label={copy.home.flowStepsAria}>
            {copy.home.attentionFlow.map((step, index) => (
              <li key={step.title} className="home-flow-step">
                <span className="home-flow-step__icon" aria-hidden="true">
                  {step.icon}
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                {index < copy.home.attentionFlow.length - 1 ? (
                  <span className="home-flow-step__connector" aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ol>
        </article>

        <article className="card home-access-card">
          <span className="home-access-card__label">{copy.home.accessLabel}</span>
          <h2>{accessTitle}</h2>
          <p>{accessDescription}</p>
          <ul>
            {copy.home.citizenActions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="home-access-card__actions">
            <Link href={identityHref} className="home-cta home-cta--inline-primary">
              {copy.home.loginCta}
            </Link>
            <Link href="/registro" className="home-cta home-cta--inline-secondary">
              {copy.home.registerNowCta}
            </Link>
          </div>
        </article>

        <article id="ayuda-soporte" className="card home-help-card">
          <h2>{copy.home.helpTitle}</h2>
          <p>{copy.home.helpDescription}</p>
          <ul>
            {copy.home.helpItems.map((item) => (
              <li key={item.label}>
                <Link href={item.href}>
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={assistantHref} className="home-help-card__assistant-link">
            {copy.home.assistantCta}
          </Link>
        </article>
      </section>
    </main>
  );
}

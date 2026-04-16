"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

const HERO_ATTRIBUTES = [
  "Disponible 24 horas",
  "Seguimiento por numero de ticket",
  "ES | PT | EN",
];

const FREQUENT_SERVICES = [
  {
    icon: "AR",
    title: "Arbol caido / ramas peligrosas",
    description:
      "Reporta incidentes con arboles en la via publica.",
    badge: "Reporte anonimo",
    badgeType: "anonymous",
  },
  {
    icon: "CD",
    title: "Contenedor desbordado",
    description:
      "Informa sobre contenedores que necesitan vaciado urgente.",
    badge: "Reporte anonimo",
    badgeType: "anonymous",
  },
  {
    icon: "AP",
    title: "Alumbrado publico",
    description: "Farolas apagadas o en mal estado.",
    badge: "Reporte anonimo",
    badgeType: "anonymous",
  },
  {
    icon: "RE",
    title: "Registro de empresa",
    description:
      "Habilitacion comercial para nuevos emprendimientos.",
    badge: "Requiere identidad",
    badgeType: "identity",
  },
  {
    icon: "PC",
    title: "Permiso de construccion",
    description: "Habilitaciones para obras en propiedad privada.",
    badge: "Requiere identidad",
    badgeType: "identity",
  },
  {
    icon: "CT",
    title: "Consultar mi tramite",
    description: "Segui el estado de una gestion ya iniciada.",
    badge: "Con numero de ticket",
    badgeType: "ticket",
  },
];

const ATTENTION_FLOW = [
  {
    icon: "1",
    title: "Recibido",
    description: "Registramos tu solicitud",
  },
  {
    icon: "2",
    title: "En revision",
    description: "Evaluamos y asignamos",
  },
  {
    icon: "3",
    title: "En proceso",
    description: "Trabajamos para resolver",
  },
  {
    icon: "4",
    title: "Resuelto",
    description: "Te notificamos la solucion",
  },
];

const CITIZEN_ACTIONS = [
  "Iniciar nuevos tramites y reportes",
  "Consultar el estado actual de cada caso",
  "Revisar el historial y seguimiento detallado",
  "Adjuntar documentacion cuando sea necesario",
];

const HELP_ITEMS = [
  { label: "Hablar con el asistente", href: "/#ayuda-soporte", icon: "AS" },
  { label: "Preguntas frecuentes", href: "/#ayuda-soporte", icon: "FAQ" },
  { label: "Canales de contacto", href: "/#ayuda-soporte", icon: "CC" },
];

export default function HomePageClient() {
  const { isAuthenticated } = useAuth();
  const hasActiveSession = isAuthenticated;
  const assistantHref = hasActiveSession
    ? "/ciudadano/dashboard#detalle-caso"
    : "/#ayuda-soporte";
  const reportHref = hasActiveSession ? "/ciudadano/dashboard#nueva-incidencia" : "/registro";
  const trackingHref = hasActiveSession ? "/mis-incidencias" : "/login";
  const accessTitle = "Gestiona tus tramites en un entorno privado";
  const accessDescription = hasActiveSession
    ? "Tu sesion esta activa y ya puedes operar de forma segura y personalizada:"
    : "Una vez autenticado podras operar de forma segura y personalizada:";
  const identityHref = hasActiveSession ? "/ciudadano/dashboard" : "/login";

  return (
    <main className="page page--home">
      <nav className="home-breadcrumb" aria-label="Ruta de navegacion">
        <ol>
          <li>
            <Link href="/">Inicio</Link>
          </li>
          <li aria-current="page">Portal de Tramites y Reportes</li>
        </ol>
      </nav>

      <section className="home-hero" aria-labelledby="titulo-home">
        <div className="home-hero__content">
          <span className="home-hero__kicker">ATENCION CIUDADANA DIGITAL</span>
          <h1 id="titulo-home">Portal de Tramites y Reportes</h1>
          <p>
            Gestiona tus tramites, reportes e incidencias en linea de forma simple, con
            seguimiento y asistencia en cada paso.
          </p>
          <div className="home-hero__actions">
            <Link href={reportHref} className="home-cta home-cta--primary">
              Iniciar un tramite
            </Link>
            <Link href={reportHref} className="home-cta home-cta--secondary">
              Reportar un problema
            </Link>
            <Link href={trackingHref} className="home-cta home-cta--secondary">
              Consultar estado
            </Link>
          </div>
          <ul className="home-hero__chips" aria-label="Atributos del portal">
            {HERO_ATTRIBUTES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <aside className="home-assistant-card" aria-label="Asistente virtual">
          <span className="home-assistant-card__icon" aria-hidden="true">
            BOT
          </span>
          <h2>Asistente virtual</h2>
          <p>
            Te guia paso a paso, responde preguntas y te ayuda a encontrar el tramite
            que necesitas.
          </p>
          <Link href={assistantHref} className="home-cta home-cta--assistant">
            Hablar con el asistente
          </Link>
        </aside>
      </section>

      <section id="tramites" className="home-frequent card" aria-labelledby="frequent-title">
        <header className="home-frequent__head">
          <div>
            <h2 id="frequent-title">Tramites y reportes frecuentes</h2>
            <p>
              Elegi un tramite para comenzar o escribinos directamente a nuestro
              asistente
            </p>
          </div>
          <Link href="/login" className="home-frequent__all-link">
            Ver todos los tramites
          </Link>
        </header>

        <div className="home-frequent__grid">
          {FREQUENT_SERVICES.map((item) => {
            const href =
              item.badgeType === "identity"
                ? hasActiveSession
                  ? "/ciudadano/dashboard"
                  : "/login"
                : hasActiveSession
                  ? "/ciudadano/dashboard#nueva-incidencia"
                  : "/registro";

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
                <Link href={href} className="frequent-card__arrow" aria-label={`Abrir ${item.title}`}>
                  &gt;
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-bottom-grid">
        <article className="card home-flow-card">
          <h2>Flujo general de atencion</h2>
          <p>
            Tus solicitudes siguen etapas claras para asegurar trazabilidad y
            seguimiento.
          </p>
          <ol className="home-flow-card__steps" aria-label="Etapas de atencion">
            {ATTENTION_FLOW.map((step, index) => (
              <li key={step.title} className="home-flow-step">
                <span className="home-flow-step__icon" aria-hidden="true">
                  {step.icon}
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                {index < ATTENTION_FLOW.length - 1 ? (
                  <span className="home-flow-step__connector" aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ol>
        </article>

        <article className="card home-access-card">
          <span className="home-access-card__label">ACCEDE A TU ESPACIO CIUDADANO</span>
          <h2>{accessTitle}</h2>
          <p>{accessDescription}</p>
          <ul>
            {CITIZEN_ACTIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="home-access-card__actions">
            <Link href={identityHref} className="home-cta home-cta--inline-primary">
              Iniciar sesion
            </Link>
            <Link href="/registro" className="home-cta home-cta--inline-secondary">
              Registrarme ahora
            </Link>
          </div>
        </article>

        <article id="ayuda-soporte" className="card home-help-card">
          <h2>Necesitas ayuda?</h2>
          <p>
            Nuestro equipo y canales de atencion estan disponibles para acompanarte.
          </p>
          <ul>
            {HELP_ITEMS.map((item) => (
              <li key={item.label}>
                <Link href={item.href}>
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={assistantHref} className="home-help-card__assistant-link">
            Hablar con el asistente
          </Link>
        </article>
      </section>
    </main>
  );
}

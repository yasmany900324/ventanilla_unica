import Link from "next/link";
import { cookies } from "next/headers";
import { getAuthenticatedUserFromToken, SESSION_COOKIE_NAME } from "../lib/auth";

const FEATURE_SUMMARY = [
  {
    title: "Canal unico y trazable",
    description:
      "Centraliza solicitudes, reclamos e incidencias ciudadanas en un sistema institucional.",
  },
  {
    title: "Comunicacion clara",
    description:
      "Cada caso mantiene estados visibles y mensajes de seguimiento durante todo el proceso.",
  },
  {
    title: "Gestion con enfoque ciudadano",
    description:
      "Mejora la atencion, los tiempos de respuesta y la transparencia del servicio publico.",
  },
];

const ATTENTION_FLOW = [
  {
    title: "Recibido",
    description: "Se registra el caso y se genera un numero de ticket para seguimiento.",
  },
  {
    title: "En revision",
    description: "El equipo valida la informacion y define el tipo de atencion requerida.",
  },
  {
    title: "En proceso",
    description:
      "Se ejecutan las acciones operativas y se actualiza el avance del caso.",
  },
  {
    title: "Resuelto",
    description:
      "Se comunica el cierre con resultado y queda disponible el historial completo.",
  },
];

const HERO_BENEFITS = [
  "Disponible 24 horas",
  "Seguimiento por numero de ticket",
  "Gestion clara y trazable",
];

const CITIZEN_ACTIONS = [
  "Registrar nuevas incidencias con informacion completa.",
  "Consultar el estado actual de cada caso reportado.",
  "Revisar el historial y seguimiento detallado de sus incidencias.",
];

const SUPPORT_ACCESS = [
  {
    title: "Centro de ayuda",
    description:
      "Guia de uso del portal para iniciar incidencias y gestionar el seguimiento.",
    href: "/#ayuda-soporte",
    actionLabel: "Ver recursos",
  },
  {
    title: "Preguntas frecuentes",
    description:
      "Respuestas sobre registro, acceso, estados del caso y trazabilidad.",
    href: "/#ayuda-soporte",
    actionLabel: "Consultar FAQ",
  },
  {
    title: "Canales de contacto",
    description:
      "Canales institucionales para soporte tecnico y consultas de atencion.",
    href: "/#ayuda-soporte",
    actionLabel: "Ver canales",
  },
];

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);
  const hasActiveSession = Boolean(authenticatedUser);
  const citizenName = authenticatedUser?.fullName || "ciudadano";

  const heroDescription =
    "Portal institucional para iniciar incidencias y tramites, consultar estados y mantener un seguimiento transparente de cada caso.";
  const accessTitle = hasActiveSession
    ? "Tu espacio ciudadano ya esta listo para operar"
    : "Accede a tu espacio ciudadano";
  const accessDescription = hasActiveSession
    ? "Tu sesion esta activa: puedes registrar incidencias, consultar estados y revisar el seguimiento de tus casos."
    : "Una vez autenticado podras operar sobre tus propios casos de forma segura y personalizada.";
  const assistantHref = hasActiveSession
    ? "/ciudadano/dashboard#detalle-caso"
    : "/#ayuda-soporte";

  return (
    <main className="page page--home">
      <section className="home-hero-grid" aria-labelledby="titulo-home">
        <div className="card card--hero home-hero-panel">
          <p className="eyebrow">Atencion ciudadana digital</p>
          <h1 id="titulo-home">Sistema de Atencion Ciudadana</h1>
          <p className="description">{heroDescription}</p>

          {hasActiveSession ? (
            <p className="small home-hero-greeting">Sesion activa: hola, {citizenName}.</p>
          ) : null}

          <div className="hero-actions">
            <Link
              href={hasActiveSession ? "/ciudadano/dashboard#nueva-incidencia" : "/registro"}
              className="button-link"
            >
              Iniciar incidencia
            </Link>
            <Link
              href={hasActiveSession ? "/mis-incidencias" : "/login"}
              className="button-link button-link--secondary"
            >
              Consultar estado
            </Link>
            <Link href={assistantHref} className="button-link button-link--secondary">
              Hablar con el asistente
            </Link>
          </div>

          <ul className="hero-benefits" aria-label="Atributos del sistema">
            {HERO_BENEFITS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <aside className="card hero-side-card" aria-label="Acceso rapido">
          <p className="eyebrow">Acceso rapido</p>
          <h2>
            {hasActiveSession
              ? "Ir a tu espacio ciudadano"
              : "Crea o activa tu perfil ciudadano"}
          </h2>
          <p className="small">
            {hasActiveSession
              ? "Ingresa al panel para registrar nuevas incidencias y revisar el estado de tus casos."
              : "Registra tu cuenta para iniciar tramites, consultar estados y recibir actualizaciones de seguimiento."}
          </p>
          <div className="hero-actions">
            <Link
              href={hasActiveSession ? "/ciudadano/dashboard" : "/login"}
              className="button-link"
            >
              {hasActiveSession ? "Abrir mi panel" : "Iniciar sesion"}
            </Link>
            {!hasActiveSession ? (
              <Link href="/registro" className="button-link button-link--secondary">
                Crear cuenta
              </Link>
            ) : null}
          </div>
        </aside>
      </section>

      <section className="feature-grid" aria-label="Beneficios del sistema">
        {FEATURE_SUMMARY.map((feature) => (
          <article key={feature.title} className="card feature-card">
            <h2>{feature.title}</h2>
            <p className="small">{feature.description}</p>
          </article>
        ))}
      </section>

      <section className="card flow-section">
        <h2>Flujo general de atencion</h2>
        <p className="small">
          Todas las incidencias siguen etapas estandar para dar trazabilidad y
          claridad del avance.
        </p>
        <ul className="flow-steps" aria-label="Etapas del flujo de atencion">
          {ATTENTION_FLOW.map((step, index) => (
            <li key={step.title} className="flow-step">
              <p className="flow-step__index">{String(index + 1).padStart(2, "0")}</p>
              <h3 className="flow-step__title">{step.title}</h3>
              <p className="small flow-step__description">{step.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="card citizen-access-section">
        <div className="citizen-access-section__content">
          <p className="eyebrow">Espacio ciudadano privado</p>
          <h2>{accessTitle}</h2>
          <p className="small">{accessDescription}</p>
          <ul className="citizen-actions-list">
            {CITIZEN_ACTIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="hero-actions citizen-access-section__actions">
          {hasActiveSession ? (
            <>
              <Link href="/ciudadano/dashboard" className="button-link">
                Ir a mi panel ciudadano
              </Link>
              <Link href="/mis-incidencias" className="button-link button-link--secondary">
                Ver mis incidencias
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="button-link">
                Ir a iniciar sesion
              </Link>
              <Link href="/registro" className="button-link button-link--secondary">
                Registrarme ahora
              </Link>
            </>
          )}
        </div>
      </section>

      <section id="ayuda-soporte" className="card support-section">
        <h2>Ayuda y soporte</h2>
        <p className="small">
          Accede a recursos de orientacion y a los canales institucionales para
          resolver dudas sobre registro, seguimiento y gestion de casos.
        </p>
        <div className="support-grid">
          {SUPPORT_ACCESS.map((item) => (
            <article key={item.title} className="support-card">
              <h3>{item.title}</h3>
              <p className="small">{item.description}</p>
              <Link href={item.href} className="support-card__link">
                {item.actionLabel}
              </Link>
            </article>
          ))}
          <article className="support-card">
            <h3>Hablar con el asistente</h3>
            <p className="small">
              Inicia una consulta guiada para orientarte sobre el estado de tu caso o
              sobre los pasos del proceso de atencion.
            </p>
            <Link href={assistantHref} className="support-card__link">
              Iniciar conversacion
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}

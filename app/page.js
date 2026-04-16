import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  destroySessionByToken,
  getAuthenticatedUserFromToken,
  SESSION_COOKIE_NAME,
} from "../lib/auth";

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

const ATTENTION_FLOW = ["Recibido", "En revision", "En proceso", "Resuelto"];

const CITIZEN_ACTIONS = [
  "Registrar nuevas incidencias con informacion completa.",
  "Consultar el estado actual de cada caso reportado.",
  "Revisar el historial y seguimiento detallado de sus incidencias.",
];

async function logoutAction() {
  "use server";

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  await destroySessionByToken(token);

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  redirect("/");
}

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);
  const hasActiveSession = Boolean(authenticatedUser);
  const citizenName = authenticatedUser?.fullName || "ciudadano";

  const heroTitle = hasActiveSession
    ? `Bienvenido, ${citizenName}`
    : "Sistema de Atencion Ciudadana";
  const heroDescription = hasActiveSession
    ? "Ya tienes una sesion activa. Accede a tu panel para registrar nuevas incidencias y consultar el estado de tus casos."
    : "Plataforma institucional para gestionar incidencias con un flujo ordenado, visible y centrado en la experiencia de la ciudadania.";
  const accessTitle = hasActiveSession
    ? "Tu espacio ciudadano ya esta listo para operar"
    : "Gestiona tus incidencias en un entorno privado";
  const accessDescription = hasActiveSession
    ? "Tu sesion esta activa: puedes registrar incidencias, consultar estados y revisar el seguimiento de tus casos."
    : "Una vez autenticado podras operar sobre tus propios casos de forma segura y personalizada.";

  return (
    <main className="page">
      <section className="card card--hero">
        <p className="eyebrow">Atencion ciudadana digital</p>
        <h1>{heroTitle}</h1>
        <p className="description">{heroDescription}</p>
        <div className="hero-actions">
          {hasActiveSession ? (
            <>
              <Link href="/ciudadano/dashboard" className="button-link">
                Ir a mi panel
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="button-link button-link--secondary button-link--button"
                >
                  Cerrar sesion
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="button-link">
                Iniciar sesion
              </Link>
              <Link href="/registro" className="button-link button-link--secondary">
                Crear cuenta
              </Link>
            </>
          )}
        </div>
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
          {ATTENTION_FLOW.map((step) => (
            <li key={step} className="flow-step">
              {step}
            </li>
          ))}
        </ul>
      </section>

      <section className="card citizen-access-section">
        <div>
          <p className="eyebrow">Accede a tu espacio ciudadano</p>
          <h2>{accessTitle}</h2>
          <p className="small">{accessDescription}</p>
        </div>
        <ul className="citizen-actions-list">
          {CITIZEN_ACTIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="hero-actions">
          {hasActiveSession ? (
            <>
              <Link href="/ciudadano/dashboard" className="button-link">
                Ir a mi panel ciudadano
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="button-link button-link--secondary button-link--button"
                >
                  Cerrar sesion
                </button>
              </form>
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
    </main>
  );
}

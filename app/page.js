import Link from "next/link";

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

export default function HomePage() {
  return (
    <main className="page">
      <section className="card card--hero">
        <p className="eyebrow">Atencion ciudadana digital</p>
        <h1>Sistema de Atencion Ciudadana</h1>
        <p className="description">
          Plataforma institucional para gestionar incidencias con un flujo
          ordenado, visible y centrado en la experiencia de la ciudadania.
        </p>
        <div className="hero-actions">
          <Link href="/login" className="button-link">
            Iniciar sesion
          </Link>
          <Link href="/registro" className="button-link button-link--secondary">
            Crear cuenta
          </Link>
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
          <h2>Gestiona tus incidencias en un entorno privado</h2>
          <p className="small">
            Una vez autenticado podras operar sobre tus propios casos de forma
            segura y personalizada.
          </p>
        </div>
        <ul className="citizen-actions-list">
          {CITIZEN_ACTIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="hero-actions">
          <Link href="/login" className="button-link">
            Ir a iniciar sesion
          </Link>
          <Link href="/registro" className="button-link button-link--secondary">
            Registrarme ahora
          </Link>
        </div>
      </section>
    </main>
  );
}

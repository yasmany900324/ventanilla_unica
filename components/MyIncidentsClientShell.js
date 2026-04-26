"use client";

import Link from "next/link";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

export default function MyIncidentsClientShell() {
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const disabledCopy = copy.myIncidentsDisabled || {};

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header dashboard-header--stacked">
        <div>
          <p className="eyebrow">{copy.dashboard.privateSpaceEyebrow}</p>
          <h1>{disabledCopy.title || "Bandeja de incidencias deshabilitada"}</h1>
          <p className="description">{disabledCopy.description || copy.myIncidents.description}</p>
        </div>
      </section>
      <section className="card">
        <p className="small">{disabledCopy.helpText || copy.myIncidents.empty}</p>
        <div className="hero-actions">
          <Link href="/asistente" className="button-link">
            {disabledCopy.primaryAction || copy.dashboard.newIncident}
          </Link>
          <Link href="/ciudadano/dashboard" className="button-link button-link--secondary">
            {disabledCopy.secondaryAction || "Ir al dashboard"}
          </Link>
        </div>
      </section>
    </main>
  );
}

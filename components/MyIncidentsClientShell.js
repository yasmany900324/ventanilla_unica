"use client";

import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import MyIncidentsPageContent from "./MyIncidentsPageContent";

export default function MyIncidentsClientShell() {
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header dashboard-header--stacked">
        <div>
          <p className="eyebrow">{copy.dashboard.privateSpaceEyebrow}</p>
          <h1>{copy.myIncidents.title}</h1>
          <p className="description">{copy.myIncidents.description}</p>
        </div>
      </section>
      <MyIncidentsPageContent />
    </main>
  );
}

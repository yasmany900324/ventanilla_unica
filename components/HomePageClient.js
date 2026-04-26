"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

function getHomeContent(locale = "es") {
  const contentByLocale = {
    en: {
      heroTitle:
        "Start managements, report situations and track the status of your requests in one place",
      heroDescription:
        "Our assistant guides you to find the right option and start your management in just a few minutes.",
      searchPlaceholder: "What do you need to do today?",
      startManagement: "Start management",
      checkStatus: "Check status",
      quickAccessLabel: "Quick access",
      quickAccess: [
        {
          id: "new",
          title: "New management",
          description: "Start a procedure or report a situation in a few steps.",
          href: "/asistente",
          icon: "+",
        },
        {
          id: "my",
          title: "My managements",
          description: "Check and track your managements.",
          href: "/mis-incidencias",
          icon: "▦",
        },
        {
          id: "file",
          title: "Check file",
          description: "Check the status of an existing file.",
          href: "/mis-incidencias",
          icon: "⌕",
        },
        {
          id: "assistant",
          title: "Talk to assistant",
          description: "Get help and find the right option for you.",
          href: "/asistente",
          icon: "◔",
        },
      ],
      frequentTitle: "Frequent managements",
      viewAllManagements: "View all managements →",
      frequent: [
        {
          title: "Public space report",
          type: "REPORT",
          description: "Report issues in public space.",
          href: "/asistente",
          icon: "◉",
        },
        {
          title: "Public lighting",
          type: "REPORT",
          description: "Report failures or lights off in your area.",
          href: "/asistente",
          icon: "✦",
        },
        {
          title: "Overflowing container",
          type: "REPORT",
          description: "Report containers needing urgent emptying.",
          href: "/asistente",
          icon: "▣",
        },
        {
          title: "Business registration",
          type: "PROCEDURE",
          description: "Commercial permit for new businesses.",
          href: "/asistente",
          icon: "▤",
        },
      ],
      recentTitle: "My recent managements",
      viewAllMine: "View all my managements →",
      loadingRecent: "Loading recent managements...",
      emptyRecent: "You still have no managements started.",
      helpTitle: "Need help?",
      helpSubtitle: "We are here to support you at every step.",
      faqTitle: "Frequently asked questions",
      faqDescription: "Answers to the most common questions.",
      channelsTitle: "Contact channels",
      channelsDescription: "Phone, email and offices.",
      helpLine: "Citizen support line",
      flowTitle: "Simple tracking",
      flowSubtitle: "Managing your request is this easy.",
      flow: [
        { title: "Start your management", description: "Choose the management type and complete the details." },
        { title: "We receive your request", description: "We register it and send you a file number." },
        { title: "We follow up", description: "Our team works on the resolution." },
        { title: "We notify you", description: "We inform you about each progress and solution." },
      ],
    },
    pt: {
      heroTitle:
        "Inicie gestões, reporte situações e acompanhe o estado das suas solicitações em um só lugar",
      heroDescription:
        "Nosso assistente orienta você para encontrar a opção correta e iniciar sua gestão em poucos minutos.",
      searchPlaceholder: "O que você precisa fazer hoje?",
      startManagement: "Iniciar gestão",
      checkStatus: "Consultar estado",
      quickAccessLabel: "Acessos rápidos",
      quickAccess: [
        {
          id: "new",
          title: "Nova gestão",
          description: "Inicie um trâmite ou reporte uma situação em poucos passos.",
          href: "/asistente",
          icon: "+",
        },
        {
          id: "my",
          title: "Minhas gestões",
          description: "Consulte e acompanhe suas gestões.",
          href: "/mis-incidencias",
          icon: "▦",
        },
        {
          id: "file",
          title: "Consultar expediente",
          description: "Consulte o estado de um expediente existente.",
          href: "/mis-incidencias",
          icon: "⌕",
        },
        {
          id: "assistant",
          title: "Falar com o assistente",
          description: "Obtenha ajuda e encontre a opção correta para você.",
          href: "/asistente",
          icon: "◔",
        },
      ],
      frequentTitle: "Gestões frequentes",
      viewAllManagements: "Ver todas as gestões →",
      frequent: [
        {
          title: "Reporte em via pública",
          type: "REPORTE",
          description: "Reporte problemas no espaço público.",
          href: "/asistente",
          icon: "◉",
        },
        {
          title: "Iluminação pública",
          type: "REPORTE",
          description: "Reporte falhas ou luzes apagadas na sua zona.",
          href: "/asistente",
          icon: "✦",
        },
        {
          title: "Contêiner transbordando",
          type: "REPORTE",
          description: "Informe contêineres que precisam de esvaziamento urgente.",
          href: "/asistente",
          icon: "▣",
        },
        {
          title: "Registro de empresa",
          type: "TRÂMITE",
          description: "Habilitação comercial para novos empreendimentos.",
          href: "/asistente",
          icon: "▤",
        },
      ],
      recentTitle: "Minhas gestões recentes",
      viewAllMine: "Ver todas as minhas gestões →",
      loadingRecent: "Carregando gestões recentes...",
      emptyRecent: "Você ainda não tem gestões iniciadas.",
      helpTitle: "Precisa de ajuda?",
      helpSubtitle: "Estamos para acompanhar você em cada passo.",
      faqTitle: "Perguntas frequentes",
      faqDescription: "Respondemos as dúvidas mais comuns.",
      channelsTitle: "Canais de contato",
      channelsDescription: "Telefone, correio e escritórios.",
      helpLine: "Linha de atenção cidadã",
      flowTitle: "Acompanhamento simples",
      flowSubtitle: "Assim é fácil fazer sua gestão.",
      flow: [
        { title: "Inicie sua gestão", description: "Escolha o tipo de gestão e complete os dados." },
        { title: "Recebemos sua solicitação", description: "Registramos e enviamos um número de expediente." },
        { title: "Fazemos acompanhamento", description: "Nossa equipe trabalha na resolução." },
        { title: "Notificamos você", description: "Informamos cada avanço e a solução." },
      ],
    },
    es: {
      heroTitle:
        "Iniciá gestiones, reportá situaciones y seguí el estado de tus solicitudes en un solo lugar",
      heroDescription:
        "Nuestro asistente te guía para encontrar la opción correcta y comenzar tu gestión en pocos minutos.",
      searchPlaceholder: "¿Qué necesitás hacer hoy?",
      startManagement: "Iniciar gestión",
      checkStatus: "Consultar estado",
      quickAccessLabel: "Accesos rápidos",
      quickAccess: [
        {
          id: "new",
          title: "Nueva gestión",
          description: "Iniciá un trámite o reportá una situación en pocos pasos.",
          href: "/asistente",
          icon: "+",
        },
        {
          id: "my",
          title: "Mis gestiones",
          description: "Consultá y hacé seguimiento de tus gestiones.",
          href: "/mis-incidencias",
          icon: "▦",
        },
        {
          id: "file",
          title: "Consultar expediente",
          description: "Consultá el estado de un expediente existente.",
          href: "/mis-incidencias",
          icon: "⌕",
        },
        {
          id: "assistant",
          title: "Hablar con el asistente",
          description: "Obtené ayuda y encontrá la opción correcta para vos.",
          href: "/asistente",
          icon: "◔",
        },
      ],
      frequentTitle: "Gestiones frecuentes",
      viewAllManagements: "Ver todas las gestiones →",
      frequent: [
        {
          title: "Reporte en vía pública",
          type: "REPORTE",
          description: "Reportá problemas en el espacio público.",
          href: "/asistente",
          icon: "◉",
        },
        {
          title: "Alumbrado público",
          type: "REPORTE",
          description: "Reportá fallas o luces apagadas en tu zona.",
          href: "/asistente",
          icon: "✦",
        },
        {
          title: "Contenedor desbordado",
          type: "REPORTE",
          description: "Informá sobre contenedores que necesitan vaciado urgente.",
          href: "/asistente",
          icon: "▣",
        },
        {
          title: "Registro de empresa",
          type: "TRÁMITE",
          description: "Habilitación comercial para nuevos emprendimientos.",
          href: "/asistente",
          icon: "▤",
        },
      ],
      recentTitle: "Mis gestiones recientes",
      viewAllMine: "Ver todas mis gestiones →",
      loadingRecent: "Cargando gestiones recientes...",
      emptyRecent: "Todavía no tenés gestiones iniciadas.",
      helpTitle: "¿Necesitás ayuda?",
      helpSubtitle: "Estamos para acompañarte en cada paso.",
      faqTitle: "Preguntas frecuentes",
      faqDescription: "Respondemos las dudas más comunes.",
      channelsTitle: "Canales de contacto",
      channelsDescription: "Teléfono, correo y oficinas.",
      helpLine: "Línea de atención ciudadana",
      flowTitle: "Seguimiento simple",
      flowSubtitle: "Así de fácil es hacer tu gestión.",
      flow: [
        { title: "Iniciá tu gestión", description: "Elegí el tipo de gestión y completá los datos." },
        { title: "Recibimos tu solicitud", description: "La registramos y te enviamos un número de expediente." },
        { title: "Hacemos seguimiento", description: "Nuestro equipo trabaja en la resolución." },
        { title: "Te notificamos", description: "Te informamos cada avance y la solución." },
      ],
    },
  };
  return contentByLocale[locale] || contentByLocale.es;
}

function formatDate(value, locale = "es") {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  const localeMap = { es: "es-UY", en: "en-US", pt: "pt-BR" };
  return new Intl.DateTimeFormat(localeMap[locale] || "es-UY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  const statusMap = {
    DRAFT: { label: "Recibido", tone: "received" },
    PENDING_CONFIRMATION: { label: "Recibido", tone: "received" },
    PENDING_CAMUNDA_SYNC: { label: "Recibido", tone: "received" },
    WAITING_CITIZEN_INFO: { label: "En revisión", tone: "review" },
    PENDING_BACKOFFICE_ACTION: { label: "En proceso", tone: "progress" },
    IN_PROGRESS: { label: "En proceso", tone: "progress" },
    RESOLVED: { label: "Resuelto", tone: "resolved" },
    CLOSED: { label: "Resuelto", tone: "resolved" },
    ARCHIVED: { label: "Resuelto", tone: "resolved" },
    REJECTED: { label: "Resuelto", tone: "resolved" },
  };
  return statusMap[value] || { label: "En revisión", tone: "review" };
}

function HeroLineArt() {
  return (
    <svg viewBox="0 0 560 360" className="home-onify-hero__art" aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="96" y="102" width="246" height="172" rx="22" stroke="#BCD0EE" strokeWidth="2.4" />
        <rect x="124" y="132" width="192" height="18" rx="9" stroke="#CAD9F1" strokeWidth="2" />
        <rect x="124" y="164" width="96" height="84" rx="14" stroke="#D1DEF4" strokeWidth="2" />
        <rect x="234" y="164" width="82" height="38" rx="12" stroke="#D1DEF4" strokeWidth="2" />
        <path d="M236 218h78" stroke="#D1DEF4" strokeWidth="2" />
        <path d="M236 234h60" stroke="#D1DEF4" strokeWidth="2" />
        <path d="M160 194l16 14 25-28" stroke="#84A9DC" strokeWidth="4" />

        <path d="M60 270h440" stroke="#D6E3F7" strokeWidth="3" />
        <path d="M72 270v-56h46v56" stroke="#C7D8F3" strokeWidth="2.2" />
        <path d="M84 214v-28h22v28" stroke="#C7D8F3" strokeWidth="2.2" />
        <path d="M368 270v-82h58v82" stroke="#C7D8F3" strokeWidth="2.2" />
        <path d="M390 188v-38h16v38" stroke="#C7D8F3" strokeWidth="2.2" />
        <path d="M444 270v-44h36v44" stroke="#C7D8F3" strokeWidth="2.2" />

        <path d="M414 94c0-16 13-29 29-29s29 13 29 29c0 18-29 39-29 39s-29-21-29-39Z" stroke="#B8D0F0" strokeWidth="2.2" />
        <circle cx="443" cy="94" r="9" stroke="#B8D0F0" strokeWidth="2.2" />

        <rect x="352" y="104" width="88" height="62" rx="14" stroke="#C2D6F2" strokeWidth="2.2" />
        <path d="M370 127h52M370 143h34" stroke="#C2D6F2" strokeWidth="2.2" />
      </g>
    </svg>
  );
}

export default function HomePageClient() {
  const { isAuthenticated } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const content = getHomeContent(locale);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [recentProcedures, setRecentProcedures] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const loadRecent = async () => {
      setIsLoadingRecent(true);
      try {
        const response = await fetch("/api/ciudadano/procedures/requests?limit=5");
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (!isMounted) return;
        setRecentProcedures(Array.isArray(data?.procedures) ? data.procedures.slice(0, 5) : []);
      } catch {
        if (!isMounted) return;
        setRecentProcedures([]);
      } finally {
        if (isMounted) setIsLoadingRecent(false);
      }
    };

    if (isAuthenticated) {
      loadRecent();
    }
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const greetingName = useMemo(() => copy.dashboard.greetingFallback || "ciudadano", [copy.dashboard.greetingFallback]);

  return (
    <main className="page page--home home-onify">
      <section className="home-onify-hero" aria-labelledby="home-main-title">
        <div className="home-onify-hero__content">
          <h1 id="home-main-title">
            {content.heroTitle}
          </h1>
          <p>{content.heroDescription}</p>

          <label className="home-onify-hero__search" htmlFor="home-search-input">
            <span className="home-onify-hero__search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              id="home-search-input"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={content.searchPlaceholder}
              aria-label="Buscar gestión"
            />
            <span className="home-onify-hero__search-arrow" aria-hidden="true">
              →
            </span>
          </label>

          <div className="home-onify-hero__actions">
            <Link href="/asistente" className="home-onify-btn home-onify-btn--primary">
              <span aria-hidden="true">+</span>
              {content.startManagement}
            </Link>
            <Link href="/mis-incidencias" className="home-onify-btn home-onify-btn--secondary">
              <span aria-hidden="true">▤</span>
              {content.checkStatus}
            </Link>
          </div>
        </div>

        <div className="home-onify-hero__visual">
          <HeroLineArt />
        </div>
      </section>

      <section className="home-onify-access" aria-label={content.quickAccessLabel}>
        {content.quickAccess.map((item) => (
          <Link key={item.id} href={item.href} className="home-onify-access__card" aria-label={item.title}>
            <span className="home-onify-access__icon" aria-hidden="true">
              {item.icon}
            </span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
            </div>
            <span className="home-onify-access__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </section>

      <section id="tramites" className="home-onify-frequent" aria-labelledby="frequent-managements-title">
        <header className="home-onify-section-head">
          <h2 id="frequent-managements-title">{content.frequentTitle}</h2>
          <Link href="/asistente">{content.viewAllManagements}</Link>
        </header>
        <div className="home-onify-frequent__grid">
          {content.frequent.map((item) => (
            <Link href={item.href} key={item.title} className="home-onify-frequent__card">
              <span className="home-onify-frequent__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span
                className={`home-onify-frequent__pill ${
                  item.type === "REPORTE" ? "home-onify-frequent__pill--report" : "home-onify-frequent__pill--procedure"
                }`}
              >
                {item.type}
              </span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="home-onify-frequent__arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-onify-dashboard">
        <article className="home-onify-recent" aria-labelledby="recent-managements-title">
          <header className="home-onify-section-head">
            <h2 id="recent-managements-title">Mis gestiones recientes</h2>
            <Link href="/mis-incidencias">{content.viewAllMine}</Link>
          </header>

          {isLoadingRecent ? <p className="home-onify-empty">{content.loadingRecent}</p> : null}

          {!isLoadingRecent && recentProcedures.length === 0 ? (
            <div className="home-onify-empty-state">
              <p>{content.emptyRecent}</p>
              <Link href="/asistente" className="home-onify-btn home-onify-btn--primary">
                <span aria-hidden="true">+</span>
                {content.startManagement}
              </Link>
            </div>
          ) : null}

          {recentProcedures.length > 0 ? (
            <ul className="home-onify-recent__list">
              {recentProcedures.map((procedure) => {
                const status = normalizeStatus(procedure.status);
                return (
                  <li key={procedure.id}>
                    <Link href={`/mis-incidencias?incidentId=${procedure.id}`} className="home-onify-recent__row">
                      <span className="home-onify-recent__avatar" aria-hidden="true">
                        ●
                      </span>
                      <div className="home-onify-recent__main">
                        <strong>{procedure.procedureName || "Gestión ciudadana"}</strong>
                        <p>Expediente {procedure.requestCode || procedure.id}</p>
                      </div>
                      <p className="home-onify-recent__date">{formatDate(procedure.createdAt, locale)}</p>
                      <span className={`home-onify-status home-onify-status--${status.tone}`}>{status.label}</span>
                      <span className="home-onify-recent__chevron" aria-hidden="true">
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </article>

        <aside id="ayuda-soporte" className="home-onify-help" aria-labelledby="help-panel-title">
          <h2 id="help-panel-title">{content.helpTitle}</h2>
          <p>{content.helpSubtitle}</p>
          <ul>
            <li>
              <Link href="/#ayuda-soporte">
                <span>{content.faqTitle}</span>
                <small>{content.faqDescription}</small>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
            <li>
              <Link href="/#ayuda-soporte">
                <span>{content.channelsTitle}</span>
                <small>{content.channelsDescription}</small>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          </ul>
          <div className="home-onify-help__line">
            <strong>{content.helpLine}</strong>
            <p>0800 4200</p>
            <small>Lunes a viernes de 8 a 18 h</small>
          </div>
          <p className="home-onify-help__hello">
            {copy.portal.greeting}, {greetingName}
          </p>
        </aside>
      </section>

      <section className="home-onify-flow" aria-labelledby="simple-tracking-title">
        <header>
          <h2 id="simple-tracking-title">{content.flowTitle}</h2>
          <p>{content.flowSubtitle}</p>
        </header>
        <ol>
          {content.flow.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

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
          iconKey: "roadAlert",
        },
        {
          title: "Public lighting",
          type: "REPORT",
          description: "Report failures or lights off in your area.",
          href: "/asistente",
          iconKey: "streetLamp",
        },
        {
          title: "Overflowing container",
          type: "REPORT",
          description: "Report containers needing urgent emptying.",
          href: "/asistente",
          iconKey: "container",
        },
        {
          title: "Business registration",
          type: "PROCEDURE",
          description: "Commercial permit for new businesses.",
          href: "/asistente",
          iconKey: "building",
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
        {
          title: "Start your management",
          description: "Choose the management type and complete the details.",
          iconKey: "document",
        },
        {
          title: "We receive your request",
          description: "We register it and send you a file number.",
          iconKey: "inbox",
        },
        { title: "We follow up", description: "Our team works on the resolution.", iconKey: "search" },
        {
          title: "We notify you",
          description: "We inform you about each progress and solution.",
          iconKey: "check",
        },
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
          iconKey: "roadAlert",
        },
        {
          title: "Iluminação pública",
          type: "REPORTE",
          description: "Reporte falhas ou luzes apagadas na sua zona.",
          href: "/asistente",
          iconKey: "streetLamp",
        },
        {
          title: "Contêiner transbordando",
          type: "REPORTE",
          description: "Informe contêineres que precisam de esvaziamento urgente.",
          href: "/asistente",
          iconKey: "container",
        },
        {
          title: "Registro de empresa",
          type: "TRÂMITE",
          description: "Habilitação comercial para novos empreendimentos.",
          href: "/asistente",
          iconKey: "building",
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
        {
          title: "Inicie sua gestão",
          description: "Escolha o tipo de gestão e complete os dados.",
          iconKey: "document",
        },
        {
          title: "Recebemos sua solicitação",
          description: "Registramos e enviamos um número de expediente.",
          iconKey: "inbox",
        },
        { title: "Fazemos acompanhamento", description: "Nossa equipe trabalha na resolução.", iconKey: "search" },
        { title: "Notificamos você", description: "Informamos cada avanço e a solução.", iconKey: "check" },
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
          iconKey: "roadAlert",
        },
        {
          title: "Alumbrado público",
          type: "REPORTE",
          description: "Reportá fallas o luces apagadas en tu zona.",
          href: "/asistente",
          iconKey: "streetLamp",
        },
        {
          title: "Contenedor desbordado",
          type: "REPORTE",
          description: "Informá sobre contenedores que necesitan vaciado urgente.",
          href: "/asistente",
          iconKey: "container",
        },
        {
          title: "Registro de empresa",
          type: "TRÁMITE",
          description: "Habilitación comercial para nuevos emprendimientos.",
          href: "/asistente",
          iconKey: "building",
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
        {
          title: "Iniciá tu gestión",
          description: "Elegí el tipo de gestión y completá los datos.",
          iconKey: "document",
        },
        {
          title: "Recibimos tu solicitud",
          description: "La registramos y te enviamos un número de expediente.",
          iconKey: "inbox",
        },
        { title: "Hacemos seguimiento", description: "Nuestro equipo trabaja en la resolución.", iconKey: "search" },
        { title: "Te notificamos", description: "Te informamos cada avance y la solución.", iconKey: "check" },
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

function FrequentManagementIcon({ iconKey }) {
  if (iconKey === "roadAlert") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4.5 6.8 17.2h10.4L12 4.5Z" />
        <path d="M10.7 10.2h2.6M10.2 12.7h3.6" />
        <path d="M5.6 18.6h12.8" />
      </svg>
    );
  }
  if (iconKey === "streetLamp") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 18.2v-3.6c0-.5.2-1 .55-1.35l3.9-3.9c.34-.34.54-.8.54-1.28V6.8" />
        <path d="M12.9 6.8h2.7l-1 1.2h-2.2" />
        <path d="M7.2 18.2h2.2v3H7.2z" />
        <path d="M6.3 21.5h4" />
      </svg>
    );
  }
  if (iconKey === "container") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 6.2h4l.9 1.1h-5.8z" />
        <path d="M6.2 8.3h11.6" />
        <path d="M7.4 8.3h9.2l-.9 10.1H8.3z" />
        <path d="M9.2 19h5.6" />
      </svg>
    );
  }
  if (iconKey === "building") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.6 18.9h12.8" />
        <path d="M7.1 10.1h9.8v8.8H7.1z" />
        <path d="M6.4 10.1h11.2l-.9-1.4H7.3z" />
        <path d="M8.2 8.7v-1.4h2.8M13 7.3h2.8v1.4" />
        <path d="M10.9 18.9v-2.8a1.1 1.1 0 0 1 2.2 0v2.8" />
        <path d="M8.8 12.6h.01M15.2 12.6h.01M8.8 14.9h.01M15.2 14.9h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 9v3M12 15h.01" />
    </svg>
  );
}

function HelpPanelIcon({ type }) {
  if (type === "channels") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 13a8 8 0 1 1 16 0" />
        <path d="M4 13v4h3v-4M17 13v4h3v-4" />
        <path d="M8 20h8" />
      </svg>
    );
  }
  if (type === "phone") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5h3l1 4-2 2a14 14 0 0 0 4 4l2-2 4 1v3a2 2 0 0 1-2 2h-1C9.9 19 5 14.1 5 8V7a2 2 0 0 1 2-2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h14v9H9l-4 3V6Z" />
      <path d="M9 10h6M9 13h4" />
    </svg>
  );
}

function StepIcon({ iconKey }) {
  if (iconKey === "inbox") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16v10H4z" />
        <path d="M8 13h8l-1.5 2h-5z" />
      </svg>
    );
  }
  if (iconKey === "search") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="5" />
        <path d="m15 15 4 4" />
      </svg>
    );
  }
  if (iconKey === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5 10 17l9-9" />
        <path d="M4 12a8 8 0 1 1 16 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h8l2 2v14H7z" />
      <path d="M9 10h6M9 13h5" />
      <path d="m11 16 1 1 2-2" />
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
                <FrequentManagementIcon iconKey={item.iconKey} />
              </span>
              <div className="home-onify-frequent__content">
                <span
                  className={`home-onify-frequent__pill ${
                    item.type === "REPORTE"
                      ? "home-onify-frequent__pill--report"
                      : "home-onify-frequent__pill--procedure"
                  }`}
                >
                  {item.type}
                </span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <span className="home-onify-frequent__arrow" aria-hidden="true">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-onify-dashboard">
        <article className="home-onify-recent" aria-labelledby="recent-managements-title">
          <header className="home-onify-section-head">
            <h2 id="recent-managements-title">{content.recentTitle}</h2>
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
                      <div className="home-onify-recent__main-group">
                        <span className="home-onify-recent__avatar" aria-hidden="true">
                          ●
                        </span>
                        <div className="home-onify-recent__main">
                          <strong>{procedure.procedureName || "Gestión ciudadana"}</strong>
                          <p>Expediente {procedure.requestCode || procedure.id}</p>
                        </div>
                      </div>
                      <div className="home-onify-recent__date-col">
                        <p className="home-onify-recent__date">{formatDate(procedure.createdAt, locale)}</p>
                      </div>
                      <div className="home-onify-recent__status-col">
                        <span className={`home-onify-status home-onify-status--${status.tone}`}>{status.label}</span>
                      </div>
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
                <span className="home-onify-help__option-icon" aria-hidden="true">
                  <HelpPanelIcon type="faq" />
                </span>
                <span className="home-onify-help__option-copy">
                  <span>{content.faqTitle}</span>
                  <small>{content.faqDescription}</small>
                </span>
                <span className="home-onify-help__option-arrow" aria-hidden="true">→</span>
              </Link>
            </li>
            <li>
              <Link href="/#ayuda-soporte">
                <span className="home-onify-help__option-icon" aria-hidden="true">
                  <HelpPanelIcon type="channels" />
                </span>
                <span className="home-onify-help__option-copy">
                  <span>{content.channelsTitle}</span>
                  <small>{content.channelsDescription}</small>
                </span>
                <span className="home-onify-help__option-arrow" aria-hidden="true">→</span>
              </Link>
            </li>
          </ul>
          <div className="home-onify-help__line">
            <span className="home-onify-help__option-icon home-onify-help__option-icon--line" aria-hidden="true">
              <HelpPanelIcon type="phone" />
            </span>
            <div className="home-onify-help__line-copy">
              <strong>{content.helpLine}</strong>
              <p>0800 4200</p>
              <small>Lunes a viernes de 8 a 18 h</small>
            </div>
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
        <ol className="home-onify-flow__steps">
          {content.flow.map((step, index) => (
            <li key={step.title} className="home-onify-flow__step">
              <div className="home-onify-flow__step-head">
                <span className="home-onify-flow__step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="home-onify-flow__step-icon" aria-hidden="true">
                  <StepIcon iconKey={step.iconKey} />
                </span>
              </div>
              <div className="home-onify-flow__step-copy">
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
              {index < content.flow.length - 1 ? (
                <span className="home-onify-flow__connector" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

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
          href: "/ciudadano/dashboard",
          iconKey: "myManagements",
        },
        {
          id: "file",
          title: "Check file",
          description: "Check the status of an existing file.",
          href: "/ciudadano/dashboard",
          iconKey: "consultFile",
        },
        {
          id: "assistant",
          title: "Talk to assistant",
          description: "Get help and find the right option for you.",
          href: "/asistente",
          iconKey: "assistant",
        },
      ],
      frequentTitle: "Frequent managements",
      viewAllManagements: "View all managements",
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
      viewAllMine: "View all my managements",
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
          href: "/ciudadano/dashboard",
          iconKey: "myManagements",
        },
        {
          id: "file",
          title: "Consultar expediente",
          description: "Consulte o estado de um expediente existente.",
          href: "/ciudadano/dashboard",
          iconKey: "consultFile",
        },
        {
          id: "assistant",
          title: "Falar com o assistente",
          description: "Obtenha ajuda e encontre a opção correta para você.",
          href: "/asistente",
          iconKey: "assistant",
        },
      ],
      frequentTitle: "Gestões frequentes",
      viewAllManagements: "Ver todas as gestões",
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
      viewAllMine: "Ver todas as minhas gestões",
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
          href: "/ciudadano/dashboard",
          iconKey: "myManagements",
        },
        {
          id: "file",
          title: "Consultar expediente",
          description: "Consultá el estado de un expediente existente.",
          href: "/ciudadano/dashboard",
          iconKey: "consultFile",
        },
        {
          id: "assistant",
          title: "Hablar con el asistente",
          description: "Obtené ayuda y encontrá la opción correcta para vos.",
          href: "/asistente",
          iconKey: "assistant",
        },
      ],
      frequentTitle: "Gestiones frecuentes",
      viewAllManagements: "Ver todas las gestiones",
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
      viewAllMine: "Ver todas mis gestiones",
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

function QuickAccessIcon({ iconKey }) {
  if (iconKey === "myManagements") {
    return (
      <svg
        className="home-onify-access__icon-svg"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M19 16.0001V18.0001M19 21.0001H19.01M12 12.0001V16.0001M14 14.0001H10M5 9.77753V16.2001C5 17.8802 5 18.7203 5.32698 19.362C5.6146 19.9265 6.07354 20.3855 6.63803 20.6731C7.27976 21.0001 8.11984 21.0001 9.8 21.0001H14M21 12.0001L15.5668 5.96405C14.3311 4.59129 13.7133 3.9049 12.9856 3.65151C12.3466 3.42894 11.651 3.42899 11.0119 3.65165C10.2843 3.90516 9.66661 4.59163 8.43114 5.96458L3 12.0001"
          stroke="#0F3D8A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (iconKey === "consultFile") {
    return (
      <svg
        className="home-onify-access__icon-svg"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8 8H4V13H11H13H20V8H16H8ZM8 6V5C8 3.89543 8.89543 3 10 3H14C15.1046 3 16 3.89543 16 5V6H20C21.1046 6 22 6.89543 22 8V19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19V8C2 6.89543 2.89543 6 4 6H8ZM11 15H4V19H20V15H13V16H11V15ZM14 6V5H10V6H14Z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  if (iconKey === "assistant") {
    return (
      <svg
        className="home-onify-access__icon-svg"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M3 5V20.7929C3 21.2383 3.53857 21.4614 3.85355 21.1464L7.70711 17.2929C7.89464 17.1054 8.149 17 8.41421 17H19C20.1046 17 21 16.1046 21 15V5C21 3.89543 20.1046 3 19 3H5C3.89543 3 3 3.89543 3 5Z"
          stroke="#0F3D8A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 12C14.2005 12.6224 13.1502 13 12 13C10.8498 13 9.79952 12.6224 9 12"
          stroke="#0F3D8A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 8.01953V8"
          stroke="#0F3D8A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 8.01953V8"
          stroke="#0F3D8A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return null;
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

function FrequentManagementIcon({ iconKey, className }) {
  const svgClassName = ["home-onify-frequent__management-svg", className].filter(Boolean).join(" ");

  if (iconKey === "frequentCardArrow") {
    return (
      <svg
        className={`${svgClassName} home-onify-frequent__card-arrow-svg`}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M5.5 9H3.5" stroke="#0095FF" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5 15L4 15" stroke="#0095FF" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 12H2" stroke="#0095FF" strokeWidth="1.5" strokeLinecap="round" />
        <path
          d="M12.0409 12.7649C12.4551 12.7649 12.7909 12.4291 12.7909 12.0149C12.7909 11.6007 12.4551 11.2649 12.0409 11.2649V12.7649ZM9.26797 12.7649H12.0409V11.2649H9.26797V12.7649Z"
          fill="#0095FF"
        />
        <path
          d="M11.8369 4.80857L12.1914 4.14766L11.8369 4.80857ZM20.5392 9.47684L20.1846 10.1377L20.5392 9.47684ZM20.5356 14.5453L20.8891 15.2068L20.5356 14.5453ZM11.8379 19.1934L11.4844 18.5319H11.4844L11.8379 19.1934ZM8.13677 15.7931L7.41828 15.578L8.13677 15.7931ZM8.13127 8.2039L7.41256 8.41827L8.13127 8.2039ZM9.18255 11.7286L8.46384 11.9429L9.18255 11.7286ZM11.4823 5.46948L20.1846 10.1377L20.8937 8.81593L12.1914 4.14766L11.4823 5.46948ZM20.1821 13.8839L11.4844 18.5319L12.1914 19.8548L20.8891 15.2068L20.1821 13.8839ZM8.85526 16.0082L9.90074 12.5163L8.46376 12.0861L7.41828 15.578L8.85526 16.0082ZM9.90126 11.5142L8.84998 7.98954L7.41256 8.41827L8.46384 11.9429L9.90126 11.5142ZM11.4844 18.5319C10.7513 18.9237 9.98824 18.7591 9.44091 18.2563C8.88829 17.7486 8.58451 16.9125 8.85526 16.0082L7.41828 15.578C6.97411 17.0615 7.47325 18.4855 8.4261 19.3609C9.38423 20.2411 10.8292 20.5828 12.1914 19.8548L11.4844 18.5319ZM20.1846 10.1377C21.6065 10.9005 21.6046 13.1236 20.1821 13.8839L20.8891 15.2068C23.3683 13.8819 23.3707 10.1447 20.8937 8.81593L20.1846 10.1377ZM12.1914 4.14766C10.8301 3.41739 9.38432 3.75692 8.42486 4.63604C7.47072 5.5103 6.96983 6.93392 7.41256 8.41827L8.84998 7.98954C8.5801 7.08467 8.88494 6.24894 9.43821 5.74199C9.98618 5.23991 10.7495 5.07638 11.4823 5.46948L12.1914 4.14766ZM9.90074 12.5163C9.9986 12.1895 9.99878 11.8412 9.90126 11.5142L8.46384 11.9429C8.47777 11.9896 8.47774 12.0394 8.46376 12.0861L9.90074 12.5163Z"
          fill="#363853"
        />
      </svg>
    );
  }
  if (iconKey === "roadAlert") {
    return (
      <svg
        className={svgClassName}
        width="64"
        height="64"
        viewBox="0 0 264 264"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M252.333 33H12.333C5.733 33 0 38.4 0 45V103C0 109.6 5.733 115 12.333 115H33V214.5C33 223.613 40.388 231 49.5 231C58.612 231 66 223.613 66 214.5V198.386L128.225 173.649L198 201.387V214.5C198 223.613 205.388 231 214.5 231C223.612 231 231 223.613 231 214.5V115H252.333C258.933 115 264 109.6 264 103V45C264 38.4 258.933 33 252.333 33ZM197.833 49H230.833L214.833 99H181.833L197.833 49ZM123.833 49H156.833L140.833 99H107.833L123.833 49ZM49.333 49H82.333L66.333 99H33.333L49.333 49ZM66 180.091V148.911L105.216 164.501L66 180.091ZM151.234 164.501L198 145.909V183.093L151.234 164.501ZM198 127.615L128.225 155.353L66 130.616V115H198V127.615Z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  if (iconKey === "streetLamp") {
    return (
      <svg
        className={svgClassName}
        width="64"
        height="64"
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M375.1,157.988c-4.599-17.701-19.224-32.168-38.458-39.895V104c0-14.908-10.248-27.466-24.069-31.004c0.041-0.327,0.069-0.658,0.069-0.996c0-39.701-32.299-72-72-72s-72,32.299-72,72v81.376c-9.311,3.303-16,12.195-16,22.624v320h-8c-4.418,0-8,3.582-8,8s3.582,8,8,8h64c4.418,0,8-3.582,8-8s-3.582-8-8-8h-8V176c0-10.429-6.689-19.321-16-22.624V72c0-30.878,25.122-56,56-56s56,25.122,56,56c0,0.338,0.028,0.669,0.069,0.996C282.89,76.534,272.643,89.092,272.643,104v14.094c-19.234,7.726-33.858,22.194-38.458,39.895c-0.623,2.396-0.101,4.947,1.415,6.906c1.515,1.959,3.852,3.106,6.328,3.106h30.715c0,17.645,14.355,32,32,32s32-14.355,32-32h30.715c2.477,0,4.813-1.147,6.328-3.106C375.201,162.935,375.723,160.385,375.1,157.988zM176.643,168c4.411,0,8,3.589,8,8v256h-16V176C168.643,171.589,172.231,168,176.643,168zM168.643,496v-48h16v48H168.643zM288.643,104c0-8.822,7.178-16,16-16s16,7.178,16,16v9.468c-5.171-0.957-10.529-1.468-16-1.468s-10.829,0.511-16,1.468V104zM304.643,184c-8.822,0-16-7.178-16-16h32C320.643,176.822,313.465,184,304.643,184zM254.068,152c9.116-14.357,28.628-24,50.575-24s41.458,9.643,50.575,24H254.068z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  if (iconKey === "container") {
    return (
      <svg
        className={svgClassName}
        width="64"
        height="64"
        viewBox="0 0 750 750"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M314.868 734.356C349.211 714.33 372.343 677.094 372.343 634.554C372.343 570.898 320.554 519.109 256.898 519.109C215.522 519.109 179.166 540.994 158.78 573.792C147.803 591.453 141.452 612.274 141.452 634.555C141.452 698.212 193.241 750 256.897 750C278.014 750 297.82 744.296 314.868 734.356Z"
          fill="#0F3D8A"
        />
        <path
          d="M98.535 182.183H106.859C106.898 182.572 106.93 182.961 106.982 183.351L153.31 532.566C179.707 505.758 216.392 489.109 256.897 489.109C337.096 489.109 402.341 554.355 402.341 634.554C402.341 673.242 387.155 708.447 362.435 734.529L536.593 735.162C554.991 735.228 570.587 721.641 573.04 703.407L643.007 183.419C643.062 183.005 643.097 182.595 643.138 182.183H651.464C662.509 182.183 671.464 173.228 671.464 162.183C671.464 151.138 662.509 142.183 651.464 142.183H635.556C621.677 109.024 572.749 80.936 505.396 64.892C498.753 55.068 490.589 45.934 480.994 37.719C452.582 13.396 414.951 0 375.037 0C335.122 0 297.492 13.396 269.079 37.719C259.483 45.934 251.32 55.068 244.676 64.892C177.325 80.936 128.396 109.023 114.516 142.183H98.535C87.489 142.183 78.535 151.138 78.535 162.183C78.535 173.228 87.49 182.183 98.535 182.183ZM375.037 30C405.893 30 434.086 39.734 455.487 55.724C430.116 52.328 403.091 50.488 375.037 50.488C346.982 50.488 319.956 52.327 294.585 55.724C315.987 39.734 344.179 30 375.037 30Z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  if (iconKey === "building") {
    return (
      <svg
        className={svgClassName}
        width="64"
        height="64"
        viewBox="0 0 50 50"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M7 2L7 7L2 7L2 46L14 46L14 44L4 44L4 9L9 9L9 4L29 4L29 7L11 7L11 9L34 9L34 20L36 20L36 7L31 7L31 2 Z M 8 12L8 14L12 14L12 12 Z M 17 12L17 14L21 14L21 12 Z M 26 12L26 14L30 14L30 12 Z M 8 17L8 19L12 19L12 17 Z M 17 17L17 19L21 19L21 17 Z M 26 17L26 19L30 19L30 17 Z M 29 20C25.742188 20 23.328125 21.324219 22.074219 23.296875C20.929688 25.09375 20.875 27.339844 21.59375 29.433594C21.515625 29.566406 21.402344 29.679688 21.328125 29.839844C21.171875 30.191406 21.035156 30.589844 21.054688 31.097656L21.054688 31.101563C21.109375 32.378906 21.851563 33.046875 22.398438 33.421875C22.628906 34.640625 23.207031 35.660156 24 36.390625L24 38.53125C23.824219 38.953125 23.472656 39.308594 22.796875 39.679688C22.089844 40.070313 21.132813 40.4375 20.144531 40.917969C19.15625 41.398438 18.125 42.011719 17.324219 42.988281C16.519531 43.96875 16 45.308594 16 47L16 48L48.050781 48L47.992188 46.941406C47.902344 45.363281 47.316406 44.117188 46.488281 43.222656C45.664063 42.328125 44.644531 41.765625 43.679688 41.320313C42.714844 40.875 41.785156 40.535156 41.109375 40.171875C40.464844 39.832031 40.148438 39.511719 40 39.160156L40 37.472656C40.597656 36.609375 40.859375 35.617188 40.9375 34.6875C41.414063 34.265625 41.96875 33.617188 42.125 32.457031C42.230469 31.625 42.019531 30.996094 41.695313 30.464844C42.144531 29.277344 42.328125 27.84375 41.933594 26.417969C41.707031 25.589844 41.277344 24.777344 40.5625 24.171875C40.003906 23.691406 39.238281 23.425781 38.390625 23.308594L37.75 22L37.125 22C36.097656 22 35.085938 22.238281 34.214844 22.578125C33.871094 22.714844 33.558594 22.863281 33.265625 23.027344C33.101563 22.808594 32.921875 22.601563 32.714844 22.414063C32.105469 21.863281 31.261719 21.550781 30.324219 21.421875L29.621094 20 Z M 8 22L8 24L12 24L12 22 Z M 17 22L17 24L19.484375 24L20.761719 22 Z M 28.4375 22.113281L29.027344 23.300781L29.644531 23.300781C30.464844 23.300781 30.96875 23.535156 31.371094 23.894531C31.773438 24.257813 32.066406 24.796875 32.238281 25.429688C32.582031 26.695313 32.289063 28.339844 32.007813 28.792969L31.644531 29.371094L32.050781 29.921875C32.289063 30.238281 32.441406 30.566406 32.363281 31.007813C32.253906 31.625 32.03125 31.707031 31.589844 32.089844L31.257813 32.375L31.246094 32.8125C31.210938 33.792969 30.871094 34.777344 30.300781 35.339844L30 35.632813L30 38.988281L30.058594 39.152344C30.453125 40.25 31.335938 40.933594 32.234375 41.429688C33.132813 41.925781 34.101563 42.289063 34.976563 42.714844C35.851563 43.140625 36.609375 43.625 37.132813 44.261719C37.496094 44.699219 37.71875 45.289063 37.855469 46L18.144531 46C18.28125 45.289063 18.503906 44.699219 18.867188 44.261719C19.390625 43.625 20.148438 43.140625 21.023438 42.714844C21.898438 42.289063 22.867188 41.925781 23.765625 41.429688C24.664063 40.933594 25.546875 40.25 25.941406 39.152344L26 38.988281L26 35.523438L25.5625 35.226563C25.101563 34.914063 24.34375 33.769531 24.238281 32.742188L24.183594 32.1875L23.683594 31.945313C23.398438 31.808594 23.082031 31.753906 23.050781 31.015625C23.050781 31.015625 23.082031 30.824219 23.15625 30.65625C23.234375 30.484375 23.375 30.304688 23.332031 30.347656L23.8125 29.867188L23.542969 29.242188C22.796875 27.523438 22.898438 25.722656 23.761719 24.367188C24.550781 23.125 26.097656 22.269531 28.4375 22.113281 Z M 36.558594 24.113281L37.089844 25.199219L37.714844 25.199219C38.472656 25.199219 38.921875 25.398438 39.265625 25.691406C39.613281 25.984375 39.859375 26.414063 40.003906 26.949219C40.300781 28.019531 40.085938 29.480469 39.746094 30.144531L39.417969 30.796875L39.933594 31.308594C39.867188 31.242188 40.195313 31.785156 40.140625 32.195313C40.011719 33.175781 39.871094 33.113281 39.449219 33.390625L39.03125 33.667969L39 34.171875C38.953125 35.042969 38.515625 36.351563 38.28125 36.589844L38 36.878906L38 39.621094L38.058594 39.78125C38.4375 40.835938 39.296875 41.476563 40.167969 41.9375C41.035156 42.398438 41.980469 42.738281 42.84375 43.136719C43.707031 43.535156 44.476563 43.984375 45.019531 44.578125C45.367188 44.953125 45.601563 45.433594 45.769531 46L39.921875 46C39.757813 44.777344 39.3125 43.765625 38.675781 42.988281C37.875 42.011719 36.84375 41.398438 35.855469 40.917969C34.867188 40.4375 33.910156 40.070313 33.203125 39.679688C32.527344 39.308594 32.175781 38.953125 32 38.53125L32 36.296875C32.691406 35.421875 33.054688 34.390625 33.15625 33.34375C33.542969 33.003906 34.144531 32.417969 34.332031 31.359375C34.484375 30.492188 34.226563 29.785156 33.90625 29.210938C34.4375 27.988281 34.59375 26.460938 34.167969 24.902344C34.164063 24.886719 34.15625 24.871094 34.152344 24.855469C34.367188 24.71875 34.640625 24.5625 34.949219 24.441406C35.4375 24.25 36.007813 24.179688 36.558594 24.113281 Z M 8 27L8 29L12 29L12 27 Z M 17 27L17 29L19.753906 29L19.394531 27 Z M 8 32L8 34L12 34L12 32 Z M 17 32L17 34L20.449219 34L19.613281 32 Z M 8 37L8 39L12 39L12 37 Z M 17 37L17 39L21 39L21 37Z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  return (
    <svg className={svgClassName} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 9v3M12 15h.01" />
    </svg>
  );
}

function HelpPanelIcon({ type }) {
  if (type === "faq") {
    return (
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M8 9H16"
          stroke="#0F3D8A"
          stroke-width="1.5"
          stroke-linecap="round"
        />
        <path
          d="M8 12.5H13.5"
          stroke="#0F3D8A"
          stroke-width="1.5"
          stroke-linecap="round"
        />
        <path
          d="M13.0867 21.3877L13.7321 21.7697L13.0867 21.3877ZM13.6288 20.4718L12.9833 20.0898L13.6288 20.4718ZM10.3712 20.4718L9.72579 20.8539H9.72579L10.3712 20.4718ZM10.9133 21.3877L11.5587 21.0057L10.9133 21.3877ZM1.25 10.5C1.25 10.9142 1.58579 11.25 2 11.25C2.41421 11.25 2.75 10.9142 2.75 10.5H1.25ZM3.07351 15.6264C2.915 15.2437 2.47627 15.062 2.09359 15.2205C1.71091 15.379 1.52918 15.8177 1.68769 16.2004L3.07351 15.6264ZM7.78958 18.9915L7.77666 19.7413L7.78958 18.9915ZM5.08658 18.6194L4.79957 19.3123H4.79957L5.08658 18.6194ZM21.6194 15.9134L22.3123 16.2004V16.2004L21.6194 15.9134ZM16.2104 18.9915L16.1975 18.2416L16.2104 18.9915ZM18.9134 18.6194L19.2004 19.3123H19.2004L18.9134 18.6194ZM19.6125 2.7368L19.2206 3.37628L19.6125 2.7368ZM21.2632 4.38751L21.9027 3.99563V3.99563L21.2632 4.38751ZM4.38751 2.7368L3.99563 2.09732V2.09732L4.38751 2.7368ZM2.7368 4.38751L2.09732 3.99563H2.09732L2.7368 4.38751ZM9.40279 19.2098L9.77986 18.5615L9.77986 18.5615L9.40279 19.2098ZM13.7321 21.7697L14.2742 20.8539L12.9833 20.0898L12.4412 21.0057L13.7321 21.7697ZM9.72579 20.8539L10.2679 21.7697L11.5587 21.0057L11.0166 20.0898L9.72579 20.8539ZM12.4412 21.0057C12.2485 21.3313 11.7515 21.3313 11.5587 21.0057L10.2679 21.7697C11.0415 23.0767 12.9585 23.0767 13.7321 21.7697L12.4412 21.0057ZM10.5 2.75H13.5V1.25H10.5V2.75ZM21.25 10.5V11.5H22.75V10.5H21.25ZM7.8025 18.2416C6.54706 18.2199 5.88923 18.1401 5.37359 17.9265L4.79957 19.3123C5.60454 19.6457 6.52138 19.7197 7.77666 19.7413L7.8025 18.2416ZM1.68769 16.2004C2.27128 17.6093 3.39066 18.7287 4.79957 19.3123L5.3736 17.9265C4.33223 17.4951 3.50486 16.6678 3.07351 15.6264L1.68769 16.2004ZM21.25 11.5C21.25 12.6751 21.2496 13.5189 21.2042 14.1847C21.1592 14.8438 21.0726 15.2736 20.9265 15.6264L22.3123 16.2004C22.5468 15.6344 22.6505 15.0223 22.7007 14.2868C22.7504 13.5581 22.75 12.6546 22.75 11.5H21.25ZM16.2233 19.7413C17.4786 19.7197 18.3955 19.6457 19.2004 19.3123L18.6264 17.9265C18.1108 18.1401 17.4529 18.2199 16.1975 18.2416L16.2233 19.7413ZM20.9265 15.6264C20.4951 16.6678 19.6678 17.4951 18.6264 17.9265L19.2004 19.3123C20.6093 18.7287 21.7287 17.6093 22.3123 16.2004L20.9265 15.6264ZM13.5 2.75C15.1512 2.75 16.337 2.75079 17.2619 2.83873C18.1757 2.92561 18.7571 3.09223 19.2206 3.37628L20.0044 2.09732C19.2655 1.64457 18.4274 1.44279 17.4039 1.34547C16.3915 1.24921 15.1222 1.25 13.5 1.25V2.75ZM22.75 10.5C22.75 8.87781 22.7508 7.6085 22.6545 6.59611C22.5572 5.57256 22.3554 4.73445 21.9027 3.99563L20.6237 4.77938C20.9078 5.24291 21.0744 5.82434 21.1613 6.73809C21.2492 7.663 21.25 8.84876 21.25 10.5H22.75ZM19.2206 3.37628C19.7925 3.72672 20.2733 4.20752 20.6237 4.77938L21.9027 3.99563C21.4286 3.22194 20.7781 2.57144 20.0044 2.09732L19.2206 3.37628ZM10.5 1.25C8.87781 1.25 7.6085 1.24921 6.59611 1.34547C5.57256 1.44279 4.73445 1.64457 3.99563 2.09732L4.77938 3.37628C5.24291 3.09223 5.82434 2.92561 6.73809 2.83873C7.663 2.75079 8.84876 2.75 10.5 2.75V1.25ZM2.75 10.5C2.75 8.84876 2.75079 7.663 2.83873 6.73809C2.92561 5.82434 3.09223 5.24291 3.37628 4.77938L2.09732 3.99563C1.64457 4.73445 1.44279 5.57256 1.34547 6.59611C1.24921 7.6085 1.25 8.87781 1.25 10.5H2.75ZM3.99563 2.09732C3.22194 2.57144 2.57144 3.22194 2.09732 3.99563L3.37628 4.77938C3.72672 4.20752 4.20752 3.72672 4.77938 3.37628L3.99563 2.09732ZM11.0166 20.0898C10.8136 19.7468 10.6354 19.4441 10.4621 19.2063C10.2795 18.9559 10.0702 18.7304 9.77986 18.5615L9.02572 19.8582C9.07313 19.8857 9.13772 19.936 9.24985 20.0898C9.37122 20.2564 9.50835 20.4865 9.72579 20.8539L11.0166 20.0898ZM7.77666 19.7413C8.21575 19.7489 8.49387 19.7545 8.70588 19.7779C8.90399 19.7999 8.98078 19.832 9.02572 19.8582L9.77986 18.5615C9.4871 18.3912 9.18246 18.3215 8.87097 18.287C8.57339 18.2541 8.21375 18.2487 7.8025 18.2416L7.77666 19.7413ZM14.2742 20.8539C14.4916 20.4865 14.6287 20.2564 14.7501 20.0898C14.8622 19.936 14.9268 19.8857 14.9742 19.8582L14.2201 18.5615C13.9298 18.7304 13.7204 18.9559 13.5379 19.2063C13.3646 19.4441 13.1864 19.7468 12.9833 20.0898L14.2742 20.8539ZM16.1975 18.2416C15.7862 18.2487 15.4266 18.2541 15.129 18.287C14.8175 18.3215 14.5129 18.3912 14.2201 18.5615L14.9742 19.8582C15.0192 19.832 15.096 19.7999 15.2941 19.7779C15.5061 19.7545 15.7842 19.7489 16.2233 19.7413L16.1975 18.2416Z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  if (type === "channels") {
    return (
      <svg
        width="64"
        height="64"
        viewBox="0 0 351.941 351.941"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M319.971 152.464C319.129 145.116 315.785 138.688 310.975 134.413C309.908 60.114 249.764 0 175.971 0C102.178 0 42.031 60.114 40.965 134.413C36.158 138.686 32.815 145.108 31.971 152.451C18.422 155.735 8.328 167.962 8.328 182.508V214.371C8.328 228.916 18.422 241.143 31.971 244.428C33.494 257.696 43.192 267.961 54.897 267.961H66.73C79.49 267.961 89.869 255.767 89.869 240.777V156.101C89.869 147.723 86.625 140.22 81.537 135.23C82.168 83.084 124.285 40.857 175.971 40.857C227.657 40.857 269.772 83.083 270.406 135.228C265.314 140.218 262.068 147.722 262.068 156.101V240.777C262.068 255.14 271.603 266.929 283.627 267.89V291.714C283.627 307.977 270.397 321.208 254.133 321.208H229.863C226.736 312.067 218.066 305.474 207.881 305.474H191.703C178.892 305.474 168.471 315.897 168.471 328.708C168.471 341.519 178.893 351.941 191.703 351.941H207.881C218.067 351.941 226.736 345.349 229.863 336.208H254.133C278.666 336.208 298.627 316.248 298.627 291.714V267.89C309.615 267.013 318.522 257.085 319.971 244.415C333.518 241.13 343.613 228.913 343.613 214.37V182.507C343.613 167.964 333.518 155.748 319.971 152.464ZM31.756 228.387C26.75 225.703 23.328 220.44 23.328 214.371V182.508C23.328 176.44 26.75 171.174 31.756 168.49V228.387ZM207.881 336.941H191.703C187.164 336.941 183.471 333.248 183.471 328.708C183.471 324.168 187.164 320.474 191.703 320.474H207.881C212.42 320.474 216.113 324.168 216.113 328.708C216.113 333.248 212.42 336.941 207.881 336.941ZM74.869 240.777C74.869 247.267 71.066 252.961 66.73 252.961H54.896C50.56 252.961 46.755 247.268 46.755 240.777V156.101C46.755 149.611 50.56 143.917 54.896 143.917H66.73C71.066 143.917 74.869 149.61 74.869 156.101V240.777ZM175.971 25.857C118.117 25.857 70.615 71.441 66.785 128.92C66.765 128.92 66.748 128.918 66.73 128.918H56.178C60.021 65.448 112.275 15 175.971 15C239.664 15 291.918 65.449 295.762 128.918H285.211C285.195 128.918 285.18 128.92 285.164 128.92C281.334 71.441 233.826 25.857 175.971 25.857ZM305.184 240.777C305.184 247.267 301.381 252.961 297.043 252.961H285.211C280.873 252.961 277.068 247.268 277.068 240.777V156.101C277.068 149.611 280.873 143.917 285.211 143.917H297.043C301.381 143.917 305.184 149.61 305.184 156.101V240.777ZM328.613 214.371C328.613 220.44 325.191 225.706 320.183 228.389V168.494C325.191 171.178 328.613 176.439 328.613 182.508V214.371Z"
          fill="#0F3D8A"
        />
      </svg>
    );
  }
  if (type === "phone") {
    return (
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M16.5562 12.9062L16.1007 13.359C16.1007 13.359 15.0181 14.4355 12.0631 11.4972C9.10812 8.55886 10.1907 7.4824 10.1907 7.4824L10.4775 7.19721C11.1841 6.4946 11.2507 5.3669 10.6342 4.54348L9.37326 2.85908C8.61028 1.83992 7.13596 1.70529 6.26145 2.57483L4.69185 4.13552C4.25823 4.56668 3.96765 5.12559 4.00289 5.74561C4.09304 7.33182 4.81071 10.7447 8.81536 14.7266C13.0621 18.9492 17.0468 19.117 18.6751 18.9651C19.1917 18.9169 19.6399 18.6549 20.0011 18.2958L21.4217 16.8832C22.3806 15.9298 22.1102 14.2949 20.8833 13.628L18.9728 12.5894C18.1672 12.1515 17.1858 12.2801 16.5562 12.9062Z"
          fill="#0F3D8A"
        />
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
  if (iconKey === "document") {
    return (
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M14 3H7C5.89543 3 5 3.89543 5 5V19C5 20.1046 5.89543 21 7 21H11"
          stroke="#0F3D8A"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M14 3L19 8"
          stroke="#0F3D8A"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M14 3V7C14 7.55228 14.4477 8 15 8H19"
          stroke="#0F3D8A"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M16 14V21"
          stroke="#0F3D8A"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M12.5 17.5H19.5"
          stroke="#0F3D8A"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }
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
      <circle cx="12" cy="12" r="6" />
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
              <QuickAccessIcon iconKey="assistant" />
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
              <FrequentManagementIcon iconKey="frequentCardArrow" />
            </span>
          </label>

          <div className="home-onify-hero__actions">
            <Link href="/asistente" className="home-onify-btn home-onify-btn--primary">
              <span aria-hidden="true">+</span>
              {content.startManagement}
            </Link>
            <Link href="/ciudadano/dashboard" className="home-onify-btn home-onify-btn--secondary">
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
              {item.iconKey ? <QuickAccessIcon iconKey={item.iconKey} /> : item.icon}
            </span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
            </div>
            {/* <span className="home-onify-access__arrow" aria-hidden="true">
              <FrequentManagementIcon iconKey="frequentCardArrow" />
            </span> */}
          </Link>
        ))}
      </section>

      <section id="tramites" className="home-onify-frequent" aria-labelledby="frequent-managements-title">
        <header className="home-onify-section-head">
          <h2 id="frequent-managements-title">{content.frequentTitle}</h2>
          <Link href="/asistente" className="home-onify-section-head__link">
            {content.viewAllManagements}
            <span className="home-onify-section-head__arrow" aria-hidden="true">
              <FrequentManagementIcon iconKey="frequentCardArrow" />
            </span>
          </Link>
        </header>
        <div className="home-onify-frequent__grid">
          {content.frequent.map((item) => (
            <Link href={item.href} key={item.title} className="home-onify-frequent__card">
              <span className="home-onify-frequent__icon" aria-hidden="true">
                <FrequentManagementIcon iconKey={item.iconKey} />
              </span>
              <div className="home-onify-frequent__content">
                <div className="home-onify-frequent__text">
                  <span
                    className={`home-onify-frequent__pill ${item.type === "REPORTE"
                      ? "home-onify-frequent__pill--report"
                      : "home-onify-frequent__pill--procedure"
                      }`}
                  >
                    {item.type}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
                <span className="home-onify-frequent__arrow" aria-hidden="true">
                  <FrequentManagementIcon iconKey="frequentCardArrow" />
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
            <Link href="/ciudadano/dashboard" className="home-onify-section-head__link">
              {content.viewAllMine}
              <span className="home-onify-section-head__arrow" aria-hidden="true">
                <FrequentManagementIcon iconKey="frequentCardArrow" />
              </span>
            </Link>
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
                    <Link href={`/ciudadano/dashboard?incidentId=${procedure.id}`} className="home-onify-recent__row">
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
                        <FrequentManagementIcon iconKey="frequentCardArrow" />
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
                <span className="home-onify-help__option-arrow" aria-hidden="true">
                  <FrequentManagementIcon iconKey="frequentCardArrow" />
                </span>
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
                <span className="home-onify-help__option-arrow" aria-hidden="true">
                  <FrequentManagementIcon iconKey="frequentCardArrow" />
                </span>
              </Link>
            </li>
          </ul>
          <div className="home-onify-help__line">
            <span className="home-onify-help__option-icon" aria-hidden="true">
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
          {content.flow.map((step, index) => {
            const isFirst = index === 0;
            const isLast = index === content.flow.length - 1;
            return (
              <li key={step.title} className="home-onify-flow__step">
                <div className="home-onify-flow__step-head">
                  <span
                    className={`home-onify-flow__step-number${isLast ? " home-onify-flow__step-number--final" : ""}`}
                    aria-hidden="true"
                  >
                    {isLast ? (
                      <svg className="home-onify-flow__step-check" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M6.5 12.5l3.2 3.2L16.5 8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </span>
                  {isFirst ? (
                    <span className="home-onify-flow__step-icon" aria-hidden="true">
                      <StepIcon iconKey={step.iconKey} />
                    </span>
                  ) : null}
                </div>
                <div className="home-onify-flow__step-copy">
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
                {index < content.flow.length - 1 ? (
                  <span className="home-onify-flow__connector" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}

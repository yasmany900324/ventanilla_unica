import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  destroySessionByToken,
  getAuthenticatedUserFromToken,
  SESSION_COOKIE_NAME,
} from "../lib/auth";

const TOPBAR_LINKS = [
  { href: "/#accesibilidad", label: "Accesibilidad" },
  { href: "/#mapa-del-sitio", label: "Mapa del sitio" },
];

const LANGUAGE_LINKS = ["ES", "PT", "EN"];

const PUBLIC_MOBILE_NAV = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/login", label: "Acceder", icon: "login" },
  { href: "/registro", label: "Cuenta", icon: "register" },
  { href: "/#ayuda-soporte", label: "Ayuda", icon: "help" },
];

const AUTH_MOBILE_NAV = [
  { href: "/", label: "Inicio", icon: "home" },
  {
    href: "/mis-incidencias",
    label: "Mis casos",
    icon: "cases",
  },
  { href: "/ciudadano/dashboard#nueva-incidencia", label: "Nueva", icon: "plus" },
  { href: "/ciudadano/dashboard#detalle-caso", label: "Perfil", icon: "profile" },
];

const FOOTER_LINK_GROUPS = [
  {
    title: "Tramites en linea",
    links: [
      { href: "/#tramites", label: "Portal Tributario" },
      { href: "/#tramites", label: "Guia de Tramites" },
      { href: "/mis-incidencias", label: "Estado de expediente" },
    ],
  },
  {
    title: "Ayuda y soporte",
    links: [
      { href: "/#ayuda-soporte", label: "Centro de ayuda" },
      { href: "/#ayuda-soporte", label: "Preguntas frecuentes" },
      { href: "/#ayuda-soporte", label: "Canales de contacto" },
    ],
  },
  {
    title: "Informacion institucional",
    links: [
      { href: "/#informacion-institucional", label: "Politica de privacidad" },
      { href: "/#accesibilidad", label: "Accesibilidad" },
      { href: "/#informacion-institucional", label: "Terminos de uso" },
    ],
  },
];

const SOCIAL_LINKS = [
  { href: "https://www.facebook.com", label: "Facebook", shortLabel: "Fb" },
  { href: "https://x.com", label: "X", shortLabel: "X" },
  { href: "https://www.instagram.com", label: "Instagram", shortLabel: "Ig" },
  { href: "https://www.youtube.com", label: "YouTube", shortLabel: "Yt" },
];

function Icon({ name }) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 3 10.5V21h6.75v-6h4.5v6H21V10.5L12 3Zm7.5 16.5h-3.75v-6h-7.5v6H4.5v-8.25L12 5.1l7.5 6.15v8.25Z" />
      </svg>
    );
  }

  if (name === "cases") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16v4H4V4Zm0 6h16v10H4V10Zm1.5 1.5v7h13v-7h-13ZM6 5.5v1h12v-1H6Z" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11.25 4h1.5v7.25H20v1.5h-7.25V20h-1.5v-7.25H4v-1.5h7.25V4Z" />
      </svg>
    );
  }

  if (name === "profile") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 9.5c4.69 0 8.5 2.52 8.5 5.63V21h-17v-.87c0-3.11 3.81-5.63 8.5-5.63Zm0 1.5c-3.84 0-7 1.95-7 4.13V19.5h14v.63c0-2.18-3.16-4.13-7-4.13Z" />
      </svg>
    );
  }

  if (name === "login") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 4h9v16h-9v-1.5h7.5V5.5H11V4Zm1.03 8.75H3v-1.5h9.03L9.6 8.82l1.06-1.06L15 12l-4.34 4.24-1.06-1.06 2.43-2.43Z" />
      </svg>
    );
  }

  if (name === "register") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6.5c3.13 0 5.67 1.67 5.67 3.74V18H1.33v-.76C1.33 15.17 3.87 13.5 7 13.5Zm0 1.5c-2.27 0-4.17 1.1-4.17 2.24V16.5h8.34v.74C11.17 16.1 9.27 15 7 15Zm10-10h1.5v2.75h2.75v1.5H18.5V12H17V9.25h-2.75v-1.5H17V5Z" />
      </svg>
    );
  }

  if (name === "help") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm0 1.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 9.5h1.25v1.75H11.5V14.5h.5c1.08 0 1.75-.64 1.75-1.45 0-.84-.71-1.55-1.75-1.55-1.06 0-1.75.68-1.75 1.7H8.75C8.75 11.46 10.13 10 12 10c1.9 0 3.25 1.3 3.25 3 0 1.3-.76 2.28-2.25 2.5Zm-.75-6.25h1.5V10h-1.5V8.25Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}

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

export default async function PortalShell({ children }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);
  const hasActiveSession = Boolean(authenticatedUser);
  const shortName = authenticatedUser?.fullName?.split(" ")?.[0] || "ciudadano";
  const assistantHref = hasActiveSession
    ? "/ciudadano/dashboard#detalle-caso"
    : "/#ayuda-soporte";
  const mainNav = [
    { href: "/", label: "Inicio" },
    {
      href: hasActiveSession ? "/mis-incidencias" : "/login",
      label: "Mis tramites e incidencias",
    },
    {
      href: hasActiveSession ? "/ciudadano/dashboard#nueva-incidencia" : "/login",
      label: "Nuevo tramite o reporte",
    },
    { href: "/#ayuda-soporte", label: "Ayuda y soporte" },
  ];
  const mobileNav = hasActiveSession ? AUTH_MOBILE_NAV : PUBLIC_MOBILE_NAV;

  return (
    <div className="app-shell">
      <a href="#contenido-principal" className="skip-link">
        Saltar al contenido principal
      </a>

      <header className="portal-header">
        <div className="portal-topbar">
          <div className="portal-topbar__inner">
            <ul className="portal-topbar__links">
              {TOPBAR_LINKS.map((item) => (
                <li key={item.label}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
            <ul className="portal-topbar__languages" aria-label="Idiomas disponibles">
              {LANGUAGE_LINKS.map((language) => (
                <li key={language}>
                  <span lang={language.toLowerCase()}>{language}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="portal-header__main">
          <div className="portal-header__inner">
            <Link href="/" className="portal-brand" aria-label="Intendencia de Maldonado">
              <span className="portal-brand__crest" aria-hidden="true">
                IM
              </span>
              <span className="portal-brand__text">
                <strong>Intendencia de Maldonado</strong>
                <small>Portal de Tramites y Reportes</small>
              </span>
            </Link>

            <nav className="portal-nav" aria-label="Navegacion principal">
              <ul className="portal-nav__list">
                {mainNav.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="portal-nav__link">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="portal-header__actions">
              {hasActiveSession ? (
                <>
                  <span className="portal-user-chip">Hola, {shortName}</span>
                  <Link href="/ciudadano/dashboard" className="portal-action-link">
                    Mi espacio
                  </Link>
                  <form action={logoutAction} className="portal-action-form">
                    <button type="submit" className="portal-action-button">
                      Cerrar sesion
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className="portal-action-link">
                    Iniciar sesion
                  </Link>
                  <Link href="/registro" className="portal-action-link portal-action-link--primary">
                    Crear cuenta
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="portal-header__gold-line" aria-hidden="true" />
      </header>

      <div id="contenido-principal" className="app-shell__content">
        {children}
      </div>

      <footer className="portal-footer" id="informacion-institucional">
        <div className="portal-footer__inner">
          <div className="portal-footer__brand">
            <div className="portal-footer__brand-head">
              <span className="portal-footer__crest" aria-hidden="true">
                IM
              </span>
              <h2>Intendencia de Maldonado</h2>
            </div>
            <p>
              Calle Florida 580, Maldonado
              <br />
              Tel. +598 4222 4220
              <br />
              tramites@maldonado.gub.uy
            </p>
            <ul className="portal-footer__social">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.label}>
                  <a href={social.href} aria-label={social.label}>
                    {social.shortLabel}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {FOOTER_LINK_GROUPS.map((group) => (
            <section key={group.title} className="portal-footer__column">
              <h3>{group.title}</h3>
              <ul>
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="portal-footer__legal">
          <p>© 2026 Intendencia de Maldonado - Todos los derechos reservados.</p>
        </div>
      </footer>

      <Link href={assistantHref} className="floating-chat-button" aria-label="Hablar con el asistente">
        <span className="floating-chat-button__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4.5 5h15a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H9.2l-3.9 2.9a.5.5 0 0 1-.8-.4v-2.5H4.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm.5 1v9.5h1a1 1 0 0 1 1 1V18l2.9-2.2a1 1 0 0 1 .6-.2H19V6H5Zm3.2 3h7.6v1.5H8.2V9Zm0 3h5.6v1.5H8.2V12Z" />
          </svg>
        </span>
        <span className="floating-chat-button__badge" aria-hidden="true">
          1
        </span>
      </Link>

      <nav className="mobile-bottom-nav" aria-label="Navegacion inferior movil">
        <ul className="mobile-bottom-nav__list">
          {mobileNav.map((item) => (
            <li key={item.label}>
              <Link href={item.href} className="mobile-bottom-nav__link">
                <span className="mobile-bottom-nav__icon">
                  <Icon name={item.icon} />
                </span>
                <span className="mobile-bottom-nav__label">{item.label}</span>
              </Link>
            </li>
          ))}
          {hasActiveSession ? (
            <li>
              <form action={logoutAction} className="mobile-bottom-nav__form">
                <button type="submit" className="mobile-bottom-nav__link mobile-bottom-nav__button">
                  <span className="mobile-bottom-nav__icon">
                    <Icon name="login" />
                  </span>
                  <span className="mobile-bottom-nav__label">Salir</span>
                </button>
              </form>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import InstitutionalLogo from "./InstitutionalLogo";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const TOPBAR_LINKS = [
  { href: "/#accesibilidad", labelKey: "accessibility" },
  { href: "/#mapa-del-sitio", labelKey: "sitemap" },
];

const LANGUAGE_LINKS = ["es", "pt", "en"];

const PUBLIC_MOBILE_NAV = [
  { href: "/", labelKey: "home", icon: "home" },
  { href: "/login", labelKey: "login", icon: "login" },
  { href: "/registro", labelKey: "account", icon: "register" },
  { href: "/#ayuda-soporte", labelKey: "help", icon: "help" },
];

const AUTH_MOBILE_NAV = [
  { href: "/", labelKey: "home", icon: "home" },
  {
    href: "/mis-incidencias",
    labelKey: "myCases",
    icon: "cases",
  },
  { href: "/asistente", labelKey: "newCase", icon: "plus" },
  { href: "/ciudadano/dashboard#detalle-caso", labelKey: "profile", icon: "profile" },
];

const FOOTER_LINK_GROUPS = [
  {
    titleKey: "onlineServices",
    links: [
      { href: "/#tramites", labelKey: "taxPortal" },
      { href: "/#tramites", labelKey: "proceduresGuide" },
      { href: "/mis-incidencias", labelKey: "fileStatus" },
    ],
  },
  {
    titleKey: "helpSupport",
    links: [
      { href: "/#ayuda-soporte", labelKey: "helpCenter" },
      { href: "/#ayuda-soporte", labelKey: "faq" },
      { href: "/#ayuda-soporte", labelKey: "contactChannels" },
    ],
  },
  {
    titleKey: "institutionalInfo",
    links: [
      { href: "/#informacion-institucional", labelKey: "privacy" },
      { href: "/#accesibilidad", labelKey: "accessibility" },
      { href: "/#informacion-institucional", labelKey: "terms" },
    ],
  },
];

const FOOTER_MOBILE_PRIORITY_LINKS = [
  { href: "/#tramites", labelKey: "proceduresGuide" },
  { href: "/#ayuda-soporte", labelKey: "helpCenter" },
  { href: "/#accesibilidad", labelKey: "accessibility" },
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

export default function PortalShell({ children }) {
  const { user, isAuthenticated, isLoadingAuth, logout } = useAuth();
  const { locale, setLocale } = useLocale();
  const copy = getLocaleCopy(locale);
  const hasActiveSession = isAuthenticated;
  const isAdministrator = user?.role === "administrador";
  const authenticatedUser = user;
  const shortName = authenticatedUser?.fullName?.split(" ")?.[0] || copy.dashboard.greetingFallback;
  const handleLogout = useCallback(async () => {
    try {
      await logout({ redirectTo: "/" });
    } catch (error) {
      console.error("[auth] Header logout failed.", error);
    }
  }, [logout]);
  const assistantHref = "/asistente";
  const mainNav = useMemo(
    () => [
      { href: "/", label: copy.nav.home },
      {
        href: hasActiveSession ? "/mis-incidencias" : "/login",
        label: copy.nav.myCases,
      },
      {
        href: hasActiveSession ? assistantHref : "/login",
        label: copy.nav.newRequest,
      },
      { href: "/#ayuda-soporte", label: copy.nav.help },
    ],
    [copy.nav.help, copy.nav.home, copy.nav.myCases, copy.nav.newRequest, hasActiveSession]
  );
  const mobileNav = useMemo(() => {
    if (!hasActiveSession) {
      return PUBLIC_MOBILE_NAV.map((item) => ({
        ...item,
        label: copy.portal.mobile[item.labelKey],
      }));
    }

    const authenticatedNav = AUTH_MOBILE_NAV.map((item) => ({
      ...item,
      label: copy.portal.mobile[item.labelKey],
    }));

    if (isAdministrator) {
      authenticatedNav.push({
        href: "/admin/dashboard",
        labelKey: "profile",
        label: copy.portal.adminDashboard,
        icon: "cases",
      });
    }

    return authenticatedNav;
  }, [copy.portal.adminDashboard, copy.portal.mobile, hasActiveSession, isAdministrator]);
  const topbarLinks = useMemo(
    () =>
      TOPBAR_LINKS.map((item) => ({
        ...item,
        label: copy.topbar[item.labelKey],
      })),
    [copy.topbar]
  );
  const footerLinkGroups = useMemo(
    () =>
      FOOTER_LINK_GROUPS.map((group) => ({
        key: group.titleKey,
        title: copy.portal.footerGroups[group.titleKey],
        links: group.links.map((link) => ({
          href: link.href,
          label: copy.portal.footerLinks[link.labelKey],
        })),
      })),
    [copy.portal.footerGroups, copy.portal.footerLinks]
  );
  const footerPriorityLinks = useMemo(
    () =>
      FOOTER_MOBILE_PRIORITY_LINKS.map((link) => ({
        href: link.href,
        label: copy.portal.footerLinks[link.labelKey],
      })),
    [copy.portal.footerLinks]
  );
  const [mobileFooterAccordionState, setMobileFooterAccordionState] = useState({
    onlineServices: false,
    helpSupport: false,
    institutionalInfo: false,
  });
  const footerRef = useRef(null);
  const [isFooterVisible, setIsFooterVisible] = useState(false);
  const toggleMobileFooterGroup = useCallback((groupKey) => {
    setMobileFooterAccordionState((previousState) => ({
      ...previousState,
      [groupKey]: !previousState[groupKey],
    }));
  }, []);
  useEffect(() => {
    const footerNode = footerRef.current;

    if (!footerNode || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsFooterVisible(entry.isIntersecting);
      },
      {
        threshold: 0.08,
        rootMargin: "0px 0px -72px 0px",
      }
    );

    observer.observe(footerNode);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="app-shell">
      <a href="#contenido-principal" className="skip-link">
        {copy.portal.skipToContent}
      </a>

      <header className="portal-header">
        <div className="portal-topbar">
          <div className="portal-topbar__inner">
            <ul className="portal-topbar__links">
              {topbarLinks.map((item) => (
                <li key={item.label}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
            <ul className="portal-topbar__languages" aria-label={copy.languageLabel}>
              {LANGUAGE_LINKS.map((language) => (
                <li key={language}>
                  <button
                    type="button"
                    className={`portal-language-button${
                      locale === language ? " portal-language-button--active" : ""
                    }`}
                    onClick={() => setLocale(language)}
                    aria-pressed={locale === language}
                    lang={language}
                  >
                    {copy.languageShort[language]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="portal-header__main">
          <div className="portal-header__inner">
            <Link href="/" className="portal-brand" aria-label={copy.portal.brandAriaLabel}>
              <InstitutionalLogo alt={copy.portal.brandName} variant="header" priority />
            </Link>

            <nav className="portal-nav" aria-label={copy.portal.mainNavAriaLabel}>
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
                  <details className="portal-user-menu">
                    <summary className="portal-user-menu__trigger">
                      <span className="portal-user-menu__name">
                        {copy.portal.greeting}, {shortName}
                      </span>
                      <span className="portal-user-menu__chevron" aria-hidden="true">
                        ▾
                      </span>
                    </summary>
                    <div className="portal-user-menu__panel">
                      <Link href="/ciudadano/dashboard" className="portal-user-menu__link">
                        {copy.portal.mySpace}
                      </Link>
                      <Link href="/mis-incidencias" className="portal-user-menu__link">
                        {copy.nav.myCases}
                      </Link>
                      {isAdministrator ? (
                        <Link href="/admin/dashboard" className="portal-user-menu__link">
                          {copy.portal.adminDashboard}
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        className="portal-user-menu__logout"
                        onClick={handleLogout}
                        disabled={isLoadingAuth}
                      >
                        {isLoadingAuth ? copy.portal.loggingOut : copy.portal.logout}
                      </button>
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <Link href="/login" className="portal-action-link">
                    {copy.portal.login}
                  </Link>
                  <Link href="/registro" className="portal-action-link portal-action-link--primary">
                    {copy.portal.createAccount}
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

      <footer className="portal-footer" id="informacion-institucional" ref={footerRef}>
        <div className="portal-footer__inner">
          <div className="portal-footer__brand">
            <div className="portal-footer__brand-head">
              <InstitutionalLogo alt={copy.portal.brandName} variant="footer" />
            </div>
            <p className="portal-footer__contact portal-footer__contact--desktop">
              {copy.portal.footerAddress}
              <br />
              Tel. +598 4222 4220
              <br />
              {copy.portal.footerMail}
            </p>
            <p className="portal-footer__contact portal-footer__contact--mobile">
              {copy.portal.footerAddress}
              <br />
              {copy.portal.footerMail}
            </p>
            <ul className="portal-footer__quick-links">
              {footerPriorityLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
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

          {footerLinkGroups.map((group) => (
            <section key={group.title} className="portal-footer__column portal-footer__column--desktop">
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

          <div className="portal-footer__mobile-accordion">
            {footerLinkGroups.map((group) => {
              const isExpanded = Boolean(mobileFooterAccordionState[group.key]);
              const panelId = `portal-footer-mobile-group-${group.key}`;
              const triggerId = `${panelId}-trigger`;

              return (
                <section key={group.key} className="portal-footer__accordion-item">
                  <h3 className="portal-footer__accordion-heading">
                    <button
                      id={triggerId}
                      type="button"
                      className="portal-footer__accordion-trigger"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() => toggleMobileFooterGroup(group.key)}
                    >
                      <span>{group.title}</span>
                      <span className="portal-footer__accordion-icon" aria-hidden="true">
                        {isExpanded ? "−" : "+"}
                      </span>
                    </button>
                  </h3>
                  <div
                    id={panelId}
                    className="portal-footer__accordion-panel"
                    role="region"
                    aria-labelledby={triggerId}
                    hidden={!isExpanded}
                  >
                    <ul>
                      {group.links.map((link) => (
                        <li key={link.label}>
                          <Link href={link.href}>{link.label}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <div className="portal-footer__legal">
          <p>{copy.portal.footerRights}</p>
        </div>
      </footer>

      <Link
        href={assistantHref}
        className={`floating-chat-button${isFooterVisible ? " floating-chat-button--footer-aware" : ""}`}
        aria-label={copy.portal.floatingChatLabel}
      >
        <span className="floating-chat-button__icon" aria-hidden="true">
          +
        </span>
      </Link>

      <nav className="mobile-bottom-nav" aria-label={copy.portal.mobileNavAriaLabel}>
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
              <div className="mobile-bottom-nav__form">
                <button
                  type="button"
                  className="mobile-bottom-nav__link mobile-bottom-nav__button"
                  onClick={handleLogout}
                  disabled={isLoadingAuth}
                >
                  <span className="mobile-bottom-nav__icon">
                    <Icon name="login" />
                  </span>
                  <span className="mobile-bottom-nav__label">
                    {isLoadingAuth ? copy.portal.mobile.exiting : copy.portal.mobile.exit}
                  </span>
                </button>
              </div>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}

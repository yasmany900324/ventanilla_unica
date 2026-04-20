"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

function normalizeCardId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function resolveCardType(item) {
  if (item?.badgeType === "anonymous") {
    return "incidencia";
  }

  return "tramite";
}

function resolveServiceKind(item) {
  if (item?.badgeType === "ticket") {
    return "estado";
  }
  if (item?.badgeType === "anonymous") {
    return "incidencia";
  }
  return "tramite";
}

function resolveServiceIcon(item) {
  const kind = resolveServiceKind(item);
  if (kind === "incidencia") {
    return "!";
  }
  if (kind === "estado") {
    return "?";
  }
  return "+";
}

function resolveIncidentCategory(item) {
  const icon = typeof item?.icon === "string" ? item.icon.toUpperCase().trim() : "";
  if (icon === "AP") {
    return "alumbrado";
  }
  if (icon === "CD") {
    return "limpieza";
  }
  if (icon === "AR") {
    return "infraestructura";
  }
  return "otro";
}

function buildAssistantCardHref(item) {
  const cardType = resolveCardType(item);
  const params = new URLSearchParams();
  params.set("type", cardType);
  params.set("id", normalizeCardId(item?.title || "") || "item");
  params.set("title", item?.title || "");

  if (item?.description) {
    params.set("description", item.description);
  }
  if (cardType === "incidencia") {
    params.set("category", resolveIncidentCategory(item));
  }

  return `/asistente?${params.toString()}`;
}

function resolveFrequentServiceCta(item, copy) {
  const kind = resolveServiceKind(item);
  const frequentCtas = copy?.home?.frequentCtas || {};
  if (kind === "incidencia") {
    return frequentCtas.incidencia || "Reportar";
  }
  if (kind === "estado") {
    return frequentCtas.estado || "Ver más";
  }
  return frequentCtas.tramite || "Iniciar trámite";
}

function FrequentServicesCarousel({ services, copy, hasActiveSession }) {
  const viewportRef = useRef(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const hasMeasuredScrollRef = useRef(false);

  const updateScrollState = useCallback(() => {
    const viewportNode = viewportRef.current;
    if (!viewportNode) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }

    const tolerance = 4;
    const maxScrollLeft = viewportNode.scrollWidth - viewportNode.clientWidth;
    setCanScrollPrev(viewportNode.scrollLeft > tolerance);
    setCanScrollNext(viewportNode.scrollLeft < maxScrollLeft - tolerance);
  }, []);

  useEffect(() => {
    const viewportNode = viewportRef.current;
    if (!viewportNode) {
      return undefined;
    }

    const handleScroll = () => updateScrollState();
    const handleResize = () => updateScrollState();
    viewportNode.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      viewportNode.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [updateScrollState]);

  useEffect(() => {
    if (hasMeasuredScrollRef.current) {
      return;
    }
    hasMeasuredScrollRef.current = true;
    const viewportNode = viewportRef.current;
    if (!viewportNode) {
      return;
    }
    const tolerance = 4;
    const maxScrollLeft = viewportNode.scrollWidth - viewportNode.clientWidth;
    setCanScrollPrev(viewportNode.scrollLeft > tolerance);
    setCanScrollNext(viewportNode.scrollLeft < maxScrollLeft - tolerance);
  }, [services.length]);

  const scrollByStep = useCallback((direction) => {
    const viewportNode = viewportRef.current;
    if (!viewportNode) {
      return;
    }

    const firstCard = viewportNode.querySelector(".home-frequent-card");
    if (!firstCard) {
      return;
    }

    const computedStyles = window.getComputedStyle(viewportNode);
    const gapValue = Number.parseFloat(computedStyles.getPropertyValue("--frequent-carousel-gap")) || 0;
    const step = firstCard.getBoundingClientRect().width + gapValue;
    viewportNode.scrollBy({
      left: direction * step,
      behavior: "smooth",
    });
  }, []);

  const handleViewportKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollByStep(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollByStep(-1);
      }
    },
    [scrollByStep]
  );

  return (
    <div className="home-frequent-carousel">
      <button
        type="button"
        className="home-frequent-carousel__nav home-frequent-carousel__nav--prev"
        aria-label={copy.home.frequentCarouselPrev}
        onClick={() => scrollByStep(-1)}
        disabled={!canScrollPrev}
      >
        <span aria-hidden="true">←</span>
      </button>

      <div
        ref={viewportRef}
        className="home-frequent-carousel__viewport"
        role="region"
        tabIndex={0}
        aria-label={copy.home.frequentCarouselAria}
        onKeyDown={handleViewportKeyDown}
      >
        <ul className="home-frequent-carousel__track">
          {services.map((item) => {
            const href =
              item.badgeType === "identity" && !hasActiveSession
                ? "/login"
                : buildAssistantCardHref(item);
            const serviceKind = resolveServiceKind(item);
            const ctaLabel = resolveFrequentServiceCta(item, copy);

            return (
              <li key={item.title} className="home-frequent-carousel__slide">
                <Link
                  href={href}
                  className={`home-frequent-card home-frequent-card--${serviceKind}`}
                  aria-label={`${copy.home.openItemAriaPrefix} ${item.title}`}
                >
                  <div className="home-frequent-card__icon-wrap">
                    <span className="home-frequent-card__icon" aria-hidden="true">
                      {resolveServiceIcon(item)}
                    </span>
                    {item.badge ? (
                      <span className={`home-frequent-card__badge home-frequent-card__badge--${item.badgeType}`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="home-frequent-card__body">
                    <p className="home-frequent-card__type">{copy.home.frequentTypeLabels[serviceKind]}</p>
                    <h3>{item.title}</h3>
                    <p className="home-frequent-card__description">{item.description}</p>
                  </div>
                  <span className="home-frequent-card__cta">{ctaLabel}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        className="home-frequent-carousel__nav home-frequent-carousel__nav--next"
        aria-label={copy.home.frequentCarouselNext}
        onClick={() => scrollByStep(1)}
        disabled={!canScrollNext}
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function HeroAssistantArtwork() {
  return (
    <svg
      width="720"
      height="420"
      viewBox="0 0 720 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Ilustración de asistente virtual para atención ciudadana"
      className="home-hero-illustration"
    >
      <defs>
        <linearGradient id="bgGlow" x1="0" y1="0" x2="720" y2="420" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3E67C7" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#8ED8F8" stopOpacity="0.12" />
        </linearGradient>

        <linearGradient
          id="botStroke"
          x1="430"
          y1="40"
          x2="640"
          y2="240"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8A97E8" />
          <stop offset="100%" stopColor="#1E4BA8" />
        </linearGradient>

        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7FD6F4" />
          <stop offset="100%" stopColor="#4BBDEB" />
        </linearGradient>

        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#163F8C" floodOpacity="0.10" />
        </filter>
      </defs>

      <rect x="0" y="0" width="720" height="420" fill="url(#bgGlow)" />

      <g
        opacity="0.16"
        stroke="#DCE7FF"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 88H244" />
        <path d="M18 184H312" />
        <path d="M30 286H242" />
        <path d="M258 286H386" />
        <path d="M102 24V354" />
        <path d="M234 24V354" />
        <path d="M356 44V336" />
        <path d="M506 66V320" />

        <rect x="230" y="120" rx="16" ry="16" width="120" height="138" />
        <path d="M256 152L263 159L276 144" />
        <rect x="286" y="145" width="34" height="4" rx="2" />
        <path d="M256 187L263 194L276 179" />
        <rect x="286" y="180" width="34" height="4" rx="2" />
        <path d="M256 222L263 229L276 214" />
        <rect x="286" y="215" width="34" height="4" rx="2" />

        <path d="M126 214V144C126 137.373 131.373 132 138 132H192L224 164V214C224 220.627 218.627 226 212 226H138C131.373 226 126 220.627 126 214Z" />
        <path d="M192 132V157C192 160.866 195.134 164 199 164H224" />
        <path d="M148 182H198" />
        <path d="M148 197H184" />

        <path d="M58 257C58 236.565 74.5655 220 95 220C115.435 220 132 236.565 132 257C132 282 95 314 95 314C95 314 58 282 58 257Z" />
        <circle cx="95" cy="257" r="11" />

        <path d="M406 260V180L454 150L502 180V260" />
        <path d="M418 260V210H442V260" />
        <path d="M466 260V210H490V260" />
        <path d="M396 260H512" />

        <path d="M540 248V204L572 180L604 204V248" />
        <path d="M552 248V222H566V248" />
        <path d="M530 248H614" />

        <path d="M40 112C40 100.954 48.9543 92 60 92H116C127.046 92 136 100.954 136 112V132C136 143.046 127.046 152 116 152H78L58 168V152C48.9543 152 40 143.046 40 132V112Z" />
        <path d="M64 122H112" />
        <path d="M64 136H98" />

        <circle cx="52" cy="54" r="10" />
        <circle cx="84" cy="54" r="10" />
        <circle cx="116" cy="54" r="10" />
      </g>

      <g
        opacity="0.14"
        stroke="#DCE7FF"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="640" cy="100" r="26" />
        <path d="M640 82V100L652 112" />
        <circle cx="612" cy="292" r="20" />
        <path d="M612 278V292L621 300" />
        <path d="M565 86H588" />
        <path d="M576 74V98" />
      </g>

      <g filter="url(#softShadow)">
        <circle cx="514" cy="165" r="72" fill="#7ED6F4" fillOpacity="0.22" />
        <path
          d="M472 134C472 97 502 67 539 67H552C583 67 609 93 609 124V144"
          stroke="#7ED6F4"
          strokeWidth="14"
          strokeLinecap="round"
          opacity="0.55"
        />

        <path
          d="M451 140C451 81.458 498.458 34 557 34C615.542 34 663 81.458 663 140V182C663 240.542 615.542 288 557 288C498.458 288 451 240.542 451 182V140Z"
          fill="#F9FBFF"
          stroke="url(#botStroke)"
          strokeWidth="12"
        />

        <path
          d="M495 82C521 48 572 38 617 56C600 76 589 97 576 111C556 132 526 135 495 118C485 112 486 95 495 82Z"
          fill="#EAF1FF"
          stroke="#7D8FE0"
          strokeWidth="8"
          strokeLinejoin="round"
        />

        <path
          d="M456 150C456 92 503 45 561 45C619 45 666 92 666 150"
          stroke="#304FAF"
          strokeWidth="14"
          strokeLinecap="round"
        />

        <rect x="437" y="142" width="22" height="56" rx="11" fill="#2747A5" />
        <rect x="662" y="142" width="22" height="56" rx="11" fill="#2747A5" />

        <ellipse cx="523" cy="168" rx="7" ry="12" fill="#6EBDEA" />
        <ellipse cx="593" cy="168" rx="7" ry="12" fill="#6EBDEA" />

        <path
          d="M523 216C534 228 552 235 570 235C587 235 602 229 613 218"
          stroke="#465CB6"
          strokeWidth="8"
          strokeLinecap="round"
        />

        <path d="M470 206C470 206 483 223 501 232" stroke="url(#accent)" strokeWidth="8" strokeLinecap="round" />
        <circle cx="506" cy="234" r="6" fill="url(#accent)" />

        <rect x="500" y="286" width="12" height="52" rx="6" fill="#2747A5" />
        <rect x="602" y="286" width="12" height="52" rx="6" fill="#2747A5" />
      </g>

      <g
        opacity="0.22"
        stroke="#D8E6FF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="560" y="236" width="58" height="72" rx="12" />
        <path d="M575 258L580 263L589 252" />
        <rect x="595" y="253" width="12" height="3" rx="1.5" />
        <path d="M575 279L580 284L589 273" />
        <rect x="595" y="274" width="12" height="3" rx="1.5" />

        <path d="M648 236C648 224.402 657.402 215 669 215C680.598 215 690 224.402 690 236C690 250 669 268 669 268C669 268 648 250 648 236Z" />
        <circle cx="669" cy="236" r="6" />
      </g>
    </svg>
  );
}

export default function HomePageClient() {
  const { isAuthenticated } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const hasActiveSession = isAuthenticated;
  const startProcedureHref = "/asistente";
  const primaryHelpItem = copy.home.helpItems[0] || null;
  const secondaryHelpItems = copy.home.helpItems.slice(1);

  return (
    <main className="page page--home">
      <nav className="home-breadcrumb" aria-label={copy.home.breadcrumbAriaLabel}>
        <ol>
          <li>
            <Link href="/">{copy.nav.home}</Link>
          </li>
          <li aria-current="page">{copy.home.breadcrumbCurrent}</li>
        </ol>
      </nav>

      <section className="home-hero" aria-labelledby="titulo-home">
        <div className="home-hero__illustration" aria-hidden="true">
          <HeroAssistantArtwork />
        </div>
        <div className="home-hero__content">
          <span className="home-hero__kicker">{copy.home.kicker}</span>
          <h1 id="titulo-home">{copy.home.title}</h1>
          <p>{copy.home.description}</p>
          <div className="home-hero__actions">
            <Link href={startProcedureHref} className="home-cta home-cta--primary">
              {copy.home.ctaStartProcedure}
            </Link>
          </div>
        </div>
      </section>

      <section id="tramites" className="home-frequent card" aria-labelledby="frequent-title">
        <header className="home-frequent__head">
          <div>
            <h2 id="frequent-title">{copy.home.frequentTitle}</h2>
            <p>{copy.home.frequentDescription}</p>
          </div>
          <Link href="/login" className="home-frequent__all-link">
            {copy.home.viewAllProcedures}
          </Link>
        </header>
        <FrequentServicesCarousel
          services={copy.home.frequentServices}
          copy={copy}
          hasActiveSession={hasActiveSession}
        />
      </section>

      <section className="home-bottom-grid">
        <article className="card home-flow-card">
          <h2>{copy.home.flowTitle}</h2>
          <p>{copy.home.flowDescription}</p>
          <ol className="home-flow-card__steps" aria-label={copy.home.flowStepsAria}>
            {copy.home.attentionFlow.map((step, index) => (
              <li key={step.title} className="home-flow-step">
                <span className="home-flow-step__icon" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </article>

        <article id="ayuda-soporte" className="card home-help-card">
          <h2>{copy.home.helpTitle}</h2>
          <p>{copy.home.helpDescription}</p>
          {primaryHelpItem ? (
            <Link href={primaryHelpItem.href} className="home-help-card__assistant-link">
              {primaryHelpItem.label}
            </Link>
          ) : null}
          <ul className="home-help-card__secondary-links">
            {secondaryHelpItems.map((item) => (
              <li key={item.label}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

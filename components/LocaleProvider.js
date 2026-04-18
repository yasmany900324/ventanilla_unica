"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getDefaultLocale, normalizeLocale } from "../lib/i18n";

export const APP_LOCALE_STORAGE_KEY = "app_locale";
export const APP_LOCALE_COOKIE_NAME = "app_locale";

const CHATBOT_LOCALE_STORAGE_KEY = "chatbot_session_locale";

const LocaleContext = createContext({
  locale: "es",
  setLocale: () => {},
});

function getNavigatorLocale() {
  if (typeof navigator === "undefined") {
    return null;
  }

  return normalizeLocale(navigator.language);
}

function persistLocale(locale) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
  window.localStorage.setItem(CHATBOT_LOCALE_STORAGE_KEY, locale);
  document.cookie = `${APP_LOCALE_COOKIE_NAME}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function LocaleProvider({ initialLocale, children }) {
  const fallbackLocale = getDefaultLocale();
  const [locale, setLocaleState] = useState(() => {
    if (typeof window !== "undefined") {
      const storedLocale = normalizeLocale(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY));
      const browserLocale = getNavigatorLocale();
      return storedLocale || browserLocale || normalizeLocale(initialLocale) || fallbackLocale;
    }
    return normalizeLocale(initialLocale) || fallbackLocale;
  });

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  const setLocale = useCallback(
    (nextLocale) => {
      const normalizedLocale = normalizeLocale(nextLocale) || fallbackLocale;
      setLocaleState(normalizedLocale);
    },
    [fallbackLocale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

import "./globals.css";
import { cookies } from "next/headers";
import PortalShell from "../components/PortalShell";
import { AuthProvider } from "../components/AuthProvider";
import { APP_LOCALE_COOKIE_NAME, LocaleProvider } from "../components/LocaleProvider";
import { getAuthenticatedUserFromToken, SESSION_COOKIE_NAME } from "../lib/auth";
import { getDefaultLocale, normalizeLocale } from "../lib/i18n";

export const metadata = {
  title: "Ventanilla de incidencias",
  description: "MVP para reporte y seguimiento local de incidencias."
};

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const initialLocale = normalizeLocale(cookieStore.get(APP_LOCALE_COOKIE_NAME)?.value) || getDefaultLocale();
  const authenticatedUser = await getAuthenticatedUserFromToken(token);

  return (
    <html lang={initialLocale}>
      <body>
        <LocaleProvider initialLocale={initialLocale}>
          <AuthProvider initialUser={authenticatedUser}>
            <PortalShell>{children}</PortalShell>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}

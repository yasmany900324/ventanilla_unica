import "./globals.css";
import { cookies } from "next/headers";
import PortalShell from "../components/PortalShell";
import { AuthProvider } from "../components/AuthProvider";
import { getAuthenticatedUserFromToken, SESSION_COOKIE_NAME } from "../lib/auth";

export const metadata = {
  title: "Ventanilla de incidencias",
  description: "MVP para reporte y seguimiento local de incidencias."
};

export default async function RootLayout({ children }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);

  return (
    <html lang="es">
      <body>
        <AuthProvider initialUser={authenticatedUser}>
          <PortalShell>{children}</PortalShell>
        </AuthProvider>
      </body>
    </html>
  );
}
